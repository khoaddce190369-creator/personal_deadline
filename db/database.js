const { createClient } = require('@libsql/client');
const config = require('../config');

const db = createClient({
  url: config.dbUrl,
  authToken: config.dbAuthToken,
});

async function initDb() {
  try {
    // Bảng lưu những user đã nhập mã mời thành công
    await db.execute(`
      CREATE TABLE IF NOT EXISTS allowed_users (
        chat_id TEXT PRIMARY KEY,
        joined_at INTEGER,
        web_pin TEXT
      )
    `);

    // Bảng deadlines có thêm cột chat_id
    await db.execute(`
      CREATE TABLE IF NOT EXISTS deadlines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        deadline_time INTEGER NOT NULL,
        remind_before_minutes INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        notified INTEGER DEFAULT 0,
        created_at INTEGER
      )
    `);
    
    // Bảng quản lý các quỹ tài chính (funds)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS funds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        name TEXT NOT NULL,
        balance REAL DEFAULT 0,
        created_at INTEGER
      )
    `);
    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_funds_chat_name ON funds (chat_id, name)
    `);

    // Bảng lưu lịch sử giao dịch (thu / chi)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'income' hoặc 'expense'
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        fund_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Bảng cài đặt ngân sách / hạn mức chi tiêu tuần
    await db.execute(`
      CREATE TABLE IF NOT EXISTS weekly_budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        week_key TEXT NOT NULL, -- vd: '2026-W40' hoặc 'default'
        amount REAL NOT NULL,
        spent_override REAL,
        created_at INTEGER
      )
    `);
    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_chat_week ON weekly_budgets (chat_id, week_key)
    `);
    try {
      await db.execute(`ALTER TABLE weekly_budgets ADD COLUMN spent_override REAL`);
    } catch (_) {
      // Đã có cột spent_override
    }

    // Bảng lưu trạng thái chu kỳ tuần và tháng, cùng tổng số tiền thực tế của user
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_finance_state (
        chat_id TEXT PRIMARY KEY,
        last_week_key TEXT NOT NULL,
        last_month_key TEXT,
        total_money REAL DEFAULT 0,
        updated_at INTEGER
      )
    `);
    try {
      await db.execute(`ALTER TABLE user_finance_state ADD COLUMN last_month_key TEXT`);
    } catch (_) {
      // Đã có cột last_month_key
    }
    try {
      await db.execute(`ALTER TABLE user_finance_state ADD COLUMN total_money REAL DEFAULT 0`);
    } catch (_) {
      // Đã có cột total_money
    }
    
    // Đảm bảo Admin luôn được phép dùng bot mà không cần mã mời
    if (config.adminChatId) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO allowed_users (chat_id, joined_at, web_pin) VALUES (?, ?, ?)`,
        args: [config.adminChatId, Date.now(), '123456'] // Mật khẩu web mặc định cho admin
      });
    }

    console.log('✅ Đã kết nối và cập nhật cấu trúc Database thành công!');
  } catch (err) {
    console.error('❌ Lỗi khởi tạo Database:', err.message);
  }
}

const initPromise = initDb();

module.exports = db;
module.exports.initPromise = initPromise;

