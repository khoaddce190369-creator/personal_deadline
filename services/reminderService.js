const db = require('../db/database');
const { formatTime } = require('../utils/parser');
const telegramService = require('./telegramService');

async function checkReminders() {
  try {
    const now = Date.now();
    
    const result = await db.execute(`SELECT * FROM deadlines WHERE status = 'active' AND notified = 0`);
    
    for (const row of result.rows) {
      const targetTime = row.deadline_time - (row.remind_before_minutes * 60 * 1000);
      
      if (now >= targetTime) {
        const isExactTime = row.remind_before_minutes === 0;
        await sendReminder(row, isExactTime);
        
        if (!isExactTime) {
          await db.execute({
            sql: `UPDATE deadlines SET remind_before_minutes = 0 WHERE id = ?`,
            args: [row.id]
          });
        } else {
          await db.execute({
            sql: `UPDATE deadlines SET notified = 1 WHERE id = ?`,
            args: [row.id]
          });
        }
      }
    }
  } catch (err) {
    console.error('Lỗi khi lấy reminders:', err.message);
  }
}

async function sendReminder(deadline, isExactTime) {
  const chatId = deadline.chat_id; // Đã đổi: Gửi riêng cho người tạo deadline
  if (!chatId) return;

  const titleText = isExactTime ? `🚨 **ĐẾN HẠN DEADLINE!**` : `⏰ **NHẮC HẸN DEADLINE**`;
  const text = `${titleText}\n\n`
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
  } catch (err) {
    console.error('Lỗi gửi nhắc nhở:', err);
  }
}

module.exports = {
  checkReminders
};
