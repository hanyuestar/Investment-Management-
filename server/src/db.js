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
  price        REAL NOT NULL DEFAULT 0,                -- 股票最新价（原币）
  market_value REAL NOT NULL DEFAULT 0,                -- 非股票当前市值（原币）
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
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL,     -- deposit | withdraw
  amount     REAL NOT NULL,     -- 原币
  fx         REAL NOT NULL DEFAULT 1,
  note       TEXT
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
  bootstrapAdmin();
  return db;
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
