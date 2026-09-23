<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="title">注册账号</div>
      <div class="subtitle">数据按用户隔离，默认注册为普通用户</div>
      <el-form>
        <el-form-item>
          <el-input v-model="form.username" size="large" placeholder="用户名（3-30 位，中英文/数字/下划线）" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.email" size="large" placeholder="邮箱（用于验证码登录）" :prefix-icon="Message" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" size="large" placeholder="密码（至少 8 位）" show-password :prefix-icon="Lock" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.confirm" type="password" size="large" placeholder="确认密码" show-password :prefix-icon="Lock" />
        </el-form-item>
        <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="submit">注 册</el-button>
      </el-form>
      <div style="text-align:center;margin-top:16px" class="muted">
        已有账号？<router-link to="/login">返回登录</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock, Message } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const form = reactive({ username: '', email: '', password: '', confirm: '' });

async function submit() {
  if (!form.username.trim()) return ElMessage.warning('请输入用户名');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return ElMessage.warning('邮箱格式不正确');
  if (form.password.length < 8) return ElMessage.warning('密码至少 8 位');
  if (form.password !== form.confirm) return ElMessage.warning('两次密码不一致');
  loading.value = true;
  try {
    await auth.register({ username: form.username.trim(), email: form.email.trim().toLowerCase(), password: form.password });
    ElMessage.success('注册成功，已自动登录');
    router.replace('/dashboard');
  } catch (e) { ElMessage.error(e.message); } finally { loading.value = false; }
}
</script>
