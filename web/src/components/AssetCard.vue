<template>
  <div class="asset-card">
    <div class="ac-head">
      <div>
        <div class="ac-name">{{ h.asset.name }}</div>
        <div class="ac-code">
          <span :class="'badge ' + TYPE_BADGE[h.asset.type]">{{ TYPE_LABEL[h.asset.type] }}</span>
          <span v-if="h.asset.market" :class="'badge ' + (h.asset.market === 'CN' ? 'badge-cn' : 'badge-us')" style="margin-left:4px">
            {{ MARKET_LABEL[h.asset.market] }}
          </span>
          <span v-if="h.asset.code" style="margin-left:6px">{{ h.asset.code }}</span>
        </div>
      </div>
      <div class="ac-mv num">¥{{ money(h.mvCNY) }}</div>
    </div>

    <div class="ac-row"><span>数量/份额</span><b class="num">{{ h.calc.qty ? money(h.calc.qty, h.asset.type === 'stock' ? 0 : 4) : '—' }}</b></div>
    <div class="ac-row">
      <span>成本单价 / 当前单价 ({{ h.asset.currency }})</span>
      <b class="num">{{ money(h.calc.avgLocal, 4) }} / {{ money(unitPrice, 4) }}</b>
    </div>
    <div class="ac-row" v-if="hasOpening"><span>期初建仓</span><b class="num">{{ money(h.calc.openingQty, 4) }} 份 / ¥{{ money(h.calc.openingCostCNY) }}</b></div>
    <div class="ac-row"><span>成本 (CNY)</span><b class="num">¥{{ money(h.calc.costCNY) }}</b></div>
    <div class="ac-row"><span>已实现</span><b class="num" :class="signClass(h.calc.realCNY)">{{ signedMoney(h.calc.realCNY) }}</b></div>
    <div class="ac-row"><span>浮动盈亏</span><b class="num" :class="signClass(h.calc.unrealCNY)">{{ signedMoney(h.calc.unrealCNY) }}</b></div>
    <div class="ac-row"><span>总收益</span><b class="num" :class="signClass(h.calc.totalCNY)">{{ signedMoney(h.calc.totalCNY) }}</b></div>
    <div class="ac-row">
      <span>收益率</span>
      <b class="num" :class="signClass(h.calc.rate)">{{ signedPct(h.calc.rate) }}</b>
    </div>
    <div class="ac-row" v-if="h.asset.currency === 'USD'">
      <span>汇率(锁定成本/当前)</span>
      <b class="num muted">{{ Number(h.calc.fxUsed || 0).toFixed(4) }} / {{ Number(fxCurrent || 0).toFixed(4) }}</b>
    </div>
    <div class="ac-row" v-if="accountName"><span>所属账户</span><b>{{ accountName }}</b></div>

    <div class="ac-actions">
      <el-button size="small" type="primary" @click="$emit('event', h.asset)">录入</el-button>
      <el-button size="small" @click="$emit('edit', h.asset)">编辑</el-button>
      <el-button size="small" @click="$emit('alert', h.asset)">预警</el-button>
      <el-button size="small" type="danger" plain @click="$emit('remove', h.asset)">删除</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { money, signedMoney, signedPct, signClass, TYPE_LABEL, TYPE_BADGE, MARKET_LABEL } from '../utils/format';
import { usePortfolioStore } from '../stores/portfolio';
const props = defineProps({
  h: { type: Object, required: true },
  accountName: { type: String, default: '' },
});
defineEmits(['event', 'edit', 'alert', 'remove']);
const store = usePortfolioStore();
const fxCurrent = computed(() => store.kpis.fxCurrent || 0);
/** 当前单位价格：股票用市价，非股票用单位净值 */
const unitPrice = computed(() =>
  props.h.asset.type === 'stock' ? props.h.asset.price : props.h.asset.unitPrice);
const hasOpening = computed(() => (props.h.calc.openingQty || 0) > 0);
</script>
