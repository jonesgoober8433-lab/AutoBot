require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, PermissionFlagsBits, Events
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');
const cron = require('node-cron');

// ==========================================
// 1. 常數與身分組設定
// ==========================================
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID || '1476762995454640159';

const ROLES = {
  VERIFIED: '1540053101120323685',
  UNVERIFIED: '1540053110846791762',
  RETIRED: '1540327837947396166',
  JOBS: {
    '黑騎士': '1540050432796266526', '聖騎士': '1540051178396844153', '英雄': '1540051228459929631',
    '箭神': '1540051260005154967', '神射手': '1540051322525716601', '冰雷': '1540051347376832594',
    '火毒': '1540051370416017449', '主教': '1540051392138444880', '槍神': '1540051430050897921',
    '拳霸': '1540051450904969317', '刀賊': '1540051596518494228', '鏢賊': '1540051618345652275'
  }
};

const userSelectedJob = new Map();

// ==========================================
// 2. 輔助函式模組
// ==========================================

// 建立主職業/退休選擇選單
function buildMainSelectMenu() {
  const options = Object.keys(ROLES.JOBS).map(job =>
    new StringSelectMenuOptionBuilder().setLabel(job).setValue(job).setDescription(`選擇主職業【${job}】`)
  );
  options.push(
    new StringSelectMenuOptionBuilder().setLabel('💤 暫.退休').setValue('RETIRED_OPTION').setDescription('轉為退休狀態')
  );
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('select_job_register').setPlaceholder('🔽 請選擇主要職業或狀態').addOptions(options)
  );
}

// 建立職業名冊查詢下拉切換選單
function buildJobQueryMenu() {
  const options = Object.keys(ROLES.JOBS).map(job =>
    new StringSelectMenuOptionBuilder().setLabel(job).setValue(job).setDescription(`查看【${job}】名冊`)
  );
  options.push(
    new StringSelectMenuOptionBuilder().setLabel('💤 暫.退休名單').setValue('RETIRED_LIST').setDescription('查看退休成員名單')
  );
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('select_query_job').setPlaceholder('🔍 點此切換查看其他職業名冊').addOptions(options)
  );
}

// 解析小號文字 (格式: ID/職業/等級)
function parseSubCharacter(rawText) {
  if (!rawText || !rawText.trim()) return null;
  const parts = rawText.split(/[/\\|\s,，_-]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;

  const ign = parts[0];
  let job = '未知職業';
  let level = '1';

  for (const p of parts.slice(1)) {
    for (const validJob of Object.keys(ROLES.JOBS)) {
      if (p.includes(validJob)) { job = validJob; break; }
    }
    const cleanNum = p.replace(/[^0-9]/g, '');
    if (cleanNum && !isNaN(cleanNum)) level = cleanNum;
  }
  return { ign, job, level, raw: rawText.trim() };
}

// 帶超時保護的 Firebase 讀取
async function fetchUserDocSafe(userId) {
  if (!db) return {};
  try {
    const doc = await Promise.race([
      db.collection('member_profiles').doc(userId).get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1200))
    ]);
    return doc?.exists ? doc.data() : {};
  } catch {
    return {};
  }
}

// 產生特定職業名冊 Embed
async function generateJobEmbed(targetJob) {
  if (!db) return new EmbedBuilder().setColor(0xED4245).setDescription('❌ 資料庫連線異常');

  const snapshot = await db.collection('member_profiles').get();
  if (snapshot.empty) {
    return new EmbedBuilder().setColor(0x3498DB).setTitle(`📋【${targetJob}】名冊`).setDescription('目前尚無成員登記。');
  }

  const members = [];
  snapshot.forEach(doc => members.push(doc.data()));

  if (targetJob === 'RETIRED_LIST') {
    const retired = members.filter(m => m.isRetired);
    const desc = retired.length
      ? retired.map((m, i) => `${i + 1}. <@${m.userId}> (\`${m.mainIgn || '退休'}\`)`).join('\n')
      : '目前沒有暫.退休成員。';
    return new EmbedBuilder().setColor(0x95A5A6).setTitle('📋【💤 暫.退休】名單').setDescription(desc);
  }

  const list = [];
  for (const m of members) {
    if (m.isRetired) continue;
    if (m.mainJob === targetJob) {
      list.push({ text: `\`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}> **【本尊】**`, level: parseInt(m.mainLevel) || 0 });
    }
    if (m.sub1?.job === targetJob) {
      list.push({ text: `\`(${m.sub1.ign}_${m.sub1.job}_${m.sub1.level}等)\` - <@${m.userId}> [本尊: \`${m.mainIgn}\` <@${m.userId}>]`, level: parseInt(m.sub1.level) || 0 });
    }
    if (m.sub2?.job === targetJob) {
      list.push({ text: `\`(${m.sub2.ign}_${m.sub2.job}_${m.sub2.level}等)\` - <@${m.userId}> [本尊: \`${m.mainIgn}\` <@${m.userId}>]`, level: parseInt(m.sub2.level) || 0 });
    }
  }

  list.sort((a, b) => b.level - a.level);
  const desc = list.length
    ? list.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n')
    : `目前尚無【${targetJob}】的本尊或分身登記。`;

  return new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`📋【${targetJob}】名冊 (共 ${list.length} 位角色)`)
    .setDescription(desc.substring(0, 4000));
}

