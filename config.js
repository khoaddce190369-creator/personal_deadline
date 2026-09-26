require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  adminChatId: process.env.ADMIN_CHAT_ID, 
  dbUrl: process.env.DB_URL || 'file:./database.sqlite', // Mặc định lưu file local
  dbAuthToken: process.env.DB_AUTH_TOKEN || ''
};
