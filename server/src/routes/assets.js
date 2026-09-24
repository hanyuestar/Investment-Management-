'use strict';
/** 资产 CRUD。类型/市场/币种/所属账户创建后不可改（避免成本链错乱），仅可改名/代码/现价净值市值/预警。
 *  v5：非股票引入「单位净值 unitPrice」，市值 = 份额 × 单位净值；创建时可一并录入「期初建仓」。 */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, ownedRow } = require('../middleware/helpers');
const { currentFx } = require('../services/fx');

const router = express.Router();
router.use(authRequired);

const TYPES = ['stock', 'fund', 'wealth', 'bond'];
const CCYS = ['CNY', 'USD'];
const MARKETS = ['CN', 'US'];

function mapRow(a) {
  return {
    id: String(a.id), accountId: String(a.account_id), name: a.name, code: a.code || '',
    market: a.market || '', type: a.type, currency: a.currency,
    price: a.price || 0, marketValue: a.market_value || 0, unitPrice: a.unit_price || 0,
    marginCNY: a.margin_cny || 0,
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

/**
 * 解析融资额：支持 CNY/USD 录入，统一换算为 CNY 存储。
 * 仅券商账户（kind='broker'）允许融资。
 */
function parseMargin(body, account, dateStr) {
  const raw = Number(body.margin != null ? body.margin : body.marginCNY);
  if (!isFinite(raw) || raw === 0) return 0;
  if (raw < 0) return '融资金额不能为负';
  if (account.kind !== 'broker') return '仅券商账户支持融资';
  const inCur = ['CNY', 'USD'].includes(body.marginCurrency) ? body.marginCurrency : 'CNY';
  if (inCur === 'CNY') return +raw.toFixed(2);
  const rate = (+body.marginFx > 0) ? +body.marginFx : currentFx(dateStr || now().slice(0, 10));
  if (!isFinite(rate) || rate <= 0) return '汇率非法，无法换算融资金额';
  return +(raw * rate).toFixed(2);      // USD → CNY
}

/** 解析并校验「期初建仓」输入；返回 {qty, price, amount, date} 或错误字符串 */
function parseOpening(o) {
  if (!o) return null;
  const qty = Number(o.qty);
  if (!(qty > 0)) return '期初份额需大于 0';
  let price = o.costPrice !== undefined && o.costPrice !== '' ? Number(o.costPrice) : null;
  let amount = o.amount !== undefined && o.amount !== '' ? Number(o.amount) : null;
  if (price !== null && !(price >= 0)) return '期初成本单价非法';
  if (amount !== null && !(amount >= 0)) return '期初投入本金非法';
  if (price === null && amount === null) return '请填写期初成本单价或期初投入本金';
  if (price === null) price = amount / qty;              // 由本金反推成本单价
  if (amount === null) amount = qty * price;
  const date = String(o.date || '').slice(0, 10) || now().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '期初建仓日期格式应为 YYYY-MM-DD';
  return { qty, price, amount, date };
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
  const isStock = type === 'stock';
  const price = Number(b.price) || 0;
  let unitPrice = Number(b.unitPrice) || 0;
  let marketValue = Number(b.marketValue) || 0;
  if (price < 0 || marketValue < 0 || unitPrice < 0) return badRequest(res, '价格/净值/市值不能为负');
  if (!isStock && !(unitPrice > 0)) {
    return badRequest(res, '非股票资产必须填写单位净值（市值 = 份额 × 单位净值）');
  }

  const opening = parseOpening(b.opening);
  if (typeof opening === 'string') return badRequest(res, opening);

  /* 有期初建仓但未填当前净值/市值时，按成本单价兜底，避免市值算不出来 */
  if (opening && !isStock && !(unitPrice > 0)) unitPrice = opening.price;
  if (opening && !isStock && !(marketValue > 0)) marketValue = opening.qty * unitPrice;

  const marginCNY = parseMargin(b, account, opening ? opening.date : null);
  if (typeof marginCNY === 'string') return badRequest(res, marginCNY);

  const info = getDb().prepare(`INSERT INTO asset
    (user_id,account_id,name,code,market,type,currency,price,market_value,unit_price,margin_cny,alerts_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, account.id, name, String(b.code || ''), market, type, currency,
      isStock ? price : 0,
      isStock ? 0 : marketValue,
      isStock ? 0 : unitPrice,
      marginCNY,
      null, now());

  if (opening) {
    getDb().prepare(`INSERT INTO event
      (user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,fx,is_t,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,NULL,0,1,0,?,?)`)
      .run(req.user.id, info.lastInsertRowid, opening.date, 'opening', null,
        opening.qty, opening.price, opening.amount, '期初建仓（录入资产时填写）', now());
  }
  res.status(201).json(mapRow(ownedRow(getDb(), 'asset', info.lastInsertRowid, req.user.id)));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const row = ownedRow(getDb(), 'asset', req.params.id, req.user.id);
  if (!row) return notFound(res);
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : row.name;
  if (!name) return badRequest(res, '资产名称不能为空');
  const code = b.code !== undefined ? String(b.code) : row.code;
  let price = row.price, mv = row.market_value, up = row.unit_price;
  if (b.price !== undefined) price = Number(b.price) || 0;
  if (b.marketValue !== undefined) mv = Number(b.marketValue) || 0;
  if (b.unitPrice !== undefined) up = Number(b.unitPrice) || 0;
  if (price < 0 || mv < 0 || up < 0) return badRequest(res, '价格/净值/市值不能为负');
  if (row.type !== 'stock' && b.unitPrice !== undefined && !(up > 0)) {
    return badRequest(res, '非股票资产的单位净值需大于 0');
  }

  let alertsJson = row.alerts_json;
  if (b.alerts !== undefined) {
    const result = validateAlerts(b.alerts);
    if (typeof result === 'string') return badRequest(res, result);
    alertsJson = result ? JSON.stringify(result) : null;
  }

  let margin = row.margin_cny || 0;
  if (b.margin !== undefined || b.marginCNY !== undefined) {
    const account = ownedRow(getDb(), 'account', row.account_id, req.user.id) || { kind: 'other' };
    const m = parseMargin(b, account, null);
    if (typeof m === 'string') return badRequest(res, m);
    margin = m;
  }

  getDb().prepare('UPDATE asset SET name=?,code=?,price=?,market_value=?,unit_price=?,margin_cny=?,alerts_json=? WHERE id=? AND user_id=?')
    .run(name, code, price, mv, up, margin, alertsJson, row.id, req.user.id);
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
