import { defineStore } from 'pinia';
import { authApi, setToken, getToken } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    user: null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user?.role === 'admin',
    username: (s) => s.user?.username || '',
  },
  actions: {
    setSession(token, user) {
      this.token = token;
      this.user = user;
      setToken(token);
    },
    async login(payload) {
      const r = await authApi.login(payload);
      this.setSession(r.token, r.user);
      return r.user;
    },
    async register(payload) {
      const r = await authApi.register(payload);
      this.setSession(r.token, r.user);
      return r.user;
    },
    async fetchMe() {
      if (!this.token) return null;
      const r = await authApi.me();
      this.user = r.user;
      return r.user;
    },
    async logout() {
      try { await authApi.logout(); } catch { /* ignore */ }
      this.setSession('', null);
    },
  },
});
