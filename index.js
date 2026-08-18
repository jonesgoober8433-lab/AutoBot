require('dotenv').config(); 
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

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
// 2. Firebase 初始化連線
// ==========================================
let db;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('✅ Firebase Firestore 連線成功');
  } else {
    console.log('⚠️ 未偵測到 FIREBASE_CREDENTIALS，跳過資料庫連線');
  }
} catch (error) {
  console.error('❌ Firebase 初始化失敗:', error.message);
}

// ==========================================
// 3. 定義要註冊的斜線指令
// ==========================================
const commands = [
  {
    name: '占卜',
    description: '抽取今天的幸運運勢，並自動記錄到資料庫！',
  },
  {
    name: '歷史占卜',
    description: '從資料庫查詢你最近的 5 次占卜紀錄',
  }
];

// ==========================================
// 4. Discord 機器人核心邏輯
// ==========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✅ 機器人已成功上線，登入身分：${client.user.tag}`);
  
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('✅ 斜線指令註冊成功！');
  } catch (error) {
    console.error('❌ 註冊斜線指令失敗:', error);
  }
});

// 🌟 監聽互動
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // 🔮 指令：占卜 (加入寫入資料庫功能)
  if (interaction.commandName === '占卜') {
    // 因為寫入資料庫需要時間，先告訴 Discord 我們正在處理
    await interaction.deferReply(); 

    const fortunes = ['大吉🌟', '中吉✨', '小吉🍵', '吉💪', '末吉🍂', '凶👀', '大凶🛌'];
    const result = fortunes[Math.floor(Math.random() * fortunes.length)];

    // 嘗試存入 Firebase
    if (db) {
      try {
        await db.collection('fortune_history').add({
          userId: interaction.user.id,
          username: interaction.user.username,
          fortune: result,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (error) {
        console.error('寫入占卜紀錄失敗:', error);
      }
    }

    await interaction.editReply(`🔮 來自星星的指引：**${result}**\n*(已自動為您存入歷史紀錄)*`);
  }

  // 📜 指令：歷史占卜 (讀取資料庫功能)
  if (interaction.commandName === '歷史占卜') {
    if (!db) {
      return interaction.reply({ content: '❌ 資料庫未連線，無法查詢紀錄。', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const userId = interaction.user.id;
      // 從資料庫抓取這位使用者的所有紀錄
      const snapshot = await db.collection('fortune_history')
        .where('userId', '==', userId)
        .get();

      if (snapshot.empty) {
        return interaction.editReply('📜 你還沒有任何占卜紀錄喔！趕快先使用 `/占卜` 試試看吧！');
      }

      // 將資料取出並依時間由新到舊排序 (在程式內排序，避免初學者碰到 Firebase 索引問題)
      const records = [];
      snapshot.forEach(doc => records.push(doc.data()));
      records.sort((a, b) => {
        const timeA = a.timestamp ? a.timestamp.toMillis() : 0;
        const timeB = b.timestamp ? b.timestamp.toMillis() : 0;
        return timeB - timeA;
      });

      // 只取前 5 筆
      const top5 = records.slice(0, 5);

      // 組合訊息文字
      let historyText = `📜 **${interaction.user.username} 的最近 5 次占卜紀錄：**\n\n`;
      top5.forEach((data, index) => {
        // 將時間戳轉換為台灣時間字串
        const timeString = data.timestamp 
          ? data.timestamp.toDate().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) 
          : '剛剛';
        historyText += `${index + 1}. [${timeString}] 抽到了 **${data.fortune}**\n`;
      });

      await interaction.editReply(historyText);
    } catch (error) {
      console.error('讀取歷史紀錄失敗:', error);
      await interaction.editReply('❌ 讀取歷史紀錄時發生錯誤。');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