// 建立主表單彈窗
function createRegisterModal(selectedJob, prevData) {
  const modal = new ModalBuilder().setCustomId('modal_register_multi').setTitle(`名冊更新（主職：${selectedJob}）`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_main_ign').setLabel('1. 本尊遊戲ID (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainIgn || '').setPlaceholder('例如：Edward').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_main_level').setLabel('2. 本尊等級 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainLevel || '').setPlaceholder('例如：120').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_playtime').setLabel('3. 平常遊玩時間 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.playtime || '').setPlaceholder('例如：平日晚上 8 到 12 點').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_sub1').setLabel('4. 小號 1 (選填，格式：名稱/職業/等級)').setStyle(TextInputStyle.Short).setValue(prevData.sub1?.raw || '').setPlaceholder('例如：小神射/神射手/90').setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_sub2').setLabel('5. 小號 2 (選填，格式：名稱/職業/等級)').setStyle(TextInputStyle.Short).setValue(prevData.sub2?.raw || '').setPlaceholder('例如：小主教/主教/75').setRequired(false)
    )
  );
  return modal;
}

// ==========================================
// 3. 伺服器與 Firebase 初始化
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Auto-Bot Online!'));
app.listen(process.env.PORT || 3000, () => console.log('✅ Web Server Online'));

let db;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CREDENTIALS)) });
    db = admin.firestore();
    console.log('✅ Firebase Online');
  }
} catch (e) {
  console.error('❌ Firebase Error:', e.message);
}

// ==========================================
// 4. 指令註冊與排程
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('幸運頻道').setDescription('抽取今日幸運頻道')
    .addIntegerOption(o => o.setName('最大頻道').setDescription('最大頻道數').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('報到').setDescription('【管理員專用】發送報到面板').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('職業查詢').setDescription('依職業查看成員與分身名冊')
    .addStringOption(o => o.setName('職業名稱').setDescription('選擇要查看的職業').setRequired(false)
      .addChoices(Object.keys(ROLES.JOBS).map(j => ({ name: j, value: j })))),
  new SlashCommandBuilder().setName('個人名片').setDescription('查看自己登記的名片資訊')
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot 上線：${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ 指令更新成功');
  } catch (e) { console.error('❌ 指令註冊失敗:', e); }

  // 每週二 08:00 定時任務
  cron.schedule('0 0 8 * * 2', async () => {
    try {
      const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📢【每週例行更新】名冊與等級維護')
          .setDescription('早安冒險家們！又到了每週二更新時間囉～\n等級提升或小號異動請在下方選單選擇職業更新（自動預載上次資料）！');
        await channel.send({ embeds: [embed], components: [buildMainSelectMenu()] });
      }
    } catch (err) { console.error('定時發送失敗:', err); }
  }, { timezone: 'Asia/Taipei' });
});

client.on(Events.GuildMemberAdd, async (member) => {
  member.roles.add(ROLES.UNVERIFIED).catch(() => {});
});

