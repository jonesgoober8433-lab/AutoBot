require('dotenv').config(); 
const { 
  Client, GatewayIntentBits, REST, Routes, 
  ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, Events
} = require('discord.js');
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
  },
  {
    name: '發送報到面板',
    description: '【管理員專用】發送新手報到按鈕面板',
    default_member_permissions: PermissionFlagsBits.Administrator.toString(), // 限制僅管理員可用
  }
];

// ==========================================
// 4. Discord 機器人核心邏輯
// ==========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 防範 Discord Client 拋出未捕獲錯誤導致程序終止
client.on('error', (err) => console.error('Discord Client Error:', err));

client.once(Events.ClientReady, async () => {
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

// 🌟 監聽互動 (包含斜線指令、按鈕點擊、表單送出)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ==========================
    // [A] 處理斜線指令
    // ==========================
    if (interaction.isChatInputCommand()) {
      
      // 🔮 指令：占卜
      if (interaction.commandName === '占卜') {
        await interaction.deferReply(); 
        const fortunes = ['大吉🌟', '中吉✨', '小吉🍵', '吉💪', '末吉🍂', '凶👀', '大凶🛌'];
        const result = fortunes[Math.floor(Math.random() * fortunes.length)];

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

      // 📜 指令：歷史占卜
      if (interaction.commandName === '歷史占卜') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線，無法查詢紀錄。', ephemeral: true });
        await interaction.deferReply();
        try {
          const snapshot = await db.collection('fortune_history').where('userId', '==', interaction.user.id).get();
          if (snapshot.empty) return interaction.editReply('📜 你還沒有任何占卜紀錄喔！趕快先使用 /占卜 試試看吧！');
          
          const records = [];
          snapshot.forEach(doc => records.push(doc.data()));
          records.sort((a, b) => (b.timestamp ? b.timestamp.toMillis() : 0) - (a.timestamp ? a.timestamp.toMillis() : 0));
          
          let historyText = `📜 ${interaction.user.username} 的最近 5 次占卜紀錄：\n\n`;
          records.slice(0, 5).forEach((data, index) => {
            const timeString = data.timestamp ? data.timestamp.toDate().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '剛剛';
            historyText += `${index + 1}. [${timeString}] 抽到了 ${data.fortune}\n`; 
          });
          await interaction.editReply(historyText);
        } catch (error) {
          console.error('讀取歷史紀錄失敗:', error);
          await interaction.editReply('❌ 讀取歷史紀錄時發生錯誤。');
        }
      }

      // 🆕 指令：發送報到面板
      if (interaction.commandName === '發送報到面板') {
        const registerButton = new ButtonBuilder()
          .setCustomId('btn_open_register')
          .setLabel('📝 點我填寫報到資料')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(registerButton);

        await interaction.reply({
          content: '歡迎來到伺服器！請點擊下方的按鈕填寫你的報到資料，讓大家認識你喔！',
          components: [row]
        });
      }
    }

    // ==========================
    // [B] 處理按鈕點擊事件
    // ==========================
    if (interaction.isButton()) {
      if (interaction.customId === 'btn_open_register') {
        const modal = new ModalBuilder()
          .setCustomId('modal_register')
          .setTitle('新手報到表單');

        const reasonInput = new TextInputBuilder()
          .setCustomId('input_reason')
          .setLabel('1. 加入頻道的原因？')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('例如：想找人一起練等打王...')
          .setRequired(true);

        const jobInput = new TextInputBuilder()
          .setCustomId('input_job')
          .setLabel('2. 你的職業與等級？')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如：龍騎士 / 120等')
          .setRequired(true);

        const timeInput = new TextInputBuilder()
          .setCustomId('input_time')
          .setLabel('3. 平常遊玩的時間？')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如：平日晚上 8 點到 12 點')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(reasonInput),
          new ActionRowBuilder().addComponents(jobInput),
          new ActionRowBuilder().addComponents(timeInput)
        );

        await interaction.showModal(modal);
      }
    }

    // ==========================
    // [C] 處理表單送出事件
    // ==========================
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_register') {
        // 先 deferReply 避免寫入 Firebase 時超時 (3秒限制)
        await interaction.deferReply(); 

        const reason = interaction.fields.getTextInputValue('input_reason');
        const job = interaction.fields.getTextInputValue('input_job');
        const playtime = interaction.fields.getTextInputValue('input_time');

        if (db) {
          try {
            await db.collection('member_profiles').add({
              userId: interaction.user.id,
              username: interaction.user.username,
              reason: reason,
              job_level: job,
              playtime: playtime,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (error) {
            console.error('寫入報到資料失敗:', error);
          }
        }

        await interaction.editReply({
          content: `🎉 歡迎 <@${interaction.user.id}> 完成報到！\n\n**📌 加入原因**：\n${reason}\n\n**⚔️ 職業/等級**：${job}\n**⏱️ 遊玩時間**：${playtime}`,
        });
      }
    }
  } catch (err) {
    console.error('處理互動時發生錯誤:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
