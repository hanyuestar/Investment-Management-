/**
 * 成本核算引擎测试（Node）
 * 运行：node server/calc.test.js
 */
const C = require('../src/calc.js');

let pass = 0, fail = 0;
function eq(name, got, want, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? '✅' : '❌'} ${name}: got=${(+got).toFixed(4)} want=${(+want).toFixed(4)}`);
  ok ? pass++ : fail++;
}

/* ---------- 场景 1：摊薄加权平均 + 做 T ---------- */
{
  const S = { settings: { costMethod: 'wavg' }, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', name: '贵州茅台', code: '600519', type: 'stock', currency: 'CNY', price: 1580 }],
    events: [
      { assetId: 'a1', date: '2026-02-10', kind: 'buy', side: 'buy', qty: 100, price: 1500, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-03-12', kind: 'buy', side: 'buy', qty: 100, price: 1450, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-03-20', kind: 'sell', side: 'sell', qty: 100, price: 1560, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-08-15', kind: 'buy', side: 'buy', qty: 100, price: 1400, fee: 0, fx: 1 }
    ] };
  const r = C.calcAsset(S.assets[0], S);
  console.log('\n— 场景1 摊薄+做T —');
  eq('持股数量', r.qty, 200, 1e-6);
  eq('摊薄成本(原币)', r.avgLocal, 287500 / 200, 0.01);   // 卖前均价1475 → 卖100 → 余147500 → +140000 = 287500/200 = 1437.5
  eq('卖出已实现', r.realCNY, (1560 - 1475) * 100, 0.01);  // 卖前均价=(1500+1450)/2=1475 → +8500
}

/* ---------- 场景 2：FIFO 与摊薄对比 ---------- */
{
  const base = { fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 20 }] };
  const evs = [
    { assetId: 'a1', date: '2026-01-01', kind: 'buy', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
    { assetId: 'a1', date: '2026-02-01', kind: 'buy', side: 'buy', qty: 100, price: 20, fee: 0, fx: 1 },
    { assetId: 'a1', date: '2026-03-01', kind: 'sell', side: 'sell', qty: 100, price: 30, fee: 0, fx: 1 }
  ];
  console.log('\n— 场景2 FIFO vs 摊薄 —');
  const w = C.calcAsset(base.assets[0], { ...base, events: evs, settings: { costMethod: 'wavg' } });
  const f = C.calcAsset(base.assets[0], { ...base, events: evs, settings: { costMethod: 'fifo' } });
  eq('摊薄·卖出已实现', w.realCNY, (30 - 15) * 100, 0.01);   // 卖前均价15 → +1500
  eq('FIFO·卖出已实现', f.realCNY, (30 - 10) * 100, 0.01);   // 卖最早批次成本10 → +2000
  eq('摊薄·剩余成本(原币)', w.costLocal, 15 * 100, 0.01);
  eq('FIFO·剩余成本(原币)', f.costLocal, 20 * 100, 0.01);    // 剩第二批 20*100
}

/* ---------- 场景 3：分红开关 ---------- */
{
  const mk = (reduce) => ({ fx: [], accounts: [{ id: 'acc1' }],
    settings: { costMethod: 'wavg', dividendReducesCost: reduce },
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 12 }],
    events: [
      { assetId: 'a1', date: '2026-01-01', kind: 'buy', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-02-01', kind: 'div', side: 'div', amount: 200, fx: 1 }
    ] });
  console.log('\n— 场景3 分红开关 —');
  const a = C.calcAsset(mk(false).assets[0], mk(false));
  const b = C.calcAsset(mk(true).assets[0], mk(true));
  eq('默认·已实现分红', a.divCNY, 200, 0.01);
  eq('默认·成本不变', a.costCNY, 1000, 0.01);
  eq('冲减·已实现分红=0', b.divCNY, 0, 0.01);
  eq('冲减·成本=800', b.costCNY, 800, 0.01);
}

/* ---------- 场景 4：送股 / 拆分 ---------- */
{
  const S = { fx: [], accounts: [{ id: 'acc1' }], settings: {},
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 5 }],
    events: [
      { assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-02-01', side: 'bonus', qty: 20, fx: 1 },
      { assetId: 'a1', date: '2026-03-01', side: 'split', ratio: 2, fx: 1 }
    ] };
  const r = C.calcAsset(S.assets[0], S);
  console.log('\n— 场景4 送股+拆分 —');
  eq('股数', r.qty, (100 + 20) * 2, 1e-6);
  eq('成本总额不变', r.costCNY, 1000, 0.01);
  eq('摊薄成本', r.avgCNY, 1000 / 240, 0.001);
}

/* ---------- 场景 5：双币种 + 汇率锁定 ---------- */
{
  const S = { fx: [{ date: '2026-01-01', rate: 7.10 }, { date: '2026-06-01', rate: 7.30 }],
    accounts: [{ id: 'acc1' }], settings: {},
    assets: [{ id: 'a1', accountId: 'acc1', name: 'VOO', code: 'VOO', type: 'stock', currency: 'USD', price: 100 }],
    events: [
      { assetId: 'a1', date: '2026-02-01', side: 'buy', qty: 10, price: 90, fee: 0, fx: 7.10 },
      { assetId: 'a1', date: '2026-07-01', side: 'buy', qty: 10, price: 95, fee: 0, fx: 7.30 }
    ] };
  const r = C.calcAsset(S.assets[0], S);
  console.log('\n— 场景5 双币汇率锁定 —');
  eq('成本(¥)·各笔用自身汇率', r.costCNY, 10 * 90 * 7.10 + 10 * 95 * 7.30, 0.01);
  eq('市值(¥)·用当前汇率7.30', r.mvCNY, 20 * 100 * 7.30, 0.01);
  eq('当前汇率', C.currentFx(S), 7.30, 1e-9);
}

/* ---------- 场景 6：多账户汇总 ---------- */
{
  const S = { fx: [], settings: {}, accounts: [{ id: 'A', name: '券商A' }, { id: 'B', name: '券商B' }],
    assets: [
      { id: 'a1', accountId: 'A', name: '茅台', code: '600519', market: 'CN', type: 'stock', currency: 'CNY', price: 1580 },
      { id: 'a2', accountId: 'B', name: '茅台', code: '600519', market: 'CN', type: 'stock', currency: 'CNY', price: 1580 }
    ],
    events: [
      { assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 100, price: 1500, fee: 0, fx: 1 },
      { assetId: 'a2', date: '2026-01-01', side: 'buy', qty: 50, price: 1400, fee: 0, fx: 1 }
    ] };
  console.log('\n— 场景6 多账户 + 跨账户合并 —');
  const as = C.accountSummary(S);
  eq('账户A市值', as.byAccount[0].mv, 100 * 1580, 0.01);
  eq('账户B市值', as.byAccount[1].mv, 50 * 1580, 0.01);
  eq('汇总市值', as.total.mv, 150 * 1580, 0.01);
  const agg = C.securityAggregation(S);
  eq('合并后茅台股数', agg[0].qty, 150, 1e-6);
  eq('合并覆盖账户数', agg[0].accounts.length, 2, 1e-6);
}

/* ---------- 场景 7：月度/年度报表 ---------- */
{
  const S = { fx: [], settings: {}, accounts: [{ id: 'acc1' }], snapshots: [{ month: '2026-01', total: 10000 }, { month: '2026-02', total: 12000 }],
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', code: 'X', type: 'stock', currency: 'CNY', price: 10 }],
    events: [
      { assetId: 'a1', date: '2026-01-05', side: 'buy', qty: 100, price: 10, fee: 0, fx: 1 },
      { assetId: 'a1', date: '2026-02-05', side: 'sell', qty: 50, price: 12, fee: 0, fx: 1 }
    ] };
  console.log('\n— 场景7 报表 —');
  const mr = C.monthRows(S);
  const feb = mr.find(x => x.month === '2026-02');
  eq('2月已实现', feb.real, 100, 0.01);
  eq('2月含浮动', feb.floatTotal, 100 + (12000 - 10000 - (-600)), 0.01); // 净投入=卖出+600
  const yr = C.yearRows(S);
  eq('年度已实现', yr[0].real, 100, 0.01);
}

console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`);

