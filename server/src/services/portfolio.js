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
  const simpleAnn = Calc.annualized(s.accountRate, days);   // 与累计收益率（账户口径）配对
  const bm = Calc.benchmark(S, S.benchSeries, opts);
  const alloc = Calc.allocation(S, settings.allocTargets, opts);
  const concentration = Calc.concentration(S, { ...opts, warnSingle: settings.warnSingle, warnTop5: settings.warnTop5 });
  const alerts = Calc.checkAlerts(S2);
  const tax = Calc.taxEstimate(S, settings.taxRules, opts);
  const months = Calc.monthRows(S, opts);
  const years = Calc.yearRows(S, opts);
  const cash = Calc.accountCash(S, opts);
  const accounts = Calc.accountSummary(S2);
  const aggregation = Calc.securityAggregation(S2);

  // 税务：按市场按年度的资本利得明细（修复原型用汇总值驱动年度表的缺陷）
  const gainsByYear = Calc.realizedGainsByYear(S, opts);
  const capGainRows = ['CN', 'US'].flatMap(mk => Object.keys(gainsByYear[mk]).sort().map(y => {
    const gain = gainsByYear[mk][y];
    const rate = mk === 'US' ? settings.taxRules.usCapGain : settings.taxRules.cnCapGain;
    return { market: mk, year: y, gain, tax: round2(Math.max(0, gain) * rate) };
  }));

  // 本年收益 = 全年已实现 + 全年浮动（有快照时）；无快照时仅已实现
  const nowYear = Calc.TODAY().slice(0, 4);
  const yRow = years.find(y => y.year === nowYear);
  const yearProfit = yRow ? (yRow.hasF ? yRow.total : yRow.real) : null;
  const yearReal = yRow ? yRow.real : null;

  const holdings = s.rows.map(({ a, r, mv, profit }) => ({ asset: a, calc: r, mvCNY: mv, profitCNY: profit }));

  /* ---------- 数据一致性检测 ----------
   * 「期初建仓本金」与「入金」是本金来源的两种**互斥**表达：
   *   · 期初建仓 = 这笔钱在**开始记账前**就已投入（系统外）
   *   · 入金     = 这笔钱在**记账期内**转入账户（系统内）
   * 若两者同时存在且金额接近，极可能是同一笔钱被记了两次：
   *   总资产 会因「假现金」虚增，累计投入 也会双倍计数。
   * 这里只做**提示**（不自动改数），并给出两条修正路径。
   */
  const warnings = [];
  if (s.openingCost > 0 && s.netDeposit > 0) {
    const dup = round2(Math.min(s.openingCost, s.netDeposit));
    warnings.push({
      code: 'duplicate_opening_deposit',
      level: 'warn',
      title: '期初建仓与入金可能是同一笔钱',
      openingCost: s.openingCost,
      netDeposit: s.netDeposit,
      mightDup: dup,
      msg: `同时存在「期初建仓本金 ¥${s.openingCost}」与「净入金 ¥${s.netDeposit}」。`
        + `累计投入只按净入金计（不受影响），但**账户现金**会出现并不存在的余额`
        + `（约 ¥${dup}，这笔钱其实已变成持仓）。若确认是同一笔钱，`
        + `删除那笔「入金」记录即可让现金也准确；若入金是另外新转入的钱，请忽略本提示。`,
    });
  }
  if (s.openingCost > 0 && s.netDeposit <= 0) {
    warnings.push({
      code: 'opening_without_deposit',
      level: 'warn',
      title: '期初建仓缺少对应入金',
      openingCost: s.openingCost,
      msg: `检测到期初建仓本金 ¥${s.openingCost}，但没有对应入金记录。`
        + `按当前口径「累计投入 = 净入金」，这笔本金**未计入累计投入**，`
        + `因此「总资产」会比实际少算约 ¥${s.openingCost}。`
        + `请到「出入金」页补录一笔等额入金（若这笔钱是记账前就投入的，也需补录以体现本金）。`,
    });
  }

  const kpis = {
    /* ── 单一口径三件套（v6）── */
    totalAssets: s.totalAssets,          // 总资产 = 累计投入 + 累计收益
    invest: s.invest,                    // 累计投入 = 净入金（入金 − 出金）
    profit: s.profit,                    // 累计收益（唯一口径，不再分账户/持仓）
    rate: s.rate,                        // 收益率 = 累计收益 / 累计投入
    /* ── 持仓构成（用于卡片副标题）── */
    mv: s.mv,
    real: s.real,                        // 已实现（含分红、利息）
    unreal: s.unreal,                    // 浮动
    cashIncome: s.cashIncome,
    /* ── 诊断 / 出入金页 ── */
    cash: s.cash,                        // 账户现金余额（可能为负 → 漏记录入金）
    netDeposit: s.netDeposit,
    openingCost: s.openingCost,
    netInvest: s.netInvest,
    buyTotal: s.buyTotal,
    /* ── 绩效 ── */
    xirr: pct(xirr),
    holdingDays: days,
    twr: pct(twr),
    alpha: bm && bm.alpha != null ? bm.alpha : null,
    benchmarkCode: settings.benchmarkCode,
    yearProfit,
    yearReal,
    fxCurrent: Calc.currentFx(S),
  };

  return {
    kpis,
    warnings,
    settings,
    holdings,
    accounts,
    aggregation,
    performance: {
      xirr: pct(xirr), twr: pct(twr), simpleAnnualized: pct(simpleAnn),
      cumulativeRate: s.rate, holdingDays: days,
      totalAssets: s.totalAssets, invest: s.invest, profit: s.profit,
      real: s.real, unreal: s.unreal, mv: s.mv, cash: s.cash,
      netDeposit: s.netDeposit, openingCost: s.openingCost,
      netInvest: s.netInvest, buyTotal: s.buyTotal,
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
