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
const userCustomBetChoice = new Map(); // 暫存自訂下注選項

// ==========================================
// 2. 賭局輔助函式模組
// ==========================================

// 格式化數字顯示 (如 5000000 -> 500 萬)
function formatMeso(amount) {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(2)} 億`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)} 萬`;
  return amount.toLocaleString();
}

// 產生賭局 Embed
function createBetEmbed(betData) {
  const totalPool = betData.poolOption1 + betData.poolOption2;
  const odds1 = betData.poolOption1 > 0 ? (totalPool / betData.poolOption1).toFixed(2) : '無上限';
  const odds2 = betData.poolOption2 > 0 ? (totalPool / betData.poolOption2).toFixed(2) : '無上限';
  const now = Date.now();
  const isClosed = now >= betData.deadline;

  return new EmbedBuilder()
    .setColor(isClosed ? 0x95A5A6 : 0xE67E22)
    .setTitle(`🎲【社群賭局】${betData.title}`)
    .setDescription(
      `👑 **發起人**：<@${betData.creatorId}>\n` +
      `⏳ **截止時間**：<t:${Math.floor(betData.deadline / 1000)}:R> (<t:${Math.floor(betData.deadline / 1000)}:F>)\n` +
      `💰 **總獎金池**：\`${formatMeso(totalPool)} 楓幣\`\n` +
      `狀態：${isClosed ? '🔴 **已截止下注，等待發起人/管理員結算**' : '🟢 **下注火熱進行中！**'}\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .addFields(
      {
        name: `🟢 【選項 1】${betData.option1}`,
        value: `💵 目前彩池：\`${formatMeso(betData.poolOption1)} 楓幣\`\n👥 下注人數：\`${Object.keys(betData.bets1 || {}).length} 人\`\n📈 當前即時賠率：\`${odds1}x\``,
        inline: true
      },
      {
        name: `🔴 【選項 2】${betData.option2}`,
        value: `💵 目前彩池：\`${formatMeso(betData.poolOption2)} 楓幣\`\n👥 下注人數：\`${Object.keys(betData.bets2 || {}).length} 人\`\n📈 當前即時賠率：\`${odds2}x\``,
        inline: true
      }
    )
    .setFooter({ text: '純屬社群娛樂，輸贏請以遊戲內結果為準' });
}

