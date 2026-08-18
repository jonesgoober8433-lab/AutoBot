require('dotenv').config(); 
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const express = require('express');

// ==========================================
// 1. 喚醒伺服器設定 (Express)
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
// 2. 定義要註冊的斜線指令 (Slash Commands)
// ==========================================
const commands = [
  {
    name: '占卜',
    description: '抽取今天的幸運運勢！',
  }
];

// ==========================================
// 3. Discord 機器人核心邏輯
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // 如果只用斜線指令，甚至可以不需要 MessageContent Intents
  ]
});

// 當機器人準備就緒時，向 Discord 註冊指令
client.once('ready', async () => {
  console.log(`✅ 機器人已成功上線，登入身分：${client.user.tag}`);
  
  try {
    console.log('⏳ 開始向 Discord 註冊斜線指令...');
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    // 註冊全域指令 (這會讓指令出現在所有加入的伺服器)
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('✅ 斜線指令註冊成功！');
  } catch (error) {
    console.error('❌ 註冊斜線指令失敗:', error);
  }
});

// 🌟 監聽使用者的斜線指令互動
client.on('interactionCreate', async (interaction) => {
  // 如果這不是一個斜線指令，就直接忽略
  if (!interaction.isChatInputCommand()) return;

  // 🔮 幸運占卜指令的邏輯
  if (interaction.commandName === '占卜') {
    const fortunes = [
      '大吉：今天運氣爆棚，心想事成！🌟',
      '中吉：穩穩當當，會有意想不到的小驚喜。✨',
      '小吉：平靜的一天，適合喝杯好茶放鬆一下。🍵',
      '吉：按部就班，努力會有回報的。💪',
      '末吉：遇到小挫折別灰心，轉機就在眼前。🍂',
      '凶：今天稍微低調一點，謹言慎行喔！👀',
      '大凶：諸事不宜，建議早點洗洗睡保平安。🛌'
    ];
    
    const randomIndex = Math.floor(Math.random() * fortunes.length);
    const result = fortunes[randomIndex];

    // 斜線指令必須使用 interaction.reply() 來回覆
    await interaction.reply(`🔮 來自星星的指引：**${result}**`);
  }
});

// 啟動機器人
client.login(process.env.DISCORD_TOKEN);
