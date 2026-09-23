'use strict';
/** 站内通知（预警扫描产生） */
const express = require('express');
const { getDb, now } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM notification WHERE user_id=? ORDER BY id DESC LIMIT 200')
    .all(req.user.id)
    .map(n => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body,
      isRead: !!n.is_read, dedupKey: n.dedup_key, createdAt: n.created_at,
    }));
  const unread = rows.filter(r => !r.isRead).length;
  res.json({ notifications: rows, unread });
});

router.put('/:id/read', (req, res) => {
  getDb().prepare('UPDATE notification SET is_read=1 WHERE id=? AND user_id=?')
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  getDb().prepare('UPDATE notification SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
