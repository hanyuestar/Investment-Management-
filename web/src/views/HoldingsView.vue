<template>
  <div>
    <div class="page-head">
      <div>
        <h2>持仓</h2>
        <div class="sub">按类型/关键词筛选；顶部账户选择器可切换账户视角</div>
      </div>
      <div class="actions">
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
import { Search } from '@element-plus/icons-vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { assetsApi } from '../api';
import AssetCard from '../components/AssetCard.vue';
import OpsDialogs from '../components/OpsDialogs.vue';

const store = usePortfolioStore();
const ops = ref(null);
const typeFilter = ref('');
const kw = ref('');

const filtered = computed(() => store.holdings.filter(h => {
  if (typeFilter.value && h.asset.type !== typeFilter.value) return false;
  if (kw.value.trim()) {
    const k = kw.value.trim().toLowerCase();
    if (!h.asset.name.toLowerCase().includes(k) && !(h.asset.code || '').toLowerCase().includes(k)) return false;
  }
  return true;
}));

async function removeAsset(asset) {
  try {
    await ElMessageBox.confirm(`确定删除资产「${asset.name}」？其全部流水将一并删除。`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    });
  } catch { return; }
  try {
    await assetsApi.remove(asset.id);
    ElMessage.success('已删除');
    await store.refreshAll();
  } catch (e) { ElMessage.error(e.message); }
}
</script>
