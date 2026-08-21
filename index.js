require('dotenv').config(); 
const { 
  Client, GatewayIntentBits, REST, Routes, 
  ActionRowBuilder, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, Events
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

// ==========================================
// 1. 身分組 ID 與職業選單設定
// ==========================================
const ROLES = {
  VERIFIED: '1540053101120323685',   // 已驗證
  UNVERIFIED: '1540053110846791762', // 未驗證
  JOBS: {
    '黑騎士': '1540050432796266526',
    '聖騎士': '1540051178396844153',
    '英雄': '1540051228459929631',
    '箭神': '1540051260005154967',
    '神射手': '1540051322525716601',
    '冰雷': '1540051347376832594',
    '火毒': '1540051370416017449',
    '主教': '1540051392138444880',
    '槍神': '1540051430050897921',
    '拳霸': '1540051450904969317',
    '刀賊': '1540051596518494228',
    '鏢賊': '1540051618345652275'
  }
};

// 暫存使用者選擇的職業
const userSelectedJob = new Map();

// ==========================================
// 2. 喚醒伺服器設定 (Express)
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
// 3. Firebase 初始化連線
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
// 4. 定義要註冊的斜線指令
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('幸運頻道')
    .setDescription('設定最大頻道數，隨機抽取今日的幸運頻道並記錄！')
    .addIntegerOption(option =>
      option
        .setName('最大頻道')
        .setDescription('請輸入伺服器的最大頻道數字 (例如：20 或 30)')
        .setRequired(true)
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('發送報到面板')
    .setDescription('【管理員專用】發送新手報到按鈕與職業選單面板')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

// ==========================================
// 5. Discord 機器人核心邏輯
// ==========================================
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ] 
});

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

// 🌟 新成員加入時自動賦予「未驗證」身分組
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await member.roles.add(ROLES.UNVERIFIED);
    console.log(`👤 新成員 ${member.user.tag} 加入，已自動發放「未驗證」身分組。`);
  } catch (error) {
    console.error(`❌ 自動發放「未驗證」身分組失敗 (${member.user.tag}):`, error);
  }
});

// 🌟 監聽互動 (包含斜線指令、選單選取、表單送出)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ==========================
    // [A] 處理斜線指令
    // ==========================
    if (interaction.isChatInputCommand()) {
      
      // 🎲 指令：幸運頻道
      if (interaction.commandName === '幸運頻道') {
        await interaction.deferReply();

        const maxChannel = interaction.options.getInteger('最大頻道');
        const luckyChannel = Math.floor(Math.random() * maxChannel) + 1;

        if (db) {
          try {
            await db.collection('lucky_channel_history').add({
              userId: interaction.user.id,
              username: interaction.user.username,
              maxChannel: maxChannel,
              luckyChannel: luckyChannel,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (error) {
            console.error('寫入幸運頻道紀錄失敗:', error);
          }
        }

        await interaction.editReply(`🎲 **${interaction.user.username}** 的今日幸運頻道抽取結果：\n\n✨ 幸運頻道為：**第 ${luckyChannel} 頻道** (範圍 1 ~ ${maxChannel})\n*(已自動存入資料庫)*`);
      }

      // 🆕 指令：發送報到面板
      if (interaction.commandName === '發送報到面板') {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_job_register')
          .setPlaceholder('🔽 請在此選擇你的主職業')
          .addOptions(
            Object.keys(ROLES.JOBS).map(jobName => 
              new StringSelectMenuOptionBuilder()
                .setLabel(jobName)
                .setValue(jobName)
                .setDescription(`選擇【${jobName}】並填寫報到表單`)
            )
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
          content: '歡迎來到伺服器！請先在下方下拉選單選擇你的 **主要職業**，隨後將彈出表單完成報到資料！',
          components: [row]
        });
      }
    }

    // ==========================
    // [B] 處理職業下拉選單選擇
    // ==========================
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_job_register') {
        const selectedJob = interaction.values[0];
        userSelectedJob.set(interaction.user.id, selectedJob);

        const modal = new ModalBuilder()
          .setCustomId('modal_register')
          .setTitle(`新手報到表單（已選：${selectedJob}）`);

        const reasonInput = new TextInputBuilder()
          .setCustomId('input_reason')
          .setLabel('1. 加入頻道的原因？')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('例如：想找人一起練等打王...')
          .setRequired(true);

        const levelInput = new TextInputBuilder()
          .setCustomId('input_level')
          .setLabel('2. 你的等級？')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如：120 等')
          .setRequired(true);

        const timeInput = new TextInputBuilder()
          .setCustomId('input_time')
          .setLabel('3. 平常遊玩的時間？')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如：平日晚上 8 點到 12 點')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(reasonInput),
          new ActionRowBuilder().addComponents(levelInput),
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
        await interaction.deferReply(); 

        const reason = interaction.fields.getTextInputValue('input_reason');
        const level = interaction.fields.getTextInputValue('input_level');
        const playtime = interaction.fields.getTextInputValue('input_time');
        const chosenJob = userSelectedJob.get(interaction.user.id) || '未知職業';

        // 1. 寫入 Firebase 資料庫
        if (db) {
          try {
            await db.collection('member_profiles').add({
              userId: interaction.user.id,
              username: interaction.user.username,
              reason: reason,
              job: chosenJob,
              level: level,
              playtime: playtime,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (error) {
            console.error('寫入報到資料失敗:', error);
          }
        }

        // 2. 身分組切換處理 (強制 fetch 確保取得伺服器最新成員實例)
        let roleSuccess = false;
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          
          // 移除「未驗證」身分組
          if (member.roles.cache.has(ROLES.UNVERIFIED)) {
            await member.roles.remove(ROLES.UNVERIFIED);
          }

          // 賦予「已驗證」身分組
          await member.roles.add(ROLES.VERIFIED);

          // 賦予所選職業身分組
          const jobRoleId = ROLES.JOBS[chosenJob];
          if (jobRoleId) {
            await member.roles.add(jobRoleId);
          }

          roleSuccess = true;
        } catch (roleError) {
          console.error('❌ 身分組賦予失敗 (請檢查 Bot 身分組順序是否高於目標身分組):', roleError);
        }

        // 3. 回覆報到結果
        let replyContent = `🎉 歡迎 <@${interaction.user.id}> 完成報到！\n\n**📌 加入原因**：\n${reason}\n\n**⚔️ 職業**：${chosenJob}\n**🎖️ 等級**：${level}\n**⏱️ 遊玩時間**：${playtime}`;
        
        if (roleSuccess) {
          replyContent += `\n\n✨ 已為您賦予 **【已驗證】** 與 **【${chosenJob}】** 身分組！`;
        } else {
          replyContent += `\n\n⚠️ 已記錄資料，但身分組自動賦予失敗，請通知管理員檢查權限設定。`;
        }

        await interaction.editReply({ content: replyContent });

        // 清理暫存
        userSelectedJob.delete(interaction.user.id);
      }
    }
  } catch (err) {
    console.error('處理互動時發生錯誤:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
