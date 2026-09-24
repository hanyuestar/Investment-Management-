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
router.get('/export', (req, res) => {
  const db = getDb();
  const uid = req.user.id;
  const payload = {
    schema: 'invest-manager/v4',
    exportedAt: now(),
    settings: (() => { try { return JSON.parse(req.user.settings_json || '{}'); } catch { return {}; } })(),
    fx: db.prepare('SELECT date,rate,source,note FROM fx_rate ORDER BY date').all(),
    accounts: db.prepare('SELECT id,name,kind,currency,note,created_at FROM account WHERE user_id=? ORDER BY id').all(uid),
    assets: db.prepare(`SELECT id,account_id,name,code,market,type,currency,price,market_value,unit_price,margin_cny,alerts_json,created_at
                        FROM asset WHERE user_id=? ORDER BY id`).all(uid),
    events: db.prepare(`SELECT id,asset_id,date,kind,side,qty,price,amount,ratio,fee,margin_cny,fx,is_t,note,created_at
                        FROM event WHERE user_id=? ORDER BY id`).all(uid),
    snapshots: db.prepare('SELECT month,total FROM snapshot WHERE user_id=? ORDER BY month').all(uid),
    benchmarks: db.prepare('SELECT code,date,value FROM benchmark WHERE user_id=? ORDER BY date').all(uid),
    cashFlows: db.prepare('SELECT id,account_id,date,kind,amount,fx,input_currency,input_amount,note FROM cash_flow WHERE user_id=? ORDER BY id').all(uid),
    dcaPlans: db.prepare(`SELECT id,asset_id,start_month,months,day,amount,note,active,created_at
                          FROM dca_plan WHERE user_id=? ORDER BY id`).all(uid),
  };
  res.setHeader('Content-Disposition', `attachment; filename="invest-manager-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(payload);
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

  // 导入前自动备份当前数据（JSON 快照落到 data/backups/）
  const backupPayload = {
    schema: 'invest-manager/v4', exportedAt: now(),
    settings: (() => { try { return JSON.parse(req.user.settings_json || '{}'); } catch { return {}; } })(),
    fx: db.prepare('SELECT date,rate,source,note FROM fx_rate ORDER BY date').all(),
    accounts: db.prepare('SELECT id,name,kind,currency,note,created_at FROM account WHERE user_id=?').all(uid),
    assets: db.prepare('SELECT * FROM asset WHERE user_id=?').all(uid),
    events: db.prepare('SELECT * FROM event WHERE user_id=?').all(uid),
    snapshots: db.prepare('SELECT * FROM snapshot WHERE user_id=?').all(uid),
    benchmarks: db.prepare('SELECT * FROM benchmark WHERE user_id=?').all(uid),
    cashFlows: db.prepare('SELECT * FROM cash_flow WHERE user_id=?').all(uid),
    dcaPlans: db.prepare('SELECT * FROM dca_plan WHERE user_id=?').all(uid),
  };
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
  const backupFile = writeJsonBackup({
    schema: 'invest-manager/v4', exportedAt: now(),
    accounts: db.prepare('SELECT * FROM account WHERE user_id=?').all(req.user.id),
    assets: db.prepare('SELECT * FROM asset WHERE user_id=?').all(req.user.id),
    events: db.prepare('SELECT * FROM event WHERE user_id=?').all(req.user.id),
  }, 'pre-demo');
  loadDemoData(db, req.user.id);
  res.json({ ok: true, backupFile: backupFile.replace(/\\/g, '/').split('/').pop() });
}));

module.exports = router;