// 產生賭局操作按鈕面板
function createBetComponents(betId, option1, option2) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bet_btn_${betId}_opt1_100w`).setLabel(`🟢 ${option1} (+100w)`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bet_btn_${betId}_opt2_100w`).setLabel(`🔴 ${option2} (+100w)`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`bet_btn_${betId}_custom`).setLabel('✏️ 自訂金額下注').setStyle(ButtonStyle.Primary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bet_btn_${betId}_settle`).setLabel('⚖️ 發起人/管理員一鍵結算').setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

// ==========================================
// 3. 通用工具與名冊函式
// ==========================================
function buildMainSelectMenu() {
  const options = Object.keys(ROLES.JOBS).map(job =>
    new StringSelectMenuOptionBuilder().setLabel(job).setValue(job).setDescription(`選擇主職業【${job}】`)
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel('💤 暫.退休').setValue('RETIRED_OPTION').setDescription('轉為退休狀態'));
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
  } catch { return {}; }
}

function createRegisterModal(selectedJob, prevData) {
  const modal = new ModalBuilder().setCustomId('modal_register_page1').setTitle(`資料填寫 (主職：${selectedJob})`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_main_ign').setLabel('1. 本尊遊戲ID (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainIgn || '').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_main_level').setLabel('2. 本尊等級 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainLevel || '').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_playtime').setLabel('3. 遊玩時間 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.playtime || '').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_subs_1_2').setLabel('4. 小號 1~2 (格式: ID/職業/等級，換行)').setStyle(TextInputStyle.Paragraph).setValue([prevData.subs?.[0]?.raw, prevData.subs?.[1]?.raw].filter(Boolean).join('\n')).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_subs_3_4').setLabel('5. 小號 3~4 (格式: ID/職業/等級，換行)').setStyle(TextInputStyle.Paragraph).setValue([prevData.subs?.[2]?.raw, prevData.subs?.[3]?.raw].filter(Boolean).join('\n')).setRequired(false))
  );
  return modal;
}

async function generateJobEmbed(targetJob) {
  if (!db) return new EmbedBuilder().setColor(0xED4245).setDescription('❌ 資料庫連線異常');
  const snapshot = await db.collection('member_profiles').get();
  if (snapshot.empty) return new EmbedBuilder().setColor(0x3498DB).setTitle(`📋【${targetJob}】名冊`).setDescription('目前尚無紀錄。');

  const members = [];
  snapshot.forEach(doc => members.push(doc.data()));

  if (targetJob === 'WARDEN_LIST') {
    const wardens = members.filter(m => !m.isRetired && parseInt(m.mainLevel) >= 200);
    const desc = wardens.length ? wardens.map((m, i) => `${i + 1}. 👑 \`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}>`).join('\n') : '目前尚未誕生 Lv 200 典獄長！';
    return new EmbedBuilder().setColor(0xF1C40F).setTitle('👑【尊榮的 Lv 200_典獄長】傳奇名冊').setDescription(desc);
  }

  if (targetJob === 'RETIRED_LIST') {
    const retired = members.filter(m => m.isRetired);
    const desc = retired.length ? retired.map((m, i) => `${i + 1}. <@${m.userId}> (\`${m.mainIgn || '退休'}\`)`).join('\n') : '目前沒有暫.退休成員。';
    return new EmbedBuilder().setColor(0x95A5A6).setTitle('📋【💤 暫.退休】名單').setDescription(desc);
  }

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
    if (m.mainJob === targetJob) list.push({ text: `\`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}> **【本尊】**`, level: parseInt(m.mainLevel) || 0 });
    if (m.subs && Array.isArray(m.subs)) {
      m.subs.forEach(s => {
        if (s?.job === targetJob) {
          const owners = subIgnOwnersMap.get(s.ign.toLowerCase()) || [m.mainIgn];
          list.push({ text: `\`(${s.ign}_${s.job}_${s.level}等)\` - <@${m.userId}> [本尊: \`${owners.join(' & ')}\`]`, level: parseInt(s.level) || 0 });
        }
      });
    }
  }

  list.sort((a, b) => b.level - a.level);
  const desc = list.length ? list.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n') : `目前尚無【${targetJob}】的本尊或分身登記。`;
  return new EmbedBuilder().setColor(0x3498DB).setTitle(`📋【${targetJob}】名冊 (共 ${list.length} 位角色)`).setDescription(desc.substring(0, 4000));
}

// ==========================================
// 4. Express 伺服器 & Firebase
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
} catch (e) { console.error('❌ Firebase Error:', e.message); }

// ==========================================
// 5. 斜線指令註冊
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('發起賭局').setDescription('發起一個下注競猜賭局')
    .addStringOption(o => o.setName('題目').setDescription('賭局題目 (例如：小明的三飛閃30能過嗎？)').setRequired(true))
    .addStringOption(o => o.setName('選項1').setDescription('選項 1 (例如：會過)').setRequired(true))
    .addStringOption(o => o.setName('選項2').setDescription('選項 2 (例如：爆掉)').setRequired(true))
    .addIntegerOption(o => o.setName('截止時間').setDescription('下注截止時間 (幾分鐘後截止，例如：10)').setRequired(true).setMinValue(1)),
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

  // 每週二例行廣播與每日 199 倒數
  cron.schedule('0 0 8 * * *', async () => {
    try {
      const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (!channel?.isTextBased()) return;

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
            const embed199 = new EmbedBuilder().setColor(0xE74C3C).setTitle('⏳【即將登頂 200 等】巔峰修煉倒數').setDescription(countdownTexts.join('\n'));
            await channel.send({ embeds: [embed199] });
          }
        }
      }

      if (new Date().getDay() === 2) {
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📢【每週例行更新】名冊與等級維護')
          .setDescription('早安冒險家們！又到了每週二更新時間囉～\n請在下方選單選擇職業更新資料！');
        await channel.send({ embeds: [embed], components: [buildMainSelectMenu()] });
      }
    } catch (err) { console.error(err); }
  }, { timezone: 'Asia/Taipei' });
});

client.on(Events.GuildMemberAdd, async (member) => {
  member.roles.add(ROLES.UNVERIFIED).catch(() => {});
});

