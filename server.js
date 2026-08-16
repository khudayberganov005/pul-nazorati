require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { db } = require('./db');
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
api.get('/summary', (req, res) => {
  const userId = req.dbUser.id;

  const totals = db.prepare(`
    SELECT type, COALESCE(SUM(amount),0) as total
    FROM transactions WHERE user_id = ?
    GROUP BY type
  `).all(userId);

  let income = 0, expense = 0;
  totals.forEach(t => { if (t.type === 'income') income = t.total; else expense = t.total; });

  res.json({ balance: income - expense, income, expense });
});

/* ---------- TRANZAKSIYA QO'SHISH ---------- */
api.post('/transactions', (req, res) => {
  const { type, category, amount, date, comment } = req.body;
  if (!['income', 'expense'].includes(type) || !category || !amount || !date) {
    return res.status(400).json({ error: 'Maydonlar to\'liq emas' });
  }
  const info = db.prepare(`
    INSERT INTO transactions (user_id, type, category, amount, date, comment)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.dbUser.id, type, category, Math.round(Number(amount)), date, comment || null);

  res.json({ id: info.lastInsertRowid });
});

/* ---------- STATISTIKA (grafik uchun) ---------- */
api.get('/stats', (req, res) => {
  const period = req.query.period || 'week';
  const userId = req.dbUser.id;
  const start = periodStartDate(period);

  let groupExpr, labelFormat;
  if (period === 'year') {
    groupExpr = "strftime('%Y-%m', date)";
  } else if (period === 'month') {
    // haftalar bo'yicha (ISO hafta raqami)
    groupExpr = "strftime('%Y-%W', date)";
  } else {
    groupExpr = "date";
  }

  const rows = db.prepare(`
    SELECT ${groupExpr} as bucket, type, COALESCE(SUM(amount),0) as total
    FROM transactions
    WHERE user_id = ? AND date >= ?
    GROUP BY bucket, type
    ORDER BY bucket ASC
  `).all(userId, start);

  const buckets = {};
  rows.forEach(r => {
    if (!buckets[r.bucket]) buckets[r.bucket] = { income: 0, expense: 0 };
    buckets[r.bucket][r.type] = r.total;
  });

  const labels = Object.keys(buckets);
  res.json({
    labels,
    income: labels.map(l => buckets[l].income),
    expense: labels.map(l => buckets[l].expense)
  });
});

/* ---------- KATEGORIYA BO'YICHA TAHLIL (donut) ---------- */
api.get('/analysis', (req, res) => {
  const period = req.query.period || 'month';
  const userId = req.dbUser.id;
  const start = periodStartDate(period);

  const rows = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) as total
    FROM transactions
    WHERE user_id = ? AND type = 'expense' AND date >= ?
    GROUP BY category
    ORDER BY total DESC
  `).all(userId, start);

  res.json({ categories: rows });
});

/* ---------- MAQSADLAR ---------- */
api.get('/goals', (req, res) => {
  const goals = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC').all(req.dbUser.id);
  res.json({ goals });
});

api.post('/goals', (req, res) => {
  const { name, target } = req.body;
  if (!name || !target || Number(target) <= 0) {
    return res.status(400).json({ error: 'Maydonlar to\'liq emas' });
  }
  const info = db.prepare('INSERT INTO goals (user_id, name, target, current) VALUES (?, ?, ?, 0)')
    .run(req.dbUser.id, name, Math.round(Number(target)));
  res.json({ id: info.lastInsertRowid });
});

api.post('/goals/:id/contribute', (req, res) => {
  const { amount } = req.body;
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.dbUser.id);
  if (!goal) return res.status(404).json({ error: 'Maqsad topilmadi' });

  const newCurrent = goal.current + Math.round(Number(amount || 0));
  db.prepare('UPDATE goals SET current = ? WHERE id = ?').run(newCurrent, goal.id);
  res.json({ current: newCurrent });
});

app.use('/api', api);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ${PORT}-portda ishga tushdi`));

// Telegram botni ham shu jarayonda ishga tushiramiz
require('./bot');
