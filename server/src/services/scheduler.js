'use strict';
/**
 * 定时任务（node-cron）：
 * - 汇率同步（每日 08:00，主源失败降级备用源）
 * - 月末快照（每月最后一天 23:50）
 * - 定投生成（每日 00:10 检查当日到期计划，幂等）
 * - 预警扫描（每日 16:00 收盘后，站内通知；配置 SMTP 后可邮件）
 * - 数据备份（每日 03:00，保留 30 天）
 */
const cron = require('node-cron');
const { getDb, now } = require('../db');
const { config } = require('../config');
const fxService = require('./fx');
const { backupDatabase } = require('./backup');
const portfolio = require('./portfolio');
const Calc = require('../calc');

function todayParts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    month: `${d.getFullYear()}-${p(d.getMonth() + 1)}`, day: d.getDate(),
    y: d.getFullYear(), m: d.getMonth() + 1 };
}

async function jobSyncFx() {
  const r = await fxService.syncFxRate();
  console.log(`[cron] 汇率同步：${r.ok ? `1 USD = ${r.rate} CNY${r.usedFallback ? '（备用源）' : ''}` : r.error}`);
}

/** 月末快照：为每位用户记录当月末总资产 */
function jobMonthlySnapshot() {
  const db = getDb();
  const { month } = todayParts();
  const users = db.prepare("SELECT id FROM user WHERE status='active'").all();
  let n = 0;
  for (const u of users) {
    try {
      /* v6 起 kpis 已无 total 字段（改用 mv = 持仓市值），快照即持仓市值口径 */
      const total = portfolio.computeAll(u.id).kpis.mv;
      if (!(total > 0)) continue;
      db.prepare(`INSERT INTO snapshot (user_id,month,total) VALUES (?,?,?)
                  ON CONFLICT(user_id,month) DO UPDATE SET total=excluded.total`).run(u.id, month, total);
      n++;
    } catch (e) { console.warn(`[cron] 快照失败 user=${u.id}: ${e.message}`); }
  }
  console.log(`[cron] 月末快照完成：${n} 位用户`);
}

/** 定投生成：为今天到期的 active 计划补投（同日已有 invest 事件则跳过） */
function jobDcaGenerate() {
  const db = getDb();
  const { year: y, month: m0, day } = (() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  })();
  const plans = db.prepare('SELECT * FROM dca_plan WHERE active=1').all();
  let count = 0;
  for (const p of plans) {
    if (p.day !== day) continue;
    const [sy, sm] = p.start_month.split('-').map(Number);
    const elapsed = (y - sy) * 12 + (m0 - sm);
    if (elapsed < 0 || elapsed >= p.months) continue;
    const date = todayParts().date;
    const exists = db.prepare("SELECT id FROM event WHERE asset_id=? AND date=? AND kind='invest'").get(p.asset_id, date);
    if (exists) continue;
    const asset = db.prepare('SELECT * FROM asset WHERE id=?').get(p.asset_id);
    const fx = asset && asset.currency === 'USD' ? fxService.currentFx(date) : 1;
    db.prepare(`INSERT INTO event (user_id,asset_id,date,kind,side,amount,fee,fx,note,created_at)
                VALUES (?,?,?, 'invest', NULL,?,0,?,? ,?)`)
      .run(p.user_id, p.asset_id, date, p.amount, fx, p.note || '定投', now());
    count++;
  }
  if (count) console.log(`[cron] 定投生成：${count} 笔`);
}

/** 预警扫描：集中度 + 止盈止损，写站内通知（同日同标的同类型去重） */
function jobScanAlerts() {
  const db = getDb();
  const users = db.prepare("SELECT id FROM user WHERE status='active'").all();
  const dayKey = todayParts().date;
  let count = 0;
  for (const u of users) {
    let data;
    try { data = portfolio.computeAll(u.id); } catch { continue; }
    const msgs = [
      ...data.concentration.alerts.map(t => ({ kind: 'concentration', title: '集中度风险', body: t })),
      ...data.alerts.map(a => ({ kind: 'price', title: `${a.level}预警 · ${a.asset}`, body: a.msg })),
    ];
    for (const msg of msgs) {
      const dedup = `${dayKey}:${msg.kind}:${msg.title}:${msg.body}`;
      const hit = db.prepare('SELECT id FROM notification WHERE user_id=? AND dedup_key=?').get(u.id, dedup);
      if (hit) continue;
      db.prepare('INSERT INTO notification (user_id,kind,title,body,is_read,dedup_key,created_at) VALUES (?,?,?,? ,0,?,?)')
        .run(u.id, msg.kind, msg.title, msg.body, dedup, now());
      count++;
    }
  }
  if (count) console.log(`[cron] 预警扫描：新增 ${count} 条通知`);
}

async function jobBackup() {
  try {
    const file = await backupDatabase(getDb());
    console.log(`[cron] 数据库已备份：${file}`);
  } catch (e) {
    console.warn(`[cron] 备份失败：${e.message}`);
  }
}

/** 判断今天是否本月最后一天 */
function isLastDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === d.getDate();
}

function startScheduler() {
  // 汇率同步
  cron.schedule(config.FX.syncCron, () => { jobSyncFx().catch(e => console.warn(`[cron] fx: ${e.message}`)); });
  // 每日 00:10 定投
  cron.schedule('10 0 * * *', jobDcaGenerate);
  // 每日 03:00 备份
  cron.schedule('0 3 * * *', () => { jobBackup(); });
  // 每日 16:00 预警扫描
  cron.schedule('0 16 * * *', jobScanAlerts);
  // 每月最后一天 23:50 快照（每天 23:50 检查是否月末）
  cron.schedule('50 23 * * *', () => { if (isLastDayOfMonth()) jobMonthlySnapshot(); });

  if (config.FX.syncOnStart) {
    jobSyncFx().catch(e => console.warn(`[startup] fx: ${e.message}`));
  }
  console.log('[cron] 定时任务已启动');
}

module.exports = {
  startScheduler, jobSyncFx, jobMonthlySnapshot, jobDcaGenerate, jobScanAlerts, jobBackup,
};
