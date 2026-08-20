require('dotenv').config(); 
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

// ==========================================
// 1. Wake-up server settings (Express)
// ==========================================
const app = express();
app.get('/', (req, res) => {
  res.send('Auto-Bot Server is Online!');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Web server started on Port ${PORT}`);
});

// ==========================================
// 2. Firebase Initialization Connection
// ==========================================
let db;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('✅ Firebase Firestore connection successful');
  } else {
    console.log('⚠️ FIREBASE_CREDENTIALS not detected, skipping database connection');
  }
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
}

// ==========================================
// 3. Define the slash commands to register
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
// 4. Discord Bot Core Logic
// ==========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✅ Bot successfully online, logged in as: ${client.user.tag}`);
  
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('✅ Slash commands registered successfully!');
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }
});

// 🌟 Listen for interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // 🔮 Command: Divination (with database writing feature)
  if (interaction.commandName === '占卜') {
    // Since writing to the database takes time, first tell Discord we are processing
    await interaction.deferReply(); 

    const fortunes = ['大吉🌟', '中吉✨', '小吉🍵', '吉💪', '末吉🍂', '凶👀', '大凶🛌'];
    const result = fortunes[Math.floor(Math.random() * fortunes.length)];

    // Attempt to save to Firebase
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

    await interaction.editReply(`🔮 來自星星的指引：${result}\n*(已自動為您存入歷史紀錄)*`);
  }

  // 📜 Command: History (Database reading feature)
  if (interaction.commandName === '歷史占卜') {
    if (!db) {
      return interaction.reply({ content: '❌ 資料庫未連線，無法查詢紀錄。', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const userId = interaction.user.id;
      // Fetch all records for this user from the database
      const snapshot = await db.collection('fortune_history')
        .where('userId', '==', userId)
        .get();

      if (snapshot.empty) {
        return interaction.editReply('📜 你還沒有任何占卜紀錄喔！趕快先使用 `/占卜` 試試看吧！');
      }

      // Extract data and sort by time from newest to oldest
      const records = [];
      snapshot.forEach(doc => records.push(doc.data()));
      records.sort((a, b) => {
        const timeA = a.timestamp ? a.timestamp.toMillis() : 0;
        const timeB = b.timestamp ? b.timestamp.toMillis() : 0;
        return timeB - timeA;
      });

      // Only take the top 5
      const top5 = records.slice(0, 5);

      // Construct message text
      let historyText = `📜 ${interaction.user.username} 的最近 5 次占卜紀錄：\n\n`;
      top5.forEach((data, index) => {
        // Convert timestamp to Taiwan time string
        const timeString = data.timestamp 
          ? data.timestamp.toDate().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) 
          : '剛剛';
        historyText += `${index + 1}.[${timeString}] 抽到了 ${data.fortune}\n`;
      });

      await interaction.editReply(historyText);
    } catch (error) {
      console.error('讀取歷史紀錄失敗:', error);
      await interaction.editReply('❌ 讀取歷史紀錄時發生錯誤。');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
