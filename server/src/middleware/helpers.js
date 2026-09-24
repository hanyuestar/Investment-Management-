'use strict';
/** 路由通用工具：异步包装、参数校验、归属权检查 */

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const badRequest = (res, msg) => res.status(400).json({ error: msg });
const notFound = (res, msg = '记录不存在') => res.status(404).json({ error: msg });


const USERNAME_RE = /^[\w一-龥][\w一-龥.\-]{2,29}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegistration(body) {
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!USERNAME_RE.test(username)) return '用户名需为 3-30 位，支持中英文、数字、下划线';
  if (!EMAIL_RE.test(email)) return '邮箱格式不正确';
  if (password.length < 8 || password.length > 64) return '密码长度需为 8-64 位';
  return null;
}

/** 取属于当前用户的行；不存在返回 undefined */
function ownedRow(db, table, id, userId, idCol = 'id') {
  return db.prepare(`SELECT * FROM ${table} WHERE ${idCol}=? AND user_id=?`).get(id, userId);
}

module.exports = {
  asyncHandler, badRequest, notFound,
  USERNAME_RE, EMAIL_RE, validateRegistration, ownedRow,
};
