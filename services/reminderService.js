const db = require('../db/database');
const config = require('../config');
const { formatTime } = require('../utils/parser');
const telegramService = require('./telegramService');

async function checkReminders() {
  try {
    const now = Date.now();
    
    // Lấy các deadline đang active và chưa thông báo
    const result = await db.execute(`SELECT * FROM deadlines WHERE status = 'active' AND notified = 0`);
    
    for (const row of result.rows) {
      const targetTime = row.deadline_time - (row.remind_before_minutes * 60 * 1000);
      
      // Nếu đã đến hoặc qua thời điểm cần nhắc (và chưa nhắc)
      if (now >= targetTime) {
        await sendReminder(row);
      }
    }
  } catch (err) {
    console.error('Lỗi khi lấy reminders:', err.message);
  }
}

async function sendReminder(deadline) {
  const chatId = config.adminChatId;
  if (!chatId) return console.log('Chưa cấu hình ADMIN_CHAT_ID');

  const text = `⏰ **NHẮC HẸN DEADLINE**\n\n`
             + `📌 Nội dung: ${deadline.title}\n`
             + `📅 Hạn chót: ${formatTime(deadline.deadline_time)}`;

  const options = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔄 Báo lại 15p', callback_data: `snooze_${deadline.id}_15` },
          { text: '🔄 Báo lại 1h', callback_data: `snooze_${deadline.id}_60` }
        ],
        [
          { text: '✅ Đã xong', callback_data: `done_${deadline.id}` }
        ]
      ]
    }
  };

  try {
    await telegramService.sendMessage(chatId, text, options);
    // Đánh dấu là đã nhắc
    await db.execute({
      sql: `UPDATE deadlines SET notified = 1 WHERE id = ?`,
      args: [deadline.id]
    });
  } catch (err) {
    console.error('Lỗi gửi nhắc nhở:', err);
  }
}

module.exports = {
  checkReminders
};
