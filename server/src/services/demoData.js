'use strict';
/**
 * 示例数据（与设计原型 seed 对齐，用于体验与交叉验证）。
 * 可通过「数据」页按钮或 scripts/seed-demo.js 装载；会先自动备份。
 */
const { now } = require('../db');

function loadDemoData(db, userId) {
  const ts = now();
  const insAccount = db.prepare(`INSERT INTO account (id,user_id,name,kind,currency,note,created_at)
    VALUES (?,?,?,?,?,?,?)`);
  const insAsset = db.prepare(`INSERT INTO asset
    (id,user_id,account_id,name,code,market,type,currency,price,market_value,alerts_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insEvent = db.prepare(`INSERT INTO event
    (id,user_id,asset_id,date,kind,side,qty,price,amount,ratio,fee,fx,is_t,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insSnap = db.prepare('INSERT OR REPLACE INTO snapshot (user_id,month,total) VALUES (?,?,?)');
  const insBench = db.prepare('INSERT OR REPLACE INTO benchmark (user_id,code,date,value) VALUES (?,?,?,?)');
  const insCash = db.prepare(`INSERT INTO cash_flow (id,user_id,account_id,date,kind,amount,fx,note)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insPlan = db.prepare(`INSERT INTO dca_plan
    (id,user_id,asset_id,start_month,months,day,amount,note,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,1,?)`);
  const insFxAuto = db.prepare(`INSERT INTO fx_rate (date,rate,source,note) VALUES (?,?,?,?)
    ON CONFLICT(date,source) DO UPDATE SET rate=excluded.rate, note=excluded.note`);

  const clearUser = () => {
    for (const t of ['event', 'asset', 'account', 'snapshot', 'benchmark', 'cash_flow', 'dca_plan', 'notification']) {
      db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(userId);
    }
  };

  const run = db.transaction(() => {
    clearUser();

    // 全局汇率（不存在才插，避免覆盖管理员数据）
    const fxCount = db.prepare("SELECT COUNT(*) n FROM fx_rate").get().n;
    if (!fxCount) {
      insFxAuto.run('2026-01-01', 7.10, 'manual', '初始汇率');
      insFxAuto.run('2026-06-01', 7.28, 'manual', '年中调整');
      insFxAuto.run('2026-09-21', 6.6954, 'auto', '自动同步');
    }

    // 账户
    insAccount.run(1, userId, '华泰证券', 'broker', 'CNY', 'A股主账户', ts);
    insAccount.run(2, userId, '招商银行', 'bank', 'CNY', '理财/债券', ts);
    insAccount.run(3, userId, '富途证券', 'broker', 'USD', '美股账户', ts);

    // 资产
    insAsset.run(1, userId, 1, '贵州茅台', '600519', 'CN', 'stock', 'CNY', 1330, 0,
      JSON.stringify({ takeProfitPrice: 1450, stopLossPrice: 1100 }), ts);
    insAsset.run(2, userId, 2, '宁德时代', '300750', 'CN', 'stock', 'CNY', 210, 0, null, ts);
    insAsset.run(3, userId, 3, '标普500 ETF', 'VOO', 'US', 'fund', 'USD', 0, 8600, null, ts);
    insAsset.run(4, userId, 2, '招银理财·稳健', '', '', 'wealth', 'CNY', 0, 51000, null, ts);
    insAsset.run(5, userId, 2, '国债2401', '', '', 'bond', 'CNY', 0, 20300, null, ts);

    // 事件
    let eid = 0;
    const E = (assetId, date, kind, side, v) => insEvent.run(++eid, userId, assetId, date, kind, side,
      v?.qty ?? null, v?.price ?? null, v?.amount ?? null, v?.ratio ?? null, v?.fee ?? 0,
      v?.fx ?? 1, v?.isT ?? 0, v?.note ?? '', ts);
    E(1, '2026-02-10', 'buy', 'buy', { qty: 100, price: 1500, fee: 15, note: '建仓' });
    E(1, '2026-03-12', 'buy', 'buy', { qty: 100, price: 1450, fee: 15, note: '补仓' });
    E(1, '2026-03-20', 'sell', 'sell', { qty: 100, price: 1560, fee: 17, isT: 1, note: 'T出' });
    E(1, '2026-06-30', 'div', 'div', { amount: 300, note: '现金分红' });
    E(1, '2026-07-10', 'bonus', 'bonus', { qty: 20, note: '10送2' });
    E(1, '2026-08-15', 'buy', 'buy', { qty: 100, price: 1400, fee: 15, note: '回调买入' });
    E(2, '2026-05-08', 'buy', 'buy', { qty: 200, price: 180, fee: 20, note: '买入' });
    E(3, '2026-01-15', 'invest', null, { amount: 5000, fx: 7.10, note: '美股权重' });
    E(3, '2026-07-15', 'invest', null, { amount: 3000, fx: 7.28, note: '加仓' });
    E(3, '2026-08-01', 'income', null, { amount: 60, fx: 7.28, note: '分红' });
    E(4, '2026-01-20', 'invest', null, { amount: 50000, note: '' });
    E(4, '2026-06-20', 'income', null, { amount: 1200, note: '半年利息' });
    E(5, '2026-04-01', 'invest', null, { amount: 20000, note: '' });

    // 月末快照
    const snaps = [['2026-01', 86000], ['2026-02', 237000], ['2026-03', 236500], ['2026-04', 246000],
      ['2026-05', 289000], ['2026-06', 291500], ['2026-07', 314500], ['2026-08', 520000]];
    snaps.forEach(([m, t]) => insSnap.run(userId, m, t));

    // 基准点位（沪深300）
    const bench = [['2026-01', 3800], ['2026-02', 3920], ['2026-03', 3860], ['2026-04', 4010],
      ['2026-05', 4180], ['2026-06', 4090], ['2026-07', 4260], ['2026-08', 4430]];
    bench.forEach(([m, v]) => insBench.run(userId, 'CSI300', m, v));

    // 出入金
    let cid = 0;
    const C = (accountId, date, kind, amount, fx, note) =>
      insCash.run(++cid, userId, accountId, date, kind, amount, fx, note);
    C(1, '2026-02-01', 'deposit', 300000, 1, '券商入金');
    C(2, '2026-01-15', 'deposit', 90000, 1, '银行入金');
    C(2, '2026-05-01', 'withdraw', 20000, 1, '取现');
    C(3, '2026-01-10', 'deposit', 8000, 7.10, '美元入金');

    // 定投计划
    insPlan.run(1, userId, 3, '2026-09', 12, 15, 400, '标普500月定投', ts);
  });

  run();
  return { ok: true };
}

module.exports = { loadDemoData };
