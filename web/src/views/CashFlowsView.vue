<template>
  <div>
    <div class="page-head">
      <div>
        <h2>出入金</h2>
        <div class="sub">账户级本金搬运，与收益口径完全分离，不参与任何盈亏计算</div>
      </div>
      <div class="actions">
        <el-button type="primary" @click="ops.addCash()">+ 登记出入金</el-button>
      </div>
    </div>

    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="label">累计入金 (CNY)</div><div class="val num up">¥{{ money(cash.deposit) }}</div></div>
      <div class="kpi"><div class="label">累计出金 (CNY)</div><div class="val num down">¥{{ money(cash.withdraw) }}</div></div>
      <div class="kpi"><div class="label">净入金 (CNY)</div><div class="val num">¥{{ money(cash.net) }}</div></div>
    </div>

    <div class="card">
      <el-table :data="rows" size="small" empty-text="暂无出入金记录">
        <el-table-column prop="date" label="日期" width="110" />
        <el-table-column label="账户" min-width="140">
          <template #default="{ row }">{{ store.accountName(row.accountId) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <span :class="'badge ' + (row.kind === 'deposit' ? 'badge-ok' : 'badge-warn')">
              {{ row.kind === 'deposit' ? '入金' : '出金' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="金额(原币)" width="140" align="right">
          <template #default="{ row }">{{ money(row.amount) }} {{ accountCcy(row.accountId) }}</template>
        </el-table-column>
        <el-table-column label="汇率" width="90" align="right">
          <template #default="{ row }">{{ row.fx !== 1 ? Number(row.fx).toFixed(4) : '—' }}</template>
        </el-table-column>
        <el-table-column label="折合 CNY" width="140" align="right">
          <template #default="{ row }"><b class="num">¥{{ money(row.amount * (row.fx || 1)) }}</b></template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <OpsDialogs ref="ops" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { cashflowsApi } from '../api';
import { money } from '../utils/format';
import OpsDialogs from '../components/OpsDialogs.vue';

const store = usePortfolioStore();
const ops = ref(null);
const cash = computed(() => store.d?.cash || { deposit: 0, withdraw: 0, net: 0 });
const rows = computed(() => store.cashFlows);
function accountCcy(id) { return store.accounts.find(a => a.id === id)?.currency || ''; }

async function remove(row) {
  try {
    await ElMessageBox.confirm('确定删除该出入金记录？', '删除确认', { type: 'warning' });
  } catch { return; }
  await cashflowsApi.remove(row.id);
  ElMessage.success('已删除');
  await store.refreshAll();
}
</script>
