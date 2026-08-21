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
  VERIFIED: '1540053101120323685',    // 已驗證
  UNVERIFIED: '1540053110846791762',  // 未驗證
  RETIRED: '1540327837947396166',     // 暫.退休
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
  const options = Object.keys(ROLES.JOBS).map(jobName => 
    new StringSelectMenuOptionBuilder()
      .setLabel(jobName)
      .setValue(jobName)
      .setDescription(`主職業【${jobName}】並填寫/更新名冊`)
  );

  // 加入「暫.退休」選項
  options.push(
    new StringSelectMenuOptionBuilder()
      .setLabel('💤 暫.退休')
      .setValue('RETIRED_OPTION')
      .setDescription('轉換為退休身分組，卸下職業身分')
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_job_register')
    .setPlaceholder('🔽 請選擇你的主要職業或狀態')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(selectMenu);
}

// 解析小號文字工具函式 (格式: ID/職業/等級 或 ID 職業 等級)
function parseSubCharacter(rawText) {
  if (!rawText || !rawText.trim()) return null;
  const parts = rawText.split(/[/\\|\s,，_-]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const ign = parts[0] || '未填ID';
  let job = '未知職業';
  let level = '1';

  // 嘗試比對職業關鍵字
  for (const p of parts.slice(1)) {
    for (const validJob of Object.keys(ROLES.JOBS)) {
      if (p.includes(validJob)) {
        job = validJob;
        break;
      }
    }
    const cleanNum = p.replace(/[^0-9]/g, '');
    if (cleanNum && !isNaN(cleanNum)) {
      level = cleanNum;
    }
  }

  return { ign, job, level, raw: rawText.trim() };
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
    .setDescription('查詢伺服器成員的名冊資訊 (分組顯示本尊與小號)')
    .addStringOption(option =>
      option
        .setName('職業名稱')
        .setDescription('選擇要查詢的特定職業 (若留空則顯示全職業分組)')
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

  // 🌟 每週二早上 08:00 (台北時間) 定時發布「更新等級」公告
  cron.schedule('0 0 8 * * 2', async () => {
    console.log('⏰ 觸發每週二定時任務：發送更新等級面板');
    try {
      const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        await channel.send({
          content: '📢 **【每週例行更新】** 早安冒險家們！又到了每週二更新等級的時間囉～\n若等級有提升、小號增減或職業變更，請直接在下方選單選擇填寫（系統會自動預載您上次的資料喔）！',
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
          content: '歡迎來到伺服器！請先在下方下拉選單選擇你的 **主要職業** 或 **暫.退休** 狀態，隨後將彈出表單完成名冊更新！',
          components: [createRegisterMenuRow()]
        });
      }

      // 🔍 指令：職業查詢 (依職業分組)
      if (interaction.commandName === '職業查詢') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線，無法查詢名冊。', ephemeral: true });
        await interaction.deferReply();

        const targetJob = interaction.options.getString('職業名稱');

        try {
          const snapshot = await db.collection('member_profiles').get();
          if (snapshot.empty) {
            return interaction.editReply('📋 目前尚無任何成員名冊紀錄。');
          }

          const members = [];
          snapshot.forEach(doc => members.push(doc.data()));

          // 如果指定單一職業
          if (targetJob) {
            const list = [];
            for (const m of members) {
              if (m.isRetired) continue;
              if (m.mainJob === targetJob) {
                list.push({ text: `\`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}> **【本尊】**`, level: parseInt(m.mainLevel) || 0 });
              }
              if (m.sub1 && m.sub1.job === targetJob) {
                list.push({ text: `\`(${m.sub1.ign}_${m.sub1.job}_${m.sub1.level}等)\` - <@${m.userId}> *(本尊: ${m.mainIgn})*`, level: parseInt(m.sub1.level) || 0 });
              }
              if (m.sub2 && m.sub2.job === targetJob) {
                list.push({ text: `\`(${m.sub2.ign}_${m.sub2.job}_${m.sub2.level}等)\` - <@${m.userId}> *(本尊: ${m.mainIgn})*`, level: parseInt(m.sub2.level) || 0 });
              }
            }

            if (list.length === 0) {
              return interaction.editReply(`📋 目前尚無 **【${targetJob}】** 的成員或分身紀錄。`);
            }

            list.sort((a, b) => b.level - a.level);
            let replyText = `📋 **【${targetJob}】名冊 (共 ${list.length} 位角色)**\n\n` + list.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n');
            if (replyText.length > 1950) replyText = replyText.substring(0, 1950) + '\n...(截斷)';
            return await interaction.editReply(replyText);
          }

          // 全職業分組顯示
          let replyText = `📋 **伺服器職業名冊總覽**\n\n`;
          for (const jobName of Object.keys(ROLES.JOBS)) {
            const currentJobCharacters = [];
            for (const m of members) {
              if (m.isRetired) continue;
              if (m.mainJob === jobName) {
                currentJobCharacters.push({ text: `\`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` <@${m.userId}>`, level: parseInt(m.mainLevel) || 0 });
              }
              if (m.sub1 && m.sub1.job === jobName) {
                currentJobCharacters.push({ text: `\`(${m.sub1.ign}_${m.sub1.job}_${m.sub1.level}等)\` *(分)*`, level: parseInt(m.sub1.level) || 0 });
              }
              if (m.sub2 && m.sub2.job === jobName) {
                currentJobCharacters.push({ text: `\`(${m.sub2.ign}_${m.sub2.job}_${m.sub2.level}等)\` *(分)*`, level: parseInt(m.sub2.level) || 0 });
              }
            }

            if (currentJobCharacters.length > 0) {
              currentJobCharacters.sort((a, b) => b.level - a.level);
              replyText += `**【${jobName}】** (${currentJobCharacters.length})\n`;
              replyText += currentJobCharacters.map(c => `• ${c.text}`).join('\n') + '\n\n';
            }
          }

          // 顯示退休人員清單
          const retiredMembers = members.filter(m => m.isRetired);
          if (retiredMembers.length > 0) {
            replyText += `**【💤 暫.退休】** (${retiredMembers.length})\n`;
            replyText += retiredMembers.map(m => `• <@${m.userId}> (\`${m.mainIgn || '退休'}\`)`).join('\n') + '\n';
          }

          if (replyText.length > 1950) {
            replyText = replyText.substring(0, 1950) + '\n...(資料過長已截斷，可使用 /職業查詢 [職業名稱] 查看特定職業)';
          }

          await interaction.editReply(replyText);
        } catch (error) {
          console.error('查詢名冊失敗:', error);
          await interaction.editReply('❌ 查詢名冊時發生錯誤。');
        }
      }
    }

    // ==========================
    // [B] 處理下拉選單選擇 (預抓上次資料)
    // ==========================
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_job_register') {
        const selectedValue = interaction.values[0];

        // 1. 讀取上次的資料作為預設值
        let prevData = {};
        if (db) {
          try {
            const userDoc = await db.collection('member_profiles').doc(interaction.user.id).get();
            if (userDoc.exists) {
              prevData = userDoc.data() || {};
            }
          } catch (e) {
            console.error('讀取歷史名冊失敗:', e);
          }
        }

        // 🌟 處理「暫.退休」選項
        if (selectedValue === 'RETIRED_OPTION') {
          const modal = new ModalBuilder()
            .setCustomId('modal_retire')
            .setTitle('轉換身分：暫.退休');

          const retireIgnInput = new TextInputBuilder()
            .setCustomId('input_retire_ign')
            .setLabel('遊戲名稱 / 暱稱 (留空則用 Discord 名字)')
            .setStyle(TextInputStyle.Short)
            .setValue(prevData.mainIgn || interaction.user.displayName || '')
            .setRequired(false);

          modal.addComponents(new ActionRowBuilder().addComponents(retireIgnInput));
          return await interaction.showModal(modal);
        }

        // 🌟 處理「正常職業選擇」
        userSelectedJob.set(interaction.user.id, selectedValue);

        const modal = new ModalBuilder()
          .setCustomId('modal_register_multi')
          .setTitle(`報到/更新（主職：${selectedValue}）`);

        const mainIgnInput = new TextInputBuilder()
          .setCustomId('input_main_ign')
          .setLabel('1. 本尊遊戲ID (必填)')
          .setStyle(TextInputStyle.Short)
          .setValue(prevData.mainIgn || '')
          .setPlaceholder('例如：Edward')
          .setRequired(true);

        const mainLevelInput = new TextInputBuilder()
          .setCustomId('input_main_level')
          .setLabel('2. 本尊等級 (必填，純數字)')
          .setStyle(TextInputStyle.Short)
          .setValue(prevData.mainLevel || '')
          .setPlaceholder('例如：120')
          .setRequired(true);

        const playtimeInput = new TextInputBuilder()
          .setCustomId('input_playtime')
          .setLabel('3. 平常遊玩時間 (必填)')
          .setStyle(TextInputStyle.Short)
          .setValue(prevData.playtime || '')
          .setPlaceholder('例如：平日晚上 8 點到 12 點')
          .setRequired(true);

        const sub1Input = new TextInputBuilder()
          .setCustomId('input_sub1')
          .setLabel('4. 小號 1 (選填，格式：名稱/職業/等級)')
          .setStyle(TextInputStyle.Short)
          .setValue(prevData.sub1?.raw || '')
          .setPlaceholder('例如：小神射/神射手/90')
          .setRequired(false);

        const sub2Input = new TextInputBuilder()
          .setCustomId('input_sub2')
          .setLabel('5. 小號 2 (選填，格式：名稱/職業/等級)')
          .setStyle(TextInputStyle.Short)
          .setValue(prevData.sub2?.raw || '')
          .setPlaceholder('例如：小主教/主教/75')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(mainIgnInput),
          new ActionRowBuilder().addComponents(mainLevelInput),
          new ActionRowBuilder().addComponents(playtimeInput),
          new ActionRowBuilder().addComponents(sub1Input),
          new ActionRowBuilder().addComponents(sub2Input)
        );

        await interaction.showModal(modal);
      }
    }

    // ==========================
    // [C] 處理表單送出事件
    // ==========================
    if (interaction.isModalSubmit()) {
      
      // 💤 處理「暫.退休」送出
      if (interaction.customId === 'modal_retire') {
        await interaction.deferReply();

        const inputIgn = interaction.fields.getTextInputValue('input_retire_ign')?.trim();
        const displayIgn = inputIgn || interaction.user.displayName || interaction.user.username;
        const newNickname = `[退休] ${displayIgn}`.substring(0, 32);

        // 1. 更新 Firebase (Doc ID: userId)
        if (db) {
          try {
            await db.collection('member_profiles').doc(interaction.user.id).set({
              userId: interaction.user.id,
              username: interaction.user.username,
              mainIgn: displayIgn,
              isRetired: true,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          } catch (e) {
            console.error('寫入退休資料失敗:', e);
          }
        }

        // 2. 身分組與暱稱切換
        let nickSuccess = false;
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          
          // 移除未驗證身分組
          if (member.roles.cache.has(ROLES.UNVERIFIED)) {
            await member.roles.remove(ROLES.UNVERIFIED);
          }

          // 移除所有職業身分組
          const allJobRoleIds = Object.values(ROLES.JOBS);
          const oldJobRoles = member.roles.cache.filter(role => allJobRoleIds.includes(role.id));
          if (oldJobRoles.size > 0) {
            await member.roles.remove(oldJobRoles);
          }

          // 賦予已驗證與暫.退休身分組
          await member.roles.add(ROLES.VERIFIED);
          await member.roles.add(ROLES.RETIRED);

          try {
            await member.setNickname(newNickname);
            nickSuccess = true;
          } catch (ne) {
            console.error('修改退休暱稱失敗:', ne.message);
          }
        } catch (err) {
          console.error('退休身分組調整失敗:', err);
        }

        let reply = `💤 <@${interaction.user.id}> 已將狀態切換為 **【暫.退休】**！\n✨ 已為您賦予【暫.退休】身分組並卸下職業身分。`;
        if (nickSuccess) reply += `\n🏷️ 伺服器暱稱已更新為：\`${newNickname}\``;

        return await interaction.editReply(reply);
      }

      // ⚔️ 處理「多角色報到/更新」送出
      if (interaction.customId === 'modal_register_multi') {
        await interaction.deferReply(); 

        const mainIgn = interaction.fields.getTextInputValue('input_main_ign').trim();
        const rawLevel = interaction.fields.getTextInputValue('input_main_level').trim();
        const mainLevel = rawLevel.replace(/[^0-9]/g, '') || rawLevel;
        const playtime = interaction.fields.getTextInputValue('input_playtime').trim();
        const sub1Raw = interaction.fields.getTextInputValue('input_sub1');
        const sub2Raw = interaction.fields.getTextInputValue('input_sub2');

        const chosenMainJob = userSelectedJob.get(interaction.user.id) || '未知職業';
        const sub1Data = parseSubCharacter(sub1Raw);
        const sub2Data = parseSubCharacter(sub2Raw);

        const newNickname = `[${mainLevel}_${chosenMainJob}] ${mainIgn}`.substring(0, 32);

        // 1. 寫入 Firebase (使用 doc(userId) 覆蓋更新)
        if (db) {
          try {
            await db.collection('member_profiles').doc(interaction.user.id).set({
              userId: interaction.user.id,
              username: interaction.user.username,
              mainIgn: mainIgn,
              mainJob: chosenMainJob,
              mainLevel: mainLevel,
              playtime: playtime,
              sub1: sub1Data,
              sub2: sub2Data,
              isRetired: false,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
          } catch (error) {
            console.error('寫入名冊失敗:', error);
          }
        }

        // 2. 身分組發放（主職 + 所有副職身分組）
        const targetRolesToAdd = new Set([ROLES.VERIFIED]);
        const assignedJobNames = [];

        // 主職
        if (ROLES.JOBS[chosenMainJob]) {
          targetRolesToAdd.add(ROLES.JOBS[chosenMainJob]);
          assignedJobNames.push(chosenMainJob);
        }

        // 副職 1
        if (sub1Data && ROLES.JOBS[sub1Data.job]) {
          targetRolesToAdd.add(ROLES.JOBS[sub1Data.job]);
          if (!assignedJobNames.includes(sub1Data.job)) assignedJobNames.push(sub1Data.job);
        }

        // 副職 2
        if (sub2Data && ROLES.JOBS[sub2Data.job]) {
          targetRolesToAdd.add(ROLES.JOBS[sub2Data.job]);
          if (!assignedJobNames.includes(sub2Data.job)) assignedJobNames.push(sub2Data.job);
        }

        let roleSuccess = false;
        let nickSuccess = false;

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          
          // 移除「未驗證」與「暫.退休」
          if (member.roles.cache.has(ROLES.UNVERIFIED)) await member.roles.remove(ROLES.UNVERIFIED);
          if (member.roles.cache.has(ROLES.RETIRED)) await member.roles.remove(ROLES.RETIRED);

          // 清除舊的職業身分組
          const allJobRoleIds = Object.values(ROLES.JOBS);
          const oldJobRoles = member.roles.cache.filter(role => allJobRoleIds.includes(role.id));
          if (oldJobRoles.size > 0) {
            await member.roles.remove(oldJobRoles);
          }

          // 賦予所有新職業身分組
          await member.roles.add(Array.from(targetRolesToAdd));
          roleSuccess = true;

          // 自動更新伺服器暱稱為本尊格式
          try {
            await member.setNickname(newNickname);
            nickSuccess = true;
          } catch (nickError) {
            console.error('修改暱稱失敗 (若為 Owner 則無法由 Bot 修改):', nickError.message);
          }

        } catch (roleError) {
          console.error('身分組賦予失敗:', roleError);
        }

        // 3. 回覆更新結果
        let replyContent = `🎉 <@${interaction.user.id}> 的角色資料已更新！\n\n` +
          `**👑 本尊**：\`${mainIgn}\` (${chosenMainJob} / ${mainLevel}等)\n` +
          `**⏱️ 遊玩時間**：${playtime}\n`;

        if (sub1Data) replyContent += `**⚔️ 分身 1**：\`${sub1Data.ign}\` (${sub1Data.job} / ${sub1Data.level}等)\n`;
        if (sub2Data) replyContent += `**⚔️ 分身 2**：\`${sub2Data.ign}\` (${sub2Data.job} / ${sub2Data.level}等)\n`;

        replyContent += `\n`;

        if (roleSuccess) {
          replyContent += `✨ 已自動賦予身分組：**【已驗證】**、**【${assignedJobNames.join('】、 【')}】**\n`;
        } else {
          replyContent += `⚠️ 身分組賦予失敗，請聯絡管理員檢查權限。\n`;
        }

        if (nickSuccess) {
          replyContent += `🏷️ 伺服器暱稱已更新為：\`${newNickname}\``;
        } else {
          replyContent += `*(提示：若為伺服器擁有者，因 Discord 安全機制無法由機器人自動改名)*`;
        }

        await interaction.editReply({ content: replyContent });
        userSelectedJob.delete(interaction.user.id);
      }
    }
  } catch (err) {
    console.error('處理互動時發生錯誤:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
