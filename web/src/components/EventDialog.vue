<template>
  <el-dialog :model-value="modelValue" @update:model-value="v => $emit('update:modelValue', v)"
    :title="title" width="500px">
    <el-form :model="form" label-width="92px">
      <el-form-item label="资产">
        <el-input :model-value="assetLabel" disabled />
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
      </el-form-item>

      <!-- 股票 -->
      <template v-if="asset?.type === 'stock'">
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.side">
            <el-radio-button label="buy">买入</el-radio-button>
            <el-radio-button label="sell">卖出</el-radio-button>
            <el-radio-button label="div">分红</el-radio-button>
            <el-radio-button label="bonus">送股</el-radio-button>
            <el-radio-button label="split">拆分</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="form.side === 'buy' || form.side === 'sell'">
          <el-form-item label="数量(股)" required>
            <el-input-number v-model="form.qty" :min="0" :precision="0" controls-position="right" style="width:200px" />
          </el-form-item>
          <el-form-item :label="`成交价(${ccyName(asset?.currency)})`" required>
            <el-input-number v-model="form.price" :min="0" :precision="3" controls-position="right" style="width:200px" />
          </el-form-item>
          <el-form-item label="标记为做T" v-if="form.side === 'buy'">
            <el-switch v-model="form.isT" :active-value="1" :inactive-value="0" />
          </el-form-item>
        </template>
        <el-form-item label="分红金额" required v-else-if="form.side === 'div'">
          <el-input-number v-model="form.amount" :min="0" :precision="2" controls-position="right" style="width:200px" />
        </el-form-item>
        <el-form-item label="送股数量" required v-else-if="form.side === 'bonus'">
          <el-input-number v-model="form.qty" :min="0" :precision="0" controls-position="right" style="width:200px" />
        </el-form-item>
        <el-form-item label="拆分比例" required v-else-if="form.side === 'split'">
          <el-input-number v-model="form.ratio" :min="0" :step="0.1" :precision="3" controls-position="right" style="width:200px" />
          <span class="form-tip" style="margin-left:8px">2=1拆2；0.5=合股</span>
        </el-form-item>
        <el-form-item :label="`手续费(${ccyName(asset?.currency)})`">
          <el-input-number v-model="form.fee" :min="0" :precision="2" controls-position="right" style="width:200px" />
        </el-form-item>
      </template>

      <!-- 基金/理财/债券 -->
      <template v-else>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.kind">
            <el-radio-button label="invest">申购/投入</el-radio-button>
            <el-radio-button label="redeem">赎回</el-radio-button>
            <el-radio-button label="income">收益(利息/分红)</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="form.kind === 'invest' || form.kind === 'redeem'">
          <el-form-item label="份额" required>
            <el-input-number v-model="form.qty" :min="0" :precision="4" controls-position="right" style="width:200px" />
            <span class="form-tip" style="margin-left:8px">当前净值 {{ asset.unitPrice || '—' }}</span>
          </el-form-item>
          <el-form-item label="单位净值" required>
            <el-input-number v-model="form.price" :min="0" :precision="6" controls-position="right" style="width:200px" />
            <span class="form-tip" style="margin-left:8px">{{ ccyName(asset?.currency) }}/份，申购赎回按当时净值</span>
          </el-form-item>
          <el-form-item label="金额合计">
            <span class="form-tip">{{ computedAmount }}（= 份额 × 单位净值，由系统计算）</span>
          </el-form-item>
        </template>
        <el-form-item v-else :label="`金额(${ccyName(asset?.currency)})`" required>
          <el-input-number v-model="form.amount" :min="0" :precision="2" controls-position="right" style="width:240px" />
        </el-form-item>
      </template>

      <el-form-item label="锁定汇率" v-if="asset?.currency === 'USD'">
        <el-input-number v-model="form.fx" :min="0" :step="0.001" :precision="4" controls-position="right" style="width:200px" />
        <span class="form-tip" style="margin-left:8px">1 USD = ? CNY，默认当日生效汇率</span>
      </el-form-item>
      <el-form-item label=" " v-if="isBuyLike">
        <span class="form-tip" style="line-height:1.6">
          💡 若这笔钱是从账户外部转入的，请先在「出入金」页登记<b>入金</b>；
          此处只记录账户内部「资金→持仓」的转换，避免同一笔钱被重复计入投入。
        </span>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.note" placeholder="如：建仓 / 补仓 / T出" />
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
import { eventsApi, fxApi } from '../api';
import { todayStr, TYPE_LABEL, MARKET_LABEL } from '../utils/format';
import { ccyName } from '../utils/format';

const props = defineProps({
  modelValue: Boolean,
  asset: { type: Object, required: true },
  event: { type: Object, default: null }, // 编辑时传入
});
const emit = defineEmits(['update:modelValue', 'saved']);
const saving = ref(false);
const form = reactive({});

const assetLabel = computed(() =>
  `${props.asset.name}（${TYPE_LABEL[props.asset.type]}${props.asset.market ? '·' + MARKET_LABEL[props.asset.market] : ''}·${props.asset.currency}）`);
const title = computed(() => `${props.event ? '编辑' : '新增'}流水 · ${props.asset.name}`);
/** 买入/申购：提示入金登记，避免重复计入投入 */
const isBuyLike = computed(() =>
  props.asset?.type === 'stock' ? form.side === 'buy'
    : (form.kind === 'invest'));
const isFlowShare = computed(() =>
  props.asset?.type !== 'stock' && (form.kind === 'invest' || form.kind === 'redeem'));
const computedAmount = computed(() => {
  const v = (+form.qty || 0) * (+form.price || 0);
  return v > 0 ? v.toFixed(2) : '—';
});

async function reset() {
  if (props.event) {
    Object.assign(form, {
      date: props.event.date, side: props.event.side, kind: props.event.kind,
      qty: props.event.qty, price: props.event.price, amount: props.event.amount,
      ratio: props.event.ratio, fee: props.event.fee || 0, fx: props.event.fx || 1,
      isT: props.event.isT || 0, note: props.event.note || '',
    });
  } else {
    Object.assign(form, {
      date: todayStr(), side: 'buy', kind: 'invest',
      qty: null, price: null, amount: null, ratio: null,
      fee: 0, fx: 7.1, isT: 0, note: '',
    });
    if (props.asset.currency === 'USD') {
      try { const c = await fxApi.current(); form.fx = c.rate; } catch { /* 保留默认 */ }
    }
  }
}
watch(() => props.modelValue, v => { if (v) reset(); }, { immediate: true });

async function save() {
  const payload = { assetId: props.asset.id, ...form };
  if (!payload.date) return ElMessage.warning('请选择日期');
  /* v5：非股票申购/赎回必须填份额与单位净值（金额由后端按 份额×净值 计算） */
  if (isFlowShare.value) {
    if (!(+payload.qty > 0)) return ElMessage.warning('请填写份额（申购/赎回必须填写份额）');
    if (!(+payload.price > 0)) return ElMessage.warning('请填写单位净值');
    payload.amount = undefined;
  }
  saving.value = true;
  try {
    if (props.event) await eventsApi.update(props.event.id, payload);
    else await eventsApi.create(payload);
    ElMessage.success('已保存');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>
