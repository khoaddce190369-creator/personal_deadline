const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const db = require('../db/database');
const { parseMessage, formatTime } = require('../utils/parser');

const bot = new TelegramBot(config.botToken, { polling: true });
const pendingDeadlines = new Map();

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  if (config.adminChatId && chatId.toString() !== config.adminChatId.toString()) {
    return bot.sendMessage(chatId, 'Bạn không có quyền sử dụng bot này.');
  }

  const text = msg.text;
  if (!text) return;

  if (text === '/start') {
    return bot.sendMessage(chatId, 'Chào bạn! Gửi deadline theo cú pháp:\n`Nội dung, giờ/phút/ngày/tháng, trước bao lâu (1d 1h 1p)`\nVí dụ: `Họp team, 15/30/26/09, 1h 30p`', { parse_mode: 'Markdown' });
  }

  try {
    const parsedData = parseMessage(text);
    const msgId = msg.message_id;
    
    pendingDeadlines.set(chatId, parsedData);

    const reply = `📌 **XÁC NHẬN DEADLINE**\n`
                + `📝 Nội dung: ${parsedData.title}\n`
                + `📅 Hạn: ${formatTime(parsedData.deadline_time)}\n`
                + `⏳ Nhắc trước: ${parsedData.remind_before_minutes} phút`;

    const options = {
      parse_mode: 'Markdown',
      reply_to_message_id: msgId,
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Xác nhận OK', callback_data: 'confirm_ok' }],
          [{ text: '✏️ Nhập lại', callback_data: 'confirm_edit' }]
        ]
      }
    };

    bot.sendMessage(chatId, reply, options);

  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const action = query.data;

  try {
    if (action === 'confirm_ok') {
      const data = pendingDeadlines.get(chatId);
      if (!data) return bot.answerCallbackQuery(query.id, { text: 'Không tìm thấy dữ liệu chờ xác nhận!' });

      await db.execute({
        sql: `INSERT INTO deadlines (title, deadline_time, remind_before_minutes, created_at) VALUES (?, ?, ?, ?)`,
        args: [data.title, data.deadline_time, data.remind_before_minutes, Date.now()]
      });
      
      bot.editMessageText(`✅ Đã lưu: ${data.title}`, { chat_id: chatId, message_id: messageId });
      pendingDeadlines.delete(chatId);
    } 
    
    else if (action === 'confirm_edit') {
      pendingDeadlines.delete(chatId);
      bot.editMessageText('✏️ Vui lòng nhập lại tin nhắn theo đúng định dạng.', { chat_id: chatId, message_id: messageId });
    }

    else if (action.startsWith('snooze_')) {
      const parts = action.split('_');
      const deadlineId = parts[1];
      const snoozeMinutes = parseInt(parts[2]);
      
      const result = await db.execute({
        sql: `SELECT * FROM deadlines WHERE id = ?`,
        args: [deadlineId]
      });
      
      const row = result.rows[0];
      if (row) {
        const timeLeftMinutes = Math.floor((row.deadline_time - Date.now()) / 60000);
        const newRemindBefore = timeLeftMinutes - snoozeMinutes;
        
        await db.execute({
          sql: `UPDATE deadlines SET notified = 0, remind_before_minutes = ? WHERE id = ?`,
          args: [newRemindBefore, deadlineId]
        });
        
        bot.editMessageText(query.message.text + `\n\n🔄 *Đã báo lại sau ${snoozeMinutes} phút*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
      }
    }
    
    else if (action.startsWith('done_')) {
      const deadlineId = action.split('_')[1];
      await db.execute({
        sql: `UPDATE deadlines SET status = 'completed' WHERE id = ?`,
        args: [deadlineId]
      });
      bot.editMessageText(query.message.text + `\n\n✅ *Đã hoàn thành!*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error('Lỗi khi xử lý callback query:', error);
  }

  bot.answerCallbackQuery(query.id);
});

function sendMessage(chatId, text, options) {
  return bot.sendMessage(chatId, text, options);
}

module.exports = {
  bot,
  sendMessage
};
