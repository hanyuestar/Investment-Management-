'use strict';
/** 数据导出 / 导入（事务覆盖，导入前自动 JSON 备份）/ 示例数据装载 */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/helpers');
const { writeJsonBackup } = require('../services/backup');
const { loadDemoData } = require('../services/demoData');

const router = express.Router();
router.use(authRequired);

/* ---------- 导出 ---------- */
/* =========================================================
 * 备份 payload 公共构造
 *
 * ⚠️ 三种 payload 用途不同，**不可简单合并**：
 *   · 可移植导出（/export）    → 用**显式列名**，是跨设备迁移的稳定契约
 *   · 完整快照（导入前/示例前） → 用 `SELECT *`，要求列完整以便回滚
 * 故此处抽为两个单一职责函数，共享表名与列名定义，避免逐处重复又保留语义差异。
 * ========================================================= */

/** 备份格式标识（**非产品版本**，改动会破坏旧备份导入兼容性，勿随版本变更） */
const BACKUP_SCHEMA = 'invest-manager/v4';

/** 表名映射：payload 键 → 数据库表名 */
const BK_TABLES = {
  accounts: 'account', assets: 'asset', events: 'event', snapshots: 'snapshot',
  benchmarks: 'benchmark', cashFlows: 'cash_flow', dcaPlans: 'dca_plan',
};

/** 可移植导出使用的显式列名（改表结构时须同步此处） */
const BK_PORTABLE_COLS = {
  accounts: 'id,name,kind,currency,note,created_at',
  assets: 'id,account_id,name,code,market,type,currency,price,market_value,unit_price,margin_cny,alerts_json,created_at',
  events: 'id,asset_id,date,kind,side,qty,price,amount,ratio,fee,margin_cny,fx,is_t,note,created_at',
  snapshots: 'month,total',
  benchmarks: 'code,date,value',
  cashFlows: 'id,account_id,date,kind,amount,fx,input_currency,input_amount,note',
  dcaPlans: 'id,asset_id,start_month,months,day,amount,note,active,created_at',
};

/** 安全解析用户设置 JSON */
function readUserSettings(user) {
  try { return JSON.parse(user.settings_json || '{}'); } catch { return {}; }
}

/**
 * 可移植导出 payload（GET /export）。
 * @param {object} user 请求用户（用于取 settings_json）
 */
function buildPortablePayload(user) {
  const db = getDb();
  const uid = user.id;
  const out = {
    schema: BACKUP_SCHEMA,               // ⚠️ 格式标识，勿随产品版本变更
    exportedAt: now(),
    settings: readUserSettings(user),
    fx: db.prepare('SELECT date,rate,source,note FROM fx_rate ORDER BY date').all(),
  };
  for (const [key, table] of Object.entries(BK_TABLES)) {
    const order = key === 'snapshots' ? ' ORDER BY month' : ' ORDER BY id';
    out[key] = db.prepare(`SELECT ${BK_PORTABLE_COLS[key]} FROM ${table} WHERE user_id=?${order}`).all(uid);
  }
  return out;
}

/**
 * 完整快照（用于回滚）：`SELECT *` 取全列。
 * @param {number} uid 用户 id
 * @param {string[]} keys 需要快照的 payload 键（默认全部）
 * @param {boolean} withSettings 是否附带 settings 与 fx（默认 true）
 */
function buildFullSnapshot(uid, keys, withSettings = true) {
  const db = getDb();
  const out = { schema: BACKUP_SCHEMA, exportedAt: now() };
  if (withSettings) {
    const user = db.prepare('SELECT settings_json FROM user WHERE id=?').get(uid);
    out.settings = readUserSettings(user || {});
    out.fx = db.prepare('SELECT date,rate,source,note FROM fx_rate ORDER BY date').all();
  }
  for (const key of (keys || Object.keys(BK_TABLES))) {
    out[key] = db.prepare(`SELECT * FROM ${BK_TABLES[key]} WHERE user_id=?`).all(uid);
  }
  return out;
}

