const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const db = require('../db/database');
const { parseMessage, parseFinanceMessage, formatTime, formatMoney, parseAmount } = require('../utils/parser');
const financeService = require('./financeService');

const bot = new TelegramBot(config.botToken, { polling: true });
const pendingDeadlines = new Map();
const pendingFinances = new Map();

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const text = msg.text;
  if (!text) return;

  try {
    // 1. Kiểm tra xem user đã được phép dùng chưa
    const userRes = await db.execute({ sql: `SELECT * FROM allowed_users WHERE chat_id = ?`, args: [chatId] });
    const isAllowed = userRes.rows.length > 0;

    if (!isAllowed) {
      if (text === config.inviteCode) {
        await db.execute({ sql: `INSERT INTO allowed_users (chat_id, joined_at) VALUES (?, ?)`, args: [chatId, Date.now()] });
        return bot.sendMessage(
          chatId,
          '✅ *Xác thực thành công! Chào mừng bạn.*\n\n' +
          '📌 **1. QUẢN LÝ DEADLINE:**\n' +
          '`Nội dung, giờ/phút/ngày/tháng, trước bao lâu`\n' +
          'VD: `Họp team, 15/30, 30p`\n\n' +
          '💰 **2. QUẢN LÝ 3 QUỸ TIỀN BẠC:**\n' +
          '• `Tiêu dùng` (500k/tuần, dư chuyển Tiết kiệm)\n' +
          '• `Phát sinh` (100k/tuần, dư chuyển Tiết kiệm)\n' +
          '• `Tiết kiệm` (Tích lũy, nhận tiền nạp & tiền dư)\n\n' +
          'Cú pháp: `+/-số tiền, tag, nội dung, thời gian`\n' +
          'VD: `-50k, tiêu dùng, ăn trưa, 12/00`\n' +
          '*(Nếu không ghi tag: "-" tự vào Tiêu dùng, "+" tự vào Tiết kiệm)*\n\n' +
          '🌐 Xem web: gõ `/web` | 📊 Tài chính: gõ `/finance` | ❓ Hướng dẫn: nhắn `?`',
          { parse_mode: 'Markdown' }
        );
      } else {
        return bot.sendMessage(chatId, '🔒 Bot này là riêng tư. Vui lòng nhập Mã Mời để có thể sử dụng:');
      }
    }

    const trimmedText = text.trim();
    const lowerText = trimmedText.toLowerCase();

    // 2. Xử lý lệnh lấy pass Web
    if (lowerText === '/web') {
      const pin = Math.floor(100000 + Math.random() * 900000).toString(); // Mã 6 số ngẫu nhiên
      await db.execute({ sql: `UPDATE allowed_users SET web_pin = ? WHERE chat_id = ?`, args: [pin, chatId] });
      return bot.sendMessage(
        chatId,
        `🌐 **THÔNG TIN ĐĂNG NHẬP WEB**\n\n` +
        `- ID Đăng nhập: \`${chatId}\`\n` +
        `- Mật khẩu (PIN): \`${pin}\`\n\n` +
        `Hãy truy cập trang web để quản lý Deadline và Quản lý Tiền bạc một cách trực quan!`,
        { parse_mode: 'Markdown' }
      );
    }

    // Bảng hướng dẫn giao tiếp với bot khi nhắn "?" hoặc "/help", "/start"
    if (trimmedText === '?' || lowerText === '/start' || lowerText === '/help') {
      return bot.sendMessage(
        chatId,
        `📖 **BẢNG HƯỚNG DẪN GIAO TIẾP VỚI BOT**\n\n` +
        `💰 **1. QUẢN LÝ TÀI CHÍNH (4 QUỸ)**\n` +
        `• **Cú pháp:** \`+/-số tiền, tag, nội dung, thời gian\`\n` +
        `• **4 Quỹ gồm:**\n` +
        `  - *Tiêu dùng*: 500k/tuần (dư cuối tuần tự sang Tiết kiệm)\n` +
        `  - *Phát sinh*: 100k/tuần (gym, nợ... dư cuối tuần tự sang Tiết kiệm)\n` +
        `  - *Trả nợ*: Mỗi tháng là -700k (-700.000 đ)\n` +
        `  - *Tiết kiệm*: Tích lũy liên tục (nhận tiền nạp & tiền dư các quỹ)\n` +
        `• **Quy tắc khi không ghi tag:**\n` +
        `  - Dấu **\`-\`** ➔ Tự động trừ vào **Quỹ Tiêu dùng**\n` +
        `  - Dấu **\`+\`** ➔ Tự động cộng vào **Quỹ Tiết kiệm**\n` +
        `• **Ví dụ mẫu:**\n` +
        `  - \`-50k, tiêu dùng, ăn trưa, 12/00\`\n` +
        `  - \`-45k, cơm trưa\` *(tự trừ Tiêu dùng)*\n` +
        `  - \`-30k, phát sinh, gửi xe\`\n` +
        `  - \`+200k, trả nợ, trả góp đợt 1\` *(giảm nợ)*\n` +
        `  - \`+100k, tiết kiệm, tiền mừng\`\n` +
        `  - \`+200k, làm thêm\` *(tự cộng Tiết kiệm)*\n` +
        `  - \`-25k\` hoặc \`+500k\` *(nhập siêu nhanh)*\n\n` +
        `⏰ **2. QUẢN LÝ DEADLINE (NHẮC HẸN & BÁO THỨC)**\n` +
        `• **Cú pháp:** \`Nội dung, giờ/phút/ngày/tháng, trước bao lâu\`\n` +
        `• **Ví dụ mẫu:**\n` +
        `  - \`Họp team, 15/30, 30p\`\n` +
        `  - \`Nộp bài tập, 23/59/05/10, 1h\`\n` +
        `  - \`Đi khám bệnh, 08/00/+1, 15p\`\n\n` +
        `📋 **3. CÁC LỆNH NHANH:**\n` +
        `• \`?\` : Xem bảng hướng dẫn giao tiếp này\n` +
        `• \`/finance\` (hoặc \`/tien\`, \`/vi\`) : Xem tình hình tài chính hiện tại\n` +
        `• \`/web\` : Lấy mã PIN đăng nhập Web Dashboard`,
        { parse_mode: 'Markdown' }
      );
    }

    // Lệnh xem tình hình tài chính hiện tại (/finance)
    if (
      lowerText === '/finance' ||
      lowerText === '/tien' ||
      lowerText === '/vi' ||
      lowerText === '/funds' ||
      lowerText === '/wallet'
    ) {
      const overview = await financeService.getOverview(chatId);
      let reply = `💰 **TÌNH HÌNH TÀI CHÍNH HIỆN TẠI**\n\n`;
      reply += `💳 **Tổng tài sản (4 quỹ):** \`${formatMoney(overview.totalBalance)}\`\n\n`;

      reply += `📊 **Tiến độ tuần (${overview.weekInfo.label}):**\n`;
      reply += `• Hạn mức cấp tuần: \`${formatMoney(overview.weeklyBudget)}\` (500k + 100k)\n`;
      reply += `• Đã chi tiêu tuần này: \`${formatMoney(overview.spentThisWeek)}\`\n`;
      if (overview.remainingWeek >= 0) {
        reply += `• Còn lại tuần này: \`${formatMoney(overview.remainingWeek)}\` 🟢\n`;
      } else {
        reply += `• Đã thâm hụt: \`${formatMoney(Math.abs(overview.remainingWeek))}\` 🔴 (Vượt hạn mức!)\n`;
      }
      reply += `*(Hết tuần, toàn bộ số dư còn lại sẽ tự động cộng dồn sang Quỹ Tiết kiệm)*\n\n`;

      reply += `🏦 **Chi tiết 4 Quỹ:**\n`;
      reply += `• **Tiêu dùng:** \`${formatMoney(overview.spendingBalance)}\` / 500,000 đ\n`;
      reply += `• **Phát sinh:** \`${formatMoney(overview.extraBalance)}\` / 100,000 đ\n`;
      reply += `• **Trả nợ:** \`${formatMoney(overview.debtBalance)}\` / -700,000 đ/tháng\n`;
      reply += `• **Tiết kiệm:** \`${formatMoney(overview.savingsBalance)}\` (Tích lũy)\n\n`;

      reply += `💡 Gõ \`-50k, ăn trưa\` để chi tiêu hoặc \`+100k\` để thêm tiết kiệm.\n`;
      reply += `💡 Nhắn \`?\` để mở lại bảng hướng dẫn.`;

      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

    const msgId = msg.message_id;

    // 3. Kiểm tra xem tin nhắn có phải là giao dịch Tiền bạc hay không
    const financeData = parseFinanceMessage(text);
    if (financeData && financeData.isFinance) {
      pendingFinances.set(chatId, financeData);

      const typeLabel = financeData.type === 'income' ? '🟢 Thu nhập (+)' : '🔴 Chi tiêu (-)';
      const timeStr = formatTime(financeData.transactionTime);

      const reply = `💰 **XÁC NHẬN GIAO DỊCH TIỀN BẠC**\n\n`
                  + `🏷️ Phân loại: ${typeLabel}\n`
                  + `💵 Số tiền: *${formatMoney(financeData.amount)}*\n`
                  + `🏦 Quỹ: *${financeData.fundName}*\n`
                  + `📝 Nội dung: *${financeData.description}*\n`
                  + `🕒 Thời gian: *${timeStr}*`;

      const options = {
        parse_mode: 'Markdown',
        reply_to_message_id: msgId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Xác nhận OK', callback_data: 'confirm_finance_ok' }],
            [{ text: '✏️ Nhập lại', callback_data: 'confirm_finance_edit' }]
          ]
        }
      };

      return bot.sendMessage(chatId, reply, options);
    }

    // 4. Nếu không phải tiền bạc, xử lý như tin nhắn tạo Deadline
    const parsedData = parseMessage(text);
    pendingDeadlines.set(chatId, parsedData);

    const reply = `📌 **XÁC NHẬN DEADLINE**\n\n`
                + `📝 Nội dung: *${parsedData.title}*\n`
                + `📅 Hạn: *${formatTime(parsedData.deadline_time)}*\n`
                + `⏳ Nhắc trước: *${parsedData.remind_before_minutes} phút*`;

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
    if (
      error.message.includes('Sai định dạng') ||
      error.message.includes('thời gian sai') ||
      error.message.includes('Không tìm thấy số tiền') ||
      error.message.includes('Ngày giờ không hợp lệ')
    ) {
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
    // XÁC NHẬN GIAO DỊCH TIỀN BẠC
    if (action === 'confirm_finance_ok') {
      const data = pendingFinances.get(chatId);
      if (!data) return bot.answerCallbackQuery(query.id, { text: 'Không tìm thấy giao dịch chờ xác nhận!' });

      const result = await financeService.addTransaction(chatId, data);
      pendingFinances.delete(chatId);

      const typeLabel = result.type === 'income' ? '🟢 Thu nhập (+)' : '🔴 Chi tiêu (-)';
      let confirmMsg = `✅ **ĐÃ LƯU GIAO DỊCH THÀNH CÔNG!**\n\n`
                     + `🏷️ Loại: ${typeLabel}\n`
                     + `💵 Số tiền: *${formatMoney(result.amount)}*\n`
                     + `🏦 Quỹ: *${result.fund_name}* (Số dư mới: \`${formatMoney(result.fund_balance)}\`)\n`
                     + `📝 Nội dung: *${result.description}*\n`
                     + `🕒 Thời gian: *${formatTime(result.created_at)}*\n\n`
                     + `💳 **Tổng tài sản:** \`${formatMoney(result.total_balance)}\`\n`
                     + `📉 **Còn lại tuần này:** \`${formatMoney(result.remaining_week)}\``;

      bot.editMessageText(confirmMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
    }

    else if (action === 'confirm_finance_edit') {
      pendingFinances.delete(chatId);
      bot.editMessageText('✏️ Đã hủy. Vui lòng nhập lại tin nhắn theo đúng định dạng.', { chat_id: chatId, message_id: messageId });
    }

    // XÁC NHẬN DEADLINE
    else if (action === 'confirm_ok') {
      const data = pendingDeadlines.get(chatId);
      if (!data) return bot.answerCallbackQuery(query.id, { text: 'Không tìm thấy dữ liệu chờ xác nhận!' });

      await db.execute({
        sql: `INSERT INTO deadlines (chat_id, title, deadline_time, remind_before_minutes, created_at) VALUES (?, ?, ?, ?, ?)`,
        args: [chatId, data.title, data.deadline_time, data.remind_before_minutes, Date.now()]
      });
      
      bot.editMessageText(`✅ Đã lưu deadline: *${data.title}*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
      pendingDeadlines.delete(chatId);
    } 
    
    else if (action === 'confirm_edit') {
      pendingDeadlines.delete(chatId);
      bot.editMessageText('✏️ Vui lòng nhập lại tin nhắn theo đúng định dạng.', { chat_id: chatId, message_id: messageId });
    }

    // BÁO LẠI (SNOOZE) DEADLINE
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
        const wasAlarming = row.remind_before_minutes <= -6;
        const timeLeftMinutes = Math.floor((row.deadline_time - Date.now()) / 60000);
        const newRemindBefore = timeLeftMinutes - snoozeMinutes;
        
        await db.execute({
          sql: `UPDATE deadlines SET notified = 0, remind_before_minutes = ? WHERE id = ?`,
          args: [newRemindBefore, deadlineId]
        });
        
        bot.editMessageText(query.message.text + `\n\n🔄 *Đã báo lại sau ${snoozeMinutes} phút*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        
        if (wasAlarming) {
          bot.sendMessage(chatId, `[TATBAOTHUC] 🛑 Đã tạm tắt còi báo động!`);
        }
      }
    }
    
    // HOÀN THÀNH DEADLINE
    else if (action.startsWith('done_')) {
      const deadlineId = action.split('_')[1];
      
      const result = await db.execute({
        sql: `SELECT remind_before_minutes FROM deadlines WHERE id = ? AND chat_id = ?`,
        args: [deadlineId, chatId]
      });
      const row = result.rows[0];
      const wasAlarming = row && row.remind_before_minutes <= -6;

      await db.execute({
        sql: `UPDATE deadlines SET status = 'completed' WHERE id = ? AND chat_id = ?`,
        args: [deadlineId, chatId]
      });
      bot.editMessageText(query.message.text + `\n\n✅ *Đã hoàn thành!*`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
      
      if (wasAlarming) {
        bot.sendMessage(chatId, `[TATBAOTHUC] 🛑 Đã tắt còi báo động!`);
      }
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
