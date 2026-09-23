<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    title="出入金登记" width="500px">
    <el-form label-width="92px">
      <el-form-item label="账户" required>
        <el-select v-model="form.accountId" style="width:100%" placeholder="选择账户">
          <el-option v-for="a in accounts" :key="a.id" :label="`${a.name}（${a.currency}）`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-radio-group v-model="form.kind">
          <el-radio-button label="deposit">入金</el-radio-button>
          <el-radio-button label="withdraw">出金</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
      </el-form-item>

      <el-form-item label="录入币种" required>
        <el-radio-group v-model="form.inputCurrency">
          <el-radio-button label="CNY">人民币 CNY</el-radio-button>
          <el-radio-button label="USD">美元 USD</el-radio-button>
        </el-radio-group>
        <div class="form-tip" style="margin-left:8px">
          {{ sameCurrency ? '与账户币种一致，无需换算' : `将按汇率换算为账户币种（${acctCur}）` }}
        </div>
      </el-form-item>

      <el-form-item :label="`金额(${form.inputCurrency})`" required>
        <el-input-number v-model="form.amount" :min="0" :precision="2" controls-position="right" style="width:220px" />
      </el-form-item>

      <el-form-item label="汇率" v-if="showFx">
        <el-input-number v-model="form.fx" :min="0" :step="0.001" :precision="4" controls-position="right" style="width:200px" />
        <span class="form-tip" style="margin-left:8px">1 USD = ? CNY</span>
      </el-form-item>

      <el-form-item label=" " v-if="form.amount > 0">
        <div class="cf-convert">
          <template v-if="sameCurrency">
            账户币种一致，直接入账：<b class="num">{{ form.amount.toFixed(2) }} {{ acctCur }}</b>
          </template>
          <template v-else>
            折合账户金额：<b class="num">{{ converted.toFixed(2) }} {{ acctCur }}</b>
            <span class="muted">（= {{ form.amount.toFixed(2) }} {{ form.inputCurrency }}
              {{ form.inputCurrency === 'CNY' ? '÷' : '×' }} {{ Number(form.fx || 0).toFixed(4) }}）</span>
          </template>
          <div class="muted" style="margin-top:2px">折合人民币：<b class="num">¥{{ amountCNY.toFixed(2) }}</b></div>
        </div>
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="form.note" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { cashflowsApi, fxApi } from '../api';
import { todayStr } from '../utils/format';

const props = defineProps({
  modelValue: Boolean,
  accounts: { type: Array, default: () => [] },
  defaultAccountId: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const form = reactive({ accountId: '', kind: 'deposit', date: todayStr(), inputCurrency: 'CNY', amount: null, fx: 7.1, note: '' });

const acctCur = computed(() => props.accounts.find(a => a.id === form.accountId)?.currency || 'CNY');
const sameCurrency = computed(() => form.inputCurrency === acctCur.value);
/** 需要换算（或账户为美元需展示汇率）时显示汇率输入 */
const showFx = computed(() => !sameCurrency.value || acctCur.value === 'USD');

const rate = computed(() => {
  const r = Number(form.fx) || 0;
  return r > 0 ? r : 7.1;
});
/** 换算为账户币种金额 */
const converted = computed(() => {
  const a = Number(form.amount) || 0;
  if (sameCurrency.value) return a;
  if (form.inputCurrency === 'CNY') return a / rate.value;   // 账户 USD，录 CNY
  return a * rate.value;                                     // 账户 CNY，录 USD
});
/** 折合人民币 */
const amountCNY = computed(() => {
  const a = Number(form.amount) || 0;
  if (form.inputCurrency === 'CNY') return a;
  return a * rate.value;
});

watch(() => props.modelValue, async v => {
  if (!v) return;
  const acc = props.defaultAccountId || props.accounts[0]?.id || '';
  Object.assign(form, {
    accountId: acc, kind: 'deposit', date: todayStr(),
    inputCurrency: props.accounts.find(a => a.id === acc)?.currency || 'CNY',
    amount: null, fx: 7.1, note: '',
  });
  try { const c = await fxApi.current(); form.fx = c.rate; } catch { /* ignore */ }
});
/* 切换账户时，录入币种跟随账户币种（用户仍可手动改） */
watch(() => form.accountId, id => {
  const cur = props.accounts.find(a => a.id === id)?.currency;
  if (cur) form.inputCurrency = cur;
});

async function save() {
  if (!form.accountId) return ElMessage.warning('请选择账户');
  if (!(form.amount > 0)) return ElMessage.warning('金额需大于 0');
  if (!sameCurrency.value && !(Number(form.fx) > 0)) return ElMessage.warning('跨币种录入请填写有效汇率');
  saving.value = true;
  try {
    await cashflowsApi.create({
      accountId: form.accountId, kind: form.kind, date: form.date,
      inputCurrency: form.inputCurrency, amount: form.amount,
      fx: form.fx, note: form.note,
    });
    ElMessage.success('已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>

<style scoped>
.cf-convert {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2, #606266);
  background: var(--bg-soft, #f7f8fa);
  border-radius: 6px;
  padding: 6px 10px;
}
.cf-convert .muted { color: var(--muted, #909399); font-size: 12px; }
</style>
