<template>
  <div>
    <div class="page-head">
      <div>
        <h2>USD / CNY 汇率</h2>
        <div class="sub">手动录入优先、自动同步兜底；每笔流水按发生日汇率锁定，历史记录不随后续汇率变化</div>
      </div>
      <div class="actions" v-if="auth.isAdmin">
        <el-button @click="sync" :loading="syncing">立即同步</el-button>
        <el-button type="primary" @click="ops.addFx()">手动录入</el-button>
      </div>
    </div>

    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="label">当前生效汇率</div>
        <div class="val num">{{ Number(current.rate || 7.1).toFixed(4) }}</div>
        <div class="sub">1 USD = ? CNY</div></div>
      <div class="kpi"><div class="label">生效日期 / 来源</div>
        <div class="val num" style="font-size:16px;padding-top:5px">
          {{ current.date || '内置默认 7.1' }}
          <span :class="'badge ' + sourceBadge(current.source)" style="margin-left:8px">{{ sourceLabel(current.source) }}</span>
        </div></div>
      <div class="kpi"><div class="label">记录条数</div>
        <div class="val num">{{ fxList.length }}</div>
        <div class="sub">手动 + 自动时间线</div></div>
    </div>

    <div class="card">
      <h3>汇率时间线
        <span class="hint" v-if="!auth.isAdmin">（只读，录入与同步请联系管理员）</span>
      </h3>
      <el-table :data="fxList" size="small" empty-text="暂无汇率记录，系统使用内置默认 7.1">
        <el-table-column prop="date" label="日期" width="130" />
        <el-table-column label="USD → CNY" width="140" align="right">
          <template #default="{ row }"><b class="num">{{ Number(row.rate).toFixed(4) }}</b></template>
        </el-table-column>
        <el-table-column label="来源" width="120">
          <template #default="{ row }">
            <span :class="'badge ' + sourceBadge(row.source)">{{ sourceLabel(row.source) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
        <el-table-column v-if="auth.isAdmin" label="操作" width="90" align="right">
          <template #default="{ row }">
            <el-button v-if="row.source === 'manual'" link type="danger" size="small" @click="remove(row)">删除</el-button>
            <span v-else class="muted">自动记录</span>
          </template>
        </el-table-column>
      </el-table>
      <p class="form-tip" style="margin-top:10px">
        自动源：Frankfurter（欧洲央行数据），失败自动降级 open.er-api.com；每日 08:00 同步。同日手动与自动并存时手动优先。
      </p>
    </div>

    <OpsDialogs ref="ops" @changed="loadFx" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { usePortfolioStore } from '../stores/portfolio';
import { fxApi } from '../api';
import { FX_SOURCE_LABEL } from '../utils/format';
import OpsDialogs from '../components/OpsDialogs.vue';

const auth = useAuthStore();
const store = usePortfolioStore();
const ops = ref(null);
const syncing = ref(false);
const fxList = ref([]);

async function loadFx() {
  try { fxList.value = await fxApi.list(); } catch { fxList.value = []; }
}
onMounted(loadFx);

const current = computed(() => {
  const list = [...fxList.value].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1
    : (a.source === 'manual' ? 1 : 0) - (b.source === 'manual' ? 1 : 0)));
  const today = new Date().toISOString().slice(0, 10);
  return list.find(f => f.date <= today) || { rate: 7.1, source: 'fallback', date: '' };
});

function sourceLabel(s) { return FX_SOURCE_LABEL[s] || s; }
function sourceBadge(s) { return { manual: 'badge-manual', auto: 'badge-auto', fallback: 'badge-fallback' }[s] || 'badge-gray'; }

async function sync() {
  syncing.value = true;
  try {
    const r = await fxApi.sync();
    ElMessage.success(`同步成功：1 USD = ${r.rate} CNY${r.usedFallback ? '（备用源）' : ''}`);
    await loadFx();
    await store.refreshAll(false);
  } catch (e) { ElMessage.error(e.message); } finally { syncing.value = false; }
}
async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除 ${row.date} 的手动汇率？`, '删除确认', { type: 'warning' });
  } catch { return; }
  await fxApi.remove(row.id);
  ElMessage.success('已删除');
  await loadFx();
  await store.refreshAll(false);
}
</script>
