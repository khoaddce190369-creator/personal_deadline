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

// Internal Cron: Tự động check deadline mỗi 60 giây (chuẩn xác từng phút)
setInterval(async () => {
  try {
    await reminderService.checkReminders();
  } catch (err) {
    console.error('Lỗi khi chạy internal cron:', err);
  }
}, 60000); // 60000ms = 1 phút

// Keep-alive endpoint: cron-job.org sẽ gọi vào đây mỗi 10-14 phút để chống ngủ
app.get('/api/ping', (req, res) => {
  res.json({ status: 'awake', time: Date.now(), message: 'Server is kept alive' });
});

// API lấy danh sách deadline
app.get('/api/deadlines', async (req, res) => {
  try {
    const status = req.query.status || 'active';
    const result = await db.execute({
      sql: `SELECT * FROM deadlines WHERE status = ? ORDER BY deadline_time ASC`,
      args: [status]
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API đổi trạng thái
app.put('/api/deadlines/:id/status', async (req, res) => {
  try {
    const id = req.params.id;
    const status = req.body.status;
    await db.execute({
      sql: `UPDATE deadlines SET status = ? WHERE id = ?`,
      args: [status, id]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API xóa deadline
app.delete('/api/deadlines/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await db.execute({
      sql: `DELETE FROM deadlines WHERE id = ?`,
      args: [id]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${config.port}`);
});
