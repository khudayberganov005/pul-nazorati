const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: connectionString && !connectionString.includes('railway.internal')
    ? { rejectUnauthorized: false }
    : false
});

// Mavjud jadvalga ustun bo'lmasa qo'shadi (eski ma'lumotlarga tegmaydi)
async function addColumnIfMissing(table, column, definition) {
  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    [table, column]
  );
  if (check.rows.length === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      first_name TEXT,
      card_label TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      category TEXT NOT NULL,
      amount INTEGER NOT NULL,
      date TEXT NOT NULL,
      comment TEXT,
      payment_type TEXT NOT NULL DEFAULT 'cash',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS goals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      target INTEGER NOT NULL,
      current INTEGER NOT NULL DEFAULT 0,
      deadline TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#FFB020',
      icon_key TEXT NOT NULL DEFAULT 'dots',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_pages (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Boshlang'ich kategoriyalarni bir marta urug'lash (agar jadval bo'sh bo'lsa)
  const catCount = await pool.query('SELECT COUNT(*)::int as c FROM categories');
  if (catCount.rows[0].c === 0) {
    const defaults = [
      ['income', 'Uy', '#00E5FF', 'home', 1],
      ['income', 'Ish haqi', '#00C853', 'briefcase', 2],
      ['income', "Qo'shimcha daromad", '#7C4DFF', 'plusCircle', 3],
      ['income', 'Boshqa', '#FFB020', 'dots', 4],
      ['expense', 'Oziq-ovqat', '#FF5252', 'basket', 1],
      ['expense', 'Transport', '#00B8D9', 'car', 2],
      ['expense', 'Boshqa', '#FFB020', 'dots', 3],
    ];
    for (const [type, name, color, icon_key, sort_order] of defaults) {
      await pool.query(
        'INSERT INTO categories (type, name, color, icon_key, sort_order) VALUES ($1,$2,$3,$4,$5)',
        [type, name, color, icon_key, sort_order]
      );
    }
  }

  // Boshlang'ich matn/rang sozlamalarini bir marta urug'lash
  const defaultSettings = {
    hero_eyebrow: 'Umumiy balans',
    add_panel_title: 'Pul kiritish',
    tx_list_title: "So'nggi tranzaksiyalar",
    nav_home_label: 'Bosh sahifa',
    nav_stats_label: 'Statistika',
    nav_goals_label: 'Maqsadlar',
    nav_analysis_label: 'Tahlil',
    nav_more_label: "Ko'proq",
    stats_title: 'Statistika',
    stats_sub: 'Daromad va xarajatlaringiz dinamikasi',
    goals_title: 'Maqsadlar',
    goals_sub: "Pul yig'ish maqsadingizni yarating va kuzating",
    analysis_title: 'Pul qayerga ketyapti',
    analysis_sub: "Xarajatlar kategoriyalar bo'yicha taqsimoti · bu oy",
    submit_btn_label: "Qo'shish",
    goal_create_btn_label: 'Maqsad yaratish',
    color_bg: '#0B0E16',
    color_panel: '#131722',
    color_income: '#00C853',
    color_expense: '#FF5252',
    color_cyan: '#00E5FF',
    color_violet: '#7C4DFF',
    color_amber: '#FFB020',
    app_name: 'Pul Nazorati',
    currency: "so'm"
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }

  console.log("Ma'lumotlar bazasi jadvallari tayyor (PostgreSQL).");

  // ---- YANGI: admin dashboard uchun qo'shimcha ustunlar (mavjudni buzmasdan) ----
  await addColumnIfMissing('users', 'is_blocked', 'is_blocked BOOLEAN NOT NULL DEFAULT false');
  await addColumnIfMissing('users', 'last_active_at', 'last_active_at TIMESTAMPTZ DEFAULT NOW()');

  await addColumnIfMissing('categories', 'emoji', 'emoji TEXT');
  await addColumnIfMissing('categories', 'emoji_size', 'emoji_size INTEGER NOT NULL DEFAULT 32');
  await addColumnIfMissing('categories', 'emoji_bg', 'emoji_bg TEXT');
  await addColumnIfMissing('categories', 'emoji_radius', 'emoji_radius INTEGER NOT NULL DEFAULT 14');
  await addColumnIfMissing('categories', 'is_active', 'is_active BOOLEAN NOT NULL DEFAULT true');

  await addColumnIfMissing('goals', 'status', "status TEXT NOT NULL DEFAULT 'active'");
  await addColumnIfMissing('goals', 'started_at', 'started_at TIMESTAMPTZ DEFAULT NOW()');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications_log (
      id SERIAL PRIMARY KEY,
      segment TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("Admin panel uchun qo'shimcha ustunlar tayyor.");
}

async function getOrCreateUser(telegramId, firstName) {
  const existing = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pool.query(
    'INSERT INTO users (telegram_id, first_name) VALUES ($1, $2) RETURNING *',
    [telegramId, firstName || null]
  );
  return inserted.rows[0];
}

// Har API so'rovda foydalanuvchining oxirgi faollik vaqtini yangilaydi
async function touchUserActivity(userId) {
  try {
    await pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [userId]);
  } catch (err) {
    console.error('Faollik vaqtini yangilashda xatolik:', err);
  }
}

module.exports = { pool, initDb, getOrCreateUser, touchUserActivity };
