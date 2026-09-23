<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="title">投资管家</div>
      <div class="subtitle">个人投资资产统一核算 · 成本 / 绩效 / 税务 / 配置</div>
      <el-tabs v-model="tab" stretch>
        <el-tab-pane label="密码登录" name="password">
          <el-form @submit.prevent="loginByPassword">
            <el-form-item>
              <el-input v-model="form.username" size="large" placeholder="用户名" :prefix-icon="User" />
            </el-form-item>
            <el-form-item>
              <el-input v-model="form.password" type="password" size="large" placeholder="密码"
                show-password :prefix-icon="Lock" @keyup.enter="loginByPassword" />
            </el-form-item>
            <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="loginByPassword">登 录</el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="邮箱验证码登录" name="code">
          <el-form>
            <el-form-item>
              <el-input v-model="form.email" size="large" placeholder="注册邮箱" :prefix-icon="Message" />
            </el-form-item>
            <el-form-item>
              <div style="display:flex;gap:8px;width:100%">
                <el-input v-model="form.code" size="large" placeholder="6 位验证码" :prefix-icon="Key" />
                <el-button size="large" :disabled="countdown > 0" @click="sendCode">
                  {{ countdown > 0 ? `${countdown}s` : '发送验证码' }}
                </el-button>
              </div>
            </el-form-item>
            <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="loginByCode">登 录</el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
      <div style="text-align:center;margin-top:16px" class="muted">
        还没有账号？<router-link to="/register">立即注册</router-link>
      </div>
      <div v-if="devHint" class="form-tip" style="margin-top:10px;color:#b5791c">{{ devHint }}</div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock, Message, Key } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../api';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const tab = ref('password');
const loading = ref(false);
const countdown = ref(0);
const devHint = ref('');
let timer = null;
const form = reactive({ username: 'admin', password: '', email: '', code: '' });

async function loginByPassword() {
  if (!form.username || !form.password) return ElMessage.warning('请输入用户名和密码');
  loading.value = true;
  try {
    await auth.login({ username: form.username, password: form.password });
    ElMessage.success('登录成功');
    router.replace(route.query.redirect || '/dashboard');
  } catch (e) { ElMessage.error(e.message); } finally { loading.value = false; }
}
async function sendCode() {
  if (!form.email) return ElMessage.warning('请输入邮箱');
  try {
    const r = await authApi.sendCode(form.email);
    ElMessage.success('验证码已发送');
    if (r.devCode) {
      form.code = r.devCode;
      devHint.value = r.hint || `开发环境验证码：${r.devCode}`;
    }
    countdown.value = 60;
    timer = setInterval(() => { countdown.value--; if (countdown.value <= 0) clearInterval(timer); }, 1000);
  } catch (e) { ElMessage.error(e.message); }
}
async function loginByCode() {
  if (!form.email || !form.code) return ElMessage.warning('请输入邮箱和验证码');
  loading.value = true;
  try {
    await auth.login({ email: form.email, code: form.code });
    ElMessage.success('登录成功');
    router.replace(route.query.redirect || '/dashboard');
  } catch (e) { ElMessage.error(e.message); } finally { loading.value = false; }
}
onBeforeUnmount(() => timer && clearInterval(timer));
</script>
