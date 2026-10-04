const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const db = require('../db/database');
const { parseMessage, parseFinanceMessage, formatTime, formatMoney, parseAmount } = require('../utils/parser');
const financeService = require('./financeService');

const bot = new TelegramBot(config.botToken, { polling: true });
const pendingDeadlines = new Map();
const pendingFinances = new Map();

// Bộ nhớ đệm danh sách user hợp lệ để phản hồi tin nhắn tức thì (0ms)
const allowedUsersCache = new Set();
if (config.adminChatId) {
  allowedUsersCache.add(config.adminChatId.toString());
}

async function isUserAllowed(chatId) {
  if (allowedUsersCache.has(chatId)) return true;
  const userRes = await db.execute({ sql: `SELECT chat_id FROM allowed_users WHERE chat_id = ?`, args: [chatId] });
  if (userRes.rows.length > 0) {
    allowedUsersCache.add(chatId);
    return true;
  }
  return false;
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const text = msg.text;
  if (!text) return;

  try {
    // 1. Kiểm tra xem user đã được phép dùng chưa (sử dụng in-memory cache)
    const isAllowed = await isUserAllowed(chatId);

    if (!isAllowed) {
      if (text === config.inviteCode) {
        await db.execute({ sql: `INSERT INTO allowed_users (chat_id, joined_at) VALUES (?, ?)`, args: [chatId, Date.now()] });
        allowedUsersCache.add(chatId);
        return bot.sendMessage(
          chatId,
          '✅ *Xác thực thành công! Chào mừng bạn.*\n\n' +
          '📌 **1. QUẢN LÝ DEADLINE:**\n' +
          '`Nội dung, giờ/phút/ngày/tháng, trước bao lâu`\n' +
          'VD: `Họp team, 15/30, 30p`\n\n' +
          '💰 **2. QUẢN LÝ 4 QUỸ TIỀN BẠC:**\n' +
          '• `Tiêu dùng` (300k/tuần, ăn uống, dư chuyển Tiết kiệm)\n' +
          '• `Phát sinh` (200k/tuần, giặt đồ, xăng xe, lặt vặt, dư chuyển Tiết kiệm)\n' +
          '• `Trả nợ` (-700k/tháng)\n' +
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
        `  - *Tiêu dùng*: 300k/tuần (ăn uống, dư cuối tuần tự sang Tiết kiệm)\n` +
        `  - *Phát sinh*: 200k/tuần (giặt đồ, xăng xe, lặt vặt, dư cuối tuần tự sang Tiết kiệm)\n` +
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
      reply += `💳 **Tổng số tiền:** \`${formatMoney(overview.totalBalance)}\`\n\n`;

      reply += `📊 **Tiến độ tuần (${overview.weekInfo.label}):**\n`;
      reply += `• Hạn mức chi tiêu tuần: \`${formatMoney(overview.weeklyBudget)}\`\n`;
      reply += `• Đã chi tiêu tuần này: \`${formatMoney(overview.spentThisWeek)}\`\n`;
      if (overview.remainingWeek >= 0) {
        reply += `• Còn lại tuần này: \`${formatMoney(overview.remainingWeek)}\` 🟢\n\n`;
      } else {
        reply += `• Đã thâm hụt: \`${formatMoney(Math.abs(overview.remainingWeek))}\` 🔴 (Vượt hạn mức!)\n\n`;
      }

      reply += `🏦 **Chi tiết 4 Quỹ:**\n`;
      reply += `• **Tiêu dùng:** \`${formatMoney(overview.spendingBalance)}\`\n`;
      reply += `• **Phát sinh:** \`${formatMoney(overview.extraBalance)}\`\n`;
      reply += `• **Trả nợ:** \`${formatMoney(overview.debtBalance)}\`\n`;
      reply += `• **Tiết kiệm:** \`${formatMoney(overview.savingsBalance)}\`\n\n`;

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
      const timeNote = financeData.hasCustomTime ? '' : ' *(Mặc định thời điểm nhập)*';

      const reply = `💰 **XÁC NHẬN GIAO DỊCH TIỀN BẠC**\n\n`
                  + `🏷️ Phân loại: ${typeLabel}\n`
                  + `💵 Số tiền: *${formatMoney(financeData.amount)}*\n`
                  + `🏦 Quỹ: *${financeData.fundName}*\n`
                  + `📝 Nội dung: *${financeData.description}*\n`
                  + `🕒 Thời gian: *${timeStr}*${timeNote}`;

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

// Tạo nội dung tin nhắn báo cáo chi tiết tình hình quỹ và tổng số dư sau giao dịch
function buildTransactionReport(result, overview, titlePrefix = '') {
  const typeLabel = result.type === 'income' ? '🟢 Thu nhập (+)' : '🔴 Chi tiêu (-)';
  const fundName = result.fund_name;
  const fundBal = result.fund_balance;

  // Báo cáo chi tiết tình hình quỹ vừa nhập
  let fundStatus = '';
  if (fundName === 'Tiêu dùng' || fundName === 'Phát sinh') {
    if (fundBal >= 0) {
      fundStatus = `• Số dư quỹ hiện tại: \`${formatMoney(fundBal)}\` 🟢`;
    } else {
      fundStatus = `• Số dư quỹ hiện tại: \`${formatMoney(fundBal)}\` 🔴 (Đã thâm hụt \`${formatMoney(Math.abs(fundBal))}\`)`;
    }
  } else if (fundName === 'Trả nợ') {
    if (fundBal < 0) {
      fundStatus = `• Số dư nợ hiện tại: \`${formatMoney(fundBal)}\` (Còn nợ: \`${formatMoney(Math.abs(fundBal))}\`) 🔴`;
    } else {
      fundStatus = `• Số dư nợ hiện tại: \`${formatMoney(fundBal)}\` (Đã hết nợ) 🟢`;
    }
  } else if (fundName === 'Tiết kiệm') {
    fundStatus = `• Số dư tiết kiệm hiện tại: \`${formatMoney(fundBal)}\` 🟢`;
  }

  const heading = titlePrefix ? `✅ **${titlePrefix}**` : `✅ **ĐÃ LƯU GIAO DỊCH THÀNH CÔNG!**`;

  let report = `${heading}\n\n`
             + `🏷️ Phân loại: ${typeLabel}\n`
             + `💵 Số tiền: *${formatMoney(result.amount)}*\n`
             + `📝 Nội dung: *${result.description}*\n`
             + `🕒 Thời gian: *${formatTime(result.created_at)}*\n\n`
             + `🏦 **BÁO CÁO TÌNH HÌNH QUỸ [${fundName}]:**\n`
             + `${fundStatus}\n\n`
             + `💳 **TỔNG SỐ DƯ HIỆN TẠI:** \`${formatMoney(result.total_balance)}\``;

  // Quỹ trả nợ và tiết kiệm không ảnh hưởng đến tiến độ tuần
  if (fundName !== 'Trả nợ' && fundName !== 'Tiết kiệm') {
    report += `\n\n📊 **Tiến độ chi tiêu tuần (${overview.weekInfo ? overview.weekInfo.label : 'Tuần này'}):**\n`
            + `• Đã chi tuần này: \`${formatMoney(overview.spentThisWeek)}\` / ${formatMoney(overview.weeklyBudget)}\n`
            + (overview.remainingWeek >= 0
                ? `• Còn lại tuần này: \`${formatMoney(overview.remainingWeek)}\` 🟢`
                : `• Đã thâm hụt tuần này: \`${formatMoney(Math.abs(overview.remainingWeek))}\` 🔴 (Vượt hạn mức!)`);
  }

  return report;
}

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

      const overview = await financeService.getOverview(chatId);
      const confirmMsg = buildTransactionReport(result, overview, 'ĐÃ LƯU GIAO DỊCH THÀNH CÔNG!');

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
  sendMessage,
  buildTransactionReport
};
