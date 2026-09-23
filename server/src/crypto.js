'use strict';
/**
 * 对称加密工具（AES-256-GCM），用于加密存储 SMTP 密码等敏感配置。
 * 密钥取自 CONFIG_SECRET（未配置时回退 JWT_SECRET），经 SHA-256 派生为 32 字节。
 */
const crypto = require('crypto');
const { config } = require('./config');

const KEY = crypto.createHash('sha256').update(config.CONFIG_SECRET).digest();
const PREFIX = 'enc:';

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  if (!payload || typeof payload !== 'string' || !payload.startsWith(PREFIX)) return payload || '';
  try {
    const buf = Buffer.from(payload.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return ''; // 密钥变更或数据损坏时返回空，避免崩溃
  }
}

/** 接口返回时打码，不暴露明文密码 */
function maskSecret(plain) {
  if (!plain) return '';
  return '••••••' + String(plain).slice(-2);
}

module.exports = { encrypt, decrypt, maskSecret };
