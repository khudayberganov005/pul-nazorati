const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    first_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMconst { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString,
  ssl: connectionString && !connectionString.includes('railway.internal')
    ? { rejectUnauthorized: false }
    : false
});

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

  console.log("Ma'lumotlar bazasi jadvallari tayyor (PostgreSQL).");
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

module.exports = { pool, initDb, getOrCreateUser };
ESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('income','expense')),
    category TEXT NOT NULL,
    amount INTEGER NOT NULL,
    date TEXT NOT NULL,
    comment TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target INTEGER NOT NULL,
    current INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Eski bazalarga yangi ustunlarni xavfsiz qo'shish (agar mavjud bo'lmasa)
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
addColumnIfMissing('transactions', 'payment_type', "payment_type TEXT NOT NULL DEFAULT 'cash'");
addColumnIfMissing('users', 'card_label', 'card_label TEXT');
addColumnIfMissing('goals', 'deadline', 'deadline TEXT');

function getOrCreateUser(telegramId, firstName) {
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO users (telegram_id, first_name) VALUES (?, ?)').run(telegramId, firstName || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

module.exports = { db, getOrCreateUser };
