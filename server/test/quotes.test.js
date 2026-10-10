'use strict';
/**
 * 行情同步服务测试（独立临时库；fetchText 注入 stub，不发真实请求）
 * 运行：node --test test/quotes.test.js
 * 覆盖：主源回写 / 幂等 / 手动保护（auto 跳过 + force 强刷）/ 备源降级 / 代码错误定位 / 解析器
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `invest-quotes-test-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.CRON_ENABLED = 'false';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin12345';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const Q = require('../src/services/quotes');

/* ---------- 样本构造（与真实接口逐字段对齐） ---------- */
const tencentLine = (key, code, price, dateRaw) => {
  const f = new Array(31).fill('x');
  f[0] = '1'; f[1] = 'NAME'; f[2] = code; f[3] = String(price); f[30] = dateRaw;
  return `v_${key}="${f.join('~')}";`;
};
const sinaStockLine = (key, name, price, date) => {
  const c = new Array(32).fill('x');
  c[0] = name; c[3] = String(price); c[30] = date; c[31] = '15:00:00';
  return `var hq_str_${key}="${c.join(',')}";`;
};

/* stub 可变的当前报价 */
const stub = {
  maotai: 1263.00,          // sh600519（腾讯）
  apple: 336.64,            // usAAPL（腾讯）
  fundNav: 1.7567,          // 018125（新浪基金）
  killTencent: false,       // true → 腾讯主源抛错，走新浪备源
  killSinaFund: false,      // true → 新浪基金抛错，走东财备源
};
async function fetchTextStub(url) {
  if (url.includes('qt.gtimg.cn')) {
    if (stub.killTencent) throw new Error('tencent down');
    return tencentLine('sh600519', '600519', stub.maotai, '20261009161459')
      + tencentLine('usAAPL', 'AAPL.OQ', stub.apple, '2026-10-09 16:00:01')
      + tencentLine('sz000858', '000858', 70.56, '20261009161500');
  }
  if (url.includes('hq.sinajs.cn') && url.includes('list=f_')) {
    if (stub.killSinaFund) throw new Error('sina fund down');
    return 'var hq_str_f_018125="永赢先进制造智选C,'
      + stub.fundNav + ',1.7567,1.7384,2026-10-09,45.656";';
  }
  if (url.includes('hq.sinajs.cn')) {
    // 新浪股票备源：按请求里的代码回价
    let out = '';
    if (/sh600519/.test(url)) out += sinaStockLine('sh600519', '贵州茅台', stub.maotai, '2026-10-09');
    if (/gbaapl/i.test(url)) out += sinaStockLine('gbaapl', '苹果', stub.apple, '');
    if (/sz000858/.test(url)) out += sinaStockLine('sz000858', '五粮液', 70.56, '2026-10-09');
    return out;
  }
  if (url.includes('api.fund.eastmoney.com')) {
    return JSON.stringify({ Data: { LSJZList: [{ FSRQ: '2026-10-09', DWJZ: String(stub.fundNav), LJJZ: '1.7567' }] } });
  }
  throw new Error('unexpected url: ' + url);
}

/* ---------- 夹具 ---------- */
db.init(TMP_DB);
const d = db.getDb();
const ts = '2026-01-01T00:00:00.000Z';
const accCn = d.prepare("INSERT INTO account (user_id,name,kind,currency,created_at) VALUES (1,'A股','broker','CNY',?)").run(ts).lastInsertRowid;
const accUsd = d.prepare("INSERT INTO account (user_id,name,kind,currency,created_at) VALUES (1,'IBKR','broker','USD',?)").run(ts).lastInsertRowid;
const insAsset = d.prepare("INSERT INTO asset (user_id,account_id,name,code,market,type,currency,price,unit_price,created_at) VALUES (1,?,?,?,?,?,?,?,?,?)");
const aMaotai = insAsset.run(accCn, '贵州茅台', '600519', 'CN', 'stock', 'CNY', 1000, 0, ts).lastInsertRowid;
const aApple = insAsset.run(accUsd, '苹果', 'AAPL', 'US', 'stock', 'USD', 300, 0, ts).lastInsertRowid;
const aFund = insAsset.run(accCn, '永赢先进制造C', '018125', '', 'fund', 'CNY', 0, 1.7, ts).lastInsertRowid;
const aBad = insAsset.run(accUsd, '代码错误标的', 'ZZZZ', 'US', 'stock', 'USD', 10, 0, ts).lastInsertRowid;
const aWly = insAsset.run(accCn, '五粮液', '000858', 'CN', 'stock', 'CNY', 70, 0, ts).lastInsertRowid;

const assetOf = id => d.prepare('SELECT * FROM asset WHERE id=?').get(id);
const findOne = (r, id) => r.updated.find(x => x.id === String(id));

