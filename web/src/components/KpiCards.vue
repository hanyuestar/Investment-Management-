<template>
  <div class="kpi-row">
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">总资产 (CNY)</div>
      <div class="val num">¥{{ money(k.total) }}</div>
      <div class="sub">含理财/债券/基金市值</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">累计投入 (CNY)</div>
      <div class="val num">¥{{ money(k.invest) }}</div>
      <div class="sub">股票净买入 + 非股净申购 + 手续费</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">累计收益 (CNY)</div>
      <div class="val num" :class="signClass(k.profit)">
        {{ signedMoney(k.profit) }}
      </div>
      <div class="sub num" :class="signClass(k.simpleRate)">简单收益率 {{ signedPct(k.simpleRate) }}</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">XIRR 年化</div>
      <div class="val num" :class="signClass(k.xirr)">{{ k.xirr == null ? '—' : signedPct(k.xirr) }}</div>
      <div class="sub">持有 {{ k.holdingDays || 0 }} 天</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">已实现 / 浮动</div>
      <div class="val num" style="font-size:15px;line-height:1.5">
        <div :class="signClass(k.real)">{{ signedMoney(k.real) }}</div>
        <div :class="signClass(k.unreal)">{{ signedMoney(k.unreal) }}</div>
      </div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">TWR 时间加权</div>
      <div class="val num" :class="signClass(k.twr)">{{ k.twr == null ? '—' : signedPct(k.twr) }}</div>
      <div class="sub">剔除出入金影响</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">基准 α ({{ k.benchmarkCode || 'CSI300' }})</div>
      <div class="val num" :class="signClass(k.alpha)">{{ k.alpha == null ? '—' : signedPct(k.alpha) }}</div>
      <div class="sub">组合 TWR − 基准涨跌</div>
    </div>
    <div class="kpi" :class="{ flash: flashing }">
      <div class="label">本年收益</div>
      <div class="val num" :class="signClass(k.yearProfit)">{{ signedMoney(k.yearProfit) }}</div>
      <div class="sub num muted">当前汇率 1 USD = {{ Number(k.fxCurrent || 7.1).toFixed(4) }} CNY</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { usePortfolioStore } from '../stores/portfolio';
import { money, signedMoney, signedPct, signClass } from '../utils/format';

const store = usePortfolioStore();
const { kpis: k, pulse } = storeToRefs(store);
const flashing = ref(false);
let timer = null;
watch(pulse, () => {
  flashing.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => { flashing.value = false; }, 1100);
});
</script>
