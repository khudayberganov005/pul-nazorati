const crypto = require('crypto');

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'pul-nazorati-fallback-secret';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 kun

/* ---------- PAROL HASH (Node crypto.scrypt, qo'shimcha paket kerak emas) ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const attemptHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(attemptHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ---------- SESSIYA TOKENI (imzolangan, bazasiz tekshiriladi) ---------- */
function signToken(adminId) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${adminId}.${expiry}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const lastDot = token.lastIndexOf('.');
  const payloadB64 = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  let payload;
  try { payload = Buffer.from(payloadB64, 'base64').toString(); } catch (e) { return null; }

  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [adminId, expiry] = payload.split('.');
  if (Date.now() > Number(expiry)) return null;
  return { adminId: Number(adminId) };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
