'use strict';
/** 出入金（账户级本金搬运，与收益口径分离） */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const { currentFx } = require('../services/fx');

const router = express.Router();
router.use(authRequired);

const mapRow = c => ({
  id: String(c.id), accountId: String(c.account_id), date: c.date, kind: c.kind,
  amount: c.amount, fx: c.fx || 1, note: c.note || '',
});

router.get('/', (req, res) => {
  let sql = 'SELECT * FROM cash_flow WHERE user_id=?';
  const params = [req.user.id];
  if (req.query.accountId) { sql += ' AND account_id=?'; params.push(req.query.accountId); }
  sql += ' ORDER BY date DESC, id DESC';
  res.json(getDb().prepare(sql).all(...params).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const date = String(b.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, '日期格式应为 YYYY-MM-DD');
  if (!['deposit', 'withdraw'].includes(b.kind)) return badRequest(res, '类型应为 deposit/withdraw');
  const amount = Number(b.amount);
  if (!(amount > 0)) return badRequest(res, '金额需大于 0');
  const account = ownedRow(getDb(), 'account', b.accountId, req.user.id);
  if (!account) return badRequest(res, '账户不存在');
  let fx = Number(b.fx);
  if (!isFinite(fx) || fx <= 0) fx = account.currency === 'USD' ? currentFx(date) : 1;
  if (account.currency === 'CNY') fx = 1;

  const info = getDb().prepare(
    'INSERT INTO cash_flow (user_id,account_id,date,kind,amount,fx,note) VALUES (?,?,?,?,?,?,?)'
  ).run(req.user.id, account.id, date, b.kind, amount, fx, String(b.note || ''));
  res.status(201).json(mapRow(ownedRow(getDb(), 'cash_flow', info.lastInsertRowid, req.user.id)));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'cash_flow', req.params.id, req.user.id);
  if (!row) return notFound(res);
  getDb().prepare('DELETE FROM cash_flow WHERE id=? AND user_id=?').run(row.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
