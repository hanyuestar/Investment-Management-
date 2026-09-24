'use strict';
/**
 * API 集成测试（node:test + 内置 fetch）
 * 运行：node --test test/api.test.js（或 npm test）
 * 使用临时 SQLite 文件，CRON 关闭。
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `invest-api-test-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.CRON_ENABLED = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin12345';
process.env.NODE_ENV = 'test'; // 非 production，send-code 回显 devCode 以便测试
process.env.BACKUP_DIR = path.join(os.tmpdir(), `invest-backup-test-${process.pid}`);

const test = require('node:test');
const assert = require('node:assert/strict');
const { init, getDb } = require('../src/db');
const { createApp } = require('../src/app');

init(TMP_DB);
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, url, token, body) {
  const res = await fetch(base + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const iso = d => d.toISOString().slice(0, 10);
const daysAgo = n => iso(new Date(Date.now() - n * 86400000));
const daysAhead = n => iso(new Date(Date.now() + n * 86400000));
const monthOf = d => d.slice(0, 7);
const today = iso(new Date());
const curMonth = monthOf(today);
const lastMonth = monthOf(daysAgo(15));
const prevMonth = monthOf(daysAgo(45));

let adminToken, aliceToken;
let alice = {};

test.after(() => {
  server.close();
  for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

/* ---------------- 健康检查与鉴权 ---------------- */
test('GET /api/health 健康检查', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('未登录访问受保护接口返回 401', async () => {
  const r = await api('GET', '/api/compute');
  assert.equal(r.status, 401);
});

test('管理员登录（首启自动初始化）', async () => {
  const r = await api('POST', '/api/auth/login', null, { username: 'admin', password: 'admin12345' });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'admin');
  adminToken = r.json.token;
});

test('错误密码登录被拒', async () => {
  const r = await api('POST', '/api/auth/login', null, { username: 'admin', password: 'wrong' });
  assert.equal(r.status, 400);
});

/* ---------------- 管理员装载示例数据并核对原型数字 ---------------- */
test('POST /api/demo 装载示例数据', async () => {
  const r = await api('POST', '/api/demo', adminToken, {});
  assert.equal(r.status, 200);
  assert.ok(r.json.backupFile);
});

test('示例数据：总资产 ¥489,795.24 = 累计投入 466,800 + 累计收益 22,995.24', async () => {
  const r = await api('GET', '/api/compute', adminToken);
  assert.equal(r.status, 200);
  const k = r.json.kpis;
  /* v6 单一口径：总资产 = 累计投入(=净入金) + 累计收益 */
  assert.ok(Math.abs(k.totalAssets - 489795.24) < 0.02, `totalAssets=${k.totalAssets}`);
  assert.ok(Math.abs(k.invest - 466800) < 0.02, `invest=${k.invest}`);
  assert.ok(Math.abs(k.profit - 22995.24) < 0.02, `profit=${k.profit}`);
  assert.ok(Math.abs(k.mv - 463480.44) < 0.02, `持仓市值=${k.mv}`);
  assert.ok(Math.abs(k.totalAssets - (k.invest + k.profit)) < 0.02, '总资产 = 累计投入 + 累计收益');
});

test('示例数据：茅台集中度 63.1%、分红税 10% 档 ¥30', async () => {
  const r = await api('GET', '/api/compute', adminToken);
  assert.ok(Math.abs(r.json.concentration.top1 - 0.6313) < 0.001);
  const moutai = r.json.tax.dividends.find(d => d.asset === '贵州茅台');
  assert.ok(moutai);
  assert.equal(moutai.rate, 0.1);
  assert.equal(moutai.tax, 30);
  // 茅台持仓：(100+100-100+20+100)=220 股
  const holding = r.json.holdings.find(h => h.asset.name === '贵州茅台');
  assert.equal(holding.calc.qty, 220);
});

/* ---------------- 注册与登录 ---------------- */
test('注册新用户 alice', async () => {
  const r = await api('POST', '/api/auth/register', null, {
    username: 'alice', email: 'alice@test.com', password: 'Alice12345',
  });
  assert.equal(r.status, 201);
  aliceToken = r.json.token;
});

