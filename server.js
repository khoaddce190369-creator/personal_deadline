const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db/database');
const reminderService = require('./services/reminderService');
const telegramService = require('./services/telegramService'); 
const financeService = require('./services/financeService'); 

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

// === API QUẢN LÝ TIỀN BẠC (FINANCE) ===

// Lấy tổng quan tài chính (tổng tiền, hạn mức tuần, chi tiêu tuần, danh sách quỹ, giao dịch gần đây)
app.get('/api/finance/overview', async (req, res) => {
  try {
    const chatId = req.query.chatId;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    const overview = await financeService.getOverview(chatId);
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cài đặt hạn mức chi tiêu tuần
app.post('/api/finance/weekly-budget', async (req, res) => {
  try {
    const { chatId, amount } = req.body;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    const result = await financeService.setWeeklyBudget(chatId, amount);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách các quỹ
app.get('/api/finance/funds', async (req, res) => {
  try {
    const chatId = req.query.chatId;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    const funds = await financeService.getFunds(chatId);
    res.json(funds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tạo quỹ mới
app.post('/api/finance/funds', async (req, res) => {
  try {
    const { chatId, name, initialBalance } = req.body;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });
    if (!name) return res.status(400).json({ error: 'Tên quỹ không được để trống' });

    const newFund = await financeService.createFund(chatId, name, initialBalance || 0);
    res.json({ success: true, fund: newFund });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xóa quỹ
app.delete('/api/finance/funds/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const chatId = req.query.chatId;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    await financeService.deleteFund(chatId, id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chỉnh sửa số dư quỹ qua Web
app.put('/api/finance/funds/:id/balance', async (req, res) => {
  try {
    const id = req.params.id;
    const { chatId, balance } = req.body;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    const result = await financeService.updateFundBalance(chatId, id, balance);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chỉnh sửa tổng số tiền qua Web
app.put('/api/finance/total-money', async (req, res) => {
  try {
    const { chatId, amount } = req.body;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    const result = await financeService.updateTotalMoney(chatId, amount);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách giao dịch
app.get('/api/finance/transactions', async (req, res) => {
  try {
    const chatId = req.query.chatId;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    const options = {
      limit: parseInt(req.query.limit) || 50,
      fund: req.query.fund,
      type: req.query.type,
      weekOnly: req.query.weekOnly === 'true'
    };

    const transactions = await financeService.getTransactions(chatId, options);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Thêm giao dịch mới (Thu nhập hoặc Chi tiêu)
app.post('/api/finance/transactions', async (req, res) => {
  try {
    const { chatId, type, amount, description, fundName, transactionTime, timeStr } = req.body;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    let finalTime = transactionTime;
    if (!finalTime && timeStr && timeStr.trim()) {
      const { parseDateTime } = require('./utils/parser');
      finalTime = parseDateTime(timeStr);
    }
    // Nếu không nhập thời gian thì mặc định ngay tại thời điểm nhập
    if (!finalTime) {
      finalTime = Date.now();
    }

    const result = await financeService.addTransaction(chatId, {
      type,
      amount,
      description,
      fundName,
      transactionTime: finalTime
    });

    // Gửi tin nhắn Telegram xác nhận lại những thông tin đã nhập
    try {
      const telegramService = require('./services/telegramService');
      const { formatMoney, formatTime } = require('./utils/parser');
      const typeLabel = result.type === 'income' ? '🟢 Thu nhập (+)' : '🔴 Chi tiêu (-)';
      const timeNote = timeStr && timeStr.trim() ? '' : ' *(Mặc định thời điểm nhập)*';
      const teleMsg = `✅ **XÁC NHẬN GIAO DỊCH TIỀN BẠC (TỪ WEB)**\n\n`
                    + `🏷️ Phân loại: ${typeLabel}\n`
                    + `💵 Số tiền: *${formatMoney(result.amount)}*\n`
                    + `🏦 Quỹ: *${result.fund_name}* (Số dư mới: \`${formatMoney(result.fund_balance)}\`)\n`
                    + `📝 Nội dung: *${result.description}*\n`
                    + `🕒 Thời gian: *${formatTime(result.created_at)}*${timeNote}\n\n`
                    + `💳 **Tổng số tiền:** \`${formatMoney(result.total_balance)}\`\n`
                    + `📉 **Còn lại tuần này:** \`${formatMoney(result.remaining_week)}\``;

      telegramService.sendMessage(chatId, teleMsg, { parse_mode: 'Markdown' });
    } catch (e) {
      console.warn('Không thể gửi tin nhắn Telegram thông báo:', e.message);
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xóa giao dịch (hoàn lại số dư quỹ)
app.delete('/api/finance/transactions/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const chatId = req.query.chatId;
    if (!chatId) return res.status(401).json({ error: 'Missing chatId' });

    await financeService.deleteTransaction(chatId, id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Internal Cron (kiểm tra nhắc hẹn deadline & tự động kết chuyển quỹ tuần mới)
setInterval(async () => {
  try {
    await reminderService.checkReminders();
    await financeService.checkAllUsersWeeklyRollover();
  } catch (err) {
    console.error('Lỗi khi chạy internal cron:', err);
  }
}, 60000); 

// Keep-alive endpoint (siêu nhẹ 2 bytes để cron-job không bao giờ bị lỗi payload)
app.all('/api/ping', (req, res) => {
  res.status(200).send('OK');
});

app.listen(config.port, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${config.port}`);
});