router.get('/export', (req, res) => {
  /* 可移植导出：显式列名 + settings/fx，见 buildPortablePayload */
  res.setHeader('Content-Disposition', `attachment; filename="invest-manager-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(buildPortablePayload(req.user));
});

/* ---------- 导入 ---------- */
const TABLES_USER = ['event', 'asset', 'account', 'snapshot', 'benchmark', 'cash_flow', 'dca_plan', 'notification'];

router.post('/import', asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') return badRequest(res, '导入内容不是合法 JSON 对象');
  if (body.schema && !String(body.schema).startsWith('invest-manager/')) {
    return badRequest(res, '文件标识不匹配，非本系统备份文件');
  }
  if (!Array.isArray(body.accounts) || !Array.isArray(body.assets) || !Array.isArray(body.events)) {
    return badRequest(res, '缺少 accounts/assets/events 必需数据段');
  }
  const db = getDb();
  const uid = req.user.id;

  // 导入前自动备份当前数据（完整快照，SELECT * 含全部列，用于回滚）
  const backupPayload = buildFullSnapshot(uid);
  const backupFile = writeJsonBackup(backupPayload, 'pre-import');

  const counts = { accounts: 0, assets: 0, events: 0, fx: 0, snapshots: 0, benchmarks: 0, cashFlows: 0, dcaPlans: 0 };

  const tx = db.transaction(() => {
    for (const t of TABLES_USER) db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);

    for (const a of body.accounts) {
      db.prepare(`INSERT INTO account (id,user_id,name,kind,currency,note,created_at)
                  VALUES (?,?,?,?,?,?,?)`)
        .run(a.id, uid, a.name, a.kind || 'broker', a.currency || 'CNY', a.note || '', a.created_at || now());
      counts.accounts++;
    }
    const accountIds = new Set(db.prepare('SELECT id FROM account WHERE user_id=?').all(uid).map(r => r.id));
    for (const a of body.assets) {
      if (!accountIds.has(a.account_id)) continue;
      db.prepare(`INSERT INTO asset
        (id,user_id,account_id,name,code,market,type,currency,price,market_value,unit_price,margin_cny,alerts_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        a.id, uid, a.account_id, a.name, a.code || '', a.market || '', a.type, a.currency,
        a.price || 0, a.market_value || 0, a.unit_price || 0, a.margin_cny || 0,
        a.alerts_json || null, a.created_at || now());
      counts.assets++;
    }
    for (const e of body.events) {
      db.prepare(`INSERT INTO event
        (id,user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,margin_cny,fx,is_t,note,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        e.id, uid, e.asset_id, e.date, e.kind, e.side || null, e.qty ?? null, e.price ?? null,
        e.amount ?? null, e.ratio ?? null, e.fee || 0, e.margin_cny || 0,
        e.fx || 1, e.is_t || 0, e.note || '', e.created_at || now());
      counts.events++;
    }
    for (const s of body.snapshots || []) {
      db.prepare('INSERT OR REPLACE INTO snapshot (user_id,month,total) VALUES (?,?,?)').run(uid, s.month, s.total);
      counts.snapshots++;
    }
    for (const b of body.benchmarks || []) {
      db.prepare('INSERT OR REPLACE INTO benchmark (user_id,code,date,value) VALUES (?,?,?,?)')
        .run(uid, b.code || 'CSI300', b.date, b.value);
      counts.benchmarks++;
    }
    for (const c of body.cashFlows || []) {
      if (!accountIds.has(c.account_id)) continue;
      db.prepare(`INSERT INTO cash_flow (id,user_id,account_id,date,kind,amount,fx,input_currency,input_amount,note)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(c.id, uid, c.account_id, c.date, c.kind, c.amount, c.fx || 1,
          c.input_currency || null, c.input_amount == null ? c.amount : c.input_amount, c.note || '');
      counts.cashFlows++;
    }
    for (const p of body.dcaPlans || []) {
      db.prepare(`INSERT INTO dca_plan (id,user_id,asset_id,start_month,months,day,amount,note,active,created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        p.id, uid, p.asset_id, p.start_month, p.months || 12, p.day || 15, p.amount,
        p.note || '定投', p.active === undefined ? 1 : (p.active ? 1 : 0), p.created_at || now());
      counts.dcaPlans++;
    }
    // 全局汇率仅管理员可导入
    if (req.user.role === 'admin' && Array.isArray(body.fx)) {
      for (const f of body.fx) {
        db.prepare(`INSERT INTO fx_rate (date,rate,source,note) VALUES (?,?,?,?)
                    ON CONFLICT(date,source) DO UPDATE SET rate=excluded.rate, note=excluded.note`)
          .run(f.date, f.rate, f.source || 'manual', f.note || '');
        counts.fx++;
      }
    }
    if (body.settings && typeof body.settings === 'object') {
      db.prepare('UPDATE user SET settings_json=? WHERE id=?').run(JSON.stringify(body.settings), uid);
    }
  });
  tx();

  res.json({ ok: true, counts, backupFile: backupFile.replace(/\\/g, '/').split('/').pop() });
}));

/* ---------- 装载示例数据（会先备份） ---------- */
router.post('/demo', asyncHandler(async (req, res) => {
  const db = getDb();
  const backupFile = writeJsonBackup(
    /* 保持原行为：仅快照示例数据会覆盖的三张表，且不附带 settings/fx */
    buildFullSnapshot(req.user.id, ['accounts', 'assets', 'events'], false), 'pre-demo');
  loadDemoData(db, req.user.id);
  res.json({ ok: true, backupFile: backupFile.replace(/\\/g, '/').split('/').pop() });
}));

module.exports = router;