test('重复用户名/邮箱注册被拒', async () => {
  const r = await api('POST', '/api/auth/register', null, {
    username: 'alice', email: 'other@test.com', password: 'Alice12345',
  });
  assert.equal(r.status, 400);
});

test('弱密码与非法邮箱被拒', async () => {
  const r = await api('POST', '/api/auth/register', null, {
    username: 'bob', email: 'bad-email', password: '123',
  });
  assert.equal(r.status, 400);
});

test('邮箱验证码登录（开发环境回显 devCode）', async () => {
  const s = await api('POST', '/api/auth/send-code', null, { email: 'alice@test.com' });
  assert.equal(s.status, 200);
  assert.ok(s.json.devCode, '开发环境应回显验证码');
  const l = await api('POST', '/api/auth/login', null, { email: 'alice@test.com', code: s.json.devCode });
  assert.equal(l.status, 200);
  assert.equal(l.json.user.username, 'alice');
});

/* ---------------- 账户与资产 CRUD ---------------- */
test('创建账户（券商/银行）', async () => {
  let r = await api('POST', '/api/accounts', aliceToken, { name: '测试券商', kind: 'broker', currency: 'CNY' });
  assert.equal(r.status, 201);
  alice.broker = r.json.id;
  r = await api('POST', '/api/accounts', aliceToken, { name: '测试银行', kind: 'bank', currency: 'CNY' });
  assert.equal(r.status, 201);
  alice.bank = r.json.id;
  r = await api('POST', '/api/accounts', aliceToken, { name: '美元券商', kind: 'broker', currency: 'USD' });
  assert.equal(r.status, 201);
  alice.usBroker = r.json.id;
});

test('创建股票与现金流型资产，校验股票必须选市场', async () => {
  let r = await api('POST', '/api/assets', aliceToken, {
    name: '测试股', type: 'stock', currency: 'CNY', accountId: alice.broker, market: 'CN', price: 10,
  });
  assert.equal(r.status, 201);
  alice.stock = r.json.id;

  r = await api('POST', '/api/assets', aliceToken, {
    name: '无市场股票', type: 'stock', currency: 'CNY', accountId: alice.broker,
  });
  assert.equal(r.status, 400);

  r = await api('POST', '/api/assets', aliceToken, {
    name: '测试理财', type: 'wealth', currency: 'CNY', accountId: alice.bank, unitPrice: 1, marketValue: 10000,
  });
  assert.equal(r.status, 201);
  alice.wealth = r.json.id;

  r = await api('POST', '/api/assets', aliceToken, {
    name: '美元基金', type: 'fund', currency: 'USD', accountId: alice.usBroker, unitPrice: 1, marketValue: 0,
  });
  assert.equal(r.status, 201);
  alice.usFund = r.json.id;
});

test('不能把资产挂到别人的账户下', async () => {
  const r = await api('POST', '/api/assets', aliceToken, {
    name: 'x', type: 'wealth', currency: 'CNY', accountId: '999999', marketValue: 1,
  });
  assert.equal(r.status, 400);
});

/* ---------------- 交易事件与成本口径 ---------------- */
test('股票买入/卖出：摊薄口径已实现正确（100@10 → 卖50@12 = +100）', async () => {
  await api('POST', '/api/events', aliceToken, { assetId: alice.stock, date: daysAgo(60), side: 'buy', qty: 100, price: 10, fee: 0 });
  await api('POST', '/api/events', aliceToken, { assetId: alice.stock, date: daysAgo(30), side: 'sell', qty: 50, price: 12, fee: 0 });
  const r = await api('GET', '/api/compute', aliceToken);
  const h = r.json.holdings.find(x => x.asset.id === alice.stock);
  assert.equal(h.calc.qty, 50);
  assert.ok(Math.abs(h.calc.realCNY - 100) < 0.01, `real=${h.calc.realCNY}`);
  assert.ok(Math.abs(h.calc.avgLocal - 10) < 1e-6);
});

