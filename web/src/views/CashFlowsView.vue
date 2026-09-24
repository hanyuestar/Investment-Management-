<template>
  <div>
    <div class="page-head">
      <div>
        <h2>出入金</h2>
        <div class="sub">本金搬运本身不产生盈亏；但计入账户现金与累计投入，并作为 XIRR 的外部现金流</div>
        <div class="sub" style="margin-top:2px">此处只记录<b>外部资金进出账户</b>。用账户里的钱买股票/基金属于<b>账户内部转移</b>，请勿重复登记入金（否则现金与总资产会虚增）。</div>
      </div>
      <div class="actions">
        <el-button type="primary" @click="ops.addCash()">+ 登记出入金</el-button>
      </div>
    </div>

    <div v-for="w in store.warnings" :key="w.code" style="margin:0 0 12px;padding:10px 14px;border-radius:8px;
      background:#fdf6ec;border:1px solid #faecd8;color:#b88230;font-size:13px;line-height:1.75">
      ⚠️ <b>{{ w.title }}</b> —— {{ w.msg }}
    </div>
    <div v-if="cash.cash < -0.01" style="margin:0 0 12px;padding:10px 14px;border-radius:8px;
      background:#fef0f0;border:1px solid #fde2e2;color:#c45656;font-size:13px;line-height:1.7">
      ⚠️ <b>账户现金为 {{ money(cash.cash) }}</b>：登记的入金不足以覆盖买入/申购支出，
      说明有<b>漏记的入金</b>。请补录，否则「总资产」会偏低。
      提示：买入/申购<b>不要</b>再记入金——同一笔钱只在「入金」时算一次外部流入。
    </div>

    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="label">累计入金 (CNY)</div><div class="val num up">¥{{ money(cash.deposit) }}</div></div>
      <div class="kpi"><div class="label">累计出金 (CNY)</div><div class="val num down">¥{{ money(cash.withdraw) }}</div></div>
      <div class="kpi"><div class="label">净入金 (CNY)</div><div class="val num">¥{{ money(cash.net) }}</div>
        <div class="sub num muted">= 累计投入（本金口径）</div></div>
      <div class="kpi"><div class="label">账户现金 (CNY)</div>
        <div class="val num" :class="cash.cash < 0 ? 'down' : ''">¥{{ money(cash.cash) }}</div>
        <div class="sub num muted">入金 − 出金 − 买入 − 申购 + 卖出 + 赎回 + 分红/利息</div></div>
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
        <el-table-column label="录入金额" width="150" align="right">
          <template #default="{ row }">
            {{ money(row.inputAmount) }} {{ row.inputCurrency || accountCcy(row.accountId) }}
          </template>
        </el-table-column>
        <el-table-column label="入账金额(账户币种)" width="160" align="right">
          <template #default="{ row }">
            <span v-if="(row.inputCurrency || accountCcy(row.accountId)) === accountCcy(row.accountId)"
              class="muted">同币种，直接入账</span>
            <b v-else class="num">{{ money(row.amount) }} {{ accountCcy(row.accountId) }}</b>
          </template>
        </el-table-column>
        <el-table-column label="汇率" width="90" align="right">
          <template #default="{ row }">{{ row.fx !== 1 ? Number(row.fx).toFixed(4) : '—' }}</template>
        </el-table-column>
        <el-table-column label="折合 CNY" width="140" align="right">
          <template #default="{ row }"><b class="num">¥{{ money(row.amountCNY != null ? row.amountCNY : row.amount * (row.fx || 1)) }}</b></template>
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
