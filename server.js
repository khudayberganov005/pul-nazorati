require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, initDb } = require('./db');
const { requireTelegramAuth, requireAdminAuth, requirePermission } = require('./telegramAuth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let botInstance = null; // /admin/notifications/send uchun, initDb() tugagach to'ldiriladi

const api = express.Router();
api.use(requireTelegramAuth);

/* ---------- ADMIN: KIRISH (login) — bu ochiq, token talab qilmaydi ---------- */
const { hashPassword, verifyPassword, signToken } = require('./adminAuth');

app.post('/api/admin/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Login va parolni kiriting" });

    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = result.rows[0];
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
    }

    const token = signToken(admin.id);
    res.json({
      token,
      admin: { id: admin.id, username: admin.username, role: admin.role, permissions: admin.permissions }
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* MUHIM: admin router /api routerdan OLDIN ulanadi, aks holda '/api' prefiksi
   '/api/admin/*' so'rovlarini ham "yutib" oladi va noto'g'ri (Telegram) auth talab qiladi */
const admin = express.Router();
admin.use(requireAdminAuth);
app.use('/api/admin', admin);

admin.get('/auth/me', (req, res) => {
  res.json({ admin: req.admin });
});

/* ---------- ADMIN BOSHQARUVI (faqat Owner) ---------- */
admin.get('/admins', async (req, res) => {
  if (req.admin.role !== 'owner') return res.status(403).json({ error: "Faqat Owner ko'ra oladi" });
  try {
    const result = await pool.query('SELECT id, username, role, permissions, created_at FROM admins ORDER BY created_at ASC');
    res.json({ admins: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.post('/admins', async (req, res) => {
  if (req.admin.role !== 'owner') return res.status(403).json({ error: "Faqat Owner qo'sha oladi" });
  try {
    const { username, password, permissions } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Login va parol kerak" });
    const result = await pool.query(
      `INSERT INTO admins (username, password_hash, role, permissions) VALUES ($1,$2,'admin',$3) RETURNING id, username, role, permissions`,
      [username, hashPassword(password), JSON.stringify(permissions || {})]
    );
    await pool.query('INSERT INTO admin_logs (admin_username, action) VALUES ($1,$2)',
      [req.admin.username, `Yangi admin qo'shdi: ${username}`]);
    res.json({ admin: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Bu login band' });
    console.error(err); res.status(500).json({ error: 'Server xatosi' });
  }
});

admin.put('/admins/:id/permissions', async (req, res) => {
  if (req.admin.role !== 'owner') return res.status(403).json({ error: "Faqat Owner o'zgartira oladi" });
  try {
    const { permissions } = req.body;
    const result = await pool.query(
      'UPDATE admins SET permissions = $1 WHERE id = $2 AND role != \'owner\' RETURNING id, username, role, permissions',
      [JSON.stringify(permissions || {}), req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Topilmadi (yoki bu Owner)" });
    await pool.query('INSERT INTO admin_logs (admin_username, action) VALUES ($1,$2)',
      [req.admin.username, `${result.rows[0].username} ruxsatlarini o'zgartirdi`]);
    res.json({ admin: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.delete('/admins/:id', async (req, res) => {
  if (req.admin.role !== 'owner') return res.status(403).json({ error: "Faqat Owner o'chira oladi" });
  try {
    const target = await pool.query('SELECT username, role FROM admins WHERE id = $1', [req.params.id]);
    if (!target.rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    if (target.rows[0].role === 'owner') return res.status(400).json({ error: "Owner'ni o'chirib bo'lmaydi" });
    await pool.query('DELETE FROM admins WHERE id = $1', [req.params.id]);
    await pool.query('INSERT INTO admin_logs (admin_username, action) VALUES ($1,$2)',
      [req.admin.username, `Adminni o'chirdi: ${target.rows[0].username}`]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- ADMIN LOGLARI ---------- */
admin.get('/logs', requirePermission('adminLogs'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 200');
    res.json({ logs: result.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- KATEGORIYALAR (dinamik, admin boshqaradi) ---------- */
api.get('/categories', async (req, res) => {
  try {
    const type = req.query.type;
    const q = type
      ? await pool.query('SELECT * FROM categories WHERE type = $1 ORDER BY sort_order ASC, id ASC', [type])
      : await pool.query('SELECT * FROM categories ORDER BY type, sort_order ASC, id ASC');
    res.json({ categories: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- SOZLAMALAR (matnlar/ranglar, admin boshqaradi) ---------- */
api.get('/settings', async (req, res) => {
  try {
    const q = await pool.query('SELECT key, value FROM app_settings');
    const settings = {};
    q.rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- QOSHIMCHA SAHIFALAR (admin qo'shadi) ---------- */
api.get('/pages', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM content_pages ORDER BY sort_order ASC, id ASC');
    res.json({ pages: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- YORDAMCHI: davr uchun sana chegarasi ---------- */
function periodStartDate(period) {
  const d = new Date();
  if (period === 'week') d.setDate(d.getDate() - 6);
  else if (period === 'year') d.setFullYear(d.getFullYear() - 1);
  else d.setDate(d.getDate() - 27); // month => oxirgi 4 hafta
  return d.toISOString().split('T')[0];
}

/* ---------- SUMMARY (bosh sahifa: balans, daromad, xarajat) ---------- */
api.get('/summary', async (req, res) => {
  try {
    const userId = req.dbUser.id;
    const result = await pool.query(
      `SELECT type, COALESCE(SUM(amount),0)::int as total FROM transactions WHERE user_id = $1 GROUP BY type`,
      [userId]
    );
    let income = 0, expense = 0;
    result.rows.forEach(t => { if (t.type === 'income') income = t.total; else expense = t.total; });
    res.json({ balance: income - expense, income, expense });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- TRANZAKSIYA QO'SHISH ---------- */
api.post('/transactions', async (req, res) => {
  try {
    const { type, category, amount, date, comment, payment_type } = req.body;
    if (!['income', 'expense'].includes(type) || !category || !amount || !date) {
      return res.status(400).json({ error: 'Maydonlar to\'liq emas' });
    }
    const result = await pool.query(
      `INSERT INTO transactions (user_id, type, category, amount, date, comment, payment_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.dbUser.id, type, category, Math.round(Number(amount)), date, comment || null, payment_type || 'cash']
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- TRANZAKSIYALAR RO'YXATI ---------- */
api.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC LIMIT 30`,
      [req.dbUser.id]
    );
    res.json({ transactions: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

api.delete('/transactions/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM transactions WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.dbUser.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Tranzaksiya topilmadi' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- STATISTIKA (grafik uchun) ---------- */
api.get('/stats', async (req, res) => {
  try {
    const period = req.query.period || 'week';
    const userId = req.dbUser.id;
    const start = periodStartDate(period);

    let groupExpr;
    if (period === 'year') {
      groupExpr = `to_char(date::date, 'YYYY-MM')`;
    } else if (period === 'month') {
      groupExpr = `to_char(date::date, 'IYYY-IW')`;
    } else {
      groupExpr = `date`;
    }

    const result = await pool.query(
      `SELECT ${groupExpr} as bucket, type, COALESCE(SUM(amount),0)::int as total
       FROM transactions
       WHERE user_id = $1 AND date >= $2
       GROUP BY bucket, type
       ORDER BY bucket ASC`,
      [userId, start]
    );

    const buckets = {};
    result.rows.forEach(r => {
      if (!buckets[r.bucket]) buckets[r.bucket] = { income: 0, expense: 0 };
      buckets[r.bucket][r.type] = r.total;
    });

    const labels = Object.keys(buckets);
    res.json({
      labels,
      income: labels.map(l => buckets[l].income),
      expense: labels.map(l => buckets[l].expense)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- KATEGORIYA BO'YICHA TAHLIL (donut) ---------- */
api.get('/analysis', async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const userId = req.dbUser.id;
    const start = periodStartDate(period);

    const result = await pool.query(
      `SELECT category, COALESCE(SUM(amount),0)::int as total
       FROM transactions
       WHERE user_id = $1 AND type = 'expense' AND date >= $2
       GROUP BY category
       ORDER BY total DESC`,
      [userId, start]
    );
    res.json({ categories: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

/* ---------- MAQSADLAR ---------- */
api.get('/goals', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM goals WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.dbUser.id]
    );
    res.json({ goals: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

api.post('/goals', async (req, res) => {
  try {
    const { name, target, deadline } = req.body;
    if (!name || !target || Number(target) <= 0) {
      return res.status(400).json({ error: 'Maydonlar to\'liq emas' });
    }
    const result = await pool.query(
      `INSERT INTO goals (user_id, name, target, current, deadline) VALUES ($1,$2,$3,0,$4) RETURNING id`,
      [req.dbUser.id, name, Math.round(Number(target)), deadline || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

api.post('/goals/:id/contribute', async (req, res) => {
  try {
    const { amount } = req.body;
    const goalResult = await pool.query(
      `SELECT * FROM goals WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.dbUser.id]
    );
    const goal = goalResult.rows[0];
    if (!goal) return res.status(404).json({ error: 'Maqsad topilmadi' });

    const newCurrent = goal.current + Math.round(Number(amount || 0));
    await pool.query(`UPDATE goals SET current = $1 WHERE id = $2`, [newCurrent, goal.id]);
    res.json({ current: newCurrent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

api.delete('/goals/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM goals WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.dbUser.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Maqsad topilmadi' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

app.use('/api', api);

/* ================= ADMIN PANEL API'LARI (admin router yuqorida allaqachon ulangan) ================= */

/* --- Kategoriyalar va sahifalarni o'qish (admin panel uchun, Telegram auth kerak emas) --- */
admin.get('/categories', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM categories ORDER BY type, sort_order ASC, id ASC');
    res.json({ categories: q.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.get('/pages', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM content_pages ORDER BY sort_order ASC, id ASC');
    res.json({ pages: q.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* --- Umumiy ma'lumot (dashboard uchun) --- */
/* ---------- YORDAMCHI: admin davrlari uchun sana chegarasi ---------- */
function adminPeriodStartDate(period) {
  const d = new Date();
  if (period === 'today') d.setHours(0, 0, 0, 0);
  else if (period === '7d') d.setDate(d.getDate() - 6);
  else if (period === '30d') d.setDate(d.getDate() - 29);
  else if (period === '3m') d.setMonth(d.getMonth() - 3);
  else if (period === '1y') d.setFullYear(d.getFullYear() - 1);
  else d.setDate(d.getDate() - 6); // default 7d
  return d.toISOString().split('T')[0];
}

admin.get('/overview', requirePermission('statistics'), async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*)::int as c FROM users');
    const todayUsers = await pool.query("SELECT COUNT(*)::int as c FROM users WHERE created_at::date = CURRENT_DATE");
    const activeUsers = await pool.query("SELECT COUNT(*)::int as c FROM users WHERE last_active_at >= NOW() - INTERVAL '7 days'");
    const tx = await pool.query('SELECT COUNT(*)::int as c FROM transactions');
    const goals = await pool.query("SELECT COUNT(*)::int as c FROM goals WHERE status = 'active'");
    const totals = await pool.query(`SELECT type, COALESCE(SUM(amount),0)::int as total FROM transactions GROUP BY type`);
    let income = 0, expense = 0;
    totals.rows.forEach(t => { if (t.type === 'income') income = t.total; else expense = t.total; });

    res.json({
      users: users.rows[0].c,
      newUsersToday: todayUsers.rows[0].c,
      activeUsers: activeUsers.rows[0].c,
      transactions: tx.rows[0].c,
      goals: goals.rows[0].c,
      income, expense, balance: income - expense
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- ANALITIKA ---------- */
admin.get('/analytics', requirePermission('statistics'), async (req, res) => {
  try {
    const period = req.query.period || '7d';
    const start = adminPeriodStartDate(period);

    // Kunlik foydalanuvchilar o'sishi
    const growth = await pool.query(`
      SELECT created_at::date as d, COUNT(*)::int as c FROM users
      WHERE created_at::date >= $1 GROUP BY d ORDER BY d ASC
    `, [start]);

    // Daromad vs xarajat vaqt seriyasi
    const flow = await pool.query(`
      SELECT date, type, COALESCE(SUM(amount),0)::int as total FROM transactions
      WHERE date >= $1 GROUP BY date, type ORDER BY date ASC
    `, [start]);
    const flowMap = {};
    flow.rows.forEach(r => {
      if (!flowMap[r.date]) flowMap[r.date] = { income: 0, expense: 0 };
      flowMap[r.date][r.type] = r.total;
    });
    const flowLabels = Object.keys(flowMap).sort();

    // Eng ko'p ishlatiladigan kategoriyalar
    const topCats = await pool.query(`
      SELECT category, COUNT(*)::int as cnt, COALESCE(SUM(amount),0)::int as total
      FROM transactions WHERE date >= $1 GROUP BY category ORDER BY total DESC LIMIT 8
    `, [start]);

    // DAU / WAU / MAU
    const dau = await pool.query("SELECT COUNT(*)::int as c FROM users WHERE last_active_at >= NOW() - INTERVAL '1 day'");
    const wau = await pool.query("SELECT COUNT(*)::int as c FROM users WHERE last_active_at >= NOW() - INTERVAL '7 days'");
    const mau = await pool.query("SELECT COUNT(*)::int as c FROM users WHERE last_active_at >= NOW() - INTERVAL '30 days'");

    res.json({
      growth: growth.rows.map(r => ({ date: r.d, count: r.c })),
      flow: { labels: flowLabels, income: flowLabels.map(l => flowMap[l].income || 0), expense: flowLabels.map(l => flowMap[l].expense || 0) },
      topCategories: topCats.rows,
      dau: dau.rows[0].c, wau: wau.rows[0].c, mau: mau.rows[0].c
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- FOYDALANUVCHILAR ---------- */
admin.get('/users', requirePermission('users'), async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const filter = req.query.filter || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 15;
    const offset = (page - 1) * perPage;

    const conditions = [];
    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(LOWER(u.first_name) LIKE $${params.length} OR LOWER(u.username) LIKE $${params.length} OR u.telegram_id LIKE $${params.length})`);
    }
    if (filter === 'premium') conditions.push(`u.is_premium = true`);
    else if (filter === 'free') conditions.push(`u.is_premium = false`);
    else if (filter === 'active') conditions.push(`u.last_active_at >= NOW() - INTERVAL '7 days'`);
    else if (filter === 'inactive') conditions.push(`u.last_active_at < NOW() - INTERVAL '7 days'`);

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countQ = await pool.query(`SELECT COUNT(*)::int as c FROM users u ${whereClause}`, params);
    const total = countQ.rows[0].c;

    const dataQ = await pool.query(`
      SELECT u.*,
        COALESCE((SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id), 0)::int as tx_count,
        COALESCE((SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) FROM transactions t WHERE t.user_id = u.id), 0)::int as total_income,
        COALESCE((SELECT SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) FROM transactions t WHERE t.user_id = u.id), 0)::int as total_expense,
        COALESCE((SELECT COUNT(*) FROM goals g WHERE g.user_id = u.id), 0)::int as goals_count
      FROM users u ${whereClause}
      ORDER BY COALESCE(NULLIF(u.username,''), u.first_name, '') ASC
      LIMIT ${perPage} OFFSET ${offset}
    `, params);

    res.json({ users: dataQ.rows, total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.get('/users/:id', requirePermission('users'), async (req, res) => {
  try {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user.rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    const tx = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.params.id]);
    const goals = await pool.query('SELECT * FROM goals WHERE user_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ user: user.rows[0], transactions: tx.rows, goals: goals.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.put('/users/:id/block', requirePermission('users'), async (req, res) => {
  try {
    const u = await pool.query('UPDATE users SET is_blocked = true WHERE id = $1 RETURNING username, first_name', [req.params.id]);
    await pool.query('INSERT INTO admin_logs (admin_username, target_user_id, action) VALUES ($1,$2,$3)',
      [req.admin.username, req.params.id, `Foydalanuvchini bloklashdi: ${u.rows[0]?.username || u.rows[0]?.first_name || req.params.id}`]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.put('/users/:id/unblock', requirePermission('users'), async (req, res) => {
  try {
    const u = await pool.query('UPDATE users SET is_blocked = false WHERE id = $1 RETURNING username, first_name', [req.params.id]);
    await pool.query('INSERT INTO admin_logs (admin_username, target_user_id, action) VALUES ($1,$2,$3)',
      [req.admin.username, req.params.id, `Foydalanuvchini aktivlashtirdi: ${u.rows[0]?.username || u.rows[0]?.first_name || req.params.id}`]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- PREMIUM BERISH / OLIB TASHLASH ---------- */
const PREMIUM_DURATIONS = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

admin.post('/users/:id/premium', requirePermission('premium'), async (req, res) => {
  try {
    const { duration, customDays } = req.body; // duration: '7d'|'30d'|'90d'|'1y'|'lifetime'|'custom'
    let until = null;
    let planLabel = '';

    if (duration === 'lifetime') {
      until = null; // muddatsiz
      planLabel = 'Umrbod';
    } else if (duration === 'custom') {
      const days = Number(customDays);
      if (!days || days <= 0) return res.status(400).json({ error: "Kunlar sonini kiriting" });
      until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      planLabel = `${days} kun (maxsus)`;
    } else if (PREMIUM_DURATIONS[duration]) {
      until = new Date(Date.now() + PREMIUM_DURATIONS[duration]);
      planLabel = duration;
    } else {
      return res.status(400).json({ error: "Noto'g'ri muddat" });
    }

    const u = await pool.query(
      `UPDATE users SET is_premium = true, premium_until = $1, premium_plan = $2, premium_source = 'admin' WHERE id = $3 RETURNING username, first_name, telegram_id`,
      [until, planLabel, req.params.id]
    );
    if (!u.rows[0]) return res.status(404).json({ error: 'Topilmadi' });

    await pool.query('INSERT INTO admin_logs (admin_username, target_user_id, action) VALUES ($1,$2,$3)',
      [req.admin.username, req.params.id, `${u.rows[0].username || u.rows[0].first_name}ga ${planLabel} Premium berdi`]);

    if (botInstance) {
      botInstance.sendMessage(u.rows[0].telegram_id, `🎉 Sizga Premium faollashtirildi: ${planLabel}!`).catch(() => {});
    }
    res.json({ ok: true, until, planLabel });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.delete('/users/:id/premium', requirePermission('premium'), async (req, res) => {
  try {
    const u = await pool.query(
      `UPDATE users SET is_premium = false, premium_until = NULL, premium_plan = NULL, premium_source = NULL WHERE id = $1 RETURNING username, first_name`,
      [req.params.id]
    );
    if (!u.rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    await pool.query('INSERT INTO admin_logs (admin_username, target_user_id, action) VALUES ($1,$2,$3)',
      [req.admin.username, req.params.id, `${u.rows[0].username || u.rows[0].first_name}dan Premiumni olib tashladi`]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.get('/transactions', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT t.*, u.first_name, u.telegram_id
      FROM transactions t JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC LIMIT 200
    `);
    res.json({ transactions: q.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- MAQSADLAR (admin ko'rinishi) ---------- */
admin.get('/goals', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT g.*, u.first_name, u.telegram_id
      FROM goals g JOIN users u ON u.id = g.user_id
      ORDER BY g.created_at DESC LIMIT 200
    `);
    res.json({ goals: q.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- XABARLAR (broadcast) ---------- */
admin.post('/notifications/send', requirePermission('notifications'), async (req, res) => {
  try {
    const { segment, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Xabar matni bo\'sh' });
    if (!botInstance) return res.status(503).json({ error: 'Bot hali ishga tushmagan' });

    let query = 'SELECT telegram_id FROM users WHERE is_blocked = false';
    if (segment === 'active') query += " AND last_active_at >= NOW() - INTERVAL '7 days'";
    else if (segment === 'new') query += " AND created_at >= NOW() - INTERVAL '7 days'";
    else if (segment === 'inactive') query += " AND last_active_at < NOW() - INTERVAL '30 days'";

    const users = await pool.query(query);
    let sent = 0, failed = 0;
    for (const u of users.rows) {
      try {
        await botInstance.sendMessage(u.telegram_id, text);
        sent++;
      } catch (e) { failed++; }
    }

    await pool.query(
      'INSERT INTO notifications_log (segment, message, sent_count, failed_count) VALUES ($1,$2,$3,$4)',
      [segment || 'all', text, sent, failed]
    );
    res.json({ sent, failed, total: users.rows.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.get('/notifications/history', requirePermission('notifications'), async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM notifications_log ORDER BY created_at DESC LIMIT 30');
    res.json({ history: q.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* ---------- SYSTEM ---------- */
const SERVER_STARTED_AT = Date.now();
admin.get('/system/status', async (req, res) => {
  let dbOk = false;
  try { await pool.query('SELECT 1'); dbOk = true; } catch (e) { dbOk = false; }
  res.json({
    db: dbOk ? 'online' : 'error',
    bot: botInstance ? 'online' : 'offline',
    api: 'online',
    uptimeSeconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000)
  });
});

/* --- Kategoriyalar CRUD (emoji dizayn maydonlari bilan) --- */
admin.post('/categories', async (req, res) => {
  try {
    const { type, name, color, icon_key, sort_order, emoji, emoji_size, emoji_bg, emoji_radius, is_active } = req.body;
    if (!['income', 'expense'].includes(type) || !name) return res.status(400).json({ error: "Maydonlar to'liq emas" });
    const q = await pool.query(
      `INSERT INTO categories (type, name, color, icon_key, sort_order, emoji, emoji_size, emoji_bg, emoji_radius, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [type, name, color || '#FFB020', icon_key || 'dots', sort_order || 0,
       emoji || null, emoji_size || 32, emoji_bg || null, emoji_radius ?? 14, is_active !== false]
    );
    res.json({ category: q.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.put('/categories/:id', async (req, res) => {
  try {
    const { name, color, icon_key, sort_order, emoji, emoji_size, emoji_bg, emoji_radius, is_active } = req.body;
    const q = await pool.query(
      `UPDATE categories SET name=$1, color=$2, icon_key=$3, sort_order=$4,
       emoji=$5, emoji_size=$6, emoji_bg=$7, emoji_radius=$8, is_active=$9
       WHERE id=$10 RETURNING *`,
      [name, color, icon_key, sort_order || 0,
       emoji || null, emoji_size || 32, emoji_bg || null, emoji_radius ?? 14, is_active !== false,
       req.params.id]
    );
    if (!q.rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ category: q.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.delete('/categories/:id', async (req, res) => {
  try {
    const q = await pool.query('DELETE FROM categories WHERE id=$1', [req.params.id]);
    if (q.rowCount === 0) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* --- Sozlamalar (matn/rang) CRUD --- */
admin.get('/settings', async (req, res) => {
  try {
    const q = await pool.query('SELECT key, value FROM app_settings ORDER BY key ASC');
    res.json({ settings: q.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.put('/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
      [req.params.key, value]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

/* --- Qo'shimcha sahifalar CRUD --- */
admin.post('/pages', async (req, res) => {
  try {
    const { title, body, sort_order } = req.body;
    if (!title || !body) return res.status(400).json({ error: "Maydonlar to'liq emas" });
    const q = await pool.query(
      'INSERT INTO content_pages (title, body, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [title, body, sort_order || 0]
    );
    res.json({ page: q.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.put('/pages/:id', async (req, res) => {
  try {
    const { title, body, sort_order } = req.body;
    const q = await pool.query(
      'UPDATE content_pages SET title=$1, body=$2, sort_order=$3 WHERE id=$4 RETURNING *',
      [title, body, sort_order || 0, req.params.id]
    );
    if (!q.rows[0]) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ page: q.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.delete('/pages/:id', async (req, res) => {
  try {
    const q = await pool.query('DELETE FROM content_pages WHERE id=$1', [req.params.id]);
    if (q.rowCount === 0) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server ${PORT}-portda ishga tushdi`));
    botInstance = require('./bot');
  })
  .catch(err => {
    console.error("Ma'lumotlar bazasiga ulanishda xatolik:", err);
    process.exit(1);
  });
