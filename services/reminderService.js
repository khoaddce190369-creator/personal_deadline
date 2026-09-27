const db = require('../db/database');
const { formatTime } = require('../utils/parser');
const telegramService = require('./telegramService');

async function checkReminders() {
  try {
    const now = Date.now();
    
    // Lấy các deadline đang active
    const result = await db.execute(`SELECT * FROM deadlines WHERE status = 'active' AND notified = 0`);
    
    for (const row of result.rows) {
      const targetTime = row.deadline_time - (row.remind_before_minutes * 60 * 1000);
      
      if (now >= targetTime) {
        
        let reminderType = 'before';
        if (row.remind_before_minutes === 0) reminderType = 'exact';
        else if (row.remind_before_minutes < 0) {
          // -2: Quá hạn lần 1
          // -4: Quá hạn lần 2
          // -6 trở đi: Đã bỏ qua 3 lần -> BẬT CHẾ ĐỘ BÁO THỨC ĐỊA NGỤC
          if (row.remind_before_minutes <= -6) {
            reminderType = 'alarm';
          } else {
            reminderType = 'overdue';
          }
        }

        await sendReminder(row, reminderType);
        
        if (row.remind_before_minutes > 0) {
          await db.execute({
            sql: `UPDATE deadlines SET remind_before_minutes = 0 WHERE id = ?`,
            args: [row.id]
          });
        } else {
          const nextSpamMinutes = row.remind_before_minutes - 2;
          await db.execute({
            sql: `UPDATE deadlines SET remind_before_minutes = ? WHERE id = ?`,
            args: [nextSpamMinutes, row.id]
          });
        }
      }
    }
  } catch (err) {
    console.error('Lỗi khi lấy reminders:', err.message);
  }
}

async function sendReminder(deadline, reminderType) {
  const chatId = deadline.chat_id; 
  if (!chatId) return;

  let titleText = `⏰ **NHẮC HẸN DEADLINE**`;
  if (reminderType === 'exact') titleText = `🚨 **ĐẾN HẠN DEADLINE!**`;
  else if (reminderType === 'overdue') titleText = `💥 **QUÁ HẠN! HÃY HOÀN THÀNH DEADLINE!**`;
  else if (reminderType === 'alarm') titleText = `[BAOTHUC] 💀 **DẬY MAU! ĐÃ BỎ QUA 3 LẦN!** 💀`;

  const text = `${titleText}\n\n`
             + `📌 Nội dung: ${deadline.title}\n`
             + `📅 Hạn chót: ${formatTime(deadline.deadline_time)}`;

  const options = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Đã xong', callback_data: `done_${deadline.id}` }
        ],
        [
          { text: '🔄 Báo lại 15p', callback_data: `snooze_${deadline.id}_15` },
          { text: '🔄 Báo lại 1h', callback_data: `snooze_${deadline.id}_60` }
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