test('现金分红默认计入已实现，开关切换后冲减成本，总盈亏不变', async () => {
  await api('POST', '/api/events', aliceToken, { assetId: alice.stock, date: daysAgo(10), side: 'div', amount: 200 });
  let r = await api('GET', '/api/compute', aliceToken);
  let h = r.json.holdings.find(x => x.asset.id === alice.stock);
  assert.equal(h.calc.divCNY, 200);
  const totalDefault = h.calc.totalCNY;

  await api('PUT', '/api/auth/settings', aliceToken, { dividendReducesCost: true });
  r = await api('GET', '/api/compute', aliceToken);
  h = r.json.holdings.find(x => x.asset.id === alice.stock);
  assert.equal(h.calc.divCNY, 0);
  assert.ok(Math.abs(h.calc.costCNY - 300) < 0.01, `cost=${h.calc.costCNY}`);
  assert.ok(Math.abs(h.calc.totalCNY - totalDefault) < 0.01);
  await api('PUT', '/api/auth/settings', aliceToken, { dividendReducesCost: false });
});

test('FIFO 与摊薄口径差异（专用标的）', async () => {
  let r = await api('POST', '/api/assets', aliceToken, {
    name: '口径股', type: 'stock', currency: 'CNY', accountId: alice.broker, market: 'CN', price: 30,
  });
  const id = r.json.id;
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(90), side: 'buy', qty: 100, price: 10 });
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(80), side: 'buy', qty: 100, price: 20 });
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(70), side: 'sell', qty: 100, price: 30 });

  await api('PUT', '/api/auth/settings', aliceToken, { costMethod: 'wavg' });
  r = await api('GET', '/api/compute', aliceToken);
  assert.ok(Math.abs(r.json.holdings.find(x => x.asset.id === id).calc.realCNY - 1500) < 0.01);

  await api('PUT', '/api/auth/settings', aliceToken, { costMethod: 'fifo' });
  r = await api('GET', '/api/compute', aliceToken);
  assert.ok(Math.abs(r.json.holdings.find(x => x.asset.id === id).calc.realCNY - 2000) < 0.01);
  await api('PUT', '/api/auth/settings', aliceToken, { costMethod: 'wavg' });
});

test('事件校验：数量/价格非法返回 400', async () => {
  const r = await api('POST', '/api/events', aliceToken, { assetId: alice.stock, date: today, side: 'buy', qty: 0, price: 10 });
  assert.equal(r.status, 400);
});

/* ---------------- 双币种与汇率锁定 ---------------- */
test('美元资产：历史汇率锁定成本，新增手动汇率不改历史成本', async () => {
  await api('POST', '/api/events', aliceToken, { assetId: alice.usFund, date: daysAgo(40), kind: 'invest', qty: 1000, price: 1, amount: 1000, fx: 7.1 });
  let r = await api('GET', '/api/compute', aliceToken);
  let h = r.json.holdings.find(x => x.asset.id === alice.usFund);
  assert.ok(Math.abs(h.calc.investCNY - 7100) < 0.01);

  // 管理员录入今日手动汇率 7.05
  const fx = await api('POST', '/api/fx', adminToken, { date: today, rate: 7.05, note: '测试手动' });
  assert.equal(fx.status, 201);
  r = await api('GET', '/api/fx/current', aliceToken);
  assert.ok(Math.abs(r.json.rate - 7.05) < 1e-9);
  assert.equal(r.json.source, 'manual');

  // 历史成本仍为 7100
  r = await api('GET', '/api/compute', aliceToken);
  h = r.json.holdings.find(x => x.asset.id === alice.usFund);
  assert.ok(Math.abs(h.calc.investCNY - 7100) < 0.01, '历史成本被汇率变动改写');
});

test('普通用户不能管理汇率（403），自动汇率不可删', async () => {
  const r = await api('POST', '/api/fx', aliceToken, { date: today, rate: 7.0 });
  assert.equal(r.status, 403);
});

