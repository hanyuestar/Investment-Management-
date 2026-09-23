<template>
  <div>
    <div class="page-head">
      <div>
        <h2>设置</h2>
        <div class="sub">成本口径、分红处理、基准选择与账号安全；所有口径实时重算，历史数据不被改写</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>核算口径</h3>
        <el-form label-width="120px" :model="form">
          <el-form-item label="成本核算方法">
            <el-radio-group v-model="form.costMethod">
              <el-radio label="wavg">移动加权平均（推荐）</el-radio>
              <el-radio label="fifo">先进先出 FIFO</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="现金分红处理">
            <el-switch v-model="form.dividendReducesCost"
              active-text="冲减持仓成本" inactive-text="计入已实现收益（默认）" />
          </el-form-item>
          <el-form-item label="基准指数代码">
            <el-input v-model="form.benchmarkCode" style="width:180px" placeholder="CSI300" />
            <span class="form-tip" style="margin-left:8px">点位在「绩效」页按月录入</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="save">保存口径设置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="card">
        <h3>修改密码</h3>
        <el-form label-width="100px">
          <el-form-item label="原密码"><el-input v-model="pwd.oldPassword" type="password" show-password /></el-form-item>
          <el-form-item label="新密码"><el-input v-model="pwd.newPassword" type="password" show-password placeholder="至少 8 位" /></el-form-item>
          <el-form-item label="确认新密码"><el-input v-model="pwd.confirm" type="password" show-password /></el-form-item>
          <el-form-item>
            <el-button :loading="changing" @click="changePwd">修改密码</el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>

    <div class="card">
      <h3>口径速查</h3>
      <div class="tbl-wrap is-text">
        <table class="tbl">
          <thead><tr><th style="width:160px">项目</th><th>口径说明</th></tr></thead>
          <tbody>
            <tr><td><b>移动加权平均</b></td><td>每次买入后重算平均成本；卖出已实现 = (卖价 − 平均成本) × 数量 − 费用</td></tr>
            <tr><td><b>FIFO</b></td><td>卖出时按最早批次结转成本，同一笔卖出在两种口径下已实现可能不同，但总盈亏一致</td></tr>
            <tr><td><b>现金分红（默认）</b></td><td>计入已实现收益，持仓成本不变</td></tr>
            <tr><td><b>分红冲减成本</b></td><td>分红不计收益，等额冲减持仓成本；两种处理总盈亏相同</td></tr>
            <tr><td><b>送股</b></td><td>股数增加、成本总额不变、均价摊薄</td></tr>
            <tr><td><b>拆分/合股</b></td><td>按比例调整股数与成本价，成本总额不变</td></tr>
            <tr><td><b>多币种</b></td><td>每笔流水锁定当日汇率用于成本；市值按当前汇率折算；历史成本不随后续汇率变化</td></tr>
            <tr><td><b>出入金</b></td><td>仅记录本金搬运，不参与任何收益计算</td></tr>
            <tr><td><b>XIRR</b></td><td>资金加权年化，考虑每笔投入时点；TWR 为时间加权，剔除出入金影响</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { usePortfolioStore } from '../stores/portfolio';
import { authApi } from '../api';

const store = usePortfolioStore();
const saving = ref(false);
const changing = ref(false);
const form = reactive({ costMethod: 'wavg', dividendReducesCost: false, benchmarkCode: 'CSI300' });
const pwd = reactive({ oldPassword: '', newPassword: '', confirm: '' });

watch(() => store.settings, s => {
  if (!s) return;
  form.costMethod = s.costMethod || 'wavg';
  form.dividendReducesCost = !!s.dividendReducesCost;
  form.benchmarkCode = s.benchmarkCode || 'CSI300';
}, { immediate: true });

async function save() {
  saving.value = true;
  try {
    await authApi.putSettings({ ...form });
    ElMessage.success('设置已保存，全量结果已按新口径重算');
    await store.refreshAll();
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}
async function changePwd() {
  if (pwd.newPassword.length < 8) return ElMessage.warning('新密码至少 8 位');
  if (pwd.newPassword !== pwd.confirm) return ElMessage.warning('两次输入的新密码不一致');
  changing.value = true;
  try {
    await authApi.changePassword(pwd.oldPassword, pwd.newPassword);
    ElMessage.success('密码已修改，下次登录请使用新密码');
    pwd.oldPassword = pwd.newPassword = pwd.confirm = '';
  } catch (e) { ElMessage.error(e.message); } finally { changing.value = false; }
}
</script>
