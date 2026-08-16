const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

if (!token) {
  console.warn('BOT_TOKEN topilmadi — bot ishga tushmadi (faqat API server ishlaydi).');
  module.exports = null;
  return;
}

const bot = new TelegramBot(token, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Salom! 👋\n\nPul Nazorati ilovasiga xush kelibsiz — daromad va xarajatlaringizni shu yerdan boshqarishingiz mumkin.', {
    reply_markup: {
      inline_keyboard: [[
        { text: '💰 Ilovani ochish', web_app: { url: webAppUrl } }
      ]]
    }
  });
});

console.log('Telegram bot polling rejimida ishga tushdi.');

module.exports = bot;
