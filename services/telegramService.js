const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const db = require('../db/database');
const { parseMessage, formatTime } = require('../utils/parser');

const bot = new TelegramBot(config.botToken, { polling: true });
const pendingDeadlines = new Map();

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const text = msg.text;
  if (!text) return;

  try {
    // 1. Ktra xem user đã được phép dùng chưa
    const userRes = await db.execute({ sql: `SELECT * FROM allowed_users WHERE chat_id = ?`, args: [chatId] });
    const isAllowed = userRes.rows.length > 0;

    if (!isAllowed) {
      if (text === config.inviteCode) {
        await db.execute({ sql: `INSERT INTO allowed_users (chat_id, joined_at) VALUES (?, ?)`, args: [chatId, Date.now()] });
        return bot.sendMessage(chatId, '✅ Xác thực thành công! Chào mừng bạn đến với Hệ thống Quản lý Deadline.\n\nHướng dẫn sử dụng:\nNhập deadline theo cú pháp: `Nội dung, giờ/phút/ngày/tháng, trước bao lâu`\nVD: `Họp team, 15/30, 30p`\nĐể lấy mật khẩu vào Web, gõ: `/web`', { parse_mode: 'Markdown' });
      } else {
        return bot.sendMessage(chatId, '🔒 Bot này là riêng tư. Vui lòng nhập Mã Mời để có thể sử dụng:');
      }
    }

    // 2. Xử lý lệnh lấy pass Web
    if (text === '/web') {
      const pin = Math.floor(100000 + Math.random() * 900000).toString(); // Mã 6 số ngẫu nhiên
      await db.execute({ sql: `UPDATE allowed_users SET web_pin = ? WHERE chat_id = ?`, args: [pin, chatId] });
      return bot.sendMessage(chatId, `🌐 **THÔNG TIN ĐĂNG NHẬP WEB**\n\n- ID Đăng nhập của bạn: \`${chatId}\`\n- Mật khẩu (PIN) của bạn: \`${pin}\`\n\nHãy vào trang web để quản lý các deadline của riêng bạn.`, { parse_mode: 'Markdown' });
    }

    if (text === '/start') {
      return bot.sendMessage(chatId, 'Chào bạn! Gửi deadline theo cú pháp:\n`Nội dung, giờ/phút/ngày/tháng, trước bao lâu (1d 1h 1p)`\nVí dụ: `Họp team, 15/30/26/09, 1h 30p`\nLấy pass web: `/web`', { parse_mode: 'Markdown' });
    }

    // 3. Xử lý tin nhắn tạo deadline
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
    if (error.message.includes('Sai định dạng') || error.message.includes('thời gian sai')) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    } else {
      console.error(error);
      bot.sendMessage(chatId, `❌ Đã có lỗi xảy ra trong quá trình xử lý.`);
    }
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id.toString();
  const messageId = query.message.message_id;
  const action = query.data;

  try {
    if (action === 'confirm_ok') {
      const data = pendingDeadlines.get(chatId);
      if (!data) return bot.answerCallbackQuery(query.id, { text: 'Không tìm thấy dữ liệu chờ xác nhận!' });

      await db.execute({
        sql: `INSERT INTO deadlines (chat_id, title, deadline_time, remind_before_minutes, created_at) VALUES (?, ?, ?, ?, ?)`,
        args: [chatId, data.title, data.deadline_time, data.remind_before_minutes, Date.now()]
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
        sql: `SELECT * FROM deadlines WHERE id = ? AND chat_id = ?`,
        args: [deadlineId, chatId]
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
        sql: `UPDATE deadlines SET status = 'completed' WHERE id = ? AND chat_id = ?`,
        args: [deadlineId, chatId]
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
