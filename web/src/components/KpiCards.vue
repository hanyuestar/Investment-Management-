<template>
  <div class="kpi-row">
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">总资产 (CNY)</div>
      <div class="val num">¥{{ money(k.totalAssets) }}</div>
      <div class="sub num muted">累计投入 {{ money(k.invest) }} + 累计收益 {{ signedMoney(k.profit) }}</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">累计投入 (CNY)</div>
      <div class="val num">¥{{ money(k.invest) }}</div>
      <div class="sub num muted">净入金（入金 − 出金）</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">累计收益 (CNY)</div>
      <div class="val num" :class="signClass(k.profit)">{{ signedMoney(k.profit) }}</div>
      <div class="sub num" :class="signClass(k.rate)">
        收益率 {{ signedPct(k.rate) }} ｜ 已实现 {{ signedMoney(k.real) }} · 浮动 {{ signedMoney(k.unreal) }}
      </div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">XIRR 年化</div>
      <div class="val num" :class="signClass(k.xirr)">{{ k.xirr == null ? '—' : signedPct(k.xirr) }}</div>
      <div class="sub">按出入金现金流 ｜ 持有 {{ k.holdingDays || 0 }} 天</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">TWR 时间加权</div>
      <div class="val num" :class="signClass(k.twr)">{{ k.twr == null ? '—' : signedPct(k.twr) }}</div>
      <div class="sub">剔除资金进出影响</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">基准 α ({{ k.benchmarkCode || 'CSI300' }})</div>
      <div class="val num" :class="signClass(k.alpha)">{{ k.alpha == null ? '—' : signedPct(k.alpha) }}</div>
      <div class="sub">组合 TWR − 基准涨跌</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">本年收益</div>
      <div class="val num" :class="signClass(k.yearProfit)">{{ signedMoney(k.yearProfit) }}</div>
      <div class="sub num muted">汇率 1 USD = {{ Number(k.fxCurrent || 7.1).toFixed(4) }}</div>
    </div>
  </div>

  <!-- 数据一致性告警（如：期初建仓本金与入金重复统计） -->
  <div v-if="warnings.length" class="dup-warn">
    <div v-for="w in warnings" :key="w.code" class="dup-item">
      <div class="dup-msg">⚠️ <b>{{ w.title }}</b> —— {{ w.msg }}</div>
      <button class="dup-dismiss" @click="store.dismissWarning(w.code)">不再提示</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { usePortfolioStore } from '../stores/portfolio';
import { money, signedMoney, signedPct, signClass } from '../utils/format';

const store = usePortfolioStore();
const { kpis: k, warnings, pulse } = storeToRefs(store);
const flashing = ref(false);
let timer = null;
watch(pulse, () => {
  flashing.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => { flashing.value = false; }, 1100);
});
</script>

<style scoped>
.dup-warn {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
  color: #b88230;
  font-size: 13px;
  line-height: 1.75;
}
.dup-warn b { color: #a06a10; }
.dup-item { display: flex; gap: 10px; align-items: flex-start; }
.dup-msg { flex: 1; min-width: 0; }
.dup-dismiss {
  flex: none; margin-top: 1px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
  background: transparent; border: 1px solid #e6c78a; color: #a06a10;
  font-size: 12px; line-height: 1.5; white-space: nowrap;
}
.dup-dismiss:hover { background: #f7ecd8; }
@media (max-width: 768px) {
  .dup-warn { font-size: 12px; line-height: 1.7; padding: 9px 12px; }
}
</style>