/* =========================================================
 * v4 场景：绩效 / 配置 / 风控 / 税务 / 定投 / 预警 / 出入金
 * ========================================================= */
const near = (name, got, want, tol = 0.001) => {
  const ok = got != null && Math.abs(got - want) <= tol;
  console.log(`${ok ? '✅' : '❌'} ${name}: got=${got == null ? 'null' : (+got).toFixed(6)} want=${(+want).toFixed(6)}`);
  ok ? pass++ : fail++;
};

/* ---------- 场景 8：XIRR 年化（已知答案校验） ---------- */
{
  console.log('\n— 场景8 XIRR —');
  // 投入1000，一年后收回1100 → 年化 10%
  const r = C.xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]);
  near('一年期 XIRR', r, 0.10, 0.002);
  // 两笔各投 1000（相隔一年），第二笔投入时价值 1100 → 期末 2310
  const r2 = C.xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: -1000 }, { date: '2027-01-01', amount: 2310 }]);
  near('两笔定投 XIRR', r2, 0.10, 0.003);
  near('annualized 简单年化', C.annualized(0.21, 365 * 2), Math.sqrt(1.21) - 1, 0.002);
}

/* ---------- 场景 9：TWR 时间加权（经理有无择时不应影响） ---------- */
{
  console.log('\n— 场景9 TWR —');
  // 1月10000 → 2月12000（无净投入）→ 3月（净投入5000）18000 → 月收益 +20%, +16.67%
  // TWR = 1.2 * (18000/(12000+5000)) - 1 = 1.2*1.058823 - 1 = 0.270588
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', type: 'wealth', currency: 'CNY', marketValue: 18000 }],
    events: [{ assetId: 'a1', date: '2026-01-10', kind: 'invest', amount: 10000, fx: 1 },
             { assetId: 'a1', date: '2026-03-10', kind: 'invest', amount: 5000, fx: 1 }],
    snapshots: [{ month: '2026-01', total: 10000 }, { month: '2026-02', total: 12000 }, { month: '2026-03', total: 18000 }] };
  near('TWR 累计', C.twr(S), 1.2 * (18000 / 17000) - 1, 0.0005);
}

