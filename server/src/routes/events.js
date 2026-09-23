'use strict';
/** 交易与现金流事件 CRUD（统一 event 表） */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const { currentFx } = require('../services/fx');

const router = express.Router();
router.use(authRequired);

const STOCK_SIDES = ['buy', 'sell', 'div', 'bonus', 'split'];
const FLOW_KINDS = ['invest', 'redeem', 'income'];

function mapRow(e) {
  return {
    id: String(e.id), assetId: String(e.asset_id), date: e.date, kind: e.kind, side: e.side,
    qty: e.qty, price: e.price, amount: e.amount, ratio: e.ratio, fee: e.fee || 0,
    fx: e.fx || 1, isT: e.is_t ? 1 : 0, note: e.note || '', createdAt: e.created_at,
  };
}

/** 校验并归一化事件载荷 */
function normalize(body, asset) {
  const date = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '日期格式应为 YYYY-MM-DD' };
  const isStock = asset.type === 'stock';
  const allowed = isStock ? STOCK_SIDES : FLOW_KINDS;
  const type = isStock ? String(body.side || body.kind || '') : String(body.kind || '');
  if (!allowed.includes(type)) return { error: `该资产允许的事件类型：${allowed.join(' / ')}` };

  const fee = Math.max(0, Number(body.fee) || 0);
  let fx = Number(body.fx);
  if (!isFinite(fx) || fx <= 0) fx = asset.currency === 'USD' ? currentFx(date) : 1;
  if (asset.currency === 'CNY') fx = 1;

  const v = { date, fee, fx, note: String(body.note || ''), isT: body.isT ? 1 : 0 };
  if (isStock) {
    v.kind = type; v.side = type;
    if (type === 'buy' || type === 'sell') {
      const qty = Number(body.qty), price = Number(body.price);
      if (!(qty > 0) || !(price > 0)) return { error: '数量与成交价需大于 0' };
      v.qty = qty; v.price = price;
    } else if (type === 'div') {
      const amount = Number(body.amount);
      if (!(amount > 0)) return { error: '分红金额需大于 0' };
      v.amount = amount;
    } else if (type === 'bonus') {
      const qty = Number(body.qty);
      if (!(qty > 0)) return { error: '送股数量需大于 0' };
      v.qty = qty;
    } else if (type === 'split') {
      const ratio = Number(body.ratio);
      if (!(ratio > 0)) return { error: '拆分比例需大于 0（0.5 表示合股）' };
      v.ratio = ratio;
    }
  } else {
    const amount = Number(body.amount);
    if (!(amount > 0)) return { error: '金额需大于 0' };
    v.kind = type; v.side = null; v.amount = amount;
  }
  return { value: v };
}

router.get('/', (req, res) => {
  const db = getDb();
  let sql = `SELECT e.* FROM event e JOIN asset a ON e.asset_id=a.id
             WHERE e.user_id=?`;
  const params = [req.user.id];
  if (req.query.assetId) { sql += ' AND e.asset_id=?'; params.push(req.query.assetId); }
  if (req.query.accountId) { sql += ' AND a.account_id=?'; params.push(req.query.accountId); }
  if (req.query.kind) { sql += ' AND e.kind=?'; params.push(req.query.kind); }
  sql += ' ORDER BY e.date DESC, e.id DESC';
  res.json(db.prepare(sql).all(...params).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const asset = ownedRow(getDb(), 'asset', req.body?.assetId, req.user.id);
  if (!asset) return badRequest(res, '资产不存在或无权操作');
  const { value, error } = normalize(req.body || {}, asset);
  if (error) return badRequest(res, error);

  const info = getDb().prepare(`INSERT INTO event
    (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,fx,is_t,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    req.user.id, asset.id, value.date, value.kind, value.side,
    value.qty ?? null, value.price ?? null, value.amount ?? null, value.ratio ?? null,
    value.fee, value.fx, value.isT, value.note, now());
  res.status(201).json(mapRow(ownedRow(getDb(), 'event', info.lastInsertRowid, req.user.id)));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const row = ownedRow(db, 'event', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const asset = db.prepare('SELECT * FROM asset WHERE id=? AND user_id=?').get(row.asset_id, req.user.id);
  const merged = {
    date: req.body.date ?? row.date, kind: row.kind, side: row.side,
    qty: row.qty, price: row.price, amount: row.amount, ratio: row.ratio,
    fee: row.fee, fx: row.fx, isT: row.is_t, note: row.note, ...req.body,
  };
  const { value, error } = normalize(merged, asset);
  if (error) return badRequest(res, error);
  db.prepare(`UPDATE event SET date=?,kind=?,side=?,qty=?,price=?,amount=?,ratio=?,fee=?,fx=?,is_t=?,note=?
              WHERE id=? AND user_id=?`).run(
    value.date, value.kind, value.side, value.qty ?? null, value.price ?? null,
    value.amount ?? null, value.ratio ?? null, value.fee, value.fx, value.isT, value.note,
    row.id, req.user.id);
  res.json(mapRow(ownedRow(db, 'event', row.id, req.user.id)));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'event', req.params.id, req.user.id);
  if (!row) return notFound(res);
  getDb().prepare('DELETE FROM event WHERE id=? AND user_id=?').run(row.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
