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
  WARDEN_200: '1540337376994402376', // 尊榮的 Lv 200_典獄長
  JOBS: {
    '黑騎士': '1540050432796266526', '聖騎士': '1540051178396844153', '英雄': '1540051228459929631',
    '箭神': '1540051260005154967', '神射手': '1540051322525716601', '冰雷': '1540051347376832594',
    '火毒': '1540051370416017449', '主教': '1540051392138444880', '槍神': '1540051430050897921',
    '拳霸': '1540051450904969317', '刀賊': '1540051596518494228', '鏢賊': '1540051618345652275'
  }
};

const userSelectedJob = new Map();

// ==========================================
// 2. 輔助工具函式
// ==========================================

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

function buildJobQueryMenu() {
  const options = Object.keys(ROLES.JOBS).map(job =>
    new StringSelectMenuOptionBuilder().setLabel(job).setValue(job).setDescription(`查看【${job}】名冊`)
  );
  options.push(
    new StringSelectMenuOptionBuilder().setLabel('👑 Lv 200 典獄長名冊').setValue('WARDEN_LIST').setDescription('查看達成 200 等傳奇成員'),
    new StringSelectMenuOptionBuilder().setLabel('💤 暫.退休名單').setValue('RETIRED_LIST').setDescription('查看退休成員名單')
  );
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('select_query_job').setPlaceholder('🔍 點此切換查看其他名冊').addOptions(options)
  );
}

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

// 建立表單 (第 1 頁：本尊 + 1~4 號分身)
function createModalPage1(selectedJob, prevData) {
  const modal = new ModalBuilder().setCustomId('modal_register_page1').setTitle(`資料填寫 (第1頁，主職：${selectedJob})`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_main_ign').setLabel('1. 本尊遊戲ID (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainIgn || '').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_main_level').setLabel('2. 本尊等級 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainLevel || '').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_playtime').setLabel('3. 遊玩時間 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.playtime || '').setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_subs_1_2').setLabel('4. 小號 1~2 (格式: ID/職業/等級，換行)').setStyle(TextInputStyle.Paragraph)
        .setValue([prevData.subs?.[0]?.raw, prevData.subs?.[1]?.raw].filter(Boolean).join('\n'))
        .setPlaceholder('範例：\n小神射/神射手/90\n小主教/主教/75').setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_subs_3_4').setLabel('5. 小號 3~4 (格式: ID/職業/等級，換行)').setStyle(TextInputStyle.Paragraph)
        .setValue([prevData.subs?.[2]?.raw, prevData.subs?.[3]?.raw].filter(Boolean).join('\n'))
        .setPlaceholder('範例：\n小刀賊/刀賊/85\n小拳霸/拳霸/70').setRequired(false)
    )
  );
  return modal;
}

// 建立表單 (第 2 頁：5~10 號分身)
function createModalPage2(prevData) {
  const modal = new ModalBuilder().setCustomId('modal_register_page2').setTitle('更多小號填寫 (第 5 ~ 10 隻)');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_subs_5_7').setLabel('小號 5~7 (格式: ID/職業/等級，換行)').setStyle(TextInputStyle.Paragraph)
        .setValue([prevData.subs?.[4]?.raw, prevData.subs?.[5]?.raw, prevData.subs?.[6]?.raw].filter(Boolean).join('\n'))
        .setPlaceholder('小號5/黑騎士/80\n小號6/冰雷/70\n小號7/英雄/60').setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_subs_8_10').setLabel('小號 8~10 (格式: ID/職業/等級，換行)').setStyle(TextInputStyle.Paragraph)
        .setValue([prevData.subs?.[7]?.raw, prevData.subs?.[8]?.raw, prevData.subs?.[9]?.raw].filter(Boolean).join('\n'))
        .setPlaceholder('小號8/槍神/50\n小號9/聖騎士/50\n小號10/火毒/50').setRequired(false)
    )
  );
  return modal;
}

