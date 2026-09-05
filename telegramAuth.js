const crypto = require('crypto');
const { getOrCreateUser, touchUserActivity } = require('./db');

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

async function requireTelegramAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || '';
  const botToken = process.env.BOT_TOKEN;

  try {
    // Faqat lokal test uchun: Telegramsiz sinash imkoniyati
    if (!initData && process.env.ALLOW_DEV_NO_AUTH === 'true') {
      req.dbUser = await getOrCreateUser('dev-user', 'Dev');
      return next();
    }

    const result = validateInitData(initData, botToken);
    if (!result.ok || !result.user) {
      return res.status(401).json({ error: 'Telegram autentifikatsiyasi muvaffaqiyatsiz' });
    }

    req.dbUser = await getOrCreateUser(String(result.user.id), result.user.first_name, result.user.username);

    if (req.dbUser.is_blocked) {
      return res.status(403).json({ error: "Sizning hisobingiz administrator tomonidan bloklangan" });
    }
    touchUserActivity(req.dbUser.id); // fon rejimida, javobni kutmaymiz

    next();
  } catch (err) {
    console.error('Auth xatosi:', err);
    res.status(500).json({ error: 'Server xatosi' });
  }
}

const { pool } = require('./db');
const { verifyToken } = require('./adminAuth');

async function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Tizimga kirish talab qilinadi' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Sessiya tugagan yoki noto\'g\'ri, qayta kiring' });
  }

  try {
    const result = await pool.query('SELECT id, username, role, permissions FROM admins WHERE id = $1', [decoded.adminId]);
    if (!result.rows[0]) {
      return res.status(401).json({ error: 'Admin hisobi topilmadi' });
    }
    req.admin = result.rows[0];
    next();
  } catch (err) {
    console.error('Admin auth xatosi:', err);
    res.status(500).json({ error: 'Server xatosi' });
  }
}

// Faqat Owner yoki ko'rsatilgan ruxsatga ega admin o'ta oladi
function requirePermission(key) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Tizimga kirish talab qilinadi' });
    if (req.admin.role === 'owner') return next();
    if (req.admin.permissions && req.admin.permissions[key] === true) return next();
    return res.status(403).json({ error: "Bu amal uchun ruxsatingiz yo'q" });
  };
}

module.exports = { requireTelegramAuth, validateInitData, requireAdminAuth, requirePermission };
