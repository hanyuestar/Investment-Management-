'use strict';
/** 基准点位（默认沪深300 CSI300，按月录入） */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/helpers');

const router = express.Router();
router.use(authRequired);

const mapRow = r => ({ id: String(r.id), code: r.code, date: r.date, value: r.value });

router.get('/', (req, res) => {
  const code = String(req.query.code || 'CSI300');
  res.json(getDb().prepare('SELECT * FROM benchmark WHERE user_id=? AND code=? ORDER BY date')
    .all(req.user.id, code).map(mapRow));
});

router.post('/', asyncHandler(async (req, res) => {
  const code = String(req.body?.code || 'CSI300').slice(0, 20);
  const date = String(req.body?.date || '').slice(0, 7);
  const value = Number(req.body?.value);
  if (!/^\d{4}-\d{2}$/.test(date)) return badRequest(res, '月份格式应为 YYYY-MM');
  if (!(value > 0)) return badRequest(res, '点位需大于 0');
  const db = getDb();
  db.prepare(`INSERT INTO benchmark (user_id,code,date,value) VALUES (?,?,?,?)
              ON CONFLICT(user_id,code,date) DO UPDATE SET value=excluded.value`)
    .run(req.user.id, code, date, value);
  const row = db.prepare('SELECT * FROM benchmark WHERE user_id=? AND code=? AND date=?')
    .get(req.user.id, code, date);
  res.status(201).json(mapRow(row));
}));

router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM benchmark WHERE id=? AND user_id=?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: '记录不存在' });
  res.json({ ok: true });
});

module.exports = router;
