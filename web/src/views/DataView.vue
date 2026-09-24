<template>
  <div>
    <div class="page-head">
      <div>
        <h2>数据管理</h2>
        <div class="sub">月末快照、备份导出、导入恢复与示例数据</div>
      </div>
    </div>

    <div class="grid-sidebar">
      <div class="card">
        <h3>月末快照（TWR / 基准曲线 / 含浮动收益的输入）</h3>
        <div class="sub">填<b>月末持仓市值</b>（不含账户现金）：月度浮动收益 = 快照差 − 当月证券净投入（买卖/申赎）</div>
        <div class="toolbar">
          <el-date-picker v-model="snap.month" type="month" value-format="YYYY-MM" placeholder="月份" size="small" style="width:130px" />
          <el-input-number v-model="snap.total" :min="0" :precision="2" size="small" controls-position="right" style="width:180px" placeholder="月末持仓市值" />
          <el-button size="small" @click="fillCurrent">填入当前持仓市值</el-button>
          <el-button size="small" type="primary" @click="saveSnap">保存快照</el-button>
        </div>
        <el-table :data="store.snapshots" size="small" max-height="340" empty-text="暂无快照">
          <el-table-column prop="month" label="月份" width="120" />
          <el-table-column label="月末持仓市值 (CNY)" align="right">
            <template #default="{ row }">¥{{ money(row.total) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="delSnap(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="card">
        <h3>基准点位（{{ benchCode }}，TWR 对比曲线的输入）</h3>
        <div class="toolbar">
          <el-date-picker v-model="bench.date" type="month" value-format="YYYY-MM" placeholder="月份" size="small" style="width:130px" />
          <el-input-number v-model="bench.value" :min="0" :precision="2" size="small" controls-position="right" style="width:180px" placeholder="月末收盘点位" />
          <el-button size="small" type="primary" @click="saveBench">保存点位</el-button>
        </div>
        <el-table :data="benchList" size="small" max-height="240" empty-text="暂无基准点位">
          <el-table-column prop="date" label="月份" width="120" />
          <el-table-column label="点位" align="right">
            <template #default="{ row }">{{ money(row.value) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="delBench(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div>
        <div class="card">
          <h3>备份与恢复</h3>
          <p class="form-tip">导出为单个 JSON（账户/资产/流水/快照/基准/出入金/定投/设置），可跨设备迁移。导入会<strong>整体替换</strong>当前数据，导入前系统自动备份到服务器 <code>data/backups/</code>。</p>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
            <el-button type="primary" @click="doExport">导出全部数据 (JSON)</el-button>
            <el-upload :show-file-list="false" accept=".json,application/json" :before-upload="beforeImport" :http-request="doImport">
              <el-button style="width:100%">导入备份文件（覆盖当前数据）</el-button>
            </el-upload>
          </div>
        </div>
        <div class="card">
          <h3>示例数据</h3>
          <p class="form-tip">一键载入与设计原型一致的演示数据（3 个账户、5 只标的、13 笔流水、8 期快照与基准），会覆盖当前数据并自动备份。</p>
          <el-button style="width:100%" @click="loadDemo">载入示例数据</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { snapshotsApi, benchmarksApi, dataApi, getToken } from '../api';
import { money, currentMonth } from '../utils/format';

const store = usePortfolioStore();
const snap = reactive({ month: currentMonth(), total: null });

/* 基准点位（带 id，独立加载以便删除） */
const benchCode = computed(() => store.settings?.benchmarkCode || 'CSI300');
const benchList = ref([]);
const bench = reactive({ date: currentMonth(), value: null });
async function loadBench() {
  try { benchList.value = await benchmarksApi.list(benchCode.value); } catch { benchList.value = []; }
}
onMounted(loadBench);
async function saveBench() {
  if (!bench.date || !(bench.value > 0)) return ElMessage.warning('请选择月份并填写点位');
  await benchmarksApi.save({ code: benchCode.value, date: bench.date, value: bench.value });
  ElMessage.success('基准点位已保存');
  bench.value = null;
  await loadBench();
  await store.refreshAll();
}
async function delBench(row) {
  try { await ElMessageBox.confirm(`删除 ${row.date} 基准点位？`, '确认', { type: 'warning' }); } catch { return; }
  await benchmarksApi.remove(row.id);
  ElMessage.success('已删除');
  await loadBench();
  await store.refreshAll();
}

function fillCurrent() {
  snap.total = Math.round((store.kpis.mv || 0) * 100) / 100;
}
async function saveSnap() {
  if (!snap.month || !(snap.total >= 0)) return ElMessage.warning('请选择月份并填写月末持仓市值');
  await snapshotsApi.save({ ...snap });
  ElMessage.success('快照已保存');
  snap.total = null;
  await store.refreshAll();
}
async function delSnap(row) {
  try { await ElMessageBox.confirm(`删除 ${row.month} 快照？`, '确认', { type: 'warning' }); } catch { return; }
  await snapshotsApi.remove(row.month);
  ElMessage.success('已删除');
  await store.refreshAll();
}

async function doExport() {
  const res = await fetch(dataApi.exportUrl, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return ElMessage.error('导出失败');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invest-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success('已导出');
}

function beforeImport(file) {
  const isJson = file.name.endsWith('.json') || file.type === 'application/json';
  if (!isJson) ElMessage.error('请选择 JSON 备份文件');
  return isJson;
}
async function doImport(opt) {
  try {
    await ElMessageBox.confirm('导入将整体替换当前全部业务数据（已自动备份），确定继续？', '导入确认', {
      type: 'warning', confirmButtonText: '导入', cancelButtonText: '取消',
    });
  } catch { opt.onError(new Error('cancel')); return; }
  try {
    const text = await opt.file.text();
    const payload = JSON.parse(text);
    const r = await dataApi.import(payload);
    ElMessage.success(`导入完成：账户 ${r.counts.accounts}、资产 ${r.counts.assets}、流水 ${r.counts.events}；自动备份 ${r.backupFile}`);
    await store.refreshAll();
    await loadBench();
    opt.onSuccess(r);
  } catch (e) {
    ElMessage.error('导入失败：' + e.message);
    opt.onError(e);
  }
}

async function loadDemo() {
  try {
    await ElMessageBox.confirm('将覆盖当前业务数据并自动备份，确定载入示例数据？', '确认', { type: 'warning' });
  } catch { return; }
  const r = await dataApi.loadDemo();
  ElMessage.success(`示例数据已载入（自动备份 ${r.backupFile}）`);
  await store.refreshAll();
}
</script>
