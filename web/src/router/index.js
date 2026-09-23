import { createRouter, createWebHistory } from 'vue-router';
import { getToken } from '../api';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../layout/MainLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '总览' } },
      { path: 'holdings', name: 'holdings', component: () => import('../views/HoldingsView.vue'), meta: { title: '持仓' } },
      { path: 'accounts', name: 'accounts', component: () => import('../views/AccountsView.vue'), meta: { title: '账户' } },
      { path: 'transactions', name: 'transactions', component: () => import('../views/TransactionsView.vue'), meta: { title: '交易流水' } },
      { path: 'performance', name: 'performance', component: () => import('../views/PerformanceView.vue'), meta: { title: '绩效' } },
      { path: 'allocation', name: 'allocation', component: () => import('../views/AllocationView.vue'), meta: { title: '配置' } },
      { path: 'risk', name: 'risk', component: () => import('../views/RiskView.vue'), meta: { title: '风险' } },
      { path: 'tax', name: 'tax', component: () => import('../views/TaxView.vue'), meta: { title: '税务' } },
      { path: 'dca', name: 'dca', component: () => import('../views/DcaView.vue'), meta: { title: '定投' } },
      { path: 'cashflows', name: 'cashflows', component: () => import('../views/CashFlowsView.vue'), meta: { title: '出入金' } },
      { path: 'reports', name: 'reports', component: () => import('../views/ReportsView.vue'), meta: { title: '收益报表' } },
      { path: 'fx', name: 'fx', component: () => import('../views/FxView.vue'), meta: { title: '汇率' } },
      { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { title: '设置' } },
      { path: 'data', name: 'data', component: () => import('../views/DataView.vue'), meta: { title: '数据' } },
      { path: 'admin', name: 'admin', component: () => import('../views/AdminView.vue'), meta: { title: '管理后台', admin: true } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.public && getToken() && (to.name === 'login' || to.name === 'register')) {
    return { path: '/dashboard' };
  }
  return true;
});

export default router;
