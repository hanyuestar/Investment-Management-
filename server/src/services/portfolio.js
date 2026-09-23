'use strict';
/**
 * 组合计算服务：把 calc 引擎的纯函数能力组装成接口需要的派生数据。
 * 所有结果实时计算、不入库，保证口径可切换、数据可追溯。
 */
const Calc = require('../calc');
const { buildState } = require('../state');

function round2(n) { return Math.round((+n || 0) * 100) / 100; }

/** 账户维度过滤（供不支持 opts 的引擎函数使用） */
function scope(S, accountId) {
  if (!accountId) return S;
  const id = String(accountId);
  return {
    ...S,
    accounts: S.accounts.filter(a => a.id === id),
    assets: S.assets.filter(a => a.accountId === id),
    cashFlows: S.cashFlows.filter(c => c.accountId === id),
  };
}

function pct(n) { return n == null ? null : n; }

/** 一次性返回前端所需的全部派生数据 */
function computeAll(userId, accountId) {
  const S = buildState(userId);
  const settings = S.fullSettings;
  const id = accountId ? String(accountId) : null;
  const opts = id ? { accountId: id } : {};
  const S2 = scope(S, id);

  const s = Calc.summary(S, opts);
  const days = Calc.holdingDays(S, opts);
  const xirr = Calc.portfolioXirr(S, opts);
  const twr = Calc.twr(S, opts);
  const simpleAnn = Calc.annualized(s.rate, days);
  const bm = Calc.benchmark(S, S.benchSeries, opts);
  const alloc = Calc.allocation(S, settings.allocTargets, opts);
  const concentration = Calc.concentration(S, { ...opts, warnSingle: settings.warnSingle, warnTop5: settings.warnTop5 });
  const alerts = Calc.checkAlerts(S2);
  const tax = Calc.taxEstimate(S, settings.taxRules, opts);
  const months = Calc.monthRows(S, opts);
  const years = Calc.yearRows(S, opts);
  const cash = Calc.cashFlowSummary(S, opts);
  const accounts = Calc.accountSummary(S2);
  const aggregation = Calc.securityAggregation(S2);

  // 税务：按市场按年度的资本利得明细（修复原型用汇总值驱动年度表的缺陷）
  const gainsByYear = Calc.realizedGainsByYear(S, opts);
  const capGainRows = ['CN', 'US'].flatMap(mk => Object.keys(gainsByYear[mk]).sort().map(y => {
    const gain = gainsByYear[mk][y];
    const rate = mk === 'US' ? settings.taxRules.usCapGain : settings.taxRules.cnCapGain;
    return { market: mk, year: y, gain, tax: round2(Math.max(0, gain) * rate) };
  }));

  // 本年收益（有快照用含浮动，否则用已实现）
  const nowYear = Calc.TODAY().slice(0, 4);
  const yRow = years.find(y => y.year === nowYear);
  const yearProfit = yRow ? (yRow.hasF ? yRow.floatTotal : yRow.real) : null;

  const holdings = s.rows.map(({ a, r, mv, profit }) => ({ asset: a, calc: r, mvCNY: mv, profitCNY: profit }));

  const kpis = {
    total: s.total,
    invest: s.invest,
    profit: s.profit,
    simpleRate: s.rate,
    xirr: pct(xirr),
    holdingDays: days,
    real: s.real,
    unreal: s.unreal,
    twr: pct(twr),
    alpha: bm && bm.alpha != null ? bm.alpha : null,
    benchmarkCode: settings.benchmarkCode,
    yearProfit,
    fxCurrent: Calc.currentFx(S),
  };

  return {
    kpis,
    settings,
    holdings,
    accounts,
    aggregation,
    performance: {
      xirr: pct(xirr), twr: pct(twr), simpleAnnualized: pct(simpleAnn),
      cumulativeRate: s.rate, holdingDays: days,
      real: s.real, unreal: s.unreal, profit: s.profit, invest: s.invest,
    },
    benchmark: bm,
    allocation: alloc,
    concentration,
    alerts,
    tax: { ...tax, capGainRows },
    reports: { months, years },
    cash,
  };
}

/** 仅返回原始状态（/api/state 一次性拉取） */
function rawState(userId) {
  const S = buildState(userId);
  return {
    settings: S.fullSettings,
    fx: S.fx,
    accounts: S.accounts,
    assets: S.assets,
    events: S.events,
    snapshots: S.snapshots,
    benchmarks: S.benchSeries,
    cashFlows: S.cashFlows,
    dcaPlans: S.dcaPlans,
  };
}

module.exports = { computeAll, rawState, scope };
