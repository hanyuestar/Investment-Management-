<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    title="定投计划" width="480px">
    <el-form label-width="92px">
      <el-form-item label="定投标的" required>
        <el-select v-model="form.assetId" style="width:100%" placeholder="基金/理财/债券（股票不支持定投）">
          <el-option v-for="a in flowAssets" :key="a.id"
            :label="`${a.name}（${TYPE_LABEL[a.type]}·${a.currency}）`" :value="a.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="起始月份" required>
        <el-date-picker v-model="form.startMonth" type="month" value-format="YYYY-MM" style="width:100%" />
      </el-form-item>
      <el-form-item label="期数(月)" required>
        <el-input-number v-model="form.months" :min="1" :max="360" controls-position="right" style="width:160px" />
      </el-form-item>
      <el-form-item label="扣款日" required>
        <el-input-number v-model="form.day" :min="1" :max="28" controls-position="right" style="width:160px" />
        <span class="form-tip" style="margin-left:8px">每月几号（1-28）</span>
      </el-form-item>
      <el-form-item label="每期金额" required>
        <el-input-number v-model="form.amount" :min="0" :precision="2" controls-position="right" style="width:200px" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" placeholder="如：标普500月定投" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存计划</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { dcaApi } from '../api';
import { currentMonth, TYPE_LABEL } from '../utils/format';

const props = defineProps({
  modelValue: Boolean,
  assets: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const flowAssets = computed(() => props.assets.filter(a => a.type !== 'stock'));
const form = reactive({ assetId: '', startMonth: currentMonth(), months: 12, day: 15, amount: null, note: '定投' });

watch(() => props.modelValue, v => {
  if (v) Object.assign(form, { assetId: flowAssets.value[0]?.id || '', startMonth: currentMonth(), months: 12, day: 15, amount: null, note: '定投' });
});

async function save() {
  if (!form.assetId) return ElMessage.warning('请选择定投标的');
  if (!(form.amount > 0)) return ElMessage.warning('请填写每期金额');
  saving.value = true;
  try {
    await dcaApi.create({ ...form });
    ElMessage.success('定投计划已创建，可在列表中一键生成投入记录');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
</script>
