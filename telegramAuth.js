const crypto = require('crypto');
const { getOrCreateUser } = require('./db');

/**
 * Telegram WebApp initData haqiqiyligini tekshiradi.
 * Rasmiy algoritm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
function validateInitData(initData, botToken) {
  if (!initData) return { ok: false };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false };
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return { ok: false };

  // 24 soatdan eski initData'ni rad etamiz (ixtiyoriy, ammo tavsiya etiladi)
  const authDate = Number(params.get('auth_date') || 0);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > 86400) return { ok: false };

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (e) { /* noop */ }

  return { ok: true, user };
}

function requireTelegramAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || '';
  const botToken = process.env.BOT_TOKEN;

  // Faqat lokal test uchun: Telegramsiz sinash imkoniyati
  if (!initData && process.env.ALLOW_DEV_NO_AUTH === 'true') {
    req.dbUser = getOrCreateUser('dev-user', 'Dev');
    return next();
  }

  const result = validateInitData(initData, botToken);
  if (!result.ok || !result.user) {
    return res.status(401).json({ error: 'Telegram autentifikatsiyasi muvaffaqiyatsiz' });
  }

  req.dbUser = getOrCreateUser(String(result.user.id), result.user.first_name);
  next();
}

module.exports = { requireTelegramAuth, validateInitData };
