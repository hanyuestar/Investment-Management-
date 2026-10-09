'use strict';
/** 基准点位（默认沪深300 CSI300，按月录入） */
const express = require('express');
const { getDb } = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/helpers');
const { adminRequired } = require('../middleware/auth');
const benchService = require('../services/benchmark');

const router = express.Router();
router.use(authRequired);

const mapRow = r => ({ id: String(r.id), code: r.code, date: r.date, value: r.value });

/** 支持的基准指数列表（供前端下拉选择） */
router.get('/indices', (req, res) => {
  res.json({ default: benchService.DEFAULT_CODE, list: benchService.indexList() });
});

/**
 * 自动同步基准点位（仅管理员）。
 * - 自动补齐历史月末点位（只取已结束的月份，避免写入未走完的当月）
 * - 幂等：已存在的月份默认跳过，不覆盖手工录入；body.overwrite=true 可强制覆盖
 * body: { code?: 'CSI300', overwrite?: boolean, datalen?: number, months?: ['2026-09'] }
 */
router.post('/sync', adminRequired, asyncHandler(async (req, res) => {
  const code = String(req.body?.code || benchService.DEFAULT_CODE).slice(0, 20);
  const overwrite = !!req.body?.overwrite;
  const datalen = req.body?.datalen;
  const months = Array.isArray(req.body?.months) ? req.body.months.slice(0, 200) : undefined;
  const r = await benchService.syncBenchmark(req.user.id, code, { overwrite, datalen, months });
  if (!r.ok) return badRequest(res, r.error || '同步失败');
  res.json(r);
}));

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
