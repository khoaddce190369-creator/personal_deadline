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

initDb();

module.exports = db;