/* ---------- 场景 10：资产配置再平衡 ---------- */
{
  console.log('\n— 场景10 配置再平衡 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [
      { id: 'a1', accountId: 'acc1', type: 'stock', currency: 'CNY', market: 'CN', price: 100 },
      { id: 'a2', accountId: 'acc1', type: 'wealth', currency: 'CNY', marketValue: 20000 }],
    events: [{ assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 800, price: 100, fee: 0, fx: 1 }] };
  // 股票80000 / 理财20000 → 总100000；目标 股60% 理15%（其他0）
  const al = C.allocation(S, { stock: 0.6, fund: 0, wealth: 0.15, bond: 0 });
  near('股票当前占比', al.rows.find(r => r.type === 'stock').curPct, 0.8, 1e-6);
  near('股票目标金额', al.rows.find(r => r.type === 'stock').tgtAmt, 60000, 0.01);
  near('股票应卖出额(-)', al.rows.find(r => r.type === 'stock').diff, -20000, 0.01);
  near('理财应买入额(+)', al.rows.find(r => r.type === 'wealth').diff, -5000, 0.01);
  near('偏离度(半总)', al.drift, (20000 + 5000 + 0 + 0) / 2, 0.01);
}

/* ---------- 场景 11：集中度风控 ---------- */
{
  console.log('\n— 场景11 集中度 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', type: 'stock', currency: 'CNY', market: 'CN', price: 100 }],
    events: [{ assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 1000, price: 100, fee: 0, fx: 1 }] };
  const c = C.concentration(S, { warnSingle: 0.2 });
  near('单一持仓占比', c.top1, 1.0, 1e-6);
  console.log(`${c.alerts.length > 0 ? '✅' : '❌'} 触发集中度告警: ${c.alerts.join(' | ')}`);
  c.alerts.length > 0 ? pass++ : fail++;
}

