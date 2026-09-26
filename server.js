const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db/database');
const reminderService = require('./services/reminderService');
const telegramService = require('./services/telegramService'); 

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Đăng nhập Web bằng chat_id và web_pin
app.post('/api/login', async (req, res) => {
  try {
    const { chatId, pin } = req.body;
    const result = await db.execute({
      sql: `SELECT * FROM allowed_users WHERE chat_id = ? AND web_pin = ?`,
      args: [chatId, pin]
    });
    
    if (result.rows.length > 0) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: 'Sai ID hoặc PIN' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách deadline của riêng người dùng
app.get('/api/deadlines', async (req, res) => {
  try {
    const status = req.query.status || 'active';
    const chatId = req.query.chatId;
    
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    const result = await db.execute({
      sql: `SELECT * FROM deadlines WHERE status = ? AND chat_id = ? ORDER BY deadline_time ASC`,
      args: [status, chatId]
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Đổi trạng thái deadline
app.put('/api/deadlines/:id/status', async (req, res) => {
  try {
    const id = req.params.id;
    const { status, chatId } = req.body;
    await db.execute({
      sql: `UPDATE deadlines SET status = ? WHERE id = ? AND chat_id = ?`,
      args: [status, id, chatId]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xóa deadline
app.delete('/api/deadlines/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const chatId = req.query.chatId;
    await db.execute({
      sql: `DELETE FROM deadlines WHERE id = ? AND chat_id = ?`,
      args: [id, chatId]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Internal Cron
setInterval(async () => {
  try {
    await reminderService.checkReminders();
  } catch (err) {
    console.error('Lỗi khi chạy internal cron:', err);
  }
}, 60000); 

// Keep-alive endpoint
app.get('/api/ping', (req, res) => {
  res.json({ status: 'awake', time: Date.now(), message: 'Server is kept alive' });
});

app.listen(config.port, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${config.port}`);
});