// ==========================================
// 6. 互動事件監聽核心
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // 🎲 發起賭局
      if (commandName === '發起賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線，無法開局。', ephemeral: true });
        await interaction.deferReply();

        const title = interaction.options.getString('題目');
        const option1 = interaction.options.getString('選項1');
        const option2 = interaction.options.getString('選項2');
        const minutes = interaction.options.getInteger('截止時間');
        const deadline = Date.now() + minutes * 60 * 1000;

        const betDocRef = db.collection('active_bets').doc();
        const betData = {
          id: betDocRef.id,
          creatorId: interaction.user.id,
          creatorName: interaction.user.username,
          title, option1, option2,
          deadline, isSettled: false,
          poolOption1: 0, poolOption2: 0,
          bets1: {}, bets2: {},
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await betDocRef.set(betData);
        const embed = createBetEmbed(betData);
        const components = createBetComponents(betDocRef.id, option1, option2);

        return await interaction.editReply({ embeds: [embed], components });
      }

      if (commandName === '幸運頻道') {
        await interaction.deferReply();
        const max = interaction.options.getInteger('最大頻道');
        const lucky = Math.floor(Math.random() * max) + 1;
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
          .setTitle(`🪪 冒險家名片 - ${d.mainIgn}`)
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
    // [B] 賭局下注與結算按鈕
    // ----------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // 1. 快速更新名片按鈕
      if (customId === 'btn_quick_edit') {
        const prevData = await fetchUserDocSafe(interaction.user.id);
        const defaultJob = prevData.mainJob || Object.keys(ROLES.JOBS)[0];
        userSelectedJob.set(interaction.user.id, defaultJob);
        return await interaction.showModal(createRegisterModal(defaultJob, prevData));
      }

      // 2. 賭局下注按鈕 (以 bet_btn_ 開頭)
      if (customId.startsWith('bet_btn_')) {
        const parts = customId.split('_');
        const betId = parts[2];
        const action = parts[3];

        if (!db) return interaction.reply({ content: '❌ 資料庫連線異常', ephemeral: true });

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 該賭局已不存在或已移除。', ephemeral: true });

        const betData = betDoc.data();

        // 結算流程
        if (action === 'settle') {
          const isCreator = interaction.user.id === betData.creatorId;
          const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

          if (!isCreator && !isAdmin) {
            return interaction.reply({ content: '❌ 只有發起人或管理員可以執行結算！', ephemeral: true });
          }

          if (Date.now() < betData.deadline) {
            return interaction.reply({ content: `⏳ 尚未到達截止時間！請在 <t:${Math.floor(betData.deadline / 1000)}:R> 後再進行結算。`, ephemeral: true });
          }

          if (betData.isSettled) {
            return interaction.reply({ content: '⚠️ 該賭局已經完成結算過囉！', ephemeral: true });
          }

          // 彈出選擇勝方選單
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`settle_choice_${betId}`)
            .setPlaceholder('🏆 請選擇最終獲勝的選項')
            .addOptions([
              new StringSelectMenuOptionBuilder().setLabel(`🟢 勝方：【${betData.option1}】`).setValue('opt1'),
              new StringSelectMenuOptionBuilder().setLabel(`🔴 勝方：【${betData.option2}】`).setValue('opt2')
            ]);

          return await interaction.reply({
            content: `⚖️ **請點選最終獲勝的結果進行獎金派發：**`,
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            ephemeral: true
          });
        }

        // 檢查截止狀態
        if (Date.now() >= betData.deadline) {
          return interaction.reply({ content: '🛑 該賭局已截止下注，請等待結果公佈！', ephemeral: true });
        }

        // 自訂金額彈窗
        if (action === 'custom') {
          const modal = new ModalBuilder().setCustomId(`modal_bet_custom_${betId}`).setTitle(`自訂下注金額`);
          const choiceInput = new TextInputBuilder()
            .setCustomId('input_bet_choice')
            .setLabel(`選擇選項 (請填 1 或 2)`)
            .setPlaceholder(`1 = ${betData.option1} | 2 = ${betData.option2}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          const amountInput = new TextInputBuilder()
            .setCustomId('input_bet_amount')
            .setLabel(`下注金額 (萬為單位或純數字)`)
            .setPlaceholder(`例如：500w 或 5000000`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(choiceInput), new ActionRowBuilder().addComponents(amountInput));
          return await interaction.showModal(modal);
        }

        // 快捷下注 +100w (1,000,000)
        const isOpt1 = action === 'opt1';
        const addAmount = 1000000;
        const targetBets = isOpt1 ? betData.bets1 : betData.bets2;
        const userDoc = await fetchUserDocSafe(interaction.user.id);
        const playerIgn = userDoc.mainIgn || interaction.user.displayName || interaction.user.username;

        const currentBet = targetBets[interaction.user.id]?.amount || 0;
        targetBets[interaction.user.id] = { ign: playerIgn, amount: currentBet + addAmount };

        const updatePayload = isOpt1
          ? { poolOption1: betData.poolOption1 + addAmount, bets1: targetBets }
          : { poolOption2: betData.poolOption2 + addAmount, bets2: targetBets };

        await db.collection('active_bets').doc(betId).update(updatePayload);

        // 即時刷新主 Embed
        const newBetData = { ...betData, ...updatePayload };
        await interaction.message.edit({ embeds: [createBetEmbed(newBetData)] });

        return await interaction.reply({
          content: `✅ 成功下注 **${isOpt1 ? betData.option1 : betData.option2}** \`+100 萬 楓幣\`！(累計下注: ${formatMeso(currentBet + addAmount)})`,
          ephemeral: true
        });
      }
    }

    // ----------------------------------------
    // [C] 下拉選單切換
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      // 1. 賭局結算選單
      if (interaction.customId.startsWith('settle_choice_')) {
        await interaction.deferReply();
        const betId = interaction.customId.replace('settle_choice_', '');
        const winningChoice = interaction.values[0]; // 'opt1' or 'opt2'

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.editReply('❌ 賭局資料已失效。');
        const betData = betDoc.data();

        const isOpt1Win = winningChoice === 'opt1';
        const winTitle = isOpt1Win ? betData.option1 : betData.option2;
        const winBets = isOpt1Win ? betData.bets1 : betData.bets2;
        const loseBets = isOpt1Win ? betData.bets2 : betData.bets1;
        const winPool = isOpt1Win ? betData.poolOption1 : betData.poolOption2;
        const losePool = isOpt1Win ? betData.poolOption2 : betData.poolOption1;

        // 計算彩池分紅
        let resultsText = '```ansi\n';
        resultsText += `\u001b[1;33m🏆 結算結果：【${winTitle}】獲勝！\u001b[0m\n\n`;

        // 贏家清單 (綠色 32)
        const winEntries = Object.entries(winBets || {});
        if (winEntries.length > 0) {
          resultsText += `\u001b[1;32m=== 贏家名冊 (彩池加成派彩) ===\u001b[0m\n`;
          for (const [uid, b] of winEntries) {
            const shareRatio = winPool > 0 ? b.amount / winPool : 0;
            const profit = Math.floor(shareRatio * losePool); // 分走輸家的比例
            resultsText += `\u001b[0;32m[哪有賭狗天天輸_${b.ign}_下注:${formatMeso(b.amount)}_+${formatMeso(profit)}楓幣]\u001b[0m\n`;
          }
        } else {
          resultsText += `\u001b[0;32m無人押中獲勝方，彩池保留。\u001b[0m\n`;
        }

        // 輸家清單 (紅色 31)
        const loseEntries = Object.entries(loseBets || {});
        if (loseEntries.length > 0) {
          resultsText += `\n\u001b[1;31m=== 輸家名冊 (通通沒收) ===\u001b[0m\n`;
          for (const [uid, b] of loseEntries) {
            resultsText += `\u001b[0;31m[賭狗賭狗賭到最後一無所有_${b.ign}_下注:${formatMeso(b.amount)}_-${formatMeso(b.amount)}楓幣]\u001b[0m\n`;
          }
        }

        resultsText += '```';

        await db.collection('active_bets').doc(betId).update({ isSettled: true });

        const settleEmbed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`🎉【賭局結算公告】${betData.title}`)
          .setDescription(`本局獲勝選項為：**【${winTitle}】**！\n總獎金池 \`${formatMeso(winPool + losePool)} 楓幣\` 已派發完畢！\n\n${resultsText}`);

        return await interaction.editReply({ embeds: [settleEmbed] });
      }

      // 2. 職業名冊切換
      if (interaction.customId === 'select_query_job') {
        await interaction.deferUpdate();
        const embed = await generateJobEmbed(interaction.values[0]);
        return await interaction.editReply({ embeds: [embed], components: [buildJobQueryMenu()] });
      }

      // 3. 報到職業選擇
      if (interaction.customId === 'select_job_register') {
        const val = interaction.values[0];
        const prevData = await fetchUserDocSafe(interaction.user.id);
        if (val === 'RETIRED_OPTION') {
          const modal = new ModalBuilder().setCustomId('modal_retire').setTitle('轉換身分：暫.退休');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('input_retire_ign').setLabel('遊戲名稱 / 暱稱').setStyle(TextInputStyle.Short)
              .setValue(prevData.mainIgn || interaction.user.displayName || '').setRequired(false)
          ));
          return await interaction.showModal(modal);
        }
        userSelectedJob.set(interaction.user.id, val);
        return await interaction.showModal(createRegisterModal(val, prevData));
      }
    }

    // ----------------------------------------
    // [D] Modal 表單提交
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      // 1. 自訂下注金額送出
      if (interaction.customId.startsWith('modal_bet_custom_')) {
        await interaction.deferReply({ ephemeral: true });
        const betId = interaction.customId.replace('modal_bet_custom_', '');
        const choice = interaction.fields.getTextInputValue('input_bet_choice').trim();
        const rawAmount = interaction.fields.getTextInputValue('input_bet_amount').toLowerCase().trim();

        let betAmount = 0;
        if (rawAmount.includes('w') || rawAmount.includes('萬')) {
          betAmount = parseInt(rawAmount.replace(/[^0-9]/g, '')) * 10000;
        } else if (rawAmount.includes('e') || rawAmount.includes('億')) {
          betAmount = parseInt(rawAmount.replace(/[^0-9]/g, '')) * 100000000;
        } else {
          betAmount = parseInt(rawAmount.replace(/[^0-9]/g, '')) || 0;
        }

        if (betAmount <= 0) return interaction.editReply('❌ 下注金額格式無效，請填寫大於 0 的金額！');

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.editReply('❌ 賭局已失效。');
        const betData = betDoc.data();

        if (Date.now() >= betData.deadline) return interaction.editReply('🛑 該賭局已截止下注！');

        const isOpt1 = choice === '1' || choice.includes(betData.option1);
        const targetBets = isOpt1 ? betData.bets1 : betData.bets2;
        const userDoc = await fetchUserDocSafe(interaction.user.id);
        const playerIgn = userDoc.mainIgn || interaction.user.displayName || interaction.user.username;

        const currentBet = targetBets[interaction.user.id]?.amount || 0;
        targetBets[interaction.user.id] = { ign: playerIgn, amount: currentBet + betAmount };

        const updatePayload = isOpt1
          ? { poolOption1: betData.poolOption1 + betAmount, bets1: targetBets }
          : { poolOption2: betData.poolOption2 + betAmount, bets2: targetBets };

        await db.collection('active_bets').doc(betId).update(updatePayload);

        return await interaction.editReply(`✅ 成功為 **${isOpt1 ? betData.option1 : betData.option2}** 下注 \`${formatMeso(betAmount)} 楓幣\`！(累計: ${formatMeso(currentBet + betAmount)})`);
      }

      // 2. 名冊更新送出
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
        const fullSubs = [...subsPage1, ...(prevData.subs ? prevData.subs.slice(4) : [])].slice(0, 10);

        let reach199At = prevData.reach199At || null;
        if (mainLevel === '199' && prevData.mainLevel !== '199') reach199At = admin.firestore.FieldValue.serverTimestamp();
        else if (mainLevel !== '199') reach199At = null;

        if (db) {
          await db.collection('member_profiles').doc(interaction.user.id).set({
            userId: interaction.user.id, username: interaction.user.username,
            mainIgn, mainJob, mainLevel, playtime, subs: fullSubs, isRetired: false,
            reach199At, timestamp: admin.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
        }

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

        const embed = new EmbedBuilder()
          .setColor(parseInt(mainLevel) >= 200 ? 0xF1C40F : 0x57F287)
          .setTitle(parseInt(mainLevel) >= 200 ? '👑 傳奇登頂！Lv 200 典獄長資料已更新！' : '🎉 冒險家名冊已成功更新！')
          .addFields(
            { name: '👑 本尊角色', value: `\`${mainIgn}\` (${mainJob} / Lv.${mainLevel})`, inline: true },
            { name: '⏱️ 遊玩時間', value: playtime, inline: true },
            { name: `⚔️ 分身名單 (${fullSubs.length} 隻)`, value: fullSubs.map(s => `• \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n') || '無', inline: false },
            { name: '🏷️ 伺服器暱稱', value: `\`${newNick}\``, inline: true },
            { name: '✨ 身分組', value: `【已驗證】、 【${jobNames.join('】、 【')}】`, inline: true }
          );

        await interaction.editReply({ embeds: [embed] });
        userSelectedJob.delete(interaction.user.id);
      }

      // 3. 退休送出
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
    }
  } catch (err) {
    console.error('互動處理錯誤:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
