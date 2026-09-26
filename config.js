require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  adminChatId: process.env.ADMIN_CHAT_ID, 
  inviteCode: process.env.INVITE_CODE || 'VIP2026',
  dbUrl: process.env.DB_URL || 'file:./database.sqlite',
  dbAuthToken: process.env.DB_AUTH_TOKEN || ''
};
