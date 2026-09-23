'use strict';
/** Express 应用工厂（测试与启动共用） */
const path = require('path');
const fs = require('fs');
const express = require('express');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const assetRoutes = require('./routes/assets');
const eventRoutes = require('./routes/events');
const fxRoutes = require('./routes/fx');
const snapshotRoutes = require('./routes/snapshots');
const benchmarkRoutes = require('./routes/benchmarks');
const cashFlowRoutes = require('./routes/cashflows');
const dcaRoutes = require('./routes/dcaPlans');
const computeRoutes = require('./routes/compute');
const dataRoutes = require('./routes/data');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

function resolveStaticDir() {
  if (process.env.STATIC_DIR && fs.existsSync(process.env.STATIC_DIR)) return process.env.STATIC_DIR;
  const candidates = [
    path.join(__dirname, '..', 'public'),              // Docker：web 构建产物拷到 server/public
    path.join(__dirname, '..', '..', 'web', 'dist'),   // 本地：web/dist
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.set('trust proxy', 1);

  // 健康检查
  app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  // 业务路由
  app.use('/api/auth', authRoutes);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/assets', assetRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/fx', fxRoutes);
  app.use('/api/snapshots', snapshotRoutes);
  app.use('/api/benchmarks', benchmarkRoutes);
  app.use('/api/cashflows', cashFlowRoutes);
  app.use('/api/dca-plans', dcaRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', computeRoutes);   // /api/state /api/compute /api/summary ...
  app.use('/api', dataRoutes);      // /api/export /api/import /api/demo

  // 404（API）
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

  // 静态前端（生产/本地构建后）
  const staticDir = resolveStaticDir();
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api).*/, (req, res, next) => {
      const index = path.join(staticDir, 'index.html');
      if (fs.existsSync(index)) return res.sendFile(index);
      next();
    });
  }

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
  });

  app.locals.staticDir = staticDir;
  return app;
}

module.exports = { createApp };
