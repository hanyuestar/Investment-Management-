/**
 * 投资管家 · 成本核算引擎（v5 参考实现）
 * 纯函数、无依赖，Node 与浏览器通用。
 *
 * v5 相对 v4 的口径变更（依据产品重设计）：
 *  1. 【期初建仓】新增 opening 事件：用于录入「记账开始前已持有的仓位」。
 *     计入份额与成本、计入净投入，但**不产生账户现金流**，并作为 XIRR 的初始存量。
 *  2. 【全类型份额】股票/基金/理财/债券统一走「份额 + 单位成本」框架，
 *     非股票不再只有金额，calcAsset 对任何类型都返回 qty / avgCNY。
 *  3. 【账户现金】新增 accountCash()：现金 = 入金−出金 − 买入−申购 + 卖出+赎回 + 分红+利息。
 *     总资产 = 持仓市值 + 现金。
 *  4. 【双口径收益】
 *     - 持仓口径 profitInvest = 已实现 + 分红/利息 + 浮动（衡量投资能力，与 XIRR/TWR 同源）
 *     - 账户口径 profitAccount = 总资产 − 有效净投入（回答「我到底赚了多少」）
 *     有效净投入 effectiveInvest = (入金−出金) + 期初建仓本金
 *  5. 【外部现金流只有出入金】月末快照存「总资产」，故
 *     月浮动 = 快照差 − 当月净入金；TWR 分母 = 上期总值 + 当月净入金。
 *     （v4 误用「证券买卖净额」作为外部现金流，导致出入金被当成收益）
 *  6. 【已实现口径统一】非股票赎回本金**不计入**已实现收益（v4 的 realizedByMonth 有此 bug）。
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

  /** 事件动作归一化：股票用 side，非股票用 kind，期初建仓用 opening */
  const actionOf = e => e.side || e.kind || '';

  /**
   * 单位价格（账户币种）：
   *  - 股票：a.price（市价）
   *  - 非股票：a.unitPrice（单位净值）；为 0 时回退到 marketValue/qty
   *  注意：股票不得走 unitPrice 分支 —— 数据库里股票的 unit_price 恒为 0，
   *  若用 `unitPrice != null` 判断会把市价误判为 0，导致市值归零。
   */
  function unitPriceOf(a, qty) {
    if (a.type === 'stock') return +a.price || 0;
    if (+a.unitPrice > 0) return +a.unitPrice;
    return qty > 0 ? (+a.marketValue || 0) / qty : (+a.marketValue || 0);
  }

  /* =========================================================
   * 单资产核算（全类型统一：份额 + 加权成本）
   * costMethod: 'wavg'(摊薄加权平均, 默认) | 'fifo'(先进先出)
   * dividendReducesCost: false=分红计入已实现(默认) | true=分红冲减成本
   * ========================================================= */
  function calcAsset(a, S) {
    const cfg = Object.assign({}, DEFAULTS, S.settings || {});
    const evs = eventsOf(S, a.id);
    return calcUnified(a, evs, cfg, S);
  }

  function calcUnified(a, evs, cfg, S) {
    const isStock = a.type === 'stock';
    const isFifo = cfg.costMethod === 'fifo';
    const divReduce = !!cfg.dividendReducesCost;

    let qty = 0;                         // 当前持仓份额
    let lots = [];                       // FIFO 批次: {q, price, fee, fx, date}
    let costLocal = 0, costCNY = 0;      // 当前持仓成本
    let openQty = 0, openCostCNY = 0;    // 期初建仓（份额 / 成本 ¥）
    let buyQty = 0, buyAmtCNY = 0, buyAmtLocal = 0;  // 累计买入/申购（**不含**期初建仓）
    let realLocal = 0, realCNY = 0;      // 已实现（卖出/赎回）
    let divLocal = 0, divCNY = 0;        // 现金分红
    let incomeCNY = 0;                   // 非股票利息等现金收益
    let investCNY = 0, redeemCNY = 0;    // 非股票累计申购 / 赎回净额（CNY）
    let sellProceedsCNY = 0;             // 股票累计卖出净额（CNY）
    const byMonth = {};                  // { 'YYYY-MM': {sell, div, income} }
    const addM = (m, k, v) => { if (!m) return; byMonth[m] = byMonth[m] || { sell: 0, div: 0, income: 0 }; byMonth[m][k] = +(byMonth[m][k] + v).toFixed(2); };

    for (const t of evs) {
      const act = actionOf(t);
      const f = t.fx || 1;
      const tQty = +t.qty || 0;
      const tAmtRaw = t.amount != null ? +t.amount || 0 : 0;
      const tPrice = +t.price || (tQty > 0 ? tAmtRaw / tQty : 0);
      const grossAmt = tQty > 0 ? tQty * tPrice : tAmtRaw;   // 成交金额（账户币种）
      const fee = t.fee || 0;

      if (act === 'opening') {
        /* 期初建仓：记账开始前已持有的仓位。计入份额/成本/净投入，不产生现金流。 */
        const q = tQty > 0 ? tQty : 1;                    // 份额缺省 1（金额口径）
        const amt = grossAmt || tAmtRaw;
        qty += q; openQty += q;
        costLocal += amt + fee;
        costCNY += (amt + fee) * f;
        openCostCNY += (amt + fee) * f;
        lots.push({ q: q, price: tPrice || (q > 0 ? amt / q : 0), fee: fee, fx: f, date: t.date });
      } else if (act === 'buy' || act === 'invest') {
        qty += tQty;                                       // 买入/申购：份额增加
        costLocal += grossAmt + fee;
        costCNY += (grossAmt + fee) * f;
        lots.push({ q: tQty, price: tPrice, fee: fee, fx: f, date: t.date });
        buyQty += tQty; buyAmtCNY += (grossAmt + fee) * f; buyAmtLocal += grossAmt + fee;
        if (!isStock) investCNY += (grossAmt + fee) * f;
      } else if (act === 'sell' || act === 'redeem') {
        const sellQty = tQty;
        const proceedsLocal = (sellQty > 0 ? sellQty * tPrice : tAmtRaw) - fee;
        let rl = 0, rc = 0;
        if (sellQty > 0) {
          if (isFifo) {
            let need = sellQty;
            while (need > 1e-9 && lots.length) {
              const lot = lots[0];
              const take = Math.min(need, lot.q);
              const lotUnitLocal = lot.price + (lot.fee || 0) / lot.q;
              const lotUnitCNY = lotUnitLocal * lot.fx;
              rl += tPrice * take - lotUnitLocal * take;
              rc += tPrice * take * f - lotUnitCNY * take;
              lot.q -= take; need -= take;
              if (lot.q <= 1e-9) lots.shift();
            }
            rl -= fee; rc -= fee * f;
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
        } else {
          /* 金额口径赎回（兼容旧数据）：按加权成本比例结转已实现 */
          const avgC = qty > 0 ? costCNY / qty : 0;
          const avgL = qty > 0 ? costLocal / qty : 0;
          const ratio = (costCNY > 0) ? Math.min(1, (tAmtRaw * f) / costCNY) : 0;
          const outQty = qty * ratio;
          rl = proceedsLocal - avgL * outQty;
          rc = proceedsLocal * f - avgC * outQty;
          costLocal -= avgL * outQty; costCNY -= avgC * outQty; qty -= outQty;
        }
        realLocal += rl; realCNY += rc;
        if (isStock) sellProceedsCNY += proceedsLocal * f; else redeemCNY += proceedsLocal * f;
        addM(t.date.slice(0, 7), 'sell', rc);
      } else if (act === 'div') {
        const v = (t.amount || 0) * f;
        if (divReduce) { costLocal -= (t.amount || 0); costCNY -= v; }
        else { divLocal += (t.amount || 0); divCNY += v; addM(t.date.slice(0, 7), 'div', v); }
      } else if (act === 'income') {
        /* 非股票利息 / 理财收益：现金收益，计入已实现 */
        const v = (tAmtRaw || 0) * f;
        incomeCNY += v;
        addM(t.date.slice(0, 7), 'income', v);
      } else if (act === 'bonus') {
        const add = tQty;
        qty += add;
        if (isFifo) { if (lots.length) lots[lots.length - 1].q += add; else lots.push({ q: add, price: 0, fee: 0, fx: f, date: t.date }); }
      } else if (act === 'split') {
        const ratio = t.ratio || 1;
        qty *= ratio;
        if (isFifo) lots.forEach(l => { l.q *= ratio; l.price /= ratio; });
      }
    }

    const fxNow = assetFx(a, S);
    const cnyRate = (a.currency === 'USD' ? fxNow : 1);
    const unitPx = unitPriceOf(a, qty);
    const mvLocal = isStock ? qty * unitPx : (qty > 0 ? qty * unitPx : (+a.marketValue || 0));
    const mvCNY = mvLocal * cnyRate;
    const unrealCNY = mvCNY - costCNY;
    const totalCNY = realCNY + divCNY + incomeCNY + unrealCNY;

    /* 净投入（证券口径，可增可减）= 期初建仓 + 买入/申购 − 卖出/赎回净额
       说明：清仓后可能为负（表示已净收回本金），此时不作为收益率分母。 */
    const netInvestCNY = openCostCNY + buyAmtCNY - sellProceedsCNY - redeemCNY;

    return {
      type: a.type, isStock, costMethod: cfg.costMethod,
      qty: +qty.toFixed(6),
      unitPrice: round2(unitPx),
      openingQty: +openQty.toFixed(6), openingCostCNY: round2(openCostCNY),
      costLocal: round2(costLocal), costCNY: round2(costCNY),
      mvLocal: round2(mvLocal), mvCNY: round2(mvCNY),
      realLocal: round2(realLocal), realCNY: round2(realCNY),
      divCNY: round2(divCNY), divLocal: round2(divLocal),
      incomeCNY: round2(incomeCNY),
      investCNY: round2(investCNY), redeemCNY: round2(redeemCNY), sellCNY: round2(sellProceedsCNY),
      unrealCNY: round2(unrealCNY), totalCNY: round2(totalCNY),
      avgLocal: qty > 0 ? costLocal / qty : 0, avgCNY: qty > 0 ? costCNY / qty : 0,
      buyAvgCNY: buyQty > 0 ? buyAmtCNY / buyQty : 0, buyAvgLocal: buyQty > 0 ? buyAmtLocal / buyQty : 0,
      buyQty, buyAmtCNY: round2(buyAmtCNY), buyAmtLocal: round2(buyAmtLocal),
      netInvestCNY: round2(netInvestCNY),
      total: round2(totalCNY),
      rate: netInvestCNY > 0 ? totalCNY / netInvestCNY : 0, fxUsed: fxNow, byMonth
    };
  }

  /** 兼容：现金流型资产（v4 接口保留，内部已统一） */
  function calcFlow(a, evs, S) {
    const cfg = Object.assign({}, DEFAULTS, S.settings || {});
    return calcUnified(a, evs, cfg, S);
  }
  function calcStock(a, evs, cfg, S) { return calcUnified(a, evs, cfg, S); }
  const assetTotal = r => (r.totalCNY !== undefined ? r.totalCNY : r.total);

  /* =========================================================
   * 账户现金 & 本金（外部现金流）
   * ========================================================= */
  /**
   * 账户现金余额（账户币种折算 CNY）
   *  现金 = 入金 − 出金
   *       − 买入(含费) − 申购(含费)
   *       + 卖出(扣费) + 赎回
   *       + 分红 + 利息/理财收益
   * 期初建仓(opening)不产生现金流：其本金在记账开始前已投入。
   */
  function accountCash(S, opts) {
    const accId = opts && opts.accountId;
    const inAcc = x => !accId || x.accountId === accId;
    let cash = 0, dep = 0, wd = 0, openCost = 0;
    (S.cashFlows || []).filter(inAcc).forEach(c => {
      const v = (c.amount || 0) * (c.fx || 1);
      if (c.kind === 'deposit') { dep += v; cash += v; } else { wd += v; cash -= v; }
    });
    (S.assets || []).filter(inAcc).forEach(a => {
      eventsOf(S, a.id).forEach(e => {
        const act = actionOf(e);
        const f = e.fx || 1;
        const tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
        const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
        const gross = tQty > 0 ? tQty * px : tAmt;
        const fee = e.fee || 0;
        switch (act) {
          case 'opening': openCost += (gross + fee) * f; break;       // 不产生现金流
          case 'buy': case 'invest': cash -= (gross + fee) * f; break;
          case 'sell': case 'redeem': cash += (gross - fee) * f; break;
          case 'div': case 'income': cash += tAmt * f; break;
          default: break;                                            // bonus / split 不影响现金
        }
      });
    });
    return {
      cash: round2(cash), deposit: round2(dep), withdraw: round2(wd),
      netDeposit: round2(dep - wd),          // 净入金（仅出入金）
      net: round2(dep - wd),                 // ★ 兼容旧字段名（= 净入金）
      openingCost: round2(openCost),         // 期初建仓本金
      effectiveInvest: round2(dep - wd + openCost)   // 有效净投入 = 净入金 + 期初建仓本金
    };
  }
  /** 兼容旧名：仅出入金汇总 */
  function cashFlowSummary(S, opts) {
    const c = accountCash(S, opts);
    return { deposit: c.deposit, withdraw: c.withdraw, net: c.netDeposit };
  }

  /* =========================================================
   * 账户维度
   * ========================================================= */
  function accountSummary(S) {
    const out = (S.accounts || []).map(acc => {
      const assets = S.assets.filter(a => a.accountId === acc.id);
      let mv = 0, netInvest = 0, profitInvest = 0;
      assets.forEach(a => {
        const r = calcAsset(a, S);
        mv += r.mvCNY; profitInvest += assetTotal(r);
        netInvest += r.netInvestCNY;
      });
      const cf = accountCash(S, { accountId: acc.id });
      const profit = round2(profitInvest);          // 累计收益（单一，= 已实现+分红+利息+浮动）
      const invest = cf.netDeposit;                 // 累计投入 = 净入金
      const totalAssets = round2(invest + profit);  // 总资产 = 累计投入 + 累计收益
      return {
        account: acc, count: assets.length,
        mv: round2(mv), cash: cf.cash, totalAssets,
        netDeposit: cf.netDeposit, openingCost: cf.openingCost, effectiveInvest: cf.effectiveInvest,
        netInvest: round2(netInvest),
        profit, profitInvest: profit, profitAccount: profit,   // 兼容别名
        invest,
        rate: invest > 0 ? profit / invest : 0,
        accountRate: invest > 0 ? profit / invest : 0
      };
    });
    const all = out.reduce((s, x) => ({
      mv: s.mv + x.mv, cash: s.cash + x.cash, totalAssets: s.totalAssets + x.totalAssets,
      invest: s.invest + x.invest, netInvest: s.netInvest + x.netInvest,
      profit: s.profit + x.profit
    }), { mv: 0, cash: 0, totalAssets: 0, invest: 0, netInvest: 0, profit: 0 });
    return {
      byAccount: out,
      total: {
        mv: round2(all.mv), cash: round2(all.cash), totalAssets: round2(all.totalAssets),
        invest: round2(all.invest), netInvest: round2(all.netInvest),
        profit: round2(all.profit), profitInvest: round2(all.profit), profitAccount: round2(all.profit),
        rate: all.invest > 0 ? all.profit / all.invest : 0,
        accountRate: all.invest > 0 ? all.profit / all.invest : 0
      }
    };
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
      m.qty += r.qty; m.costCNY += r.costCNY;                 // ★ 全类型都用真实份额
      m.mvCNY += r.mvCNY; m.totalCNY += assetTotal(r);
      m.accounts.push({ accountId: a.accountId, assetId: a.id, qty: r.qty, mvCNY: r.mvCNY });
    });
    return Object.values(map).map(m => ({
      ...m, qty: +m.qty.toFixed(6), costCNY: round2(m.costCNY), mvCNY: round2(m.mvCNY), totalCNY: round2(m.totalCNY),
      avgCNY: m.qty > 0 ? m.costCNY / m.qty : 0,
      unrealCNY: round2(m.mvCNY - m.costCNY),
      rate: m.costCNY > 0 ? m.totalCNY / m.costCNY : 0
    }));
  }

  /* =========================================================
   * 全局汇总 & 报表（双口径）
   * ========================================================= */
  function summary(S, opts) {
    const accountId = opts && opts.accountId;
    const assets = accountId ? S.assets.filter(a => a.accountId === accountId) : S.assets;
    let mv = 0, real = 0, unreal = 0, cashIncome = 0, netInvest = 0, buyTotal = 0;
    const rows = assets.map(a => {
      const r = calcAsset(a, S);
      mv += r.mvCNY || 0;
      real += r.realCNY + r.divCNY + r.incomeCNY;   // 已实现 = 卖出/赎回已实现 + 分红 + 利息/理财收益
      cashIncome += r.incomeCNY;                     // 仅作明细拆分（已含在 real 内，不再重复累计）
      unreal += r.unrealCNY;
      netInvest += r.netInvestCNY;
      buyTotal += r.buyAmtCNY;
      return { a, r, mv: r.mvCNY || 0, profit: assetTotal(r) };
    });
    const cf = accountCash(S, opts);
    /* v6 单一口径（用户定义）：
     *   累计投入 = 净入金（入金 − 出金）        —— 期初建仓本金**不计入**
     *   累计收益 = 已实现 + 分红 + 利息 + 浮动  —— 唯一口径，不再区分「账户/持仓」
     *   总资产   = 累计投入 + 累计收益
     */
    const profit = round2(real + unreal);
    const invest = cf.netDeposit;
    const totalAssets = round2(invest + profit);
    return {
      /* 持仓构成 */
      total: round2(mv),                    // 兼容旧字段名（= 持仓市值）
      mv: round2(mv),
      real: round2(real), unreal: round2(unreal), cashIncome: round2(cashIncome),
      /* 单一口径三件套 */
      invest,                               // 累计投入 = 净入金
      profit,                               // 累计收益（唯一口径）
      totalAssets,                          // 总资产 = 累计投入 + 累计收益
      rate: invest > 0 ? profit / invest : 0,
      /* 兼容别名（v5 双口径字段，现均指向同一值） */
      profitInvest: profit, profitAccount: profit, accountRate: invest > 0 ? profit / invest : 0,
      /* 诊断用（管理页/告警） */
      netDeposit: cf.netDeposit, openingCost: cf.openingCost, effectiveInvest: cf.effectiveInvest,
      netInvest: round2(netInvest),         // 证券净投入（可增可减）
      buyTotal: round2(buyTotal),           // 累计买入/申购（仅展示）
      cash: cf.cash,
      rows
    };
  }

  /** 月度已实现收益（口径统一：赎回本金不计入） */
  function realizedByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const m = {}; const add = (k, v) => { if (k) m[k] = +((m[k] || 0) + v).toFixed(2); };
    S.assets.filter(a => !accountId || a.accountId === accountId).forEach(a => {
      const r = calcAsset(a, S);
      for (const mm in r.byMonth) add(mm, r.byMonth[mm].sell + r.byMonth[mm].div + (r.byMonth[mm].income || 0));
    });
    return m;
  }
  /** 月度外部现金流：仅出入金（快照为「总资产」，故买卖/申赎属账户内部转移） */
  function netDepositByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const m = {}; const add = (k, v) => { if (k) m[k] = +((m[k] || 0) + v).toFixed(2); };
    (S.cashFlows || []).filter(c => !accountId || c.accountId === accountId).forEach(c => {
      add(String(c.date).slice(0, 7), (c.kind === 'deposit' ? 1 : -1) * (c.amount || 0) * (c.fx || 1));
    });
    return m;
  }
  /** 月度证券净投入（买入−卖出 / 申购−赎回，含期初建仓）：仅用于展示 */
  function netInvestByMonth(S, opts) {
    const accountId = opts && opts.accountId;
    const m = {}; const add = (k, v) => { if (k) m[k] = +((m[k] || 0) + v).toFixed(2); };
    S.assets.filter(a => !accountId || a.accountId === accountId).forEach(a => {
      eventsOf(S, a.id).forEach(t => {
        const act = actionOf(t), f = t.fx || 1;
        const tQty = +t.qty || 0, tAmt = t.amount != null ? +t.amount || 0 : 0;
        const px = +t.price || (tQty > 0 ? tAmt / tQty : 0);
        const gross = tQty > 0 ? tQty * px : tAmt, fee = t.fee || 0;
        if (act === 'opening') add(String(t.date).slice(0, 7), (gross + fee) * f);
        else if (act === 'buy' || act === 'invest') add(String(t.date).slice(0, 7), (gross + fee) * f);
        else if (act === 'sell' || act === 'redeem') add(String(t.date).slice(0, 7), -(gross - fee) * f);
      });
    });
    return m;
  }
  function monthRows(S, opts) {
    const real = realizedByMonth(S, opts);
    const net = netInvestByMonth(S, opts);        // ★ 月末快照为「持仓市值」，故外部资金流 = 证券净投入
    const netDep = netDepositByMonth(S, opts);    // 出入金（独立展示，不参与浮动收益）
    const snap = {}; (S.snapshots || []).forEach(s => snap[s.month] = s.total);
    const months = [...new Set([...Object.keys(real), ...Object.keys(snap), ...Object.keys(net), ...Object.keys(netDep)])].sort();
    const out = []; let prev = null;
    for (const mm of months) {
      const s = snap[mm]; let pureFloat = null, floatTotal = null;
      if (s !== undefined && prev !== null) {
        /* 纯浮动 = 快照差 − 证券净投入（快照为「持仓市值」，故买卖/申赎不计入浮动） */
        pureFloat = round2((s - prev) - (net[mm] || 0));
        /* 含浮动（规格 §7）：= 当月已实现 + 纯浮动。
           卖出/分红不改变持仓市值，故与纯浮动相加**不构成重复计算**。 */
        floatTotal = round2((real[mm] || 0) + pureFloat);
      }
      out.push({ month: mm, real: round2(real[mm] || 0),
        net: round2(net[mm] || 0),              // 证券净投入（保持原名，向后兼容）
        netDeposit: round2(netDep[mm] || 0),    // 出入金（新增，独立展示）
        snap: s, pureFloat, floatTotal,
        total: floatTotal });                   // 当月总收益 = 含浮动
      if (s !== undefined) prev = s;
    }
    return out;
  }
  function yearRows(S, opts) {
    const y = {};
    monthRows(S, opts).forEach(r => {
      const k = r.month.slice(0, 4); y[k] = y[k] || { year: k, real: 0, net: 0, netDeposit: 0, pureFloat: 0, floatTotal: 0, total: 0, hasF: false };
      y[k].real += r.real; y[k].net += r.net; y[k].netDeposit += r.netDeposit;
      if (r.floatTotal !== null) {
        y[k].pureFloat += (r.pureFloat || 0);
        y[k].floatTotal += r.floatTotal; y[k].hasF = true;
      }
    });
    return Object.values(y).sort((a, b) => (a.year < b.year ? -1 : 1))
      .map(x => ({ ...x, real: round2(x.real), net: round2(x.net), netDeposit: round2(x.netDeposit),
        pureFloat: round2(x.pureFloat), floatTotal: round2(x.floatTotal),
        total: round2(x.floatTotal) }));
  }

  /* =========================================================
   * 绩效指标 / 决策辅助 / 税务 / 预警 / 定投
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

  /**
   * 组合现金流（CNY，投资者视角）：
   *  引入「账户现金」后，**买入/卖出/申购/赎回/分红都是账户内部转移，不构成外部现金流**。
   *  真正的外部现金流只有两类：
   *    ① 出入金（入金=流出为负，出金=流入为正）
   *    ② 期初建仓本金（记账开始前已投入 → 视为初始流出）
   *  期末流入 = 总资产（持仓市值 + 现金）。
   *  兼容：若用户完全没有记录出入金与期初建仓（数据不完整），退回「证券流水口径」近似，
   *  以免 XIRR 因缺少初始流出而失真。
   */
  function portfolioFlows(S, opts) {
    const accountId = opts && opts.accountId;
    const asOf = (opts && opts.asOf) || TODAY();
    const inAcc = x => !accountId || x.accountId === accountId;
    const flows = [];

    const cf = accountCash(S, opts);
    const hasCashRecords = (cf.deposit + cf.withdraw) > 1e-9 || cf.openingCost > 1e-9;
    const s = summary(S, opts);

    if (hasCashRecords) {
      /* ── 现金口径（推荐，数据完整时）── */
      (S.cashFlows || []).filter(inAcc).forEach(c => {
        const v = (c.amount || 0) * (c.fx || 1);
        flows.push({ date: c.date, amount: c.kind === 'deposit' ? -v : v, assetId: null, kind: c.kind });
      });
      (S.assets || []).filter(inAcc).forEach(a => {
        eventsOf(S, a.id).forEach(e => {
          if (actionOf(e) !== 'opening') return;
          const f = e.fx || 1, tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
          const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
          const gross = tQty > 0 ? tQty * px : tAmt;
          flows.push({ date: e.date, amount: -((gross + (e.fee || 0)) * f), assetId: a.id, kind: 'opening' });
        });
      });
      flows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      /* 期末流入必须取**真实可变现总值**（持仓市值 + 账户现金），
         不能用展示口径 totalAssets（= 累计投入 + 累计收益）——
         两者仅在无期初建仓时相等；有期初建仓时 totalAssets 会少算本金，
         导致 XIRR 严重失真（实测：仅期初建仓 1 万→现值 1.2 万，末值取 totalAssets 得 −80%，实际应为 +20%）。 */
      const realizable = round2(s.mv + s.cash);
      if (realizable > 1e-9) flows.push({ date: asOf, amount: realizable, assetId: null, terminal: true, kind: 'realizable' });
    } else {
      /* ── 兼容口径：未记录出入金时，按证券流水近似 ── */
      (S.assets || []).filter(inAcc).forEach(a => {
        eventsOf(S, a.id).forEach(e => {
          const f = e.fx || 1, act = actionOf(e);
          const tQty = +e.qty || 0, tAmt = e.amount != null ? +e.amount || 0 : 0;
          const px = +e.price || (tQty > 0 ? tAmt / tQty : 0);
          const gross = tQty > 0 ? tQty * px : tAmt, fee = e.fee || 0;
          let amt = 0;
          if (act === 'opening' || act === 'buy' || act === 'invest') amt = -(gross + fee) * f;
          else if (act === 'sell' || act === 'redeem') amt = (gross - fee) * f;
          else if (act === 'div' || act === 'income') amt = tAmt * f;
          if (Math.abs(amt) > 1e-9) flows.push({ date: e.date, amount: amt, assetId: a.id, act });
        });
      });
      flows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
      if (s.mv > 1e-9) flows.push({ date: asOf, amount: s.mv, assetId: null, terminal: true, kind: 'mv' });
    }
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
  /** 组合持有天数（首笔事件或期初建仓 → 今天） */
  function holdingDays(S, opts) {
    const accountId = opts && opts.accountId;
    let first = null;
    (S.assets || []).filter(a => !accountId || a.accountId === accountId).forEach(a => {
      const e = eventsOf(S, a.id)[0]; if (e && (!first || e.date < first)) first = e.date;
    });
    if (!first) return 0;
    return Math.max(1, Math.round((new Date(TODAY()) - new Date(first)) / 86400000));
  }

  /* ---------- TWR：时间加权收益率（月末快照序列，外部现金流=出入金） ---------- */
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
    return { total: round2(total), cash: s.cash, rows, drift: round2(drift), driftPct: total > 0 ? drift / total : 0 };
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
        const act = actionOf(e);
        const tQty = +e.qty || 0;
        const px = +e.price || 0;
        if (act === 'opening') { qty += tQty; costCNY += (tQty * px + (e.fee || 0)) * f; }
        else if (act === 'buy') { qty += tQty; costCNY += (tQty * px + (e.fee || 0)) * f; }
        else if (act === 'sell') {
          const avg = qty > 0 ? costCNY / qty : 0;
          const gain = ((tQty * px) - (e.fee || 0)) * f - avg * tQty;
          costCNY -= avg * tQty; qty -= tQty;
          const y = String(e.date).slice(0, 4);
          out[mk][y] = round2((out[mk][y] || 0) + gain);
        } else if (act === 'bonus') qty += tQty;
        else if (act === 'split') qty *= (e.ratio || 1);
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
      const buys = eventsOf(S, a.id).filter(e => { const x = actionOf(e); return x === 'buy' || x === 'opening'; });
      eventsOf(S, a.id).filter(e => actionOf(e) === 'div').forEach(e => {
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
    const [y0, m0] = String(plan.startMonth || '2026-01').split('-').map(Number);
    for (let i = 0; i < (plan.months || 12); i++) {
      const m = (m0 - 1) + i;
      const y = y0 + Math.floor(m / 12), mm = (m % 12) + 1;
      out.push({ date: `${y}-${String(mm).padStart(2, '0')}-${String(plan.day || 1).padStart(2, '0')}`,
        kind: 'invest', side: null, qty: plan.qty || null, price: plan.price || null,
        amount: plan.amount, fee: 0, fx: plan.fx || 1, note: plan.note || '定投' });
    }
    return out;
  }

  /* ---------- 止盈止损预警 ---------- */
  function checkAlerts(S, opts) {
    const out = [];
    (S.assets || []).forEach(a => {
      const al = a.alerts; if (!al) return;
      const r = calcAsset(a, S), price = unitPriceOf(a, r.qty);
      if (al.takeProfitPrice && price >= al.takeProfitPrice) out.push({ asset: a.name, level: '止盈', msg: `现价 ${price} 达到止盈线 ${al.takeProfitPrice}` });
      if (al.stopLossPrice && price <= al.stopLossPrice) out.push({ asset: a.name, level: '止损', msg: `现价 ${price} 跌破止损线 ${al.stopLossPrice}` });
      if (al.takeProfitRate && r.rate >= al.takeProfitRate) out.push({ asset: a.name, level: '止盈', msg: `收益率 ${(r.rate * 100).toFixed(1)}% 达 ${(al.takeProfitRate * 100)}%` });
      if (al.stopLossRate && r.rate <= -al.stopLossRate) out.push({ asset: a.name, level: '止损', msg: `亏损 ${(r.rate * 100).toFixed(1)}% 触 ${(-al.stopLossRate * 100)}%` });
    });
    return out;
  }

  return { DEFAULTS, TAX_DEFAULT, ALLOC_DEFAULT, TODAY, currentFx, assetFx, eventsOf, actionOf, unitPriceOf,
    calcAsset, calcStock, calcFlow, assetTotal, accountCash, cashFlowSummary,
    accountSummary, securityAggregation, summary, realizedByMonth, netDepositByMonth, netInvestByMonth, monthRows, yearRows,
    xirr, portfolioFlows, portfolioXirr, annualized, holdingDays, twr, allocation, concentration, benchmark,
    realizedGainsByYear, taxEstimate, dcaGenerate, checkAlerts };
});
