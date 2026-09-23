<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    :title="`价格预警 · ${asset?.name || ''}`" width="460px">
    <el-form label-width="120px">
      <el-form-item :label="`止盈价(${ccyName(asset?.currency)})`">
        <el-input-number v-model="form.takeProfitPrice" :min="0" :precision="3"
          controls-position="right" style="width:200px" placeholder="现价超过触发" />
      </el-form-item>
      <el-form-item :label="`止损价(${ccyName(asset?.currency)})`">
        <el-input-number v-model="form.stopLossPrice" :min="0" :precision="3"
          controls-position="right" style="width:200px" placeholder="现价跌破触发" />
      </el-form-item>
      <el-form-item label="止盈涨幅(%)">
        <el-input-number v-model="tpRate" :min="0" :precision="1" controls-position="right"
          style="width:200px" placeholder="相对成本价" />
      </el-form-item>
      <el-form-item label="止损跌幅(%)">
        <el-input-number v-model="slRate" :min="0" :precision="1" controls-position="right"
          style="width:200px" placeholder="相对成本价" />
      </el-form-item>
      <div class="form-tip" style="padding-left:120px">
        价格与涨幅二选一即可；涨幅相对持仓成本价计算。留空表示不设置。
      </div>
    </el-form>
    <template #footer>
      <el-button @click="clear">清除预警</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { assetsApi } from '../api';
import { ccyName } from '../utils/format';

const props = defineProps({
  modelValue: Boolean,
  asset: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const form = reactive({ takeProfitPrice: null, stopLossPrice: null });
const tpRate = ref(null);
const slRate = ref(null);

watch(() => props.modelValue, v => {
  if (!v || !props.asset) return;
  const a = props.asset.alerts || {};
  form.takeProfitPrice = a.takeProfitPrice ?? null;
  form.stopLossPrice = a.stopLossPrice ?? null;
  tpRate.value = a.takeProfitRate != null ? a.takeProfitRate * 100 : null;
  slRate.value = a.stopLossRate != null ? a.stopLossRate * 100 : null;
}, { immediate: true });

async function save() {
  const alerts = { ...form };
  if (tpRate.value != null) alerts.takeProfitRate = tpRate.value / 100;
  if (slRate.value != null) alerts.stopLossRate = slRate.value / 100;
  saving.value = true;
  try {
    await assetsApi.setAlerts(props.asset.id, alerts);
    ElMessage.success('预警已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
async function clear() {
  saving.value = true;
  try {
    await assetsApi.setAlerts(props.asset.id, null);
    ElMessage.success('已清除预警');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>
