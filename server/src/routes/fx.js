'use strict';
/** 汇率：登录用户可读时间线；手动录入/删除/立即同步仅管理员 */
const express = require('express');
const { getDb } = require('../db');
const { authRequired, adminRequired } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/helpers');
const fxService = require('../services/fx');

const router = express.Router();
router.use(authRequired);

function mapRow(r) {
  return { id: r.id, date: r.date, rate: r.rate, source: r.source, note: r.note || '' };
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM fx_rate ORDER BY date DESC, source DESC').all();
  res.json(rows.map(mapRow));
});

/** 当前生效汇率 + 来源（口径与引擎 Calc.currentFx 一致，UTC 当日） */
router.get('/current', (req, res) => {
  const today = fxService.todayStr();
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM fx_rate WHERE date <= ?
    ORDER BY date DESC, CASE source WHEN 'manual' THEN 1 ELSE 0 END DESC, id DESC LIMIT 1`).get(today);
  res.json({
    date: row?.date || null,
    rate: row ? row.rate : fxService.currentFx(today),
    source: row?.source || 'fallback',
    note: row?.note || '',
  });
});

router.post('/', adminRequired, (req, res) => {
  const date = String(req.body?.date || '').slice(0, 10);
  const rate = Number(req.body?.rate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, '日期格式应为 YYYY-MM-DD');
  if (!(rate > 0)) return badRequest(res, '汇率需大于 0');
  fxService.addManualFx(date, rate, String(req.body?.note || ''));
  const row = getDb().prepare("SELECT * FROM fx_rate WHERE date=? AND source='manual'").get(date);
  res.status(201).json(mapRow(row));
});

/** 立即同步自动汇率源（主源失败自动降级备用源） */
router.post('/sync', adminRequired, asyncHandler(async (req, res) => {
  const result = await fxService.syncFxRate();
  if (!result.ok) return res.status(502).json({ error: result.error });
  res.json(result);
}));

/** 仅手动汇率可删，自动记录不可删 */
router.delete('/:id', adminRequired, (req, res) => {
  const row = getDb().prepare('SELECT * FROM fx_rate WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (row.source !== 'manual') return badRequest(res, '自动汇率记录不可删除');
  getDb().prepare('DELETE FROM fx_rate WHERE id=?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
