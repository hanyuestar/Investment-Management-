<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    title="出入金登记" width="460px">
    <el-form label-width="84px">
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
      <el-form-item label="金额(原币)" required>
        <el-input-number v-model="form.amount" :min="0" :precision="2" controls-position="right" style="width:220px" />
      </el-form-item>
      <el-form-item label="锁定汇率" v-if="usdAccount">
        <el-input-number v-model="form.fx" :min="0" :step="0.001" :precision="4" controls-position="right" style="width:200px" />
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
const form = reactive({ accountId: '', kind: 'deposit', date: todayStr(), amount: null, fx: 7.1, note: '' });
const usdAccount = computed(() => props.accounts.find(a => a.id === form.accountId)?.currency === 'USD');

watch(() => props.modelValue, async v => {
  if (!v) return;
  Object.assign(form, { accountId: props.defaultAccountId || props.accounts[0]?.id || '', kind: 'deposit', date: todayStr(), amount: null, fx: 7.1, note: '' });
  try { const c = await fxApi.current(); form.fx = c.rate; } catch { /* ignore */ }
});

async function save() {
  if (!form.accountId) return ElMessage.warning('请选择账户');
  if (!(form.amount > 0)) return ElMessage.warning('金额需大于 0');
  saving.value = true;
  try {
    await cashflowsApi.create({ ...form });
    ElMessage.success('已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>
