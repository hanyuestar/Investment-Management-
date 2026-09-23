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

      <!-- 当前价格 / 净值 -->
      <el-form-item v-if="isStock" label="最新价(原币)">
        <el-input-number v-model="form.price" :min="0" :precision="4" controls-position="right" style="width:180px" />
        <span class="form-tip" style="margin-left:8px" v-if="isEdit">类型/市场/币种/账户不可改</span>
      </el-form-item>
      <el-form-item v-else label="单位净值" required>
        <el-input-number v-model="form.unitPrice" :min="0" :precision="6" controls-position="right" style="width:180px" />
        <span class="form-tip" style="margin-left:8px">原币；市值 = 份额 × 单位净值</span>
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
  const nav = isStock.value ? +form.price || 0 : +form.unitPrice || 0;
  const mv = openingQty.value * nav;
  return mv > 0 ? mv.toFixed(2) : '—';
});

function reset() {
  if (props.asset) {
    Object.assign(form, {
      name: props.asset.name, code: props.asset.code, price: props.asset.price,
      unitPrice: props.asset.unitPrice, marketValue: props.asset.marketValue,
      type: props.asset.type, market: props.asset.market || 'CN', currency: props.asset.currency,
      openingQty: 0, openingCostPrice: null, openingAmount: null, openingDate: '',
    });
  } else {
    const today = new Date().toISOString().slice(0, 10);
    Object.assign(form, {
      name: '', code: '', accountId: props.accounts[0]?.id || '', type: 'stock',
      market: 'CN', currency: 'CNY', price: 0, unitPrice: 0, marketValue: 0,
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
      const payload = { name: form.name, code: form.code };
      if (isStock.value) payload.price = +form.price || 0;
      else payload.unitPrice = +form.unitPrice || 0;
      await assetsApi.update(props.asset.id, payload);
      ElMessage.success('已保存');
    } else {
      if (!form.accountId) return ElMessage.warning('请选择所属账户');
      if (form.type === 'stock' && !form.market) return ElMessage.warning('股票请选择市场');
      if (form.type !== 'stock' && !(+form.unitPrice > 0)) {
        return ElMessage.warning('非股票资产请填写单位净值（市值 = 份额 × 单位净值）');
      }
      const payload = {
        name: form.name, code: form.code, accountId: form.accountId, type: form.type,
        market: form.market, currency: form.currency,
        price: isStock.value ? +form.price || 0 : 0,
        unitPrice: isStock.value ? 0 : +form.unitPrice || 0,
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
