'use strict';
/**
 * 一键写入示例数据（账号 demo / demo1234）
 * 运行：npm run seed:demo
 */
const bcrypt = require('bcryptjs');
const { init, getDb, now } = require('../src/db');
const { loadDemoData } = require('../src/services/demoData');

init();
const db = getDb();

let user = db.prepare("SELECT * FROM user WHERE username='demo'").get();
if (!user) {
  const hash = bcrypt.hashSync('demo1234', 10);
  const info = db.prepare(`INSERT INTO user (username,email,password_hash,role,status,created_at,settings_json)
                           VALUES ('demo','demo@example.com',?,'user','active',?, '{}')`)
    .run(hash, now());
  user = db.prepare('SELECT * FROM user WHERE id=?').get(info.lastInsertRowid);
  console.log('[seed] 已创建演示账号 demo / demo1234');
} else {
  console.log('[seed] demo 账号已存在，将覆盖其业务数据为示例数据');
}

loadDemoData(db, user.id);
console.log('[seed] 示例数据装载完成（含 3 个账户、5 只标的、13 笔事件、8 期快照/基准、4 笔出入金、1 个定投计划）');
process.exit(0);
