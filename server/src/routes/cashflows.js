'use strict';
/**
 * 出入金（账户级本金搬运）。
 *
 * v6：支持**录入币种选择**。用户可填人民币或美元，系统按汇率换算成账户币种金额：
 *   - 录入币种 = 账户币种 → 直接使用，不经换算
 *   - 账户 USD、录入 CNY → amount(USD) = cny ÷ 汇率
 *   - 账户 CNY、录入 USD → amount(CNY) = usd × 汇率
 * 存储口径：`amount` 恒为**账户币种**金额，`fx` 恒为**账户币种→CNY** 汇率（CNY 账户为 1），
 * 故引擎的 `amount × fx = CNY` 恒成立；另存 `input_currency`/`input_amount` 供追溯与显示。
 */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const { currentFx } = require('../services/fx');

const router = express.Router();
router.use(authRequired);

const round2 = n => Math.round((+n || 0) * 100) / 100;
const CCYS = ['CNY', 'USD'];

function mapRow(c) {
  const fx = c.fx || 1;
  const cur = c.account_currency || null;
  return {
    id: String(c.id), accountId: String(c.account_id), date: c.date, kind: c.kind,
    currency: cur,                                  // 账户币种
    amount: c.amount,                               // 账户币种金额
    fx,                                             // 账户币种→CNY
    amountCNY: round2(c.amount * fx),
    inputCurrency: c.input_currency || cur,         // 用户录入时选的币种
    inputAmount: c.input_amount != null ? c.input_amount : c.amount,
    note: c.note || '',
  };
}

const SELECT = `SELECT c.*, a.currency AS account_currency FROM cash_flow c
                JOIN account a ON a.id = c.account_id`;

router.get('/', (req, res) => {
  let sql = `${SELECT} WHERE c.user_id=?`;
  const params = [req.user.id];
  if (req.query.accountId) { sql += ' AND c.account_id=?'; params.push(req.query.accountId); }
  sql += ' ORDER BY c.date DESC, c.id DESC';
  res.json(getDb().prepare(sql).all(...params).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const date = String(b.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, '日期格式应为 YYYY-MM-DD');
  if (!['deposit', 'withdraw'].includes(b.kind)) return badRequest(res, '类型应为 deposit/withdraw');

  const account = ownedRow(getDb(), 'account', b.accountId, req.user.id);
  if (!account) return badRequest(res, '账户不存在');
  const acctCur = account.currency;                       // 账户交易币种

  /* 录入币种：缺省 = 账户币种（向后兼容） */
  const inputCurrency = CCYS.includes(b.inputCurrency) ? b.inputCurrency : acctCur;
  const inputAmount = Number(b.amount);
  if (!(inputAmount > 0)) return badRequest(res, `金额需大于 0（${inputCurrency}）`);

  /* 汇率：USD→CNY */
  let rate = Number(b.fx);
  if (!isFinite(rate) || rate <= 0) rate = currentFx(date);
  if (!isFinite(rate) || rate <= 0) rate = 7.1;           // 极端兜底
  if (inputCurrency === 'CNY' && acctCur === 'CNY') rate = 1;

  /* 换算为账户币种金额 */
  let amount;
  if (inputCurrency === acctCur) amount = inputAmount;          // 币种一致，不经换算
  else if (inputCurrency === 'CNY') amount = inputAmount / rate; // 账户 USD，录 CNY
  else amount = inputAmount * rate;                             // 账户 CNY，录 USD
  amount = round2(amount);
  if (!(amount > 0)) return badRequest(res, '换算后的账户币种金额需大于 0（汇率或金额过小）');

  const fx = acctCur === 'USD' ? rate : 1;                // 账户币种→CNY

  const info = getDb().prepare(
    `INSERT INTO cash_flow (user_id,account_id,date,kind,amount,fx,input_currency,input_amount,note)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(req.user.id, account.id, date, b.kind, amount, fx, inputCurrency, inputAmount, String(b.note || ''));

  const row = getDb().prepare(`${SELECT} WHERE c.id=? AND c.user_id=?`)
    .get(info.lastInsertRowid, req.user.id);
  res.status(201).json(mapRow(row));
}));

router.delete('/:id', (req, res) => {
  const row = ownedRow(getDb(), 'cash_flow', req.params.id, req.user.id);
  if (!row) return notFound(res);
  getDb().prepare('DELETE FROM cash_flow WHERE id=? AND user_id=?').run(row.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
