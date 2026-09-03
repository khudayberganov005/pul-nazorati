require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { pool, initDb } = require('./db');
const { requireTelegramAuth, requireAdminAuth } = require('./telegramAuth');

const app = express();

/* =========================================================
   ASOSIY SOZLAMALAR
========================================================= */

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*
  public papkasidagi:
  index.html
  admin.html
  css
  js
  images
  svg
  va boshqa fayllarni serve qiladi
*/
app.use(express.static(PUBLIC_DIR));

/* =========================================================
   FRONTEND ROUTES
========================================================= */

/* Asosiy Web App */
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* Admin Panel */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

/* Health check */
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'pul-nazorati',
    time: new Date().toISOString()
  });
});

/* =========================================================
   USER API
========================================================= */

const api = express.Router();

/*
  Telegram Web App autentifikatsiyasi.
  /api ostidagi barcha user endpointlar uchun ishlaydi.
*/
api.use(requireTelegramAuth);


/* =========================================================
   KATEGORIYALAR
========================================================= */

api.get('/categories', async (req, res) => {
  try {
    const type = req.query.type;

    let result;

    if (type) {
      result = await pool.query(
        `
        SELECT *
        FROM categories
        WHERE type = $1
        ORDER BY sort_order ASC, id ASC
        `,
        [type]
      );
    } else {
      result = await pool.query(
        `
        SELECT *
        FROM categories
        ORDER BY type, sort_order ASC, id ASC
        `
      );
    }

    res.json({
      categories: result.rows
    });

  } catch (err) {
    console.error('GET /api/categories:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   SETTINGS
========================================================= */

api.get('/settings', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT key, value
      FROM app_settings
      ORDER BY key ASC
      `
    );

    const settings = {};

    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });

    res.json({
      settings
    });

  } catch (err) {
    console.error('GET /api/settings:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   CONTENT PAGES
========================================================= */

api.get('/pages', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM content_pages
      ORDER BY sort_order ASC, id ASC
      `
    );

    res.json({
      pages: result.rows
    });

  } catch (err) {
    console.error('GET /api/pages:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   PERIOD HELPER
========================================================= */

function periodStartDate(period) {
  const d = new Date();

  if (period === 'week') {
    d.setDate(d.getDate() - 6);
  } else if (period === 'year') {
    d.setFullYear(d.getFullYear() - 1);
  } else {
    // month
    d.setDate(d.getDate() - 27);
  }

  return d.toISOString().split('T')[0];
}


/* =========================================================
   SUMMARY
========================================================= */

api.get('/summary', async (req, res) => {
  try {
    const userId = req.dbUser.id;

    const result = await pool.query(
      `
      SELECT
        type,
        COALESCE(SUM(amount), 0)::int AS total
      FROM transactions
      WHERE user_id = $1
      GROUP BY type
      `,
      [userId]
    );

    let income = 0;
    let expense = 0;

    result.rows.forEach(row => {
      if (row.type === 'income') {
        income = Number(row.total);
      }

      if (row.type === 'expense') {
        expense = Number(row.total);
      }
    });

    res.json({
      balance: income - expense,
      income,
      expense
    });

  } catch (err) {
    console.error('GET /api/summary:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADD TRANSACTION
========================================================= */

api.post('/transactions', async (req, res) => {
  try {
    const {
      type,
      category,
      amount,
      date,
      comment,
      payment_type
    } = req.body;

    if (
      !['income', 'expense'].includes(type) ||
      !category ||
      amount === undefined ||
      amount === null ||
      Number(amount) <= 0 ||
      !date
    ) {
      return res.status(400).json({
        error: "Maydonlar to'liq emas"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO transactions
      (
        user_id,
        type,
        category,
        amount,
        date,
        comment,
        payment_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        req.dbUser.id,
        type,
        category,
        Math.round(Number(amount)),
        date,
        comment || null,
        payment_type || 'cash'
      ]
    );

    res.json({
      id: result.rows[0].id
    });

  } catch (err) {
    console.error('POST /api/transactions:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   TRANSACTIONS LIST
========================================================= */

api.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM transactions
      WHERE user_id = $1
      ORDER BY date DESC, created_at DESC
      LIMIT 30
      `,
      [req.dbUser.id]
    );

    res.json({
      transactions: result.rows
    });

  } catch (err) {
    console.error('GET /api/transactions:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   DELETE TRANSACTION
========================================================= */

api.delete('/transactions/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM transactions
      WHERE id = $1
      AND user_id = $2
      `,
      [
        req.params.id,
        req.dbUser.id
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Tranzaksiya topilmadi'
      });
    }

    res.json({
      ok: true
    });

  } catch (err) {
    console.error('DELETE /api/transactions:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   STATISTICS
========================================================= */

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
      `
      SELECT
        ${groupExpr} AS bucket,
        type,
        COALESCE(SUM(amount), 0)::int AS total
      FROM transactions
      WHERE user_id = $1
      AND date >= $2
      GROUP BY bucket, type
      ORDER BY bucket ASC
      `,
      [
        userId,
        start
      ]
    );

    const buckets = {};

    result.rows.forEach(row => {
      if (!buckets[row.bucket]) {
        buckets[row.bucket] = {
          income: 0,
          expense: 0
        };
      }

      buckets[row.bucket][row.type] = Number(row.total);
    });

    const labels = Object.keys(buckets);

    res.json({
      labels,
      income: labels.map(label => buckets[label].income),
      expense: labels.map(label => buckets[label].expense)
    });

  } catch (err) {
    console.error('GET /api/stats:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ANALYSIS
========================================================= */

api.get('/analysis', async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const userId = req.dbUser.id;

    const start = periodStartDate(period);

    const result = await pool.query(
      `
      SELECT
        category,
        COALESCE(SUM(amount), 0)::int AS total
      FROM transactions
      WHERE user_id = $1
      AND type = 'expense'
      AND date >= $2
      GROUP BY category
      ORDER BY total DESC
      `,
      [
        userId,
        start
      ]
    );

    res.json({
      categories: result.rows
    });

  } catch (err) {
    console.error('GET /api/analysis:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   GOALS
========================================================= */

api.get('/goals', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM goals
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.dbUser.id]
    );

    res.json({
      goals: result.rows
    });

  } catch (err) {
    console.error('GET /api/goals:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   CREATE GOAL
========================================================= */

api.post('/goals', async (req, res) => {
  try {
    const {
      name,
      target,
      deadline
    } = req.body;

    if (
      !name ||
      !target ||
      Number(target) <= 0
    ) {
      return res.status(400).json({
        error: "Maydonlar to'liq emas"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO goals
      (
        user_id,
        name,
        target,
        current,
        deadline
      )
      VALUES ($1, $2, $3, 0, $4)
      RETURNING id
      `,
      [
        req.dbUser.id,
        name,
        Math.round(Number(target)),
        deadline || null
      ]
    );

    res.json({
      id: result.rows[0].id
    });

  } catch (err) {
    console.error('POST /api/goals:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   GOAL CONTRIBUTION
========================================================= */

api.post('/goals/:id/contribute', async (req, res) => {
  try {
    const amount = Math.round(
      Number(req.body.amount || 0)
    );

    if (amount <= 0) {
      return res.status(400).json({
        error: "Summa noto'g'ri"
      });
    }

    const goalResult = await pool.query(
      `
      SELECT *
      FROM goals
      WHERE id = $1
      AND user_id = $2
      `,
      [
        req.params.id,
        req.dbUser.id
      ]
    );

    const goal = goalResult.rows[0];

    if (!goal) {
      return res.status(404).json({
        error: 'Maqsad topilmadi'
      });
    }

    const newCurrent =
      Number(goal.current) + amount;

    await pool.query(
      `
      UPDATE goals
      SET current = $1
      WHERE id = $2
      `,
      [
        newCurrent,
        goal.id
      ]
    );

    res.json({
      current: newCurrent
    });

  } catch (err) {
    console.error('POST /api/goals/:id/contribute:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   DELETE GOAL
========================================================= */

api.delete('/goals/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM goals
      WHERE id = $1
      AND user_id = $2
      `,
      [
        req.params.id,
        req.dbUser.id
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Maqsad topilmadi'
      });
    }

    res.json({
      ok: true
    });

  } catch (err) {
    console.error('DELETE /api/goals:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   USER API ULASH
========================================================= */

app.use('/api', api);


/* =========================================================
   ADMIN API
========================================================= */

const admin = express.Router();

admin.use(requireAdminAuth);


/* =========================================================
   ADMIN CATEGORIES
========================================================= */

admin.get('/categories', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM categories
      ORDER BY type, sort_order ASC, id ASC
      `
    );

    res.json({
      categories: result.rows
    });

  } catch (err) {
    console.error('GET /api/admin/categories:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN PAGES
========================================================= */

admin.get('/pages', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM content_pages
      ORDER BY sort_order ASC, id ASC
      `
    );

    res.json({
      pages: result.rows
    });

  } catch (err) {
    console.error('GET /api/admin/pages:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN OVERVIEW
========================================================= */

admin.get('/overview', async (req, res) => {
  try {
    const users = await pool.query(
      `SELECT COUNT(*)::int AS c FROM users`
    );

    const transactions = await pool.query(
      `SELECT COUNT(*)::int AS c FROM transactions`
    );

    const goals = await pool.query(
      `SELECT COUNT(*)::int AS c FROM goals`
    );

    res.json({
      users: users.rows[0].c,
      transactions: transactions.rows[0].c,
      goals: goals.rows[0].c
    });

  } catch (err) {
    console.error('GET /api/admin/overview:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN USERS
========================================================= */

admin.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM users
      ORDER BY created_at DESC
      `
    );

    res.json({
      users: result.rows
    });

  } catch (err) {
    console.error('GET /api/admin/users:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN TRANSACTIONS
========================================================= */

admin.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        t.*,
        u.first_name,
        u.telegram_id
      FROM transactions t
      JOIN users u
        ON u.id = t.user_id
      ORDER BY t.created_at DESC
      LIMIT 200
      `
    );

    res.json({
      transactions: result.rows
    });

  } catch (err) {
    console.error('GET /api/admin/transactions:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN CREATE CATEGORY
========================================================= */

admin.post('/categories', async (req, res) => {
  try {
    const {
      type,
      name,
      color,
      icon_key,
      sort_order
    } = req.body;

    if (
      !['income', 'expense'].includes(type) ||
      !name
    ) {
      return res.status(400).json({
        error: "Maydonlar to'liq emas"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO categories
      (
        type,
        name,
        color,
        icon_key,
        sort_order
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        type,
        name,
        color || '#FFB020',
        icon_key || 'dots',
        Number(sort_order) || 0
      ]
    );

    res.json({
      category: result.rows[0]
    });

  } catch (err) {
    console.error('POST /api/admin/categories:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN UPDATE CATEGORY
========================================================= */

admin.put('/categories/:id', async (req, res) => {
  try {
    const {
      name,
      color,
      icon_key,
      sort_order
    } = req.body;

    const result = await pool.query(
      `
      UPDATE categories
      SET
        name = $1,
        color = $2,
        icon_key = $3,
        sort_order = $4
      WHERE id = $5
      RETURNING *
      `,
      [
        name,
        color,
        icon_key,
        Number(sort_order) || 0,
        req.params.id
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        error: 'Topilmadi'
      });
    }

    res.json({
      category: result.rows[0]
    });

  } catch (err) {
    console.error('PUT /api/admin/categories:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN DELETE CATEGORY
========================================================= */

admin.delete('/categories/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM categories
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Topilmadi'
      });
    }

    res.json({
      ok: true
    });

  } catch (err) {
    console.error('DELETE /api/admin/categories:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN SETTINGS
========================================================= */

admin.get('/settings', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT key, value
      FROM app_settings
      ORDER BY key ASC
      `
    );

    res.json({
      settings: result.rows
    });

  } catch (err) {
    console.error('GET /api/admin/settings:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN UPDATE SETTING
========================================================= */

admin.put('/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;

    await pool.query(
      `
      INSERT INTO app_settings
      (
        key,
        value
      )
      VALUES ($1, $2)
      ON CONFLICT (key)
      DO UPDATE SET value = $2
      `,
      [
        req.params.key,
        value
      ]
    );

    res.json({
      ok: true
    });

  } catch (err) {
    console.error('PUT /api/admin/settings:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN CREATE PAGE
========================================================= */

admin.post('/pages', async (req, res) => {
  try {
    const {
      title,
      body,
      sort_order
    } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        error: "Maydonlar to'liq emas"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO content_pages
      (
        title,
        body,
        sort_order
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [
        title,
        body,
        Number(sort_order) || 0
      ]
    );

    res.json({
      page: result.rows[0]
    });

  } catch (err) {
    console.error('POST /api/admin/pages:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN UPDATE PAGE
========================================================= */

admin.put('/pages/:id', async (req, res) => {
  try {
    const {
      title,
      body,
      sort_order
    } = req.body;

    const result = await pool.query(
      `
      UPDATE content_pages
      SET
        title = $1,
        body = $2,
        sort_order = $3
      WHERE id = $4
      RETURNING *
      `,
      [
        title,
        body,
        Number(sort_order) || 0,
        req.params.id
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        error: 'Topilmadi'
      });
    }

    res.json({
      page: result.rows[0]
    });

  } catch (err) {
    console.error('PUT /api/admin/pages:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN DELETE PAGE
========================================================= */

admin.delete('/pages/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM content_pages
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Topilmadi'
      });
    }

    res.json({
      ok: true
    });

  } catch (err) {
    console.error('DELETE /api/admin/pages:', err);

    res.status(500).json({
      error: 'Server xatosi'
    });
  }
});


/* =========================================================
   ADMIN API ULASH
========================================================= */

app.use('/api/admin', admin);


/* =========================================================
   404 HANDLER
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    error: 'Route topilmadi',
    path: req.path
  });
});


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);

  res.status(500).json({
    error: 'Server xatosi'
  });
});


/* =========================================================
   DATABASE + SERVER
========================================================= */

initDb()
  .then(() => {

    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `Server ${PORT}-portda ishga tushdi`
      );
    });

    /*
      Bot server muvaffaqiyatli ishga tushgandan
      keyin ishga tushadi.
    */
    try {
      require('./bot');
      console.log('Telegram bot ishga tushirishga yuborildi');
    } catch (err) {
      console.error(
        'Telegram botni ishga tushirishda xatolik:',
        err
      );
    }

  })
  .catch(err => {

    console.error(
      "Ma'lumotlar bazasiga ulanishda xatolik:",
      err
    );

    process.exit(1);
  });