// 產生名冊 Embed (支援共享小號與 200 等典獄長)
async function generateJobEmbed(targetJob) {
  if (!db) return new EmbedBuilder().setColor(0xED4245).setDescription('❌ 資料庫連線異常');

  const snapshot = await db.collection('member_profiles').get();
  if (snapshot.empty) return new EmbedBuilder().setColor(0x3498DB).setTitle(`📋【${targetJob}】名冊`).setDescription('目前尚無紀錄。');

  const members = [];
  snapshot.forEach(doc => members.push(doc.data()));

  // 200 等典獄長專屬查詢
  if (targetJob === 'WARDEN_LIST') {
    const wardens = members.filter(m => !m.isRetired && parseInt(m.mainLevel) >= 200);
    const desc = wardens.length
      ? wardens.map((m, i) => `${i + 1}. 👑 \`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}>`).join('\n')
      : '目前尚未誕生 Lv 200 典獄長！';
    return new EmbedBuilder().setColor(0xF1C40F).setTitle('👑【尊榮的 Lv 200_典獄長】傳奇名冊').setDescription(desc);
  }

  if (targetJob === 'RETIRED_LIST') {
    const retired = members.filter(m => m.isRetired);
    const desc = retired.length
      ? retired.map((m, i) => `${i + 1}. <@${m.userId}> (\`${m.mainIgn || '退休'}\`)`).join('\n')
      : '目前沒有暫.退休成員。';
    return new EmbedBuilder().setColor(0x95A5A6).setTitle('📋【💤 暫.退休】名單').setDescription(desc);
  }

  // 建立全伺服器小號 ID 映射表，找出多人共玩的小號
  const subIgnOwnersMap = new Map();
  members.forEach(m => {
    if (m.isRetired || !m.subs) return;
    m.subs.forEach(s => {
      if (!s || !s.ign) return;
      const ignKey = s.ign.toLowerCase();
      if (!subIgnOwnersMap.has(ignKey)) subIgnOwnersMap.set(ignKey, []);
      subIgnOwnersMap.get(ignKey).push(m.mainIgn);
    });
  });

  const list = [];
  for (const m of members) {
    if (m.isRetired) continue;
    if (m.mainJob === targetJob) {
      list.push({ text: `\`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}> **【本尊】**`, level: parseInt(m.mainLevel) || 0 });
    }
    if (m.subs && Array.isArray(m.subs)) {
      m.subs.forEach(s => {
        if (s?.job === targetJob) {
          const owners = subIgnOwnersMap.get(s.ign.toLowerCase()) || [m.mainIgn];
          const ownerText = owners.length > 1 ? owners.join(' & ') : m.mainIgn;
          list.push({ text: `\`(${s.ign}_${s.job}_${s.level}等)\` - <@${m.userId}> [本尊: \`${ownerText}\`]`, level: parseInt(s.level) || 0 });
        }
      });
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

// 檢查升級儀式感並發送祝賀
async function checkLevelMilestone(guild, user, prevLevel, newLevel, mainIgn, job) {
  const pL = parseInt(prevLevel) || 0;
  const nL = parseInt(newLevel) || 0;
  if (nL <= pL) return;

  // 1. Lv 70+ 個人三轉儀式感 (回傳個人 Embed)
  let privateEmbed = null;
  if (nL >= 70 && pL < 70) {
    privateEmbed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🎖️【三轉強者誕生】達成 70 級突破！')
      .setDescription(`恭喜 <@${user.id}>（\`${mainIgn}\`）順利突破 70 級！\n正式踏入 ${job} 的高階冒險領域，向更強大的首領邁進吧！✨`);
  }

  // 2. Lv 120+ 逢十級（130, 140... 200）公開全體頻道祝賀
  if (nL >= 120 && nL % 10 === 0 && Math.floor(pL / 10) < Math.floor(nL / 10)) {
    try {
      const channel = await guild.channels.fetch(REPORT_CHANNEL_ID);
      if (channel?.isTextBased()) {
        const publicEmbed = new EmbedBuilder()
          .setColor(nL === 200 ? 0xF1C40F : 0xE67E22)
          .setTitle(nL === 200 ? '👑【全伺服器賀喜】頂點傳奇達成！Lv 200 典獄長誕生！' : '🎉【公會榮耀里程碑】等級重大突破！')
          .setDescription(`冒險家 <@${user.id}>（\`${mainIgn}\`）達成 **Lv.${nL} ${job}** 壯舉！\n全體成員為這份堅持與熱血喝采！🔥`)
          .setTimestamp();

        await channel.send({ content: nL === 200 ? '🎊 @everyone 傳奇現世！' : undefined, embeds: [publicEmbed] });
      }
    } catch (e) {
      console.error('發送升級祝賀失敗:', e);
    }
  }

  return privateEmbed;
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
  } catch (e) { console.error('❌ 指令註冊失敗:', e); }

  // 每週二 08:00 定時維護公告與 199 等修煉播報
  cron.schedule('0 0 8 * * *', async () => {
    try {
      const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (!channel?.isTextBased()) return;

      // 檢查 199 等倒數
      if (db) {
        const snap = await db.collection('member_profiles').where('mainLevel', '==', '199').where('isRetired', '==', false).get();
        if (!snap.empty) {
          const now = Date.now();
          const countdownTexts = [];
          snap.forEach(doc => {
            const data = doc.data();
            const start = data.reach199At ? data.reach199At.toMillis() : now;
            const days = Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1;
            countdownTexts.push(`🔥 <@${data.userId}>（\`${data.mainIgn}\` - ${data.mainJob}）邁向 200 等修煉：**第 ${days} 天**！`);
          });
          if (countdownTexts.length) {
            const embed199 = new EmbedBuilder()
              .setColor(0xE74C3C)
              .setTitle('⏳【即將登頂 200 等】巔峰修煉倒數')
              .setDescription(countdownTexts.join('\n') + '\n\n大家一起為即將成神的夥伴加油集氣！');
            await channel.send({ embeds: [embed199] });
          }
        }
      }

      // 週二例行發送維護面板 (星期二 = 2)
      if (new Date().getDay() === 2) {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📢【每週例行更新】名冊與等級維護')
          .setDescription('早安冒險家們！又到了每週二更新時間囉～\n等級提升或小號異動請在下方選單選擇職業更新（自動預載上次資料）！');
        await channel.send({ embeds: [embed], components: [buildMainSelectMenu()] });
      }
    } catch (err) { console.error('定時廣播失敗:', err); }
  }, { timezone: 'Asia/Taipei' });
});

client.on(Events.GuildMemberAdd, async (member) => {
  member.roles.add(ROLES.UNVERIFIED).catch(() => {});
});

// ==========================================
// 5. 事件監聽處理
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令
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

        const subListText = (d.subs && d.subs.length)
          ? d.subs.map((s, i) => `${i + 1}. \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n')
          : '無';

        const embed = new EmbedBuilder()
          .setColor(d.isRetired ? 0x95A5A6 : (parseInt(d.mainLevel) >= 200 ? 0xF1C40F : 0x3498DB))
          .setTitle(`🪪 冒險家名片 - ${d.mainIgn} ${parseInt(d.mainLevel) >= 200 ? '👑 [Lv.200 典獄長]' : ''}`)
          .addFields(
            { name: '👑 本尊角色', value: d.isRetired ? '💤 暫.退休' : `${d.mainJob} (Lv.${d.mainLevel})`, inline: true },
            { name: '⏱️ 遊玩時間', value: d.playtime || '未填', inline: true },
            { name: `⚔️ 分身清單 (共 ${d.subs?.length || 0} 隻)`, value: subListText.substring(0, 1024), inline: false }
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
      if (interaction.customId === 'select_query_job') {
        await interaction.deferUpdate();
        const embed = await generateJobEmbed(interaction.values[0]);
        return await interaction.editReply({ embeds: [embed], components: [buildJobQueryMenu()] });
      }

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
        return await interaction.showModal(createModalPage1(val, prevData));
      }
    }

    // ----------------------------------------
    // [C] 按鈕互動 (快速更新 / 第2頁小號)
    // ----------------------------------------
    if (interaction.isButton()) {
      if (interaction.customId === 'btn_quick_edit') {
        const prevData = await fetchUserDocSafe(interaction.user.id);
        const defaultJob = prevData.mainJob || Object.keys(ROLES.JOBS)[0];
        userSelectedJob.set(interaction.user.id, defaultJob);
        return await interaction.showModal(createModalPage1(defaultJob, prevData));
      }

      if (interaction.customId === 'btn_open_page2') {
        const prevData = await fetchUserDocSafe(interaction.user.id);
        return await interaction.showModal(createModalPage2(prevData));
      }
    }

    // ----------------------------------------
    // [D] Modal 表單提交
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      // 1. 退休處理
      if (interaction.customId === 'modal_retire') {
        await interaction.deferReply();
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
          const oldJobs = member.roles.cache.filter(r => allJobIds.includes(r.id) || r.id === ROLES.UNVERIFIED || r.id === ROLES.WARDEN_200);
          if (oldJobs.size) await member.roles.remove(oldJobs);
          await member.roles.add([ROLES.VERIFIED, ROLES.RETIRED]);
          await member.setNickname(newNick).catch(() => {});
        } catch (e) {}

        const embed = new EmbedBuilder().setColor(0x95A5A6).setTitle('💤 已切換為【暫.退休】')
          .setDescription(`已為 <@${interaction.user.id}> 卸下所有職業身分組並賦予【暫.退休】。`);
        return await interaction.editReply({ embeds: [embed] });
      }

      // 2. 第 1 頁送出 (本尊 + 1~4 號分身)
      if (interaction.customId === 'modal_register_page1') {
        await interaction.deferReply();

        const mainIgn = interaction.fields.getTextInputValue('input_main_ign').trim();
        const mainLevel = interaction.fields.getTextInputValue('input_main_level').replace(/[^0-9]/g, '') || '1';
        const playtime = interaction.fields.getTextInputValue('input_playtime').trim();
        const mainJob = userSelectedJob.get(interaction.user.id) || '未知職業';
        const newNick = `[${mainLevel}_${mainJob}] ${mainIgn}`.substring(0, 32);

        const subLines1_2 = interaction.fields.getTextInputValue('input_subs_1_2').split('\n');
        const subLines3_4 = interaction.fields.getTextInputValue('input_subs_3_4').split('\n');
        const subsPage1 = [...subLines1_2, ...subLines3_4].map(parseSubCharacter).filter(Boolean);

        const prevData = await fetchUserDocSafe(interaction.user.id);
        const existingPage2Subs = prevData.subs ? prevData.subs.slice(4) : [];
        const fullSubs = [...subsPage1, ...existingPage2Subs].slice(0, 10);

        // 199 等起算時間處理
        let reach199At = prevData.reach199At || null;
        if (mainLevel === '199' && prevData.mainLevel !== '199') {
          reach199At = admin.firestore.FieldValue.serverTimestamp();
        } else if (mainLevel !== '199') {
          reach199At = null;
        }

        if (db) {
          await db.collection('member_profiles').doc(interaction.user.id).set({
            userId: interaction.user.id, username: interaction.user.username,
            mainIgn, mainJob, mainLevel, playtime, subs: fullSubs, isRetired: false,
            reach199At, timestamp: admin.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
        }

        // 身分組發放
        const rolesToAdd = new Set([ROLES.VERIFIED]);
        const jobNames = [];
        if (ROLES.JOBS[mainJob]) { rolesToAdd.add(ROLES.JOBS[mainJob]); jobNames.push(mainJob); }
        fullSubs.forEach(s => {
          if (s && ROLES.JOBS[s.job]) {
            rolesToAdd.add(ROLES.JOBS[s.job]);
            if (!jobNames.includes(s.job)) jobNames.push(s.job);
          }
        });
        if (parseInt(mainLevel) >= 200) rolesToAdd.add(ROLES.WARDEN_200);

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          const allJobIds = Object.values(ROLES.JOBS);
          const oldRoles = member.roles.cache.filter(r => allJobIds.includes(r.id) || r.id === ROLES.UNVERIFIED || r.id === ROLES.RETIRED);
          if (oldRoles.size) await member.roles.remove(oldRoles);
          await member.roles.add(Array.from(rolesToAdd));
          await member.setNickname(newNick).catch(() => {});
        } catch (e) {}

        const privateMilestoneEmbed = await checkLevelMilestone(interaction.guild, interaction.user, prevData.mainLevel, mainLevel, mainIgn, mainJob);

        const subDesc = fullSubs.length
          ? fullSubs.map((s, idx) => `• \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n')
          : '無';

        const embed = new EmbedBuilder()
          .setColor(parseInt(mainLevel) >= 200 ? 0xF1C40F : 0x57F287)
          .setTitle(parseInt(mainLevel) >= 200 ? '👑 傳奇登頂！Lv 200 典獄長資料已更新！' : '🎉 冒險家名冊已成功更新！')
          .addFields(
            { name: '👑 本尊角色', value: `\`${mainIgn}\` (${mainJob} / Lv.${mainLevel})`, inline: true },
            { name: '⏱️ 遊玩時間', value: playtime, inline: true },
            { name: `⚔️ 分身名單 (已登記 ${fullSubs.length}/10 隻)`, value: subDesc, inline: false },
            { name: '🏷️ 伺服器暱稱', value: `\`${newNick}\``, inline: true },
            { name: '✨ 獲得身分組', value: `【已驗證】、 【${jobNames.join('】、 【')}】${parseInt(mainLevel) >= 200 ? '、 【尊榮的 Lv 200_典獄長】' : ''}`, inline: false }
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_open_page2').setLabel('➕ 新增/編輯第 5~10 隻小號 (第 2 頁)').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
        if (privateMilestoneEmbed) await interaction.followUp({ embeds: [privateMilestoneEmbed], ephemeral: true });
        userSelectedJob.delete(interaction.user.id);
      }

      // 3. 第 2 頁小號送出
      if (interaction.customId === 'modal_register_page2') {
        await interaction.deferReply({ ephemeral: true });
        const prevData = await fetchUserDocSafe(interaction.user.id);
        if (!prevData.mainIgn) return interaction.editReply('❌ 請先完成第 1 頁本尊資料填寫！');

        const subLines5_7 = interaction.fields.getTextInputValue('input_subs_5_7').split('\n');
        const subLines8_10 = interaction.fields.getTextInputValue('input_subs_8_10').split('\n');
        const subsPage2 = [...subLines5_7, ...subLines8_10].map(parseSubCharacter).filter(Boolean);

        const existingPage1Subs = prevData.subs ? prevData.subs.slice(0, 4) : [];
        const fullSubs = [...existingPage1Subs, ...subsPage2].slice(0, 10);

        if (db) {
          await db.collection('member_profiles').doc(interaction.user.id).update({
            subs: fullSubs, timestamp: admin.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
        }

        // 重新同步小號身分組
        const rolesToAdd = new Set([ROLES.VERIFIED]);
        if (ROLES.JOBS[prevData.mainJob]) rolesToAdd.add(ROLES.JOBS[prevData.mainJob]);
        fullSubs.forEach(s => {
          if (s && ROLES.JOBS[s.job]) rolesToAdd.add(ROLES.JOBS[s.job]);
        });
        if (parseInt(prevData.mainLevel) >= 200) rolesToAdd.add(ROLES.WARDEN_200);

        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);
          await member.roles.add(Array.from(rolesToAdd));
        } catch (e) {}

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('✅ 第 5~10 隻小號已同步保存！')
          .setDescription(`目前總共已登記 **${fullSubs.length}/10** 隻小號，相關副職業身分組已全數自動加發！`);

        return await interaction.editReply({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error('互動處理錯誤:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
