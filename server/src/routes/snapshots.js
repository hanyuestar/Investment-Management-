'use strict';
/** 月末快照（含浮动收益、TWR、基准曲线的输入） */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(authRequired);

const mapRow = r => ({ id: String(r.id), month: r.month, total: r.total });

router.get('/', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM snapshot WHERE user_id=? ORDER BY month')
    .all(req.user.id).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const month = String(req.body?.month || '').slice(0, 7);
  const total = Number(req.body?.total);
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest(res, '月份格式应为 YYYY-MM');
  if (!(total >= 0)) return badRequest(res, '月末总资产需为非负数');
  const db = getDb();
  db.prepare(`INSERT INTO snapshot (user_id,month,total) VALUES (?,?,?)
              ON CONFLICT(user_id,month) DO UPDATE SET total=excluded.total`)
    .run(req.user.id, month, total);
  const row = db.prepare('SELECT * FROM snapshot WHERE user_id=? AND month=?').get(req.user.id, month);
  res.status(201).json(mapRow(row));
}));

router.delete('/:month', (req, res) => {
  const month = String(req.params.month);
  const info = getDb().prepare('DELETE FROM snapshot WHERE user_id=? AND month=?').run(req.user.id, month);
  if (!info.changes) return notFound(res, '快照不存在');
  res.json({ ok: true });
});

module.exports = router;
