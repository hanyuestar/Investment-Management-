'use strict';
/**
 * 行情同步（POST /api/quotes/sync）：
 * 按资产代码拉取最新单价并回写（股票→price，基金→unit_price），引擎实时重算盈亏/市值。
 * 手动触发 = 强制刷新（含用户手动维护的价格）；自动定时同步见 services/scheduler.js
 * （股票每 15 分钟、基金每日收盘净值一次，自动同步跳过手动改过的价格）。
 * 代码错误/接口未返回 → 逐个标的名报错，提示用户修正。
 */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/helpers');
const quotesService = require('../services/quotes');

const router = express.Router();
router.use(authRequired);

router.post('/sync', asyncHandler(async (req, res) => {
  const r = await quotesService.syncUserQuotes(getDb(), req.user.id, { force: true });
  res.json(r);
}));

module.exports = router;