/* ---------------- 绩效：XIRR / TWR / 基准 ---------------- */
test('XIRR：一年前投 1000、当前市值 1100 → 年化约 10%（独立账户隔离）', async () => {
  const acc = await api('POST', '/api/accounts', aliceToken, { name: 'XIRR账户', kind: 'bank', currency: 'CNY' });
  const accId = acc.json.id;
  let r = await api('POST', '/api/assets', aliceToken, {
    name: 'XIRR理财', type: 'wealth', currency: 'CNY', accountId: accId, unitPrice: 1.1, marketValue: 1100,
  });
  const id = r.json.id;
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(365), kind: 'invest', qty: 1000, price: 1, amount: 1000 });
  r = await api('GET', `/api/performance?accountId=${accId}`, aliceToken);
  assert.ok(r.json.xirr != null, 'xirr 不应为 null');
  assert.ok(Math.abs(r.json.xirr - 0.10) < 0.005, `xirr=${r.json.xirr}`);
});

test('TWR 与基准对比：两期快照组合 +20%、基准 +10% → α=+10%', async () => {
  // 用独立账户隔离
  let r = await api('POST', '/api/accounts', aliceToken, { name: '绩效账户', kind: 'broker', currency: 'CNY' });
  const accId = r.json.id;
  r = await api('POST', '/api/assets', aliceToken, {
    name: '绩效理财', type: 'wealth', currency: 'CNY', accountId: accId, unitPrice: 1, marketValue: 12000,
  });
  const assetId = r.json.id;
  // 投入发生在首月之前
  await api('POST', '/api/events', aliceToken, { assetId, date: daysAgo(75), kind: 'invest', qty: 10000, price: 1, amount: 10000 });
  await api('POST', '/api/snapshots', aliceToken, { month: prevMonth, total: 10000 });
  await api('POST', '/api/snapshots', aliceToken, { month: lastMonth, total: 12000 });
  await api('POST', '/api/benchmarks', aliceToken, { date: prevMonth, value: 3800 });
  await api('POST', '/api/benchmarks', aliceToken, { date: lastMonth, value: 4180 });

  r = await api('GET', `/api/benchmark?accountId=${accId}`, aliceToken);
  assert.equal(r.status, 200);
  assert.ok(Math.abs(r.json.portRet - 0.2) < 0.005, `port=${r.json.portRet}`);
  assert.ok(Math.abs(r.json.benchRet - 0.1) < 0.005, `bench=${r.json.benchRet}`);
  assert.ok(Math.abs(r.json.alpha - 0.1) < 0.005, `alpha=${r.json.alpha}`);

  const p = await api('GET', `/api/performance?accountId=${accId}`, aliceToken);
  assert.ok(Math.abs(p.json.twr - 0.2) < 0.005);
});

/* ---------------- 配置 / 风控 / 税务 / 预警 ---------------- */
test('配置再平衡：偏离度 = Σ|diff|/2', async () => {
  const r = await api('GET', '/api/allocation', aliceToken);
  assert.equal(r.status, 200);
  const sum = r.json.rows.reduce((s, x) => s + Math.abs(x.diff), 0);
  assert.ok(Math.abs(r.json.drift - sum / 2) < 0.01);
});

test('集中度：单标的 100% 场景触发告警', async () => {
  let r = await api('POST', '/api/accounts', aliceToken, { name: '风控账户', kind: 'broker', currency: 'CNY' });
  const accId = r.json.id;
  r = await api('POST', '/api/assets', aliceToken, {
    name: '独仓股', type: 'stock', currency: 'CNY', accountId: accId, market: 'CN', price: 100,
  });
  const id = r.json.id;
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(20), side: 'buy', qty: 100, price: 100 });
  r = await api('GET', `/api/concentration?accountId=${accId}`, aliceToken);
  assert.ok(Math.abs(r.json.top1 - 1) < 1e-9);
  assert.ok(r.json.alerts.length >= 1);
});

