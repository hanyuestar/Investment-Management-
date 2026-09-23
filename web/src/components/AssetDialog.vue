<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    :title="isEdit ? '编辑资产' : '新增资产'" width="560px" @closed="onClosed">
    <el-form :model="form" label-width="104px">
      <el-form-item label="资产名称" required>
        <el-input v-model="form.name" placeholder="如：贵州茅台 / 标普500 ETF" />
      </el-form-item>
      <el-form-item label="代码">
        <el-input v-model="form.code" placeholder="如 600519 / VOO（选填）" />
      </el-form-item>

      <template v-if="!isEdit">
        <el-form-item label="所属账户" required>
          <el-select v-model="form.accountId" placeholder="选择账户" style="width:100%">
            <el-option v-for="a in accounts" :key="a.id" :label="`${a.name}（${ACCOUNT_KIND_LABEL[a.kind]}）`" :value="a.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="资产类型" required>
          <el-radio-group v-model="form.type">
            <el-radio-button label="stock">股票</el-radio-button>
            <el-radio-button label="fund">基金</el-radio-button>
            <el-radio-button label="wealth">理财</el-radio-button>
            <el-radio-button label="bond">债券</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="市场" v-if="form.type === 'stock'" required>
          <el-radio-group v-model="form.market">
            <el-radio label="CN">A股 (CNY)</el-radio>
            <el-radio label="US">美股 (USD)</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="币种" required>
          <el-radio-group v-model="form.currency" :disabled="form.type === 'stock'">
            <el-radio label="CNY">CNY</el-radio>
            <el-radio label="USD">USD</el-radio>
          </el-radio-group>
          <div class="form-tip" style="margin-left:8px">股票币种随市场；非股票可自选</div>
        </el-form-item>
      </template>

      <!-- 当前价值：按单价 或 按总市值（二选一） -->
      <el-form-item label="当前价值方式">
        <el-radio-group v-model="form.valueMode">
          <el-radio-button label="unit">按单价</el-radio-button>
          <el-radio-button label="total">按总市值</el-radio-button>
        </el-radio-group>
        <span class="form-tip" style="margin-left:8px">总市值更好找：直接填账户里现在值多少钱</span>
      </el-form-item>
      <el-form-item v-if="form.valueMode === 'unit'"
        :label="isStock ? `最新价(${ccyName(form.currency)})` : `单位净值(${ccyName(form.currency)})`" required>
        <el-input-number v-model="form.unitValue" :min="0" :precision="6" controls-position="right" style="width:180px" />
        <span class="form-tip" style="margin-left:8px">市值 = 份额 × 单价</span>
      </el-form-item>
      <el-form-item v-else :label="`当前总市值(${ccyName(form.currency)})`" required>
        <el-input-number v-model="form.totalValue" :min="0" :precision="2" controls-position="right" style="width:180px" />
        <div class="form-tip" style="margin-left:8px;line-height:1.6">
          <template v-if="currentQty > 0">
            按当前份额 <b>{{ currentQty }}</b> 折合单价 <b>{{ derivedUnit }}</b>（保存时由系统换算）
          </template>
          <template v-else>
            ⚠️ 尚无份额，无法折合单价：请先填写「期初份额」，或改用「按单价」
          </template>
        </div>
      </el-form-item>

      <!-- 期初建仓（仅创建时可填） -->
      <template v-if="!isEdit">
        <el-divider content-position="left">
          <span class="form-tip">期初建仓（可选）</span>
        </el-divider>
        <div class="form-tip" style="margin:-6px 0 10px 4px;line-height:1.6">
          若这个资产在<b>开始记账前就已持有</b>，在这里填当初的份额与成本，
          系统会据此计算已有盈亏。<b>这笔本金无需再录入金</b>（会自动计入累计投入）。
        </div>
        <el-form-item label="期初份额">
          <el-input-number v-model="form.openingQty" :min="0" :precision="4" controls-position="right" style="width:180px" />
        </el-form-item>
        <template v-if="form.openingQty > 0">
          <el-form-item label="期初成本单价">
            <el-input-number v-model="form.openingCostPrice" :min="0" :precision="6" controls-position="right" style="width:180px" />
            <span class="form-tip" style="margin-left:8px">与下方本金二选一</span>
          </el-form-item>
          <el-form-item label="期初投入本金">
            <el-input-number v-model="form.openingAmount" :min="0" :precision="2" controls-position="right" style="width:180px" />
            <span class="form-tip" style="margin-left:8px">留空则由「份额 × 成本单价」推算</span>
          </el-form-item>
          <el-form-item label="建仓日期">
            <el-date-picker v-model="form.openingDate" type="date" value-format="YYYY-MM-DD"
              placeholder="选择日期" style="width:180px" />
          </el-form-item>
          <el-form-item label=" ">
            <span class="form-tip">期初成本合计：{{ openingCostText }} ｜ 按当前净值市值：{{ openingMvText }}</span>
          </el-form-item>
        </template>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { assetsApi } from '../api';
import { ACCOUNT_KIND_LABEL } from '../utils/format';
import { ccyName } from '../utils/format';
import { usePortfolioStore } from '../stores/portfolio';

