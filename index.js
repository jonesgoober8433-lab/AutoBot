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
// 2. 工具與債務最小化演算法
// ==========================================

function parseDeadline(inputStr) {
  if (!inputStr) return null;
  const str = inputStr.trim().toLowerCase();
  const now = new Date();

  const relMatch = str.match(/^(\d+)(m|h|d|min|hr|day|分|小時|天)$/);
  if (relMatch) {
    const val = parseInt(relMatch[1]);
    const unit = relMatch[2];
    if (unit.startsWith('m') || unit === '分') return now.getTime() + val * 60 * 1000;
    if (unit.startsWith('h') || unit === '小時') return now.getTime() + val * 60 * 60 * 1000;
    if (unit.startsWith('d') || unit === '天') return now.getTime() + val * 24 * 60 * 60 * 1000;
  }

  const timeMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const target = new Date(now);
    target.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  const parsed = Date.parse(inputStr);
  if (!isNaN(parsed) && parsed > now.getTime()) return parsed;

  const numOnly = parseInt(str);
  if (!isNaN(numOnly) && numOnly > 0) return now.getTime() + numOnly * 60 * 1000;

  return null;
}

function parseMoneyInput(rawStr) {
  if (!rawStr) return 0;
  const str = rawStr.toLowerCase().trim();
  if (str.includes('w') || str.includes('萬')) return (parseFloat(str.replace(/[^0-9.]/g, '')) || 0) * 10000;
  if (str.includes('e') || str.includes('億')) return (parseFloat(str.replace(/[^0-9.]/g, '')) || 0) * 100000000;
  return parseInt(str.replace(/[^0-9]/g, '')) || 0;
}

function formatMeso(amount) {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(2)} 億`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)} 萬`;
  return (amount || 0).toLocaleString();
}

// 債務最小化撮合演算法
function calculateMinTransfers(balances) {
  const debtors = [];
  const creditors = [];

  for (const [id, data] of Object.entries(balances)) {
    const net = Math.round(data.net);
    if (net < -1) debtors.push({ id, ign: data.ign, amount: -net });
    else if (net > 1) creditors.push({ id, ign: data.ign, amount: net });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];
    const transferAmount = Math.min(debtor.amount, creditor.amount);

    if (transferAmount > 0) {
      transfers.push({
        from: debtor.ign,
        fromId: debtor.id,
        to: creditor.ign,
        toId: creditor.id,
        amount: transferAmount
      });

      debtor.amount -= transferAmount;
      creditor.amount -= transferAmount;
    }

    if (debtor.amount === 0) dIdx++;
    if (creditor.amount === 0) cIdx++;
  }

  return transfers;
}

// ==========================================
// 3. 賭局 UI 面板建構
// ==========================================

function createMultiBetEmbed(betData) {
  let playerPool = 0;
  betData.options.forEach(opt => playerPool += (opt.pool || 0));
  const totalPool = playerPool + (betData.seedMoney || 0);
  const isClosed = Date.now() >= betData.deadline;

  const embed = new EmbedBuilder()
    .setColor(isClosed ? 0x95A5A6 : 0xE67E22)
    .setTitle(betData.isScroll ? `📜【裝備衝卷競猜】${betData.title}` : `📖【技能書點擊賭局】${betData.title}`)
    .setDescription(
      `👑 **發起人**：<@${betData.creatorId}>\n` +
      `🎁 **發起人底池**：\`${formatMeso(betData.seedMoney || 0)} 楓幣\`\n` +
      `⏳ **截止時間**：<t:${Math.floor(betData.deadline / 1000)}:R> (<t:${Math.floor(betData.deadline / 1000)}:F>)\n` +
      `💰 **總獎金池**：\`${formatMeso(totalPool)} 楓幣\`\n` +
      `狀態：${isClosed ? '🔴 **已截止下注，等待結算**' : '🟢 **下注進行中！賠率隨人數即時變動**'}\n` +
      `━━━━━━━━━━━━━━━━━━━━`
    )
    .setFooter({ text: 'Pari-mutuel 彩池分紅 | 結算時自動生成最少交易轉帳清單' });

  betData.options.forEach((opt) => {
    const odds = (opt.pool > 0) ? (totalPool / opt.pool).toFixed(2) : (totalPool > 0 ? '超高賠率' : '1.00');
    const userCount = Object.keys(opt.bets || {}).length;
    embed.addFields({
      name: `${opt.name}`,
      value: `💵 彩池：\`${formatMeso(opt.pool || 0)}\`\n👥 人數：\`${userCount} 人\`\n📈 賠率：\`${odds}x\``,
      inline: true
    });
  });

  return embed;
}

