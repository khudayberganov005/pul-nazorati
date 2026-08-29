require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, initDb } = require('./db');
const { requireTelegramAuth } = require('./telegramAuth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const api = express.Router();
api.use(requireTelegramAuth);

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
