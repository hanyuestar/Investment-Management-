import { defineStore } from 'pinia';
import { computeApi } from '../api';

/**
 * 全局组合数据：原始状态 + 服务端实时计算结果。
 * 任何增删改后调用 refreshAll()；flash() 触发 KPI 闪烁反馈。
 */
export const usePortfolioStore = defineStore('portfolio', {
  state: () => ({
    raw: {
      settings: null,
      fx: [],
      accounts: [],
      assets: [],
      events: [],
      snapshots: [],
      benchmarks: [],
      cashFlows: [],
      dcaPlans: [],
    },
    d: null,            // /api/compute 全量派生数据
    selectedAccount: '', // '' = 全部账户
    loading: false,
    pulse: 0,           // KPI 闪烁计数
    lastError: '',
  }),
  getters: {
    ready: (s) => !!s.d,
    kpis: (s) => s.d?.kpis || {},
    warnings: (s) => s.d?.warnings || [],
    // 引擎返回 {asset, calc:{...}, mvCNY, profitCNY}，这里把 calc 摊平，便于组件直接取 h.qty / h.avgLocal 等
    holdings: (s) => (s.d?.holdings || []).map(h => ({ ...h, ...(h.calc || {}) })),
    // 引擎返回 {byAccount:[{account,count,mv,invest,profit,rate}], total}
    accountsAgg: (s) => (s.d?.accounts?.byAccount || []).map(r => ({
      ...r.account, count: r.count, mvCNY: r.mv, invest: r.invest, total: r.profit, ret: r.rate,
    })),
    accountsTotal: (s) => s.d?.accounts?.total || null,
    benchmark: (s) => s.d?.benchmark || null,
    // 以下各段均由 /api/compute 一次性返回
    performance: (s) => s.d?.performance || {},
    allocation: (s) => s.d?.allocation || { rows: [], total: 0, drift: 0, driftPct: 0 },
    concentration: (s) => s.d?.concentration || { list: [], byType: {}, alerts: [] },
    tax: (s) => s.d?.tax || { dividends: [], capGainRows: [], rules: {} },
    reports: (s) => s.d?.reports || { months: [], years: [] },
    cash: (s) => s.d?.cash || { cash: 0, deposit: 0, withdraw: 0, netDeposit: 0, openingCost: 0, effectiveInvest: 0 },
    settings: (s) => s.raw.settings || s.d?.settings || null,
    assets: (s) => s.raw.assets,
    accounts: (s) => s.raw.accounts,
    events: (s) => s.raw.events,
    fx: (s) => s.raw.fx,
    snapshots: (s) => s.raw.snapshots,
    benchmarks: (s) => s.raw.benchmarks,
    cashFlows: (s) => s.raw.cashFlows,
    dcaPlans: (s) => s.raw.dcaPlans,
    accountName: (s) => (id) => {
      const a = s.raw.accounts.find(x => x.id === String(id));
      return a ? a.name : '—';
    },
    assetById: (s) => (id) => s.raw.assets.find(a => a.id === String(id)),
    eventsOfAsset: (s) => (id) => s.raw.events.filter(e => e.assetId === String(id)),
  },
  actions: {
    setAccount(id) {
      this.selectedAccount = id || '';
      return this.refreshCompute();
    },
    flash() {
      this.pulse++;
    },
    async refreshAll(animate = true) {
      this.loading = true;
      this.lastError = '';
      try {
        const q = this.selectedAccount ? `?accountId=${this.selectedAccount}` : '';
        const [state, computed] = await Promise.all([
          computeApi.state(),
          computeApi.compute(this.selectedAccount),
        ]);
        this.raw = state;
        this.d = computed;
        if (animate) this.flash();
      } catch (e) {
        this.lastError = e.message;
      } finally {
        this.loading = false;
      }
    },
    async refreshCompute() {
      const computed = await computeApi.compute(this.selectedAccount);
      this.d = computed;
      this.flash();
    },
    /** 变更后统一调用：刷新并闪烁 */
    async mutate(fn) {
      const r = await fn();
      await this.refreshAll();
      return r;
    },
  },
});
