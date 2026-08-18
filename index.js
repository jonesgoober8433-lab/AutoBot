require('dotenv').config(); 
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// ==========================================
// 1. 喚醒伺服器設定 (Express) - 給 UptimeRobot 敲門用
// ==========================================
const app = express();
app.get('/', (req, res) => {
  res.send('Auto-Bot Server is Online!');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 網頁伺服器已啟動於 Port ${PORT}`);
});

// ==========================================
// 2. Discord 機器人核心邏輯
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent 
  ]
});

client.once('ready', () => {
  console.log(`✅ 機器人已成功上線，登入身分：${client.user.tag}`);
});

// 🌟 監聽訊息與指令邏輯
client.on('messageCreate', (message) => {
  // 避免機器人回覆自己或其他機器人
  if (message.author.bot) return;

  // 🔮 幸運占卜指令
  if (message.content === '!占卜') {
    // 定義運勢陣列
    const fortunes = [
      '大吉：今天運氣爆棚，心想事成！🌟',
      '中吉：穩穩當當，會有意想不到的小驚喜。✨',
      '小吉：平靜的一天，適合喝杯好茶放鬆一下。🍵',
      '吉：按部就班，努力會有回報的。💪',
      '末吉：遇到小挫折別灰心，轉機就在眼前。🍂',
      '凶：今天稍微低調一點，謹言慎行喔！👀',
      '大凶：諸事不宜，建議早點洗洗睡保平安。🛌'
    ];
    
    // 隨機抽取一個運勢
    const randomIndex = Math.floor(Math.random() * fortunes.length);
    const result = fortunes[randomIndex];

    // 回覆使用者
    message.reply(`🔮 來自星星的指引：**${result}**`);
  }
});

// 啟動機器人 (使用環境變數讀取 Token)
client.login(process.env.DISCORD_TOKEN);