test('主源同步（force）：股票回写 price、基金回写 unit_price，代码错误逐个上报', async () => {
  const r = await Q.syncUserQuotes(d, 1, { force: true, fetchText: fetchTextStub });
  assert.equal(findOne(r, aMaotai).to, 1263);
  assert.equal(findOne(r, aApple).to, 336.64);
  assert.equal(findOne(r, aFund).to, 1.7567);
  assert.equal(r.source.stocks, 'tencent');
  assert.equal(r.source.funds, 'sina');

  assert.equal(assetOf(aMaotai).price, 1263);
  assert.equal(assetOf(aMaotai).price_source, 'auto');
  assert.equal(assetOf(aMaotai).price_date, '2026-10-09');
  assert.equal(assetOf(aApple).price, 336.64);
  assert.equal(assetOf(aApple).price_date, '2026-10-09');
  assert.equal(assetOf(aFund).unit_price, 1.7567);
  assert.equal(assetOf(aFund).price_date, '2026-10-09');

  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].id, String(aBad));
  assert.equal(r.errors[0].code, 'ZZZZ');
  assert.equal(r.errors[0].name, '代码错误标的');
  assert.ok(r.errors[0].reason.includes('报价'), '错误原因应说明未获取报价');
});

test('幂等：报价与现值一致 → 计入无变化，不重复写', async () => {
  const r = await Q.syncUserQuotes(d, 1, { force: false, fetchText: fetchTextStub });
  assert.equal(r.updated.length, 0);
  assert.equal(r.unchanged, 4, '茅台/苹果/基金/五粮液 四个均与现值一致');
  assert.equal(assetOf(aMaotai).price, 1263);
});

test('手动保护：auto 同步跳过手改价格；force（手动按钮）强制刷新', async () => {
  d.prepare('UPDATE asset SET price=?, price_source=?, price_date=NULL WHERE id=?').run(1288, 'manual', aMaotai);
  stub.maotai = 1300;

  let r = await Q.syncUserQuotes(d, 1, { force: false, fetchText: fetchTextStub });
  assert.equal(r.skippedManual, 1, '自动同步应跳过手动维护的资产');
  assert.equal(assetOf(aMaotai).price, 1288, '自动同步不得改写手动价格');
  assert.ok(!r.updated.find(x => x.id === String(aMaotai)));

  r = await Q.syncUserQuotes(d, 1, { force: true, fetchText: fetchTextStub });
  const hit = findOne(r, aMaotai);
  assert.ok(hit && hit.to === 1300, '手动同步应强制刷新');
  assert.equal(assetOf(aMaotai).price, 1300);
  assert.equal(assetOf(aMaotai).price_source, 'auto', '强刷后回到 auto，继续参与自动同步');
});

test('备源降级：主源失败 → 新浪股票接棒', async () => {
  stub.killTencent = true;
  stub.maotai = 1350;           // 备源给出新价，便于断言「确由备源回写」
  try {
    const r = await Q.syncUserQuotes(d, 1, { force: false, fetchText: fetchTextStub });
    assert.equal(r.source.stocks, 'sina');
    assert.equal(findOne(r, aMaotai).to, 1350, '新浪备源同样给出报价并回写');
    assert.equal(assetOf(aApple).price, stub.apple);
    assert.ok(r.errors.find(e => e.id === String(aBad)), '主备源都没有的代码仍上报');
  } finally { stub.killTencent = false; }
});

test('基金备源：新浪失败 → 东财 lsjz 接棒', async () => {
  stub.killSinaFund = true;
  stub.fundNav = 1.76;
  try {
    const r = await Q.syncUserQuotes(d, 1, { force: true, fetchText: fetchTextStub });
    assert.equal(r.source.funds, 'eastmoney');
    assert.equal(assetOf(aFund).unit_price, 1.76);
  } finally { stub.killSinaFund = false; stub.fundNav = 1.7567; }
});

test('解析器：normalizeDate 兼容两种格式；腾讯美股代码剥交易所后缀', () => {
  assert.equal(Q.normalizeDate('20261009161459'), '2026-10-09');
  assert.equal(Q.normalizeDate('2026-10-09 16:00:01'), '2026-10-09');
  assert.equal(Q.normalizeDate(''), '');
  const m = Q.parseTencent(tencentLine('usAAPL', 'AAPL.OQ', 336.64, '2026-10-09 16:00:01'));
  assert.ok(m.has('AAPL'));
  const f = Q.parseSinaFund('var hq_str_f_018125="永赢先进制造智选C,1.7567,1.7567,1.7384,2026-10-09,45.656";');
  assert.equal(f.get('018125').nav, 1.7567);
  assert.equal(f.get('018125').date, '2026-10-09');
});

test.after(() => {
  for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});