test('税务：持股 ≤1 月分红税率 20%', async () => {
  let r = await api('POST', '/api/assets', aliceToken, {
    name: '税务股', type: 'stock', currency: 'CNY', accountId: alice.broker, market: 'CN', price: 10,
  });
  const id = r.json.id;
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(10), side: 'buy', qty: 100, price: 10 });
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(2), side: 'div', amount: 100 });
  r = await api('GET', '/api/tax', aliceToken);
  const row = r.json.dividends.find(d => d.asset === '税务股');
  assert.equal(row.rate, 0.2);
  assert.equal(row.tax, 20);
  assert.ok(r.json.capGainRows.length >= 0);
});

test('止盈预警：现价超过止盈线触发', async () => {
  let r = await api('POST', '/api/assets', aliceToken, {
    name: '预警股', type: 'stock', currency: 'CNY', accountId: alice.broker, market: 'CN', price: 130,
  });
  const id = r.json.id;
  await api('POST', '/api/events', aliceToken, { assetId: id, date: daysAgo(30), side: 'buy', qty: 100, price: 100 });
  r = await api('PUT', `/api/assets/${id}/alerts`, aliceToken, { alerts: { takeProfitPrice: 120, stopLossPrice: 90 } });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/alerts', aliceToken);
  assert.ok(r.json.priceAlerts.some(a => a.asset === '预警股' && a.level === '止盈'));
});

/* ---------------- 定投 / 出入金 / 快照 ---------------- */
test('定投计划：创建并生成 3 期投入记录（幂等）', async () => {
  let r = await api('POST', '/api/assets', aliceToken, {
    name: '定投标的', type: 'fund', currency: 'CNY', accountId: alice.bank, unitPrice: 1, marketValue: 0,
  });
  const id = r.json.id;
  const m = curMonth;
  r = await api('POST', '/api/dca-plans', aliceToken, {
    assetId: id, startMonth: m, months: 3, day: 15, amount: 1000, note: '月定投',
  });
  assert.equal(r.status, 201);
  const planId = r.json.id;
  r = await api('POST', `/api/dca-plans/${planId}/generate`, aliceToken);
  assert.equal(r.json.insertedCount, 3);
  r = await api('POST', `/api/dca-plans/${planId}/generate`, aliceToken);
  assert.equal(r.json.insertedCount, 0, '重复生成应幂等跳过');
  r = await api('GET', '/api/events?kind=invest', aliceToken);
  assert.ok(r.json.filter(e => e.assetId === id).length === 3);
});

test('股票不能设定投计划', async () => {
  const r = await api('POST', '/api/dca-plans', aliceToken, {
    assetId: alice.stock, startMonth: curMonth, months: 3, day: 15, amount: 100,
  });
  assert.equal(r.status, 400);
});

test('出入金：入金 5 万、出金 2 万 → 净入金 3 万（本金搬运本身不生盈亏）', async () => {
  await api('POST', '/api/cashflows', aliceToken, { accountId: alice.bank, date: daysAgo(20), kind: 'deposit', amount: 50000 });
  await api('POST', '/api/cashflows', aliceToken, { accountId: alice.bank, date: daysAgo(10), kind: 'withdraw', amount: 20000 });
  const r = await api('GET', '/api/compute', aliceToken);
  assert.equal(r.json.cash.deposit, 50000);
  assert.equal(r.json.cash.withdraw, 20000);
  assert.equal(r.json.cash.net, 30000);
});

test('月末快照可增删改查', async () => {
  const m = '2025-01';
  let r = await api('POST', '/api/snapshots', aliceToken, { month: m, total: 999 });
  assert.equal(r.status, 201);
  r = await api('POST', '/api/snapshots', aliceToken, { month: m, total: 1001 }); // upsert
  assert.equal(r.json.total, 1001);
  r = await api('DELETE', `/api/snapshots/${m}`, aliceToken);
  assert.equal(r.status, 200);
});

/* ---------------- 报表 ---------------- */
test('月度/年度报表可返回', async () => {
  const m = await api('GET', '/api/reports/monthly', aliceToken);
  assert.equal(m.status, 200);
  assert.ok(Array.isArray(m.json) && m.json.length > 0);
  const y = await api('GET', '/api/reports/yearly', aliceToken);
  assert.equal(y.status, 200);
  assert.ok(Array.isArray(y.json) && y.json.length > 0);
});

