/**
 * 投资管家 · 成本核算引擎（参考实现 v3）
 * 纯函数、无依赖，Node 与浏览器通用。
 * 覆盖：摊薄加权平均 + FIFO / 分红是否冲减成本 / 多账户 / 双币种 / 做T / 送股拆分
 *
 * 用法（Node）: const C = require('./calc.js'); C.summary(S, {accountId});
 * 用法（浏览器）: window.Calc
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 工具 ---------- */
  const TODAY = () => new Date().toISOString().slice(0, 10);
  const round2 = n => Math.round((+n || 0) * 100) / 100;

  // 默认设置
  const DEFAULTS = { costMethod: 'wavg', dividendReducesCost: false };

  /** 当前生效汇率（日期 <= 今天 的最近一条）
   *  同一日期：管理员手动(source=manual) 优先于自动源(source=auto)
   */
  function currentFx(S) {
    const t = TODAY();
    const f = (S.fx || []).filter(r => r.date <= t).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.source === 'manual' ? 1 : 0) - (b.source === 'manual' ? 1 : 0)));
    return f.length ? f[f.length - 1].rate : 7.1;
  }
  /** 资产估值汇率：人民币恒为 1，美元用最新汇率 */
  const assetFx = (a, S) => (a.currency === 'USD' ? currentFx(S) : 1);

  /** 取某资产的事件（按日期升序，稳定排序） */
  function eventsOf(S, assetId) {
    return (S.events || []).filter(e => e.assetId === assetId)
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  }

  /* =========================================================
   * 单资产核算
   * costMethod: 'wavg'(摊薄加权平均, 默认) | 'fifo'(先进先出)
   * dividendReducesCost: false=分红计入已实现(默认) | true=分红冲减成本
   * ========================================================= */
  function calcAsset(a, S) {
    const cfg = Object.assign({}, DEFAULTS, S.settings || {});
    const evs = eventsOf(S, a.id);
    if (a.type === 'stock') return calcStock(a, evs, cfg, S);
    return calcFlow(a, evs, S);
  }

  /** 股票核算（两种口径共用一套逐笔框架） */
  function calcStock(a, evs, cfg, S) {
    const isFifo = cfg.costMethod === 'fifo';
    const divReduce = !!cfg.dividendReducesCost;

    let qty = 0;                 // 当前持股
    let lots = [];               // FIFO 批次: {q, price, fee, fx, date}
    let costLocal = 0, costCNY = 0;        // 加权口径成本总额
    let buyQty = 0, buyAmtCNY = 0, buyAmtLocal = 0;   // 累计买入（算均价与收益率用）
    let realLocal = 0, realCNY = 0;        // 卖出已实现
    let divCNY = 0, divLocal = 0;          // 现金分红累计
    const byMonth = {};                    // { 'YYYY-MM': {sell, div} } 已实现（本币）
    const addM = (m, k, v) => { if (!m) return; byMonth[m] = byMonth[m] || { sell: 0, div: 0 }; byMonth[m][k] = +(byMonth[m][k] + v).toFixed(2); };

    for (const t of evs) {
      const f = t.fx || 1;
      if (t.side === 'buy') {
        const g = t.qty * t.price;
        qty += t.qty;
        costLocal += g + (t.fee || 0);
        costCNY += (g + (t.fee || 0)) * f;
        lots.push({ q: t.qty, price: t.price, fee: t.fee || 0, fx: f, date: t.date });
        buyQty += t.qty; buyAmtCNY += (g + (t.fee || 0)) * f; buyAmtLocal += g + (t.fee || 0);
      } else if (t.side === 'sell') {
        const sellQty = t.qty, proceedsLocal = sellQty * t.price - (t.fee || 0);
        let rl = 0, rc = 0;
        if (isFifo) {
          let need = sellQty;
          while (need > 1e-9 && lots.length) {
            const lot = lots[0];
            const take = Math.min(need, lot.q);
            const lotUnitLocal = lot.price + (lot.fee || 0) / lot.q;   // 含费单位成本（原币）
            const lotUnitCNY = lotUnitLocal * lot.fx;                  // 含费单位成本（¥）
            rl += (t.price) * take - lotUnitLocal * take;              // 卖出价（简化）

            rc += t.price * take * f - lotUnitCNY * take;              // 卖出价*卖出汇率 - 批成本
            lot.q -= take; need -= take;
            if (lot.q <= 1e-9) lots.shift();
          }
          // 卖出费用在整单层面扣减
          rl -= (t.fee || 0); rc -= (t.fee || 0) * f;
          // 剩余成本 = 批次合计
          costLocal = lots.reduce((s, l) => s + l.q * (l.price + (l.fee || 0) / l.q), 0);
          costCNY = lots.reduce((s, l) => s + l.q * ((l.price + (l.fee || 0) / l.q) * l.fx), 0);
          qty -= sellQty;
        } else {
          const avgL = qty > 0 ? costLocal / qty : 0;
          const avgC = qty > 0 ? costCNY / qty : 0;
          rl = proceedsLocal - avgL * sellQty;
          rc = proceedsLocal * f - avgC * sellQty;
          costLocal -= avgL * sellQty; costCNY -= avgC * sellQty; qty -= sellQty;
        }
        realLocal += rl; realCNY += rc;
        addM(t.date.slice(0, 7), 'sell', rc);
      } else if (t.side === 'div') {
        const v = (t.amount || 0) * f;
        if (divReduce) {                    // 冲减成本：成本下降，不计已实现
          costLocal -= (t.amount || 0);
          costCNY -= v;
        } else {                            // 默认：计入已实现收益
          divLocal += (t.amount || 0); divCNY += v;
          addM(t.date.slice(0, 7), 'div', v);
        }
      } else if (t.side === 'bonus') {       // 送股/转股：股数增、成本不变
        const add = t.qty || 0;
        qty += add;
        if (isFifo) { if (lots.length) lots[lots.length - 1].q += add; else lots.push({ q: add, price: 0, fee: 0, fx: f, date: t.date }); }
      } else if (t.side === 'split') {       // 拆分/合股：股数按比例、成本不变
        const ratio = t.ratio || 1;
        qty *= ratio;
        if (isFifo) lots.forEach(l => { l.q *= ratio; l.price /= ratio; });
      }
    }

    const fxNow = assetFx(a, S);
    const px = a.price || 0;
    const mvLocal = qty * px;
    const mvCNY = mvLocal * (a.currency === 'USD' ? fxNow : 1);
    const unrealCNY = mvCNY - costCNY;
    const totalCNY = realCNY + divCNY + unrealCNY;
    return {
      type: 'stock', costMethod: cfg.costMethod, qty: +qty.toFixed(6),
      costLocal: round2(costLocal), costCNY: round2(costCNY),
      mvLocal: round2(mvLocal), mvCNY: round2(mvCNY),
      realLocal: round2(realLocal), realCNY: round2(realCNY),
      divCNY: round2(divCNY), unrealCNY: round2(unrealCNY), totalCNY: round2(totalCNY),
      avgLocal: qty > 0 ? costLocal / qty : 0, avgCNY: qty > 0 ? costCNY / qty : 0,
      buyAvgCNY: buyQty > 0 ? buyAmtCNY / buyQty : 0, buyAvgLocal: buyQty > 0 ? buyAmtLocal / buyQty : 0,
      buyQty, buyAmtCNY: round2(buyAmtCNY), buyAmtLocal: round2(buyAmtLocal),
      rate: buyAmtCNY > 0 ? totalCNY / buyAmtCNY : 0, fxUsed: fxNow, byMonth
    };
  }

  /** 现金流型资产（理财/债券/基金） */
  function calcFlow(a, evs, S) {
    let investCNY = 0, redeemCNY = 0, incomeCNY = 0;
    for (const f of evs) {
      const v = (f.amount || 0) * (f.fx || 1);
      if (f.kind === 'invest') investCNY += v;
      else if (f.kind === 'redeem') redeemCNY += v;
      else if (f.kind === 'income') incomeCNY += v;
    }
    const mvCNY = round2((a.marketValue || 0) * assetFx(a, S));
    const total = round2(redeemCNY + incomeCNY + mvCNY - investCNY);
    return {
      type: a.type, investCNY: round2(investCNY), redeemCNY: round2(redeemCNY),
      incomeCNY: round2(incomeCNY), mvCNY, unrealCNY: round2(mvCNY - (investCNY - redeemCNY)),
      total, rate: investCNY > 0 ? total / investCNY : 0, fxUsed: assetFx(a, S), totalCNY: total
    };
  }
  const assetTotal = r => (r.totalCNY !== undefined ? r.totalCNY : r.total);

  /* =========================================================
   * 账户维度
   * ========================================================= */
  /** 账户汇总：每个账户的市值 / 投入 / 盈亏 */
  function accountSummary(S) {
    const out = (S.accounts || []).map(acc => {
      const assets = S.assets.filter(a => a.accountId === acc.id);
      let mv = 0, invest = 0, profit = 0;
      assets.forEach(a => {
        const r = calcAsset(a, S); mv += r.mvCNY; profit += assetTotal(r);
        invest += a.type === 'stock' ? r.buyAmtCNY : r.investCNY;
      });
      return { account: acc, count: assets.length, mv: round2(mv), invest: round2(invest),
        profit: round2(profit), rate: invest > 0 ? profit / invest : 0 };
    });
    const all = out.reduce((s, x) => ({ mv: s.mv + x.mv, invest: s.invest + x.invest, profit: s.profit + x.profit }), { mv: 0, invest: 0, profit: 0 });
    return { byAccount: out, total: { mv: round2(all.mv), invest: round2(all.invest), profit: round2(all.profit), rate: all.invest > 0 ? all.profit / all.invest : 0 } };
  }

  /** 同一证券跨账户合并（按 market+code，无代码则按名称） */
  function securityAggregation(S) {
    const key = a => (a.market || '') + '|' + (a.code || a.name);
    const map = {};
    S.assets.forEach(a => {
      const r = calcAsset(a, S), k = key(a);
      map[k] = map[k] || { name: a.name, code: a.code, market: a.market, type: a.type, currency: a.currency,
        qty: 0, costCNY: 0, mvCNY: 0, totalCNY: 0, accounts: [] };
      const m = map[k];
      if (a.type === 'stock') { m.qty += r.qty; m.costCNY += r.costCNY; }
      m.mvCNY += r.mvCNY; m.totalCNY += assetTotal(r);
      m.accounts.push({ accountId: a.accountId, assetId: a.id, qty: a.type === 'stock' ? r.qty : (a.marketValue || 0) });
    });
    return Object.values(map).map(m => ({
      ...m, qty: +m.qty.toFixed(6), costCNY: round2(m.costCNY), mvCNY: round2(m.mvCNY), totalCNY: round2(m.totalCNY),
      avgCNY: m.qty > 0 ? m.costCNY / m.qty : 0,
      unrealCNY: round2(m.mvCNY - m.costCNY), rate: m.costCNY > 0 ? m.totalCNY / m.costCNY : 0
    }));
  }

  /* =========================================================
   * 全局汇总 & 报表
   * ========================================================= */
  function summary(S, opts) {
    const accountId = opts && opts.accountId;
    const assets = accountId ? S.assets.filter(a => a.accountId === accountId) : S.assets;
    let total = 0, invest = 0, real = 0, unreal = 0, cashIncome = 0;
    const rows = assets.map(a => {
      const r = calcAsset(a, S), mv = r.mvCNY || 0; total += mv;
      if (a.type === 'stock') { invest += r.buyAmtCNY; real += r.realCNY + r.divCNY; unreal += r.unrealCNY; }
      else { invest += r.investCNY; cashIncome += r.incomeCNY; real += r.incomeCNY; unreal += r.unrealCNY; }
      return { a, r, mv, profit: assetTotal(r) };
    });
    return { total: round2(total), invest: round2(invest), real: round2(real), unreal: round2(unreal),
      cashIncome: round2(cashIncome), profit: round2(real + unreal),
      rate: invest > 0 ? (real + unreal) / invest : 0, rows };
  }

  function realizedByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const m = {}; const add = (k, v) => { if (k) m[k] = +( (m[k] || 0) + v ).toFixed(2); };
    S.assets.filter(a => !accountId || a.accountId === accountId).forEach(a => {
      if (a.type === 'stock') {
        const r = calcAsset(a, S);
        for (const mm in r.byMonth) add(mm, r.byMonth[mm].sell + r.byMonth[mm].div);
      } else {
        eventsOf(S, a.id).forEach(f => {
          if (f.kind === 'income' || f.kind === 'redeem') add(f.date.slice(0, 7), (f.amount || 0) * (f.fx || 1));
        });
      }
    });
    return m;
  }
  function netInvestByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const m = {}; const add = (k, v) => { if (k) m[k] = +((m[k] || 0) + v).toFixed(2); };
    S.assets.filter(a => !accountId || a.accountId === accountId).forEach(a => {
      if (a.type === 'stock') eventsOf(S, a.id).forEach(t => {
        if (t.side === 'buy') add(t.date.slice(0, 7), (t.qty * t.price + (t.fee || 0)) * t.fx);
        else if (t.side === 'sell') add(t.date.slice(0, 7), -(t.qty * t.price - (t.fee || 0)) * t.fx);
      });
      else eventsOf(S, a.id).forEach(f => {
        if (f.kind === 'invest' || f.kind === 'redeem') add(f.date.slice(0, 7), (f.kind === 'invest' ? 1 : -1) * (f.amount || 0) * (f.fx || 1));
      });
    });
    return m;
  }
  function monthRows(S, opts) {
    const real = realizedByMonth(S, opts), net = netInvestByMonth(S, opts);
    const snap = {}; (S.snapshots || []).forEach(s => snap[s.month] = s.total);
    const months = [...new Set([...Object.keys(real), ...Object.keys(snap), ...Object.keys(net)])].sort();
    const out = []; let prev = null;
    for (const mm of months) {
      const s = snap[mm]; let floatTotal = null;
      if (s !== undefined && prev !== null) floatTotal = round2((real[mm] || 0) + (s - prev - (net[mm] || 0)));
      out.push({ month: mm, real: round2(real[mm] || 0), net: round2(net[mm] || 0), snap: s, floatTotal });
      if (s !== undefined) prev = s;
    }
    return out;
  }
  function yearRows(S, opts) {
    const y = {};
    monthRows(S, opts).forEach(r => {
      const k = r.month.slice(0, 4); y[k] = y[k] || { year: k, real: 0, net: 0, floatTotal: 0, hasF: false };
      y[k].real += r.real; y[k].net += r.net;
      if (r.floatTotal !== null) { y[k].floatTotal += r.floatTotal; y[k].hasF = true; }
    });
    return Object.values(y).sort((a, b) => (a.year < b.year ? -1 : 1))
      .map(x => ({ ...x, real: round2(x.real), net: round2(x.net), floatTotal: round2(x.floatTotal) }));
  }

  /* =========================================================
   * v4 新增：绩效指标 / 决策辅助 / 税务 / 预警 / 定投
   * ========================================================= */

  /* ---------- XIRR：资金加权内部收益率（年化） ---------- */
  function xirr(flows, guess) {
    if (!flows || flows.length < 2) return null;
    const t0 = new Date(flows[0].date).getTime();
    const yrs = d => (new Date(d).getTime() - t0) / 31536000000;
    const npv = r => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, yrs(f.date)), 0);
    let r = guess == null ? 0.1 : guess;
    for (let i = 0; i < 100; i++) {
      const f = npv(r);
      if (Math.abs(f) < 1e-6) return r;
      const df = (npv(r + 1e-7) - f) / 1e-7;
      if (!isFinite(df) || Math.abs(df) < 1e-12) break;
      const next = r - f / df;
      if (!isFinite(next)) break;
      if (Math.abs(next - r) < 1e-10) return next;
      r = Math.max(-0.9999, Math.min(100, next));
    }
    let lo = -0.9999, hi = 100, flo = npv(lo), fhi = npv(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-6 || (hi - lo) < 1e-12) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /** 组合现金流（CNY）：买入/投入=流出(负)，卖出/赎回/分红/利息=流入(正)，期末持仓市值=末期流入 */
  function portfolioFlows(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = (opts && opts.asOf) || TODAY();
    const flows = [];
    (S.assets || []).filter(a => !accountId || a.accountId === accountId).forEach(a => {
      eventsOf(S, a.id).forEach(e => {
        const f = e.fx || 1;
        let amt = 0;
        if (a.type === 'stock') {
          if (e.side === 'buy') amt = -((e.qty * e.price) + (e.fee || 0)) * f;
          else if (e.side === 'sell') amt = ((e.qty * e.price) - (e.fee || 0)) * f;
          else if (e.side === 'div') amt = (e.amount || 0) * f;
        } else {
          if (e.kind === 'invest') amt = -((e.amount || 0) + (e.fee || 0)) * f;
          else if (e.kind === 'redeem') amt = (e.amount || 0) * f;
          else if (e.kind === 'income') amt = (e.amount || 0) * f;
        }
        if (Math.abs(amt) > 1e-9) flows.push({ date: e.date, amount: amt, assetId: a.id });
      });
    });
    flows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const mv = summary(S, opts).total;
    if (mv > 0) flows.push({ date: asOf, amount: mv, assetId: null, terminal: true });
    return flows;
  }
  function portfolioXirr(S, opts) {
    const flows = portfolioFlows(S, opts);
    if (flows.length < 2) return null;
    if (flows[0].amount >= 0) flows.unshift({ date: flows[0].date, amount: -1e-6 });
    return xirr(flows);
  }
  /** 简单年化：（1+累计收益率）^(365/持有天数) - 1 */
  function annualized(total, days) {
    if (!(days > 0) || 1 + total <= 0) return null;
    return Math.pow(1 + total, 365 / days) - 1;
  }
  /** 组合持有天数（首笔事件 → 今天） */
  function holdingDays(S, opts) {
    const accountId = opts && opts.accountId;
    let first = null;
    (S.assets || []).filter(a => !accountId || a.accountId === accountId).forEach(a => {
      const e = eventsOf(S, a.id)[0]; if (e && (!first || e.date < first)) first = e.date;
    });
    if (!first) return 0;
    return Math.max(1, Math.round((new Date(TODAY()) - new Date(first)) / 86400000));
  }

  /* ---------- TWR：时间加权收益率（月末快照序列） ---------- */
  function twr(S, opts) {
    const rows = monthRows(S, opts).filter(r => r.snap !== undefined);
    if (rows.length < 2) return null;
    let factor = 1;
    for (let i = 1; i < rows.length; i++) {
      const denom = rows[i - 1].snap + (rows[i].net || 0);
      if (denom > 0) factor *= rows[i].snap / denom;
    }
    return factor - 1;
  }

  /* ---------- 资产配置 & 再平衡 ---------- */
  const ALLOC_DEFAULT = { stock: 0.6, fund: 0.2, wealth: 0.15, bond: 0.05 };
  function allocation(S, targets, opts) {
    const s = summary(S, opts);
    const tg = Object.assign({}, ALLOC_DEFAULT, targets || {});
    const byType = {};
    s.rows.forEach(r => { byType[r.a.type] = (byType[r.a.type] || 0) + r.mv; });
    const total = s.total || 0;
    const rows = ['stock', 'fund', 'wealth', 'bond'].map(t => {
      const cur = byType[t] || 0;
      return { type: t, cur: round2(cur), curPct: total > 0 ? cur / total : 0, tgtPct: tg[t] || 0,
        tgtAmt: round2(total * (tg[t] || 0)), diff: round2(total * (tg[t] || 0) - cur) };
    });
    const drift = rows.reduce((a, r) => a + Math.abs(r.diff), 0) / 2;
    return { total: round2(total), rows, drift: round2(drift), driftPct: total > 0 ? drift / total : 0 };
  }

  /* ---------- 集中度 & 风险 ---------- */
  function concentration(S, opts) {
    const warnSingle = (opts && opts.warnSingle) || 0.2;
    const warnTop5 = (opts && opts.warnTop5) || 0.6;
    const s = summary(S, opts);
    const total = s.total || 1;
    const list = [...s.rows].sort((a, b) => b.mv - a.mv)
      .map(r => ({ name: r.a.name, type: r.a.type, mv: r.mv, pct: r.mv / total }));
    const top5 = list.slice(0, 5).reduce((x, r) => x + r.pct, 0);
    const byType = {};
    s.rows.forEach(r => { byType[r.a.type] = (byType[r.a.type] || 0) + r.mv / total; });
    const alerts = [];
    if (list[0] && list[0].pct > warnSingle) alerts.push(`单标的集中：${list[0].name} 占 ${(list[0].pct * 100).toFixed(1)}%（阈值 ${(warnSingle * 100)}%）`);
    if (top5 > warnTop5) alerts.push(`前5大持仓合计 ${(top5 * 100).toFixed(1)}%（阈值 ${(warnTop5 * 100)}%）`);
    if (byType.stock > 0.7) alerts.push(`股票类占比 ${(byType.stock * 100).toFixed(1)}%，权益风险偏高`);
    return { list, top1: list[0] ? list[0].pct : 0, top5, byType, warnSingle, warnTop5, alerts };
  }

  /* ---------- 基准对比 ---------- */
  function benchmark(S, benchSeries, opts) {
    const snaps = monthRows(S, opts).filter(r => r.snap !== undefined);
    if (snaps.length < 2 || !benchSeries || benchSeries.length < 2) return null;
    const first = snaps[0], last = snaps[snaps.length - 1];
    const bAt = m => { const x = benchSeries.filter(b => b.date.slice(0, 7) <= m).pop(); return x ? x.value : null; };
    const b0 = bAt(first.month), b1 = bAt(last.month);
    // 组合用「含浮动的月度链」近似净值曲线
    let nav = 1; const series = [];
    snaps.forEach((r, i) => {
      if (i > 0) { const denom = snaps[i - 1].snap + (r.net || 0); if (denom > 0) nav *= r.snap / denom; }
      series.push({ month: r.month, port: nav - 1, bench: b0 && bAt(r.month) ? bAt(r.month) / b0 - 1 : null });
    });
    const portRet = b0 ? nav - 1 : null;
    const benchRet = b0 && b1 ? b1 / b0 - 1 : null;
    return { portRet, benchRet, alpha: (portRet != null && benchRet != null) ? portRet - benchRet : null, series };
  }

  /* ---------- 税务估算 ---------- */
  const TAX_DEFAULT = { cnDiv: { le1m: 0.20, m1to1y: 0.10, gt1y: 0 }, cnCapGain: 0, usDiv: 0.30, usCapGain: 0 };
  /** 按市场汇总已实现资本利得（均价法，逐年） */
  function realizedGainsByYear(S, opts) {
    const accountId = opts && opts.accountId;
    const out = { CN: {}, US: {} };
    (S.assets || []).filter(a => a.type === 'stock' && (!accountId || a.accountId === accountId)).forEach(a => {
      const mk = a.market === 'US' ? 'US' : 'CN';
      let qty = 0, costCNY = 0;
      eventsOf(S, a.id).forEach(e => {
        const f = e.fx || 1;
        if (e.side === 'buy') { qty += e.qty; costCNY += (e.qty * e.price + (e.fee || 0)) * f; }
        else if (e.side === 'sell') {
          const avg = qty > 0 ? costCNY / qty : 0;
          const gain = ((e.qty * e.price) - (e.fee || 0)) * f - avg * e.qty;
          costCNY -= avg * e.qty; qty -= e.qty;
          const y = e.date.slice(0, 4);
          out[mk][y] = round2((out[mk][y] || 0) + gain);
        } else if (e.side === 'bonus') qty += (e.qty || 0);
        else if (e.side === 'split') qty *= (e.ratio || 1);
      });
    });
    return out;
  }
  function taxEstimate(S, rules, opts) {
    const R = Object.assign({}, TAX_DEFAULT, rules || {});
    const accountId = opts && opts.accountId;
    const dividends = [];
    (S.assets || []).filter(a => a.type === 'stock' && (!accountId || a.accountId === accountId)).forEach(a => {
      const isUS = a.market === 'US';
      const buys = eventsOf(S, a.id).filter(e => e.side === 'buy');
      eventsOf(S, a.id).filter(e => e.side === 'div').forEach(e => {
        const amtCNY = (e.amount || 0) * (e.fx || 1);
        let rate;
        if (isUS) rate = R.usDiv;
        else {
          const prior = buys.filter(b => b.date <= e.date);
          const firstBuy = prior[0] ? prior[0].date : null;
          const days = firstBuy ? (new Date(e.date) - new Date(firstBuy)) / 86400000 : 9999;
          rate = days <= 30 ? R.cnDiv.le1m : days <= 365 ? R.cnDiv.m1to1y : R.cnDiv.gt1y;
        }
        dividends.push({ asset: a.name, market: isUS ? 'US' : 'CN', date: e.date, amount: round2(amtCNY),
          rate, tax: round2(amtCNY * rate), net: round2(amtCNY * (1 - rate)) });
      });
    });
    const gains = realizedGainsByYear(S, opts);
    const capGain = { CN: { gain: 0, tax: 0 }, US: { gain: 0, tax: 0 } };
    Object.keys(gains).forEach(mk => {
      Object.keys(gains[mk]).forEach(y => {
        const g = gains[mk][y];
        capGain[mk].gain = round2(capGain[mk].gain + g);
        if (g > 0) capGain[mk].tax = round2(capGain[mk].tax + g * (mk === 'US' ? R.usCapGain : R.cnCapGain));
      });
    });
    const divTax = round2(dividends.reduce((s, d) => s + d.tax, 0));
    return { dividends, capGain, divTax, capGainTax: round2(capGain.CN.tax + capGain.US.tax),
      totalTax: round2(divTax + capGain.CN.tax + capGain.US.tax), rules: R };
  }

  /* ---------- 定投计划：按期生成投入事件 ---------- */
  function dcaGenerate(plan) {
    const out = [];
    const [y0, m0] = (plan.startMonth || '2026-01').split('-').map(Number);
    for (let i = 0; i < (plan.months || 12); i++) {
      const m = (m0 - 1) + i;
      const y = y0 + Math.floor(m / 12), mm = (m % 12) + 1;
      out.push({ date: `${y}-${String(mm).padStart(2, '0')}-${String(plan.day || 1).padStart(2, '0')}`,
        kind: 'invest', amount: plan.amount, fee: 0, fx: plan.fx || 1, note: plan.note || '定投' });
    }
    return out;
  }

  /* ---------- 止盈止损预警 ---------- */
  function checkAlerts(S, opts) {
    const out = [];
    (S.assets || []).forEach(a => {
      const al = a.alerts; if (!al) return;
      const r = calcAsset(a, S), price = a.price || 0;
      if (al.takeProfitPrice && price >= al.takeProfitPrice) out.push({ asset: a.name, level: '止盈', msg: `现价 ${price} 达到止盈线 ${al.takeProfitPrice}` });
      if (al.stopLossPrice && price <= al.stopLossPrice) out.push({ asset: a.name, level: '止损', msg: `现价 ${price} 跌破止损线 ${al.stopLossPrice}` });
      if (al.takeProfitRate && r.rate >= al.takeProfitRate) out.push({ asset: a.name, level: '止盈', msg: `收益率 ${(r.rate * 100).toFixed(1)}% 达 ${(al.takeProfitRate * 100)}%` });
      if (al.stopLossRate && r.rate <= -al.stopLossRate) out.push({ asset: a.name, level: '止损', msg: `亏损 ${(r.rate * 100).toFixed(1)}% 触 ${(-al.stopLossRate * 100)}%` });
    });
    return out;
  }

  /* ---------- 资金出入金（账户级） ---------- */
  /** S.cashFlows: [{id, accountId, date, kind:'deposit'|'withdraw', amount, fx, note}] */
  function cashFlowSummary(S, opts) {
    const accountId = opts && opts.accountId;
    let dep = 0, wd = 0;
    (S.cashFlows || []).filter(c => !accountId || c.accountId === accountId).forEach(c => {
      const v = (c.amount || 0) * (c.fx || 1);
      if (c.kind === 'deposit') dep += v; else wd += v;
    });
    return { deposit: round2(dep), withdraw: round2(wd), net: round2(dep - wd) };
  }

  return { DEFAULTS, TAX_DEFAULT, ALLOC_DEFAULT, TODAY, currentFx, assetFx, eventsOf, calcAsset, calcStock, calcFlow, assetTotal,
    accountSummary, securityAggregation, summary, realizedByMonth, netInvestByMonth, monthRows, yearRows,
    xirr, portfolioFlows, portfolioXirr, annualized, holdingDays, twr, allocation, concentration, benchmark,
    realizedGainsByYear, taxEstimate, dcaGenerate, checkAlerts, cashFlowSummary };
});
