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
          '💰 **2. QUẢN LÝ TIỀN BẠC (THU/CHI/QUỸ):**\n' +
          '• Chi tiêu (-): `-, 45k, Cơm trưa, Ăn uống`\n' +
          '• Thu nhập (+): `+, 5tr, Lương tháng, Tiết kiệm`\n\n' +
          '🌐 Để lấy mật khẩu vào Web: gõ `/web`\n' +
          '📊 Xem ví & quỹ: gõ `/tien`',
          { parse_mode: 'Markdown' }
        );
      } else {
        return bot.sendMessage(chatId, '🔒 Bot này là riêng tư. Vui lòng nhập Mã Mời để có thể sử dụng:');
      }
    }

    // 2. Xử lý lệnh lấy pass Web
    if (text === '/web') {
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

    // Lệnh xem trợ giúp / start
    if (text === '/start' || text === '/help') {
      return bot.sendMessage(
        chatId,
        `👋 **CHÀO MỪNG BẠN ĐẾN VỚI HỆ THỐNG TRỢ LÝ CÁ NHÂN!**\n\n` +
        `⏰ **QUẢN LÝ DEADLINE:**\n` +
        `• Cú pháp: \`Nội dung, giờ/phút/ngày/tháng, trước bao lâu\`\n` +
        `• Ví dụ: \`Họp team, 15/30/26/09, 1h 30p\`\n\n` +
        `💰 **QUẢN LÝ TIỀN BẠC (THU / CHI / QUỸ):**\n` +
        `• Chi tiêu (-): \`-, 45k, Cơm trưa, Ăn uống\`\n` +
        `• Thu nhập (+): \`+, 2tr, Thưởng dự án, Tiết kiệm\`\n` +
        `*(Hỗ trợ viết tắt: 50k, 1.5tr, 2m... Nếu không ghi tên quỹ, bot tự vào "Quỹ chung")*\n\n` +
        `📊 **CÁC LỆNH NHANH:**\n` +
        `• \`/tien\` hoặc \`/vi\`: Xem tổng tài sản, chi tiêu tuần & số dư các quỹ\n` +
        `• \`/setbudget <tiền>\`: Đặt hạn mức chi tiêu tuần (VD: \`/setbudget 1.5tr\`)\n` +
        `• \`/web\`: Lấy mã PIN đăng nhập Web`,
        { parse_mode: 'Markdown' }
      );
    }

    // Lệnh xem tổng quan tiền bạc
    if (text === '/tien' || text === '/vi' || text === '/funds' || text === '/wallet') {
      const overview = await financeService.getOverview(chatId);
      let reply = `💰 **TỔNG QUAN TÀI CHÍNH CỦA BẠN**\n\n`;
      reply += `💳 **Tổng tài sản:** \`${formatMoney(overview.totalBalance)}\`\n\n`;

      reply += `📅 **Hạn mức chi tiêu tuần (${overview.weekInfo.label}):**\n`;
      if (overview.weeklyBudget > 0) {
        const percent = Math.min(100, Math.round((overview.spentThisWeek / overview.weeklyBudget) * 100));
        reply += `• Hạn mức tuần: \`${formatMoney(overview.weeklyBudget)}\`\n`;
        reply += `• Đã chi: \`${formatMoney(overview.spentThisWeek)}\` (${percent}%)\n`;
        if (overview.remainingWeek >= 0) {
          reply += `• Còn lại: \`${formatMoney(overview.remainingWeek)}\` 🟢\n\n`;
        } else {
          reply += `• Vượt quá: \`${formatMoney(Math.abs(overview.remainingWeek))}\` 🔴 (Cảnh báo vượt hạn mức!)\n\n`;
        }
      } else {
        reply += `• Đã chi tuần này: \`${formatMoney(overview.spentThisWeek)}\`\n`;
        reply += `• *(Chưa đặt hạn mức tuần. Gõ \`/setbudget <tiền>\` để đặt)*\n\n`;
      }

      reply += `🏦 **Số dư các Quỹ:**\n`;
      if (overview.funds.length === 0) {
        reply += `• Chưa có quỹ nào. Giao dịch mới sẽ tự tạo quỹ.\n`;
      } else {
        overview.funds.forEach(f => {
          reply += `• ${f.name}: \`${formatMoney(f.balance)}\`\n`;
        });
      }

      reply += `\n💡 Gõ \`-, 45k, Cơm trưa, Ăn uống\` để ghi chép chi tiêu.`;

      return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }

    // Lệnh đặt hạn mức chi tiêu tuần
    if (text.startsWith('/setbudget')) {
      const rawBudget = text.replace('/setbudget', '').trim();
      const budgetAmount = parseAmount(rawBudget);

      if (budgetAmount <= 0) {
        return bot.sendMessage(chatId, '❌ Vui lòng nhập số tiền hợp lệ. VD: `/setbudget 1500000` hoặc `/setbudget 1.5tr`', { parse_mode: 'Markdown' });
      }

      const res = await financeService.setWeeklyBudget(chatId, budgetAmount);
      const spent = await financeService.getWeeklySpending(chatId);
      const remaining = budgetAmount - spent;

      return bot.sendMessage(
        chatId,
        `✅ **ĐÃ CẬP NHẬT HẠN MỨC TUẦN THÀNH CÔNG!**\n\n` +
        `🎯 Hạn mức: \`${formatMoney(budgetAmount)}\`\n` +
        `📉 Đã tiêu tuần này: \`${formatMoney(spent)}\`\n` +
        `💵 Số tiền còn lại: \`${formatMoney(remaining)}\`\n\n` +
        `Bot sẽ giúp bạn theo dõi chi tiêu để không vượt quá hạn mức này!`,
        { parse_mode: 'Markdown' }
      );
    }

    const msgId = msg.message_id;

    // 3. Kiểm tra xem tin nhắn có phải là giao dịch Tiền bạc hay không
    const financeData = parseFinanceMessage(text);
    if (financeData && financeData.isFinance) {
      pendingFinances.set(chatId, financeData);

      const typeLabel = financeData.type === 'income' ? '🟢 Thu nhập (+)' : '🔴 Chi tiêu (-)';
      const reply = `💰 **XÁC NHẬN GIAO DỊCH TIỀN BẠC**\n\n`
                  + `🏷️ Phân loại: ${typeLabel}\n`
                  + `💵 Số tiền: *${formatMoney(financeData.amount)}*\n`
                  + `📝 Nội dung: *${financeData.description}*\n`
                  + `🏦 Quỹ: *${financeData.fundName}*`;

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
                     + `📝 Nội dung: *${result.description}*\n`
                     + `🏦 Quỹ: *${result.fund_name}* (Số dư: \`${formatMoney(result.fund_balance)}\`)\n`;

      if (result.type === 'expense' && result.weekly_budget > 0) {
        confirmMsg += `\n📊 **Chi tiêu tuần:** \`${formatMoney(result.spent_this_week)}\` / \`${formatMoney(result.weekly_budget)}\``;
        if (result.remaining_week >= 0) {
          confirmMsg += ` (Còn lại: \`${formatMoney(result.remaining_week)}\`)`;
        } else {
          confirmMsg += ` ⚠️ *(ĐÃ VƯỢT HẠN MỨC ${formatMoney(Math.abs(result.remaining_week))}!)*`;
        }
      }

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
