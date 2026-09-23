<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    title="手动录入汇率" width="420px">
    <el-form label-width="92px">
      <el-form-item label="日期" required>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
      </el-form-item>
      <el-form-item label="USD→CNY" required>
        <el-input-number v-model="form.rate" :min="0" :step="0.001" :precision="4" controls-position="right" style="width:200px" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" placeholder="如：银行结汇汇率" />
      </el-form-item>
      <div class="form-tip">
        同日存在手动与自动两条时，手动优先；手动汇率只影响此后新记录，历史流水已锁定汇率不变。
      </div>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { fxApi } from '../api';
import { todayStr } from '../utils/format';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const form = reactive({ date: todayStr(), rate: 7.1, note: '' });
watch(() => props.modelValue, v => {
  if (v) Object.assign(form, { date: todayStr(), rate: 7.1, note: '' });
});
async function save() {
  if (!(form.rate > 0)) return ElMessage.warning('汇率需大于 0');
  saving.value = true;
  try {
    await fxApi.addManual({ ...form });
    ElMessage.success('已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>