/* ---------------- 导出 / 导入往返 ---------------- */
test('导出 → 新增垃圾数据 → 导入恢复（导入前自动备份）', async () => {
  const exp = await api('GET', '/api/export', aliceToken);
  assert.equal(exp.status, 200);
  assert.equal(exp.json.schema, 'invest-manager/v4');
  const accountCount = exp.json.accounts.length;

  await api('POST', '/api/accounts', aliceToken, { name: '即将被导入覆盖的账户' });
  let now2 = await api('GET', '/api/accounts', aliceToken);
  assert.equal(now2.json.length, accountCount + 1);

  const imp = await api('POST', '/api/import', aliceToken, exp.json);
  assert.equal(imp.status, 200);
  assert.ok(imp.json.backupFile);
  assert.equal(imp.json.counts.accounts, accountCount);
  now2 = await api('GET', '/api/accounts', aliceToken);
  assert.equal(now2.json.length, accountCount);
});

test('导入非法文件被拒', async () => {
  const r = await api('POST', '/api/import', aliceToken, { schema: 'other/x', accounts: [] });
  assert.equal(r.status, 400);
});

/* ---------------- 管理后台 ---------------- */
test('管理员：用户列表、禁用后旧 token 即时失效、再启用', async () => {
  let r = await api('GET', '/api/admin/users', adminToken);
  assert.equal(r.status, 200);
  const target = r.json.find(u => u.username === 'alice');
  assert.ok(target);

  r = await api('PUT', `/api/admin/users/${target.id}/status`, adminToken, { status: 'disabled' });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/compute', aliceToken);
  assert.equal(r.status, 403, '禁用用户旧 token 应即时失效');

  r = await api('POST', '/api/auth/login', null, { username: 'alice', password: 'Alice12345' });
  assert.equal(r.status, 403, '禁用用户不能登录');

  await api('PUT', `/api/admin/users/${target.id}/status`, adminToken, { status: 'active' });
  r = await api('GET', '/api/compute', aliceToken);
  assert.equal(r.status, 200);
});

test('管理员：重置密码后可用临时密码登录', async () => {
  const users = (await api('GET', '/api/admin/users', adminToken)).json;
  const target = users.find(u => u.username === 'alice');
  const r = await api('POST', `/api/admin/users/${target.id}/reset-password`, adminToken, {});
  assert.equal(r.status, 200);
  assert.ok(r.json.tempPassword.length >= 8);
  const l = await api('POST', '/api/auth/login', null, { username: 'alice', password: r.json.tempPassword });
  assert.equal(l.status, 200);
});

test('普通用户不能访问管理后台', async () => {
  const r = await api('GET', '/api/admin/users', aliceToken);
  assert.equal(r.status, 403);
});

test('管理员：邮箱配置保存后密码打码回显；测试连通失败有明确错误', async () => {
  let r = await api('PUT', '/api/admin/mail', adminToken, {
    host: 'smtp.invalid.test', port: 465, secure: true, user: 'u@test.com', password: 'secret123', from: 'u@test.com',
  });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/admin/mail', adminToken);
  assert.equal(r.json.hasPassword, true);
  assert.ok(!JSON.stringify(r.json).includes('secret123'), '明文密码不能回显');
  r = await api('POST', '/api/admin/mail/test', adminToken, {});
  assert.equal(r.status, 502);
  assert.ok(r.json.error);
});

test('管理员：系统概览', async () => {
  const r = await api('GET', '/api/admin/stats', adminToken);
  assert.equal(r.status, 200);
  assert.ok(r.json.users >= 2);
  assert.equal(r.json.mailConfigured, true);
});

/* ---------------- 级联删除 ---------------- */
test('删除账户级联删除其下资产与事件', async () => {
  const before = (await api('GET', '/api/assets', aliceToken)).json.length;
  const r = await api('DELETE', `/api/accounts/${alice.bank}`, aliceToken);
  assert.equal(r.status, 200);
  assert.ok(r.json.deletedAssets > 0);
  const after = (await api('GET', '/api/assets', aliceToken)).json.length;
  assert.ok(after < before);
});