function createMultiBetComponents(betId, options) {
  if (options.length <= 3) {
    const row1 = new ActionRowBuilder();
    options.forEach((opt, idx) => {
      row1.addComponents(
        new ButtonBuilder().setCustomId(`bet_quick_${betId}_${idx}`).setLabel(`${opt.name} (+100w)`).setStyle(ButtonStyle.Primary)
      );
    });
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_custom_btn_${betId}`).setLabel('✏️ 自訂金額下注').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bet_settle_btn_${betId}`).setLabel('⚖️ 一鍵結算').setStyle(ButtonStyle.Secondary)
    );
    return [row1, row2];
  } else {
    const selectOptions = options.map((opt, idx) =>
      new StringSelectMenuOptionBuilder().setLabel(opt.name).setValue(`${idx}`).setDescription(`選擇投注【${opt.name}】`)
    );
    const row1 = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`bet_select_opt_${betId}`).setPlaceholder('🔽 點此選擇你要押注的過卷數 / 選項').addOptions(selectOptions)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_act_100w_${betId}`).setLabel('💵 快捷下注 +100w').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_custom_btn_${betId}`).setLabel('✏️ 自訂金額下注').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bet_settle_btn_${betId}`).setLabel('⚖️ 一鍵結算').setStyle(ButtonStyle.Secondary)
    );
    return [row1, row2];
  }
}

async function hasActiveBet() {
  if (!db) return false;
  const snapshot = await db.collection('active_bets').where('isSettled', '==', false).get();
  return !snapshot.empty;
}

// ==========================================
// 4. 名冊與個人資料模組
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
// 5. Express 伺服器 & Firebase 初始化
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
// 6. 斜線指令註冊
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('發起賭局')
    .setDescription('發起社群競猜賭局 (同時間全服限一局)')
    .addSubcommand(sub =>
      sub.setName('技能書')
        .setDescription('發起技能書點擊二選一賭局 (會過 / 爆掉)')
        .addStringOption(o => o.setName('技能書名稱').setDescription('例如：三飛閃30、四連箭30、暴風神射30').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：15m、30m、1h、21:30 等').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('發起人自掏腰包加碼底池 (選填，例如：500w、1000w)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('衝卷')
        .setDescription('發起裝備衝卷過幾卷競猜 (+0 ~ +10)')
        .addStringOption(o => o.setName('裝備名稱').setDescription('例如：紫色衝浪板、楓葉之盔').setRequired(true))
        .addIntegerOption(o => o.setName('最大卷數').setDescription('該裝備總卷數上限 (例如：2、7 或 10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：15m、1h、20:00 等').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('發起人自掏腰包加碼底池 (選填，例如：500w、1000w)').setRequired(false))
    ),

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
// 7. 互動事件核心監聽
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === '發起賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });

        if (await hasActiveBet()) {
          return interaction.reply({ content: '⚠️ **伺服器目前已有正在進行中的賭局！**\n為了維持秩序與彩池集中，請等待當前賭局結算後再開新局！', ephemeral: true });
        }

        const subCommand = interaction.options.getSubcommand();

        if (subCommand === '技能書') {
          await interaction.deferReply();
          const bookName = interaction.options.getString('技能書名稱');
          const rawDeadline = interaction.options.getString('截止時間');
          const rawSeed = interaction.options.getString('底池金額');

          const deadline = parseDeadline(rawDeadline);
          const seedMoney = parseMoneyInput(rawSeed);

          if (!deadline) return interaction.editReply('❌ 時間格式無效！請輸入如 `15m`、`30m`、`1h`、`21:30`。');

          const betDocRef = db.collection('active_bets').doc();
          const options = [
            { name: `🟢 會過`, pool: 0, bets: {} },
            { name: `🔴 爆掉`, pool: 0, bets: {} }
          ];

          const betData = {
            id: betDocRef.id,
            creatorId: interaction.user.id,
            creatorName: interaction.user.username,
            title: `【${bookName}】能不能點過？`,
            options, deadline, seedMoney,
            isScroll: false, isSettled: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          };

          await betDocRef.set(betData);
          return await interaction.editReply({
            embeds: [createMultiBetEmbed(betData)],
            components: createMultiBetComponents(betDocRef.id, options)
          });
        }

        if (subCommand === '衝卷') {
          await interaction.deferReply();
          const equipName = interaction.options.getString('裝備名稱');
          const maxScroll = interaction.options.getInteger('最大卷數');
          const rawDeadline = interaction.options.getString('截止時間');
          const rawSeed = interaction.options.getString('底池金額');

          const deadline = parseDeadline(rawDeadline);
          const seedMoney = parseMoneyInput(rawSeed);

          if (!deadline) return interaction.editReply('❌ 時間格式無效！請輸入如 `15m`、`1h`、`20:00`。');

          const options = [];
          for (let i = 0; i <= maxScroll; i++) {
            let label = `+${i} 卷`;
            if (i === 0) label = `💀 +0 (全爆)`;
            else if (i === maxScroll) label = `👑 +${i} (完美神裝)`;
            options.push({ name: label, pool: 0, bets: {} });
          }

          const betDocRef = db.collection('active_bets').doc();
          const betData = {
            id: betDocRef.id,
            creatorId: interaction.user.id,
            creatorName: interaction.user.username,
            title: `【${equipName}】能過幾卷？(上限 +${maxScroll})`,
            options, deadline, seedMoney,
            isScroll: true, isSettled: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          };

          await betDocRef.set(betData);
          return await interaction.editReply({
            embeds: [createMultiBetEmbed(betData)],
            components: createMultiBetComponents(betDocRef.id, options)
          });
        }
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
    // [B] 賭局按鈕 (即時動態刷新)
    // ----------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId === 'btn_quick_edit') {
        const prevData = await fetchUserDocSafe(interaction.user.id);
        const defaultJob = prevData.mainJob || Object.keys(ROLES.JOBS)[0];
        userSelectedJob.set(interaction.user.id, defaultJob);
        return await interaction.showModal(createRegisterModal(defaultJob, prevData));
      }

      // 1. 結算按鈕
      if (customId.startsWith('bet_settle_btn_')) {
        const betId = customId.replace('bet_settle_btn_', '');
        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 該賭局已失效。', ephemeral: true });

        const betData = betDoc.data();
        const isCreator = interaction.user.id === betData.creatorId;
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

        if (!isCreator && !isAdmin) return interaction.reply({ content: '❌ 只有發起人或管理員可以結算！', ephemeral: true });
        if (Date.now() < betData.deadline) return interaction.reply({ content: `⏳ 尚未到達截止時間！請在 <t:${Math.floor(betData.deadline / 1000)}:R> 後再進行結算。`, ephemeral: true });
        if (betData.isSettled) return interaction.reply({ content: '⚠️ 該賭局已經結算完畢！', ephemeral: true });

        const selectOptions = betData.options.map((opt, idx) =>
          new StringSelectMenuOptionBuilder().setLabel(`🏆 勝方：【${opt.name}】`).setValue(`${idx}`)
        );

        return await interaction.reply({
          content: `⚖️ **請選擇【${betData.title}】最終獲勝的結果進行獎金派發：**`,
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`settle_finalize_${betId}`).setPlaceholder('選擇最終獲勝選項').addOptions(selectOptions)
          )],
          ephemeral: true
        });
      }

      // 2. 快捷下注 +100w (二選一)
      if (customId.startsWith('bet_quick_')) {
        const parts = customId.split('_');
        const betId = parts[2];
        const optIdx = parseInt(parts[3]);

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (Date.now() >= betData.deadline) return interaction.reply({ content: '🛑 該賭局已截止下注！', ephemeral: true });

        const addAmount = 1000000;
        const userDoc = await fetchUserDocSafe(interaction.user.id);
        const playerIgn = userDoc.mainIgn || interaction.user.displayName || interaction.user.username;

        const options = betData.options;
        const currentBet = options[optIdx].bets[interaction.user.id]?.amount || 0;
        options[optIdx].bets[interaction.user.id] = { ign: playerIgn, amount: currentBet + addAmount };
        options[optIdx].pool = (options[optIdx].pool || 0) + addAmount;

        await db.collection('active_bets').doc(betId).update({ options });
        await interaction.message.edit({ embeds: [createMultiBetEmbed({ ...betData, options })] });

        return await interaction.reply({
          content: `✅ 成功為 **${options[optIdx].name}** 下注 \`+100 萬 楓幣\`！(個人累計: ${formatMeso(currentBet + addAmount)})`,
          ephemeral: true
        });
      }

      // 3. 衝卷/多選項快捷 +100w
      if (customId.startsWith('bet_act_100w_')) {
        const betId = customId.replace('bet_act_100w_', '');
        const selectedOptIdx = userSelectedJob.get(`bet_choice_${interaction.user.id}_${betId}`);
        if (selectedOptIdx === undefined) return interaction.reply({ content: '⚠️ 請先在上方下拉選單點選你要下注的【選項】！', ephemeral: true });

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (Date.now() >= betData.deadline) return interaction.reply({ content: '🛑 該賭局已截止下注！', ephemeral: true });

        const addAmount = 1000000;
        const userDoc = await fetchUserDocSafe(interaction.user.id);
        const playerIgn = userDoc.mainIgn || interaction.user.displayName || interaction.user.username;

        const options = betData.options;
        const currentBet = options[selectedOptIdx].bets[interaction.user.id]?.amount || 0;
        options[selectedOptIdx].bets[interaction.user.id] = { ign: playerIgn, amount: currentBet + addAmount };
        options[selectedOptIdx].pool = (options[selectedOptIdx].pool || 0) + addAmount;

        await db.collection('active_bets').doc(betId).update({ options });
        await interaction.message.edit({ embeds: [createMultiBetEmbed({ ...betData, options })] });

        return await interaction.reply({
          content: `✅ 成功為 **${options[selectedOptIdx].name}** 下注 \`+100 萬 楓幣\`！(個人累計: ${formatMeso(currentBet + addAmount)})`,
          ephemeral: true
        });
      }

      // 4. 自訂金額彈窗
      if (customId.startsWith('bet_custom_btn_')) {
        const betId = customId.replace('bet_custom_btn_', '');
        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (Date.now() >= betData.deadline) return interaction.reply({ content: '🛑 該賭局已截止下注！', ephemeral: true });

        const modal = new ModalBuilder().setCustomId(`modal_bet_custom_${betId}`).setTitle(`自訂下注金額`);
        let descList = betData.options.map((opt, i) => `${i + 1}:${opt.name}`).join(' | ');
        if (descList.length > 90) descList = descList.substring(0, 90) + '...';

        const choiceInput = new TextInputBuilder()
          .setCustomId('input_bet_choice')
          .setLabel(`選擇選項編號 (1 ~ ${betData.options.length})`)
          .setPlaceholder(`選項：${descList}`)
          .setStyle(TextInputStyle.Short).setRequired(true);

        const amountInput = new TextInputBuilder()
          .setCustomId('input_bet_amount')
          .setLabel(`下注金額 (支援 500w, 1e 或純數字)`)
          .setPlaceholder(`例如：500w 或 5000000`)
          .setStyle(TextInputStyle.Short).setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(choiceInput), new ActionRowBuilder().addComponents(amountInput));
        return await interaction.showModal(modal);
      }
    }

    // ----------------------------------------
    // [C] 下拉選單處理 (精簡化 ANSI 名冊樣式)
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('bet_select_opt_')) {
        const betId = interaction.customId.replace('bet_select_opt_', '');
        const optIdx = parseInt(interaction.values[0]);
        userSelectedJob.set(`bet_choice_${interaction.user.id}_${betId}`, optIdx);
        return await interaction.reply({ content: `👉 已選中第 ${optIdx + 1} 個選項，現在可以點擊下方按鈕進行下注！`, ephemeral: true });
      }

      // 賭局結算執行 (ANSI 格式化精簡)
      if (interaction.customId.startsWith('settle_finalize_')) {
        await interaction.deferReply();
        const betId = interaction.customId.replace('settle_finalize_', '');
        const winIdx = parseInt(interaction.values[0]);

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.editReply('❌ 賭局資料已失效。');
        const betData = betDoc.data();

        const options = betData.options;
        const winOption = options[winIdx];

        let playerPool = 0;
        let winPool = winOption.pool || 0;
        options.forEach(o => playerPool += (o.pool || 0));

        const totalPool = playerPool + (betData.seedMoney || 0);
        const bonusPool = totalPool - winPool;

        const balances = {};

        if (betData.seedMoney > 0) {
          balances[betData.creatorId] = {
            ign: betData.creatorName || '發起人底池',
            net: -(betData.seedMoney)
          };
        }

        options.forEach(opt => {
          for (const [uid, b] of Object.entries(opt.bets || {})) {
            if (!balances[uid]) balances[uid] = { ign: b.ign, net: 0 };
            balances[uid].net -= b.amount;
          }
        });

        const winBets = Object.entries(winOption.bets || {});
        let resultsText = '```ansi\n';
        resultsText += `\u001b[1;33m🏆 最終結算：【${winOption.name}】獲勝！\u001b[0m\n\n`;

        // 🌟 贏家名冊 (樣式精簡)
        if (winBets.length > 0) {
          resultsText += `\u001b[1;32m=== 贏家名冊 (哪有賭狗天天輸） ===\u001b[0m\n`;
          for (const [uid, b] of winBets) {
            const share = winPool > 0 ? (b.amount / winPool) * bonusPool : 0;
            const totalReturn = b.amount + Math.floor(share);
            balances[uid].net += totalReturn;

            resultsText += `\u001b[0;32m[${b.ign}_下注:${formatMeso(b.amount)}_+${formatMeso(Math.floor(share))}楓幣 (領回:${formatMeso(totalReturn)})]\u001b[0m\n`;
          }
        } else {
          resultsText += `\u001b[0;32m無人押中此選項，底池與彩池全數保留/退回。\u001b[0m\n`;
        }

        // 🌟 輸家名冊 (樣式精簡)
        resultsText += `\n\u001b[1;31m=== 輸家名冊 (賭狗賭狗賭到最後一無所有） ===\u001b[0m\n`;
        let hasLosers = false;
        options.forEach((opt, idx) => {
          if (idx !== winIdx) {
            for (const [uid, b] of Object.entries(opt.bets || {})) {
              hasLosers = true;
              resultsText += `\u001b[0;31m[${b.ign}_下注:${formatMeso(b.amount)}_-${formatMeso(b.amount)}楓幣]\u001b[0m\n`;
            }
          }
        });
        if (!hasLosers) resultsText += `\u001b[0;31m無輸家。\u001b[0m\n`;
        resultsText += '```';

        const transfers = calculateMinTransfers(balances);
        let transferGuide = `🧾 **【最少交易次數轉帳指引（共 ${transfers.length} 筆）】**\n*(依照以下指引在遊戲內交易，可大幅降低跑圖次數與官方手續費！)*\n\n`;

        if (transfers.length === 0) {
          transferGuide += `• 無需進行任何轉帳交易。`;
        } else {
          transfers.forEach((t, i) => {
            transferGuide += `${i + 1}. ➡️ **${t.from}** 交易給 **${t.to}**：\`${formatMeso(t.amount)} 楓幣\``;
            if (t.amount >= 10000000) {
              transferGuide += ` *(💡 單筆達 1000w 以上，可協議拆單降手續費率)*`;
            }
            transferGuide += `\n`;
          });
        }

        await db.collection('active_bets').doc(betId).update({ isSettled: true });

        const settleEmbed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`🎉【競猜結算公告】${betData.title}`)
          .setDescription(`恭喜 **【${winOption.name}】** 成功開出！\n總獎金池 \`${formatMeso(totalPool)} 楓幣\` 已依照比例全數派發完畢！\n\n${resultsText}\n${transferGuide}`);

        return await interaction.editReply({ embeds: [settleEmbed] });
      }

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
      if (interaction.customId.startsWith('modal_bet_custom_')) {
        await interaction.deferReply({ ephemeral: true });
        const betId = interaction.customId.replace('modal_bet_custom_', '');
        const choiceRaw = interaction.fields.getTextInputValue('input_bet_choice').trim();
        const rawAmount = interaction.fields.getTextInputValue('input_bet_amount').trim();

        let optIdx = parseInt(choiceRaw) - 1;
        const betAmount = parseMoneyInput(rawAmount);

        if (betAmount <= 0) return interaction.editReply('❌ 下注金額格式無效，請填寫大於 0 的數字！');

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.editReply('❌ 賭局已失效');
        const betData = betDoc.data();

        if (Date.now() >= betData.deadline) return interaction.editReply('🛑 該賭局已截止下注！');
        if (isNaN(optIdx) || optIdx < 0 || optIdx >= betData.options.length) return interaction.editReply(`❌ 選項編號無效，請填寫 1 ~ ${betData.options.length}！`);

        const userDoc = await fetchUserDocSafe(interaction.user.id);
        const playerIgn = userDoc.mainIgn || interaction.user.displayName || interaction.user.username;

        const options = betData.options;
        const currentBet = options[optIdx].bets[interaction.user.id]?.amount || 0;
        options[optIdx].bets[interaction.user.id] = { ign: playerIgn, amount: currentBet + betAmount };
        options[optIdx].pool = (options[optIdx].pool || 0) + betAmount;

        await db.collection('active_bets').doc(betId).update({ options });
        return await interaction.editReply(`✅ 成功為 **${options[optIdx].name}** 下注 \`${formatMeso(betAmount)} 楓幣\`！(個人累計: ${formatMeso(currentBet + betAmount)})`);
      }

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

      if (interaction.customId === 'modal_retire') {
        await interaction.deferReply();
        const ign = interaction.fields.getTextInputValue('input_retire_ign')?.trim() || interaction.user.displayName || interaction.user.username;
        const newNick = `[退休] ${ign}`.substring(0, 32);

        if (db) {
          await db.collection('member_profiles').doc(interaction.user.id).set({
            userId: interaction.user.id, username: interaction.user.username,
            mainIgn, isRetired: true, timestamp: admin.firestore.FieldValue.serverTimestamp()
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
