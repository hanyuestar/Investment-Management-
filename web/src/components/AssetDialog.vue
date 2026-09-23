<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    :title="isEdit ? '编辑资产' : '新增资产'" width="520px" @closed="onClosed">
    <el-form :model="form" label-width="96px">
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

      <el-form-item label="最新价(原币)" v-else-if="form.type === 'stock'">
        <el-input-number v-model="form.price"
          :min="0" :precision="4" controls-position="right" style="width:200px" />
        <span class="form-tip" style="margin-left:8px">类型/市场/币种/账户创建后不可改</span>
      </el-form-item>
      <el-form-item label="当前市值(原币)" v-else>
        <el-input-number v-model="form.marketValue"
          :min="0" :precision="2" controls-position="right" style="width:200px" />
        <span class="form-tip" style="margin-left:8px">类型/市场/币种/账户创建后不可改</span>
      </el-form-item>

      <el-form-item label="初始值" v-if="!isEdit && form.type === 'stock'">
        <el-input-number v-model="form.price" :min="0" :precision="3" controls-position="right" style="width:200px" />
      </el-form-item>
      <el-form-item label="初始市值" v-if="!isEdit && form.type !== 'stock'">
        <el-input-number v-model="form.marketValue" :min="0" :precision="2" controls-position="right" style="width:200px" />
      </el-form-item>
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
const saving = ref(false);
const form = reactive({});

function reset() {
  if (props.asset) {
    Object.assign(form, {
      name: props.asset.name, code: props.asset.code, price: props.asset.price,
      marketValue: props.asset.marketValue, type: props.asset.type,
    });
  } else {
    Object.assign(form, {
      name: '', code: '', accountId: props.accounts[0]?.id || '', type: 'stock',
      market: 'CN', currency: 'CNY', price: 0, marketValue: 0,
    });
  }
}
watch(() => props.modelValue, v => { if (v) reset(); });
watch(() => form.type, t => {
  if (t === 'stock') form.currency = form.market === 'US' ? 'USD' : 'CNY';
});
watch(() => form.market, m => {
  if (form.type === 'stock') form.currency = m === 'US' ? 'USD' : 'CNY';
});

async function save() {
  try {
    if (!form.name.trim()) return ElMessage.warning('请填写资产名称');
    saving.value = true;
    if (isEdit.value) {
      await assetsApi.update(props.asset.id, {
        name: form.name, code: form.code,
        price: form.type === 'stock' ? form.price : undefined,
        marketValue: form.type === 'stock' ? undefined : form.marketValue,
      });
      ElMessage.success('已保存');
    } else {
      if (!form.accountId) return ElMessage.warning('请选择所属账户');
      if (form.type === 'stock' && !form.market) return ElMessage.warning('股票请选择市场');
      await assetsApi.create({ ...form });
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
