'use strict';
/** 只读计算与报表接口（服务端实时计算，不存派生结果） */
const express = require('express');
const { authRequired } = require('../middleware/auth');
const portfolio = require('../services/portfolio');

const router = express.Router();
router.use(authRequired);

/** 原始状态一次性拉取（账户/资产/事件/汇率/快照/基准/出入金/定投/设置） */
router.get('/state', (req, res) => {
  res.json(portfolio.rawState(req.user.id));
});

/** 全量派生数据（KPI/看板/绩效/配置/风控/税务/报表/出入金汇总） */
router.get('/compute', (req, res) => {
  res.json(portfolio.computeAll(req.user.id, req.query.accountId));
});

router.get('/summary', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json({
    kpis: d.kpis, holdings: d.holdings, accounts: d.accounts, aggregation: d.aggregation, cash: d.cash,
  });
});

router.get('/performance', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json(d.performance);
});

router.get('/benchmark', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json({ code: d.kpis.benchmarkCode, ...d.benchmark });
});

router.get('/allocation', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json(d.allocation);
});

router.get('/concentration', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json(d.concentration);
});

router.get('/alerts', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json({ priceAlerts: d.alerts, concentrationAlerts: d.concentration.alerts });
});

router.get('/tax', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json(d.tax);
});

router.get('/reports/monthly', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  let months = d.reports.months;
  if (req.query.year) months = months.filter(m => m.month.startsWith(String(req.query.year)));
  res.json(months);
});

router.get('/reports/yearly', (req, res) => {
  const d = portfolio.computeAll(req.user.id, req.query.accountId);
  res.json(d.reports.years);
});

module.exports = router;
