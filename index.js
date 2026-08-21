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
const cron = require('node-cron');

// ==========================================
// 1. 伺服器常數設定 (身分組 & 目標頻道 ID)
// ==========================================
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID || '1476762995454640159';

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

// 產生報到 / 更新等級 下拉選單 UI
function createRegisterMenuRow() {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_job_register')
    .setPlaceholder('🔽 請在此選擇你的主職業')
    .addOptions(
      Object.keys(ROLES.JOBS).map(jobName => 
        new StringSelectMenuOptionBuilder()
          .setLabel(jobName)
          .setValue(jobName)
          .setDescription(`選擇【${jobName}】並填寫報到 / 更新等級表單`)
      )
    );
  return new ActionRowBuilder().addComponents(selectMenu);
}

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
    .setName('報到')
    .setDescription('【管理員專用】發送報到 / 更新等級面板')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('職業查詢')
    .setDescription('查詢伺服器成員的名冊資訊 (遊戲ID_職業_等級)')
    .addStringOption(option =>
      option
        .setName('職業名稱')
        .setDescription('選擇要查詢的特定職業 (若留空則顯示全部)')
        .setRequired(false)
        .addChoices(
          Object.keys(ROLES.JOBS).map(jobName => ({ name: jobName, value: jobName }))
        )
    )
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

  // 🌟 每週二早上 08:00 (台北時間) 自動發布「更新等級」公告
  cron.schedule('0 0 8 * * 2', async () => {
    console.log('⏰ 觸發每週二定時任務：發送更新等級面板');

    try {
      const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        await channel.send({
          content: '📢 **【每週例行更新】** 早安冒險家們！又到了每週二更新等級的時間囉～\n若等級有提升或職業變更，請直接在下方選單重新選擇並提交資料喔！',
          components: [createRegisterMenuRow()]
        });
        console.log(`✅ 已成功於頻道 ${REPORT_CHANNEL_ID} 發送更新面板`);
      }
    } catch (err) {
      console.error('❌ 定時發送面板失敗:', err);
    }
  }, {
    timezone: 'Asia/Taipei'
  });
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

      // 🆕 指令：報到
      if (interaction.commandName === '報到') {
        await interaction.reply({
          content: '歡迎來到伺服器！請先在下方下拉選單選擇你的 **主要職業**，隨後將彈出表單完成報到 / 更新等級資料！',
          components: [createRegisterMenuRow()]
        });
      }

      // 🔍 指令：職業查詢
      if (interaction.commandName === '職業查詢') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線，無法查詢名冊。', ephemeral: true });
        await interaction.deferReply();

        const targetJob = interaction.options.getString('職業名稱');

        try {
          let query = db.collection('member_profiles');
          if (targetJob) {
            query = query.where('job', '==', targetJob);
          }

          const snapshot = await query.get();
          if (snapshot.empty) {
            return interaction.editReply(targetJob ? `📋 目前尚無 **【${targetJob}】** 的成員紀錄。` : '📋 目前尚無任何成員報到紀錄。');
          }

          // 去重處理：同一位使用者保留最新的一筆資料
          const userMap = new Map();
          snapshot.forEach(doc => {
            const data = doc.data();
            const existing = userMap.get(data.userId);
            const dataTime = data.timestamp ? data.timestamp.toMillis() : 0;
            if (!existing || (existing.time < dataTime)) {
              userMap.set(data.userId, { ...data, time: dataTime });
            }
          });

          const profiles = Array.from(userMap.values());
          // 依等級由高至低排序
          profiles.sort((a, b) => (parseInt(b.level) || 0) - (parseInt(a.level) || 0));

          let replyText = targetJob 
            ? `📋 **【${targetJob}】成員名冊 (共 ${profiles.length} 人)**\n\n`
            : `📋 **伺服器成員名冊 (共 ${profiles.length} 人)**\n\n`;

          profiles.forEach((p, idx) => {
            replyText += `${idx + 1}. \`(${p.ign || '未填'}_${p.job}_${p.level}等)\` - <@${p.userId}>\n`;
          });

          // 超過 2000 字元截斷防呆
          if (replyText.length > 1950) {
            replyText = replyText.substring(0, 1950) + '\n...(資料過長已截斷)';
          }

          await interaction.editReply(replyText);
        } catch (error) {
          console.error('查詢名冊失敗:', error);
          await interaction.editReply('❌ 查詢名冊時發生錯誤。');
        }
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
          .setTitle(`報到 / 更新等級（職業：${selectedJob}）`);

        const ignInput = new TextInputBuilder()
          .setCustomId('input_ign')
          .setLabel('1. 你的遊戲名稱（遊戲ID）？')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如：Edward')
          .setRequired(true);

        const levelInput = new TextInputBuilder()
          .setCustomId('input_level')
          .setLabel('2. 你的角色等級？')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如：120')
          .setRequired(true);

        const reasonInput = new TextInputBuilder()
          .setCustomId('input_reason')
          .setLabel('3. 加入原因 / 近況更新？')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('例如：想找人一起練等打王...')
          .setRequired(false);

        const timeInput = new TextInputBuilder()
          .setCustomId('input_time')
          .setLabel('4. 平常遊玩的時間？')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('例如：平日晚上 8 點到 12 點')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(ignInput),
          new ActionRowBuilder().addComponents(levelInput),
          new ActionRowBuilder().addComponents(reasonInput),
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

        const ign = interaction.fields.getTextInputValue('input_ign').trim();
        const rawLevel = interaction.fields.getTextInputValue('input_level').trim();
        const level = rawLevel.replace(/[^0-9]/g, '') || rawLevel;
        const reason = interaction.fields.getTextInputValue('input_reason')?.trim() || '無';
        const playtime = interaction.fields.getTextInputValue('input_time')?.trim() || '未填寫';
        const chosenJob = userSelectedJob.get(interaction.user.id) || '未知職業';

        const newNickname = `[${level}_${chosenJob}] ${ign}`.substring(0, 32);

        // 1. 寫入 Firebase 資料庫
        if (db) {
          try {
            await db.collection('member_profiles').add({
              userId: interaction.user.id,
              username: interaction.user.username,
              ign: ign,
              job: chosenJob,
              level: level,
              reason: reason,
              playtime: playtime,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (error) {
            console.error('寫入資料失敗:', error);
          }
        }

        // 2. 身分組覆蓋與暱稱更新
        let roleSuccess = false;
        let nickSuccess = false;

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          
          // 移除「未驗證」身分組
          if (member.roles.cache.has(ROLES.UNVERIFIED)) {
            await member.roles.remove(ROLES.UNVERIFIED);
          }

          // 賦予「已驗證」身分組
          await member.roles.add(ROLES.VERIFIED);

          // 清除舊的職業身分組
          const allJobRoleIds = Object.values(ROLES.JOBS);
          const oldJobRolesToRemove = member.roles.cache.filter(role => allJobRoleIds.includes(role.id));
          if (oldJobRolesToRemove.size > 0) {
            await member.roles.remove(oldJobRolesToRemove);
          }

          // 賦予新選的職業身分組
          const newJobRoleId = ROLES.JOBS[chosenJob];
          if (newJobRoleId) {
            await member.roles.add(newJobRoleId);
          }
          roleSuccess = true;

          // 自動更新伺服器暱稱
          try {
            await member.setNickname(newNickname);
            nickSuccess = true;
          } catch (nickError) {
            console.error('❌ 修改暱稱失敗 (若為 Owner 則無法修改):', nickError.message);
          }

        } catch (roleError) {
          console.error('❌ 身分組賦予失敗:', roleError);
        }

        // 3. 回覆報到 / 更新結果
        let replyContent = `🎉 <@${interaction.user.id}> 的資料已完成更新！\n\n` +
          `**🎮 遊戲名稱**：${ign}\n` +
          `**⚔️ 職業**：${chosenJob}\n` +
          `**🎖️ 等級**：${level}\n` +
          `**⏱️ 遊玩時間**：${playtime}\n` +
          `**📌 備註/原因**：\n${reason}\n\n`;
        
        if (roleSuccess) {
          replyContent += `✨ 已為您重新整理身分組為 **【已驗證】** 與 **【${chosenJob}】**！\n`;
        } else {
          replyContent += `⚠️ 身分組自動賦予失敗，請通知管理員檢查權限。\n`;
        }

        if (nickSuccess) {
          replyContent += `🏷️ 已將您的伺服器暱稱更新為：\`${newNickname}\``;
        } else {
          replyContent += `*(提示：若您是伺服器擁有者或管理員，因權限限制無法由機器人改名)*`;
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
