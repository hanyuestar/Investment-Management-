'use strict';
/**
 * SQLite 初始化与迁移（WAL 模式）。
 * 原则：不存算好的结果——成本/盈亏/税负全部由 calc 引擎按 event 实时计算。
 */
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { config, ensureDirs } = require('./config');

let db = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 用户
CREATE TABLE IF NOT EXISTS user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',
  status        TEXT    NOT NULL DEFAULT 'active',      -- active | disabled
  created_at    TEXT    NOT NULL,
  last_login_at TEXT,
  settings_json TEXT    NOT NULL DEFAULT '{}'
);

-- 邮箱验证码（登录用）
CREATE TABLE IF NOT EXISTS login_code (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 账户（券商/银行/其他）
CREATE TABLE IF NOT EXISTS account (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'broker',           -- broker | bank | other
  currency   TEXT NOT NULL DEFAULT 'CNY',
  note       TEXT,
  created_at TEXT NOT NULL
);

-- 资产
CREATE TABLE IF NOT EXISTS asset (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id   INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  code         TEXT,
  market       TEXT,                                   -- CN | US
  type         TEXT NOT NULL,                          -- stock | fund | wealth | bond
  currency     TEXT NOT NULL,                          -- CNY | USD
  price        REAL NOT NULL DEFAULT 0,                -- 股票最新价（账户币种）
  market_value REAL NOT NULL DEFAULT 0,                -- 非股票当前市值（账户币种）
  unit_price   REAL NOT NULL DEFAULT 0,                -- 非股票单位净值/单价（账户币种；市值 = 份额 × 单位净值）
  alerts_json  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_user ON asset(user_id);
CREATE INDEX IF NOT EXISTS idx_asset_account ON asset(account_id);

-- 交易与现金流统一事件表
CREATE TABLE IF NOT EXISTS event (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  asset_id  INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  kind      TEXT NOT NULL,     -- buy|sell|div|bonus|split|invest|redeem|income
  side      TEXT,              -- 股票：buy|sell|div|bonus|split
  qty       REAL,
  price     REAL,
  amount    REAL,
  ratio     REAL,
  fee       REAL NOT NULL DEFAULT 0,
  fx        REAL NOT NULL DEFAULT 1,   -- ★记录时锁定汇率（1 USD = ? CNY）
  is_t      INTEGER NOT NULL DEFAULT 0,
  note      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_asset ON event(asset_id, date);
CREATE INDEX IF NOT EXISTS idx_event_user ON event(user_id);

-- 汇率时间线（手动 + 自动，全局共享）
CREATE TABLE IF NOT EXISTS fx_rate (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  date   TEXT NOT NULL,
  rate   REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | auto
  note   TEXT,
  UNIQUE(date, source)
);

-- 月末快照
CREATE TABLE IF NOT EXISTS snapshot (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  month   TEXT NOT NULL,        -- YYYY-MM
  total   REAL NOT NULL,
  UNIQUE(user_id, month)
);

-- 基准点位
CREATE TABLE IF NOT EXISTS benchmark (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  code    TEXT NOT NULL DEFAULT 'CSI300',
  date    TEXT NOT NULL,        -- YYYY-MM
  value   REAL NOT NULL,
  UNIQUE(user_id, code, date)
);

-- 出入金（账户级本金搬运）
CREATE TABLE IF NOT EXISTS cash_flow (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id     INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  kind           TEXT NOT NULL,     -- deposit | withdraw
  amount         REAL NOT NULL,     -- 【账户币种】金额（换算后）
  fx             REAL NOT NULL DEFAULT 1,  -- 账户币种→CNY 汇率（CNY 账户恒为 1）
  input_currency TEXT,              -- 用户录入时选择的币种（CNY | USD）
  input_amount   REAL,              -- 用户录入的原始金额（input_currency 计价）
  note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_cashflow_user ON cash_flow(user_id);

-- 定投计划
CREATE TABLE IF NOT EXISTS dca_plan (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  asset_id    INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  start_month TEXT NOT NULL,
  months      INTEGER NOT NULL,
  day         INTEGER NOT NULL DEFAULT 15,
  amount      REAL NOT NULL,
  note        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- 系统配置（键值，如 SMTP 配置；敏感字段加密）
CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 站内通知（预警扫描等）
CREATE TABLE IF NOT EXISTS notification (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'alert',
  title      TEXT NOT NULL,
  body       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  dedup_key  TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_user ON notification(user_id, is_read);
`;

function now() {
  return new Date().toISOString();
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function init(dbPath) {
  ensureDirs();
  const resolved = dbPath || config.DB_PATH;
  db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate();            // 老库补列 + v5 口径迁移
  bootstrapAdmin();
  return db;
}

/** 幂等补列（老库升级用；新库由 SCHEMA 直接建出） */
function addColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function migrate() {
  addColumn('asset', 'unit_price', 'unit_price REAL NOT NULL DEFAULT 0');
  addColumn('cash_flow', 'input_currency', 'input_currency TEXT');
  addColumn('cash_flow', 'input_amount', 'input_amount REAL');
  /* 老出入金记录：录入币种即账户币种、原始金额即 amount（幂等，只补 NULL 行） */
  db.prepare(`UPDATE cash_flow
    SET input_currency = COALESCE((SELECT a.currency FROM account a WHERE a.id = cash_flow.account_id), 'CNY'),
        input_amount   = amount
    WHERE input_currency IS NULL OR input_amount IS NULL`).run();
  migrateV5Caliber();
}

/** 迁移标记键（写在 system_config，幂等） */
const MIGRATION_KEY = 'schema_v5_caliber';

/**
 * v5 口径迁移：让老数据也能用「份额 + 成本」框架计算，且**不产生虚增收益**。
 *  1) 非股票资产补单位净值：缺省 1（即「1 份 = 1 账户币种」，份额 = 金额）——这是最常见
 *     的记账近似；用户可在资产编辑里改成真实净值。
 *  2) 非股票既有 invest/redeem 事件补 qty = amount / unit_price，使「份额 × 净值 = 金额」自洽。
 *  3) **无任何事件**却已有市值的资产，补一条 opening（成本 = 当前市值）→ 期初收益为 0，
 *     不把存量仓位误算成盈利；用户可编辑该事件填入真实成本。
 *  股票不处理：其买入事件本就带 qty，成本口径未变。
 */
function migrateV5Caliber() {
  if (getConfig(MIGRATION_KEY)) return;
  const ts = now();
  const run = db.transaction(() => {
    db.prepare("UPDATE asset SET unit_price = 1 WHERE type <> 'stock' AND (unit_price IS NULL OR unit_price = 0)").run();

    const assets = db.prepare('SELECT id,user_id,type,unit_price,market_value,currency,created_at FROM asset').all();
    const selEv = db.prepare('SELECT id,kind,side,qty,amount,ratio FROM event WHERE asset_id=? ORDER BY date, id');
    const updEv = db.prepare('UPDATE event SET qty=?, price=? WHERE id=?');
    const updUp = db.prepare('UPDATE asset SET unit_price=? WHERE id=?');
    const insEv = db.prepare(`INSERT INTO event
      (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,fx,is_t,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,NULL,0,?,0,?,?)`);

    let fixedQty = 0, addedOpening = 0, setNav = 0;
    for (const a of assets) {
      if (a.type === 'stock') continue;
      const up0 = +a.unit_price > 0 ? +a.unit_price : 1;
      const evs = selEv.all(a.id);

      /* 1) 既有 invest/redeem 事件补份额：qty = 金额 ÷ 净值（净值缺省 1 → 份额 = 金额） */
      for (const e of evs) {
        const act = e.side || e.kind;
        if ((act === 'invest' || act === 'redeem') && !(+e.qty > 0)) {
          const amt = +e.amount || 0;
          if (amt > 0) { updEv.run(+(amt / up0).toFixed(6), up0, e.id); fixedQty++; }
        }
      }

      /* 2) 无任何事件的期初持仓：补一条 opening（成本 = 当前市值 → 收益为 0，不虚增） */
      if (evs.length === 0 && +a.market_value > 0) {
        const mv = +a.market_value, q = +(mv / up0).toFixed(6);
        const d = String(a.created_at || ts).slice(0, 10);
        insEv.run(a.user_id, a.id, d, 'opening', null, q, up0, +(q * up0).toFixed(2), 1,
          '期初建仓（迁移自旧数据，成本按当时市值，可编辑）', ts);
        addedOpening++;
      }

      /* 3) 用「市值 ÷ 份额」反推单位净值，**保证迁移后市值不变** */
      const after = selEv.all(a.id);
      let q = 0;
      for (const e of after) {
        const act = e.side || e.kind, eq = +e.qty || 0;
        if (act === 'invest' || act === 'opening' || act === 'bonus') q += eq;
        else if (act === 'redeem' || act === 'sell') q -= eq;
        else if (act === 'split') q *= (+e.ratio || 1);
      }
      if (q > 0 && +a.market_value > 0) {
        const up = +(+a.market_value / q).toFixed(8);
        if (Math.abs(up - up0) > 1e-9) { updUp.run(up, a.id); setNav++; }
      }
    }
    setConfig(MIGRATION_KEY, { at: ts, version: 5, fixedQty, addedOpening, setNav });
    if (fixedQty || addedOpening || setNav) {
      console.log(`[migrate] v5 口径：补份额 ${fixedQty} 笔，补期初建仓 ${addedOpening} 笔，校正单位净值 ${setNav} 个资产`);
    }
  });
  run();
}

function getDb() {
  if (!db) throw new Error('DB not initialized. Call init() first.');
  return db;
}

/** 首次启动初始化内置管理员（已存在管理员则跳过） */
function bootstrapAdmin() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM user WHERE role='admin'").get();
  if (row.n > 0) return;
  const hash = bcrypt.hashSync(config.ADMIN.password, 10);
  db.prepare(`INSERT INTO user (username,email,password_hash,role,status,created_at,settings_json)
              VALUES (?,?,?,'admin','active',?,?)`)
    .run(config.ADMIN.username, config.ADMIN.email, hash, now(), JSON.stringify({}));
  console.log(`[init] 已创建管理员账号: ${config.ADMIN.username}（请尽快修改默认密码）`);
}

/* ---------- 系统配置 ---------- */
function getConfig(key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM system_config WHERE key=?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch { return fallback; }
}
function setConfig(key, value) {
  db.prepare(`INSERT INTO system_config(key,value_json,updated_at) VALUES(?,?,?)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`)
    .run(key, JSON.stringify(value), now());
}

module.exports = { init, getDb, now, today, getConfig, setConfig };
