const db = require('../db/database');
const config = require('../config');
const { formatTime } = require('../utils/parser');
const telegramService = require('./telegramService');

async function checkReminders() {
  try {
    const now = Date.now();
    
    // Lấy các deadline đang active và chưa thông báo hoàn toàn
    const result = await db.execute(`SELECT * FROM deadlines WHERE status = 'active' AND notified = 0`);
    
    for (const row of result.rows) {
      const targetTime = row.deadline_time - (row.remind_before_minutes * 60 * 1000);
      
      if (now >= targetTime) {
        const isExactTime = row.remind_before_minutes === 0;
        await sendReminder(row, isExactTime);
        
        if (!isExactTime) {
          // Đã nhắc trước xong, cập nhật remind_before về 0 để hệ thống tiếp tục nhắc khi tới đúng giờ
          await db.execute({
            sql: `UPDATE deadlines SET remind_before_minutes = 0 WHERE id = ?`,
            args: [row.id]
          });
        } else {
          // Đã nhắc đúng giờ xong, đánh dấu hoàn tất chu trình báo
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
  const chatId = config.adminChatId;
  if (!chatId) return console.log('Chưa cấu hình ADMIN_CHAT_ID');

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