// ==========================================
// 5. 事件監聽處理 (互動核心)
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令處理
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === '幸運頻道') {
        await interaction.deferReply();
        const max = interaction.options.getInteger('最大頻道');
        const lucky = Math.floor(Math.random() * max) + 1;
        
        if (db) {
          db.collection('lucky_channel_history').add({
            userId: interaction.user.id, username: interaction.user.username,
            maxChannel: max, luckyChannel: lucky, timestamp: admin.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
        }

        const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('🎲 今日幸運頻道')
          .setDescription(`冒險家 **${interaction.user.username}** 的幸運頻道：\n\n✨ **第 ${lucky} 頻道** (範圍 1 ~ ${max})`);
        return await interaction.editReply({ embeds: [embed] });
      }

      if (commandName === '報到') {
        const embed = new EmbedBuilder().setColor(0x57F287).setTitle('📝 冒險家報到 / 名冊更新')
          .setDescription('歡迎來到伺服器！請在下方下拉選單選擇你的 **主要職業** 或 **暫.退休** 狀態！');
        return await interaction.reply({ embeds: [embed], components: [buildMainSelectMenu()] });
      }

      if (commandName === '職業查詢') {
        await interaction.deferReply();
        const targetJob = interaction.options.getString('職業名稱') || Object.keys(ROLES.JOBS)[0];
        const embed = await generateJobEmbed(targetJob);
        return await interaction.editReply({ embeds: [embed], components: [buildJobQueryMenu()] });
      }

      if (commandName === '個人名片') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        const d = await fetchUserDocSafe(interaction.user.id);
        if (!d.mainIgn) return interaction.editReply('📜 您尚未建立名冊資料，請透過 `/報到` 進行登記。');

        const embed = new EmbedBuilder()
          .setColor(d.isRetired ? 0x95A5A6 : 0x3498DB)
          .setTitle(`🪪 冒險家名片 - ${d.mainIgn}`)
          .addFields(
            { name: '👑 本尊角色', value: d.isRetired ? '💤 暫.退休' : `${d.mainJob} (Lv.${d.mainLevel})`, inline: true },
            { name: '⏱️ 遊玩時間', value: d.playtime || '未填', inline: true },
            { name: '⚔️ 分身 1', value: d.sub1 ? `${d.sub1.ign} (${d.sub1.job} Lv.${d.sub1.level})` : '無', inline: false },
            { name: '⚔️ 分身 2', value: d.sub2 ? `${d.sub2.ign} (${d.sub2.job} Lv.${d.sub2.level})` : '無', inline: false }
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_quick_edit').setLabel('✏️ 快速更新名片').setStyle(ButtonStyle.Primary)
        );
        return await interaction.editReply({ embeds: [embed], components: [row] });
      }
    }

    // ----------------------------------------
    // [B] 下拉選單切換 / 報到主選單
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      // 1. 職業查詢即時切換 (就地更新 Embed)
      if (interaction.customId === 'select_query_job') {
        await interaction.deferUpdate();
        const selectedJob = interaction.values[0];
        const embed = await generateJobEmbed(selectedJob);
        return await interaction.editReply({ embeds: [embed], components: [buildJobQueryMenu()] });
      }

      // 2. 報到主選單觸發表單
      if (interaction.customId === 'select_job_register') {
        const val = interaction.values[0];
        const prevData = await fetchUserDocSafe(interaction.user.id);

        if (val === 'RETIRED_OPTION') {
          const modal = new ModalBuilder().setCustomId('modal_retire').setTitle('轉換身分：暫.退休');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('input_retire_ign').setLabel('遊戲名稱 / 暱稱 (留空用 Discord 名)').setStyle(TextInputStyle.Short)
              .setValue(prevData.mainIgn || interaction.user.displayName || '').setRequired(false)
          ));
          return await interaction.showModal(modal);
        }

        userSelectedJob.set(interaction.user.id, val);
        return await interaction.showModal(createRegisterModal(val, prevData));
      }
    }

    // ----------------------------------------
    // [C] 按鈕點擊 (快速編輯名片)
    // ----------------------------------------
    if (interaction.isButton() && interaction.customId === 'btn_quick_edit') {
      const prevData = await fetchUserDocSafe(interaction.user.id);
      const defaultJob = prevData.mainJob || Object.keys(ROLES.JOBS)[0];
      userSelectedJob.set(interaction.user.id, defaultJob);
      return await interaction.showModal(createRegisterModal(defaultJob, prevData));
    }

    // ----------------------------------------
    // [D] Modal 表單送出處理
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      await interaction.deferReply(); // 公開回覆 Embed

      // 1. 退休表單處理
      if (interaction.customId === 'modal_retire') {
        const ign = interaction.fields.getTextInputValue('input_retire_ign')?.trim() || interaction.user.displayName || interaction.user.username;
        const newNick = `[退休] ${ign}`.substring(0, 32);

        if (db) {
          await db.collection('member_profiles').doc(interaction.user.id).set({
            userId: interaction.user.id, username: interaction.user.username,
            mainIgn: ign, isRetired: true, timestamp: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(() => {});
        }

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const allJobIds = Object.values(ROLES.JOBS);
          const oldJobs = member.roles.cache.filter(r => allJobIds.includes(r.id) || r.id === ROLES.UNVERIFIED);
          if (oldJobs.size) await member.roles.remove(oldJobs);
          await member.roles.add([ROLES.VERIFIED, ROLES.RETIRED]);
          await member.setNickname(newNick).catch(() => {});
        } catch (e) { console.error(e); }

        const embed = new EmbedBuilder().setColor(0x95A5A6).setTitle('💤 冒險家已切換為【暫.退休】')
          .setDescription(`已為 <@${interaction.user.id}> 卸下所有職業身分組並賦予【暫.退休】。`);
        return await interaction.editReply({ embeds: [embed] });
      }

      // 2. 正常多角色資料送出
      if (interaction.customId === 'modal_register_multi') {
        const mainIgn = interaction.fields.getTextInputValue('input_main_ign').trim();
        const mainLevel = interaction.fields.getTextInputValue('input_main_level').replace(/[^0-9]/g, '') || '1';
        const playtime = interaction.fields.getTextInputValue('input_playtime').trim();
        const sub1 = parseSubCharacter(interaction.fields.getTextInputValue('input_sub1'));
        const sub2 = parseSubCharacter(interaction.fields.getTextInputValue('input_sub2'));
        const mainJob = userSelectedJob.get(interaction.user.id) || '未知職業';
        const newNick = `[${mainLevel}_${mainJob}] ${mainIgn}`.substring(0, 32);

        if (db) {
          await db.collection('member_profiles').doc(interaction.user.id).set({
            userId: interaction.user.id, username: interaction.user.username,
            mainIgn, mainJob, mainLevel, playtime, sub1, sub2, isRetired: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
        }

        const rolesToAdd = new Set([ROLES.VERIFIED]);
        const jobNames = [];
        if (ROLES.JOBS[mainJob]) { rolesToAdd.add(ROLES.JOBS[mainJob]); jobNames.push(mainJob); }
        if (sub1 && ROLES.JOBS[sub1.job]) { rolesToAdd.add(ROLES.JOBS[sub1.job]); if (!jobNames.includes(sub1.job)) jobNames.push(sub1.job); }
        if (sub2 && ROLES.JOBS[sub2.job]) { rolesToAdd.add(ROLES.JOBS[sub2.job]); if (!jobNames.includes(sub2.job)) jobNames.push(sub2.job); }

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const allJobIds = Object.values(ROLES.JOBS);
          const oldRoles = member.roles.cache.filter(r => allJobIds.includes(r.id) || r.id === ROLES.UNVERIFIED || r.id === ROLES.RETIRED);
          if (oldRoles.size) await member.roles.remove(oldRoles);
          await member.roles.add(Array.from(rolesToAdd));
          await member.setNickname(newNick).catch(() => {});
        } catch (e) { console.error(e); }

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🎉 冒險家資料已完成更新！')
          .addFields(
            { name: '👑 本尊角色', value: `\`${mainIgn}\` (${mainJob} / Lv.${mainLevel})`, inline: true },
            { name: '⏱️ 遊玩時間', value: playtime, inline: true },
            { name: '⚔️ 分身名單', value: `${sub1 ? `• \`${sub1.ign}\` (${sub1.job} Lv.${sub1.level})\n` : ''}${sub2 ? `• \`${sub2.ign}\` (${sub2.job} Lv.${sub2.level})` : ''}` || '無', inline: false },
            { name: '🏷️ 伺服器暱稱', value: `\`${newNick}\``, inline: true },
            { name: '✨ 獲得身分組', value: `【已驗證】、 【${jobNames.join('】、 【')}】`, inline: true }
          );

        await interaction.editReply({ embeds: [embed] });
        userSelectedJob.delete(interaction.user.id);
      }
    }
  } catch (err) {
    console.error('互動處理錯誤:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
