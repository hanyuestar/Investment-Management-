'use strict';
/** 资产 CRUD。类型/市场/币种/所属账户创建后不可改（避免成本链错乱），仅可改名/代码/现价市值/预警 */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');

const router = express.Router();
router.use(authRequired);

const TYPES = ['stock', 'fund', 'wealth', 'bond'];
const CCYS = ['CNY', 'USD'];
const MARKETS = ['CN', 'US'];

function mapRow(a) {
  return {
    id: String(a.id), accountId: String(a.account_id), name: a.name, code: a.code || '',
    market: a.market || '', type: a.type, currency: a.currency,
    price: a.price || 0, marketValue: a.market_value || 0,
    alerts: a.alerts_json ? JSON.parse(a.alerts_json) : null,
    createdAt: a.created_at,
  };
}

function validateAlerts(al) {
  if (al === null || al === undefined) return null;
  if (typeof al !== 'object') return '预警参数格式错误';
  const keys = ['takeProfitPrice', 'stopLossPrice', 'takeProfitRate', 'stopLossRate'];
  const out = {};
  for (const k of keys) {
    if (al[k] === null || al[k] === '' || al[k] === undefined) continue;
    const v = Number(al[k]);
    if (!isFinite(v) || v < 0) return `预警阈值 ${k} 非法`;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM asset WHERE user_id=? ORDER BY id').all(req.user.id);
  res.json(rows.map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return badRequest(res, '请填写资产名称');
  const type = TYPES.includes(b.type) ? b.type : null;
  if (!type) return badRequest(res, '资产类型非法');
  const currency = CCYS.includes(b.currency) ? b.currency : null;
  if (!currency) return badRequest(res, '币种非法');
  const account = ownedRow(getDb(), 'account', b.accountId, req.user.id);
  if (!account) return badRequest(res, '所属账户不存在');

  let market = '';
  if (type === 'stock') {
    if (!MARKETS.includes(b.market)) return badRequest(res, '股票必须选择市场 A股(CN)/美股(US)');
    market = b.market;
  }
  const price = Number(b.price) || 0;
  const marketValue = Number(b.marketValue) || 0;
  if (price < 0 || marketValue < 0) return badRequest(res, '价格/市值不能为负');

  const info = getDb().prepare(`INSERT INTO asset
    (user_id,account_id,name,code,market,type,currency,price,market_value,alerts_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, account.id, name, String(b.code || ''), market, type, currency,
      type === 'stock' ? price : 0,
      type === 'stock' ? 0 : marketValue,
      null, now());
  res.status(201).json(mapRow(ownedRow(getDb(), 'asset', info.lastInsertRowid, req.user.id)));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const row = ownedRow(getDb(), 'asset', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : row.name;
  if (!name) return badRequest(res, '资产名称不能为空');
  const code = b.code !== undefined ? String(b.code) : row.code;
  let price = row.price, mv = row.market_value;
  if (b.price !== undefined) price = Number(b.price) || 0;
  if (b.marketValue !== undefined) mv = Number(b.marketValue) || 0;
  if (price < 0 || mv < 0) return badRequest(res, '价格/市值不能为负');

  let alertsJson = row.alerts_json;
  if (b.alerts !== undefined) {
    const result = validateAlerts(b.alerts);
    if (typeof result === 'string') return badRequest(res, result);
    alertsJson = result ? JSON.stringify(result) : null;
  }

  getDb().prepare('UPDATE asset SET name=?,code=?,price=?,market_value=?,alerts_json=? WHERE id=? AND user_id=?')
    .run(name, code, price, mv, alertsJson, row.id, req.user.id);
  res.json(mapRow(ownedRow(getDb(), 'asset', row.id, req.user.id)));
}));

/** 单独更新预警设置 */
router.put('/:id/alerts', asyncHandler(async (req, res) => {
  const row = ownedRow(getDb(), 'asset', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const result = validateAlerts(req.body?.alerts);
  if (typeof result === 'string') return badRequest(res, result);
  getDb().prepare('UPDATE asset SET alerts_json=? WHERE id=? AND user_id=?')
    .run(result ? JSON.stringify(result) : null, row.id, req.user.id);
  res.json(mapRow(ownedRow(getDb(), 'asset', row.id, req.user.id)));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'asset', req.params.id, req.user.id);
  if (!row) return notFound(res);
  getDb().prepare('DELETE FROM asset WHERE id=? AND user_id=?').run(row.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