/* ---------- 场景 12：税务估算 ---------- */
{
  console.log('\n— 场景12 税务 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [
      { id: 'cn', accountId: 'acc1', name: 'A股', type: 'stock', currency: 'CNY', market: 'CN', price: 10 },
      { id: 'us', accountId: 'acc1', name: '美股', type: 'stock', currency: 'USD', market: 'US', price: 10 }],
    events: [
      { assetId: 'cn', date: '2026-01-01', side: 'buy', qty: 1000, price: 10, fee: 0, fx: 1 },
      { assetId: 'cn', date: '2026-01-20', side: 'div', amount: 100, fx: 1 },   // 持股19天 → 20%
      { assetId: 'cn', date: '2026-06-01', side: 'div', amount: 100, fx: 1 },   // 持股151天 → 10%
      { assetId: 'us', date: '2026-01-01', side: 'buy', qty: 100, price: 10, fee: 0, fx: 7 },
      { assetId: 'us', date: '2026-02-01', side: 'div', amount: 10, fx: 7 },    // 美元分红 → 30%
      { assetId: 'us', date: '2026-03-01', side: 'sell', qty: 100, price: 15, fee: 0, fx: 7 }] };  // 资本利得 US
  const t = C.taxEstimate(S);
  near('A股短期分红税(20%)', t.dividends[0].tax, 20, 0.01);
  near('A股中期分红税(10%)', t.dividends[1].tax, 10, 0.01);
  near('美股分红税(30%)', t.dividends[2].tax, 10 * 7 * 0.3, 0.01);
  near('美股已实现利得(¥)', t.capGain.US.gain, (15 - 10) * 100 * 7, 0.01);
  near('分红税合计', t.divTax, 20 + 10 + 21, 0.01);
}

/* ---------- 场景 13：定投计划生成 ---------- */
{
  console.log('\n— 场景13 定投 —');
  const rows = C.dcaGenerate({ startMonth: '2026-01', months: 12, day: 10, amount: 1000, note: '月定投' });
  eq('生成期数', rows.length, 12, 0);
  console.log(`${rows[0].date === '2026-01-10' && rows[11].date === '2026-12-10' ? '✅' : '❌'} 日期序列: ${rows[0].date} … ${rows[11].date}`);
  rows[0].date === '2026-01-10' && rows[11].date === '2026-12-10' ? pass++ : fail++;
  near('每期金额', rows[5].amount, 1000, 0.01);
}

/* ---------- 场景 14：止盈止损预警 ---------- */
{
  console.log('\n— 场景14 预警 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', name: 'X', type: 'stock', currency: 'CNY', market: 'CN', price: 130,
      alerts: { takeProfitPrice: 120, stopLossPrice: 90 } }],
    events: [{ assetId: 'a1', date: '2026-01-01', side: 'buy', qty: 100, price: 100, fee: 0, fx: 1 }] };
  const al = C.checkAlerts(S);
  console.log(`${al.length > 0 && al[0].level === '止盈' ? '✅' : '❌'} 预警: ${al.map(a => a.level + ' ' + a.msg).join(' | ')}`);
  al.length > 0 && al[0].level === '止盈' ? pass++ : fail++;
}

/* ---------- 场景 15：出入金（不计入收益） ---------- */
{
  console.log('\n— 场景15 出入金 —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }], assets: [], events: [],
    cashFlows: [{ accountId: 'acc1', date: '2026-01-01', kind: 'deposit', amount: 50000, fx: 1 },
                { accountId: 'acc1', date: '2026-03-01', kind: 'withdraw', amount: 20000, fx: 1 }] };
  const cf = C.cashFlowSummary(S);
  near('累计入金', cf.deposit, 50000, 0.01);
  near('累计出金', cf.withdraw, 20000, 0.01);
  near('净入金', cf.net, 30000, 0.01);
}

/* ---------- 场景 16：组合 XIRR（多笔 + 期末市值） ---------- */
{
  console.log('\n— 场景16 组合XIRR —');
  const S = { settings: {}, fx: [], accounts: [{ id: 'acc1' }],
    assets: [{ id: 'a1', accountId: 'acc1', type: 'stock', currency: 'CNY', market: 'CN', price: 110 }],
    events: [{ assetId: 'a1', date: '2025-09-22', side: 'buy', qty: 100, price: 100, fee: 0, fx: 1 }] };
  const r = C.portfolioXirr(S);
  console.log(`${r != null && r > 0 ? '✅' : '❌'} 组合XIRR: ${r == null ? 'null' : (r * 100).toFixed(2) + '%'}`);
  (r != null && r > 0) ? pass++ : fail++;
}

console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