const props = defineProps({
  modelValue: Boolean,
  asset: { type: Object, default: null },
  accounts: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue', 'saved']);

const isEdit = computed(() => !!props.asset);
const isStock = computed(() => form.type === 'stock');
const saving = ref(false);
const form = reactive({});

const store = usePortfolioStore();
/** 当前份额：新建时用「期初份额」；编辑时取账本中的实际持仓份额 */
const currentQty = computed(() => {
  if (isEdit.value) {
    const h = store.holdings.find(x => x.asset.id === props.asset.id);
    return +(h?.qty || 0);
  }
  return +form.openingQty || 0;
});
/** 「按总市值」时折合出的单价 */
const derivedUnit = computed(() => {
  const q = currentQty.value;
  if (!(q > 0)) return '—';
  const t = +form.totalValue || 0;
  return t > 0 ? (t / q).toFixed(6) : '—';
});
/** 本次提交的有效单价（按单价 或 由总市值折合） */
const effectiveUnit = computed(() => {
  if (form.valueMode === 'total') {
    const q = currentQty.value, t = +form.totalValue || 0;
    return q > 0 && t > 0 ? t / q : 0;
  }
  return +form.unitValue || 0;
});

const openingQty = computed(() => +form.openingQty || 0);
const openingUnit = computed(() => {
  if (+form.openingCostPrice > 0) return +form.openingCostPrice;
  if (+form.openingAmount > 0 && openingQty.value > 0) return +form.openingAmount / openingQty.value;
  return 0;
});
const openingCostText = computed(() => {
  const c = openingQty.value * openingUnit.value;
  return c > 0 ? c.toFixed(2) : '—';
});
const openingMvText = computed(() => {
  const mv = openingQty.value * effectiveUnit.value;
  return mv > 0 ? mv.toFixed(2) : '—';
});

function reset() {
  if (props.asset) {
    Object.assign(form, {
      name: props.asset.name, code: props.asset.code,
      type: props.asset.type, market: props.asset.market || 'CN', currency: props.asset.currency,
      valueMode: 'unit',
      unitValue: props.asset.type === 'stock' ? props.asset.price : props.asset.unitPrice,
      totalValue: null,
      openingQty: 0, openingCostPrice: null, openingAmount: null, openingDate: '',
    });
  } else {
    const today = new Date().toISOString().slice(0, 10);
    Object.assign(form, {
      name: '', code: '', accountId: props.accounts[0]?.id || '', type: 'stock',
      market: 'CN', currency: 'CNY',
      valueMode: 'unit', unitValue: 0, totalValue: null,
      openingQty: 0, openingCostPrice: null, openingAmount: null, openingDate: today,
    });
  }
}
watch(() => props.modelValue, v => { if (v) reset(); });
watch(() => form.type, t => {
  if (t === 'stock') form.currency = form.market === 'US' ? 'USD' : 'CNY';
  else form.currency = form.currency || 'CNY';
});
watch(() => form.market, m => {
  if (form.type === 'stock') form.currency = m === 'US' ? 'USD' : 'CNY';
});

/** 当前价值校验失败时的提示语 */
function valueHint() {
  if (form.valueMode === 'total') {
    return currentQty.value > 0
      ? '请填写当前总市值'
      : '「按总市值」需先填写期初份额（用于折合单价），或改用「按单价」';
  }
  return isStock.value ? '请填写最新价' : '请填写单位净值（市值 = 份额 × 单位净值）';
}

function buildOpening() {
  if (!(openingQty.value > 0)) return null;
  const o = { qty: openingQty.value };
  if (+form.openingCostPrice > 0) o.costPrice = +form.openingCostPrice;
  if (+form.openingAmount > 0) o.amount = +form.openingAmount;
  if (!o.costPrice && !o.amount) return null;          // 两者都没填则视为未填写
  if (form.openingDate) o.date = form.openingDate;
  return o;
}

async function save() {
  try {
    if (!form.name.trim()) return ElMessage.warning('请填写资产名称');
    saving.value = true;
    if (isEdit.value) {
      const unit = effectiveUnit.value;
      if (!(unit > 0)) return ElMessage.warning(valueHint());
      const payload = { name: form.name, code: form.code };
      if (isStock.value) payload.price = unit; else payload.unitPrice = unit;
      await assetsApi.update(props.asset.id, payload);
      ElMessage.success('已保存');
    } else {
      if (!form.accountId) return ElMessage.warning('请选择所属账户');
      if (form.type === 'stock' && !form.market) return ElMessage.warning('股票请选择市场');
      if (!(effectiveUnit.value > 0)) return ElMessage.warning(valueHint());
      const payload = {
        name: form.name, code: form.code, accountId: form.accountId, type: form.type,
        market: form.market, currency: form.currency,
        price: isStock.value ? effectiveUnit.value : 0,
        unitPrice: isStock.value ? 0 : effectiveUnit.value,
      };
      const opening = buildOpening();
      if (openingQty.value > 0 && !opening) {
        return ElMessage.warning('请填写期初成本单价或期初投入本金');
      }
      if (opening) payload.opening = opening;
      await assetsApi.create(payload);
      ElMessage.success('资产已创建');
    }
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
function onClosed() { /* form 保留无影响 */ }
</script>
