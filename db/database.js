const { createClient } = require('@libsql/client');
const config = require('../config');

// Khởi tạo kết nối. 
// Nếu DB_URL là 'file:./database.sqlite', nó sẽ tạo file ở máy tính.
// Nếu DB_URL là link Turso, nó sẽ kết nối lên cloud. Rất mượt!
const db = createClient({
  url: config.dbUrl,
  authToken: config.dbAuthToken,
});

async function initDb() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS deadlines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        deadline_time INTEGER NOT NULL,
        remind_before_minutes INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        notified INTEGER DEFAULT 0,
        created_at INTEGER
      )
    `);
    console.log('✅ Đã kết nối Database thành công!');
  } catch (err) {
    console.error('❌ Lỗi khởi tạo Database:', err.message);
  }
}

initDb();

module.exports = db;
