require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, initDb } = require('./db');
const { requireTelegramAuth, requireAdminAuth } = require('./telegramAuth');

const app = express();

app.use(cors());
app.use(express.json());

const publicPath = path.join(__dirname, 'public');

app.use(express.static(publicPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicPath, 'admin.html'));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'pul-nazorati'
  });
});

const api = express.Router();
api.use(requireTelegramAuth);

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

/* ================= ADMIN PANEL API'LARI ================= */
const admin = express.Router();
admin.use(requireAdminAuth);

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
admin.get('/overview', async (req, res) => {
  try {
    const users = await pool.query('SELECT COUNT(*)::int as c FROM users');
    const tx = await pool.query('SELECT COUNT(*)::int as c FROM transactions');
    const goals = await pool.query('SELECT COUNT(*)::int as c FROM goals');
    res.json({ users: users.rows[0].c, transactions: tx.rows[0].c, goals: goals.rows[0].c });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.get('/users', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    res.json({ users: q.rows });
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

/* --- Kategoriyalar CRUD --- */
admin.post('/categories', async (req, res) => {
  try {
    const { type, name, color, icon_key, sort_order } = req.body;
    if (!['income', 'expense'].includes(type) || !name) return res.status(400).json({ error: "Maydonlar to'liq emas" });
    const q = await pool.query(
      'INSERT INTO categories (type, name, color, icon_key, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [type, name, color || '#FFB020', icon_key || 'dots', sort_order || 0]
    );
    res.json({ category: q.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server xatosi' }); }
});

admin.put('/categories/:id', async (req, res) => {
  try {
    const { name, color, icon_key, sort_order } = req.body;
    const q = await pool.query(
      'UPDATE categories SET name=$1, color=$2, icon_key=$3, sort_order=$4 WHERE id=$5 RETURNING *',
      [name, color, icon_key, sort_order || 0, req.params.id]
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

app.use('/api/admin', admin);

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server ${PORT}-portda ishga tushdi`));
    require('./bot');
  })
  .catch(err => {
    console.error("Ma'lumotlar bazasiga ulanishda xatolik:", err);
    process.exit(1);
  });
