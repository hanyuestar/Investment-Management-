<template>
  <div>
    <div class="page-head">
      <div>
        <h2>持仓</h2>
        <div class="sub">按类型/关键词筛选；顶部账户选择器可切换账户视角</div>
      </div>
      <div class="actions">
        <el-button :loading="syncing" @click="syncQuotes">同步行情</el-button>
        <el-button type="primary" @click="ops.createAsset()">新增资产</el-button>
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <el-radio-group v-model="typeFilter" size="small">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="stock">股票</el-radio-button>
          <el-radio-button label="fund">基金</el-radio-button>
          <el-radio-button label="wealth">理财</el-radio-button>
          <el-radio-button label="bond">债券</el-radio-button>
        </el-radio-group>
        <el-input v-model="kw" size="small" placeholder="搜索名称/代码" clearable style="width:220px"
          :prefix-icon="Search" />
        <span class="spacer"></span>
        <span class="muted">共 {{ filtered.length }} 只</span>
      </div>
      <div v-if="filtered.length" class="board">
        <AssetCard v-for="h in filtered" :key="h.asset.id" :h="h"
          :account-name="store.accountName(h.asset.accountId)"
          @event="(p) => ops.addEvent(p)" @edit="(p) => ops.editAsset(p)"
          @alert="(p) => ops.setAlert(p)" @remove="removeAsset" />
      </div>
      <div v-else class="empty"><div class="big">🔍</div>没有符合条件的持仓</div>
    </div>

    <OpsDialogs ref="ops" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import { usePortfolioStore } from '../stores/portfolio';
import { assetsApi, quotesApi } from '../api';
import AssetCard from '../components/AssetCard.vue';
import OpsDialogs from '../components/OpsDialogs.vue';
import { useRemoveConfirm } from '../composables/useRemoveConfirm';

const store = usePortfolioStore();
const ops = ref(null);
const typeFilter = ref('');
const kw = ref('');
const syncing = ref(false);

/** 手动同步行情：按资产代码拉取最新单价（含手动维护的价格，force）；代码错误逐个提示 */
async function syncQuotes() {
  syncing.value = true;
  try {
    const r = await quotesApi.sync();
    const parts = [];
    if (r.updated.length) parts.push(`已更新 ${r.updated.length} 个标的`);
    if (r.unchanged) parts.push(`${r.unchanged} 个无变化`);
    const base = parts.length ? parts.join('，') : '没有可同步的标的（请先在资产里填写代码）';
    const errs = r.errors || [];
    if (!errs.length) {
      ElMessage({ message: base + (r.updated.length ? '，盈亏已按新价重算' : ''), type: 'success' });
    } else {
      const detail = errs.slice(0, 2).map(e => `「${e.name}」(${e.code})`).join('、')
        + (errs.length > 2 ? ` 等 ${errs.length} 个` : '');
      ElMessage({ message: `${base}；${detail} 未能获取报价，请核对代码`, type: 'warning', duration: 6000 });
    }
    if (r.updated.length) await store.refreshAll();
  } catch (e) { ElMessage.error(e.message); } finally { syncing.value = false; }
}

const filtered = computed(() => store.holdings.filter(h => {
  if (typeFilter.value && h.asset.type !== typeFilter.value) return false;
  if (kw.value.trim()) {
    const k = kw.value.trim().toLowerCase();
    if (!h.asset.name.toLowerCase().includes(k) && !(h.asset.code || '').toLowerCase().includes(k)) return false;
  }
  return true;
}));

const confirmRemove = useRemoveConfirm();
async function removeAsset(asset) {
  /* 删除确认统一走 useRemoveConfirm（确认弹窗 → 接口 → 提示 → 刷新） */
  await confirmRemove({
    text: `确定删除资产「${asset.name}」？其全部流水将一并删除。`,
    request: () => assetsApi.remove(asset.id),
  });
}
</script>
