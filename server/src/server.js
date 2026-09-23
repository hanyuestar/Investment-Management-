'use strict';
/** 服务启动入口：初始化数据库 → 启动 HTTP → 启动定时任务 */
const { init } = require('./db');
const { config } = require('./config');
const { createApp } = require('./app');
const { startScheduler } = require('./services/scheduler');

init();
const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log('==============================================');
  console.log(` 投资管家已启动: http://localhost:${config.PORT}`);
  console.log(` 环境: ${config.NODE_ENV} | 数据库: ${config.DB_PATH}`);
  console.log(` 前端静态目录: ${app.locals.staticDir || '未构建（开发模式请用 web 的 vite dev）'}`);
  console.log('==============================================');
});

if (config.CRON_ENABLED) startScheduler();

function shutdown(sig) {
  console.log(`\n${sig} 收到，正在关闭...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
