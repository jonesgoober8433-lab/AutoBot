require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, PermissionFlagsBits, Events
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');
const cron = require('node-cron');

// ==========================================
// 1. 伺服器與常數設定
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Auto-Bot Server is Online!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ 網頁伺服器已啟動於 Port ${PORT}`));

const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID || '1476762995454640159';
const WELCOME_REGISTER_CHANNEL_ID = '1540052273743532122';
const SUPER_ADMIN_ID = '923054816937254932';

const ROLES = {
  VERIFIED: '1540053101120323685',
  UNVERIFIED: '1540053110846791762',
  RETIRED: '1540327837947396166',
  WARDEN_200: '1540337376994402376',
  JOBS: {
    '黑騎士': '1540050432796266526', '聖騎士': '1540051178396844153', '英雄': '1540051228459929631',
    '箭神': '1540051260005154967', '神射手': '1540051322525716601', '冰雷': '1540051347376832594',
    '火毒': '1540051370416017449', '主教': '1540051392138444880', '槍神': '1540051430050897921',
    '拳霸': '1540051450904969317', '刀賊': '1540051596518494228', '鏢賊': '1540051618345652275'
  }
};

const JOB_BUFFS = {
  '黑騎士': ['🔥神聖之火', '🛡️力量消除'], '聖騎士': ['🛡️魔法消除'], '英雄': ['⚔️激勵'],
  '箭神': ['🎯會心之眼'], '神射手': ['🎯會心之眼'], '主教': ['✨神聖祈禱', '👼天使祝福'],
  '冰雷': ['🧠精神強化'], '火毒': ['🧠精神強化'], '鏢賊': ['⚡速', '🍀幸運術'],
  '刀賊': ['⚡速'], '拳霸': ['🥊最終極速'], '槍神': []
};

const CLASSIC_EXP_TABLE = [
  0, 15, 34, 57, 92, 135, 372, 560, 840, 1242,
  1600, 2100, 2750, 3550, 4550, 5800, 7350, 9250, 11550, 14350,
  17750, 21850, 26750, 32550, 39400, 47450, 56850, 67750, 80350, 94850,
  111500, 130500, 152100, 176600, 204300, 235500, 270500, 309700, 353500, 402300,
  456500, 516700, 583300, 656900, 738000, 827200, 925100, 1032300, 1149500, 1277300,
  1416500, 1567800, 1732000, 1910000, 2102500, 2310500, 2535000, 2777000, 3037700, 3318200,
  3619700, 3943400, 4290700, 4662800, 5061200, 5487400, 5942900, 6429400, 6948500, 7502000,
  8587440, 9370880, 10220640, 11140920, 12136140, 13210960, 14370320, 15619380, 16963560, 18408540,
  19960240, 21624840, 23408800, 25318880, 27362140, 29545920, 31877840, 34365820, 37018140, 39843340,
  42850320, 46048380, 49447140, 53056620, 56887240, 60949820, 65255640, 69816400, 74644240, 79751740,
  85152000, 90858600, 96885600, 103247600, 109959800, 117037900, 124498300, 132357900, 140634200, 149345400,
  158510200, 168147900, 178278200, 188921500, 200100000, 211836000, 224152800, 237074200, 250624800, 264829700,
  279715000, 295307700, 311635800, 328728100, 346614400, 365325500, 384893100, 405350000, 426729000, 449064100,
  472389600, 496740600, 522153200, 548663800, 576310000, 605130200, 635163700, 666450800, 699033300, 732953000,
  768253100, 804978000, 843173100, 882885100, 924161000, 967049500, 1011599800, 1057862500, 1105889000, 1155731800,
  1207444700, 1261082500, 1316699800, 1374352500, 1434107000, 1496020000, 1560159400, 1626593500, 1695391300, 1766622800,
  1840358800, 1916671000, 1995632500, 2077317300, 2161800500, 2249158500, 2339468500, 2432808000, 2529255000, 2628888000,
  2731786000, 2838028500, 2947696000, 3060870000, 3177632500, 3298066500, 3422256000, 3550286000, 3682242500, 3818212500,
  3958284500, 4102547500, 4251091500, 4404008000, 4561389000, 4723327000, 4889916000, 5061250000, 5237424500, 5418535500,
  5604680000, 5795955000, 5992458500, 6194289500, 6401548000, 6614333500, 6832747000, 7056889500, 7286862500, 7522768500
];

const PITY_QUOTES = [
  "贊助苦主一包強力吸水面紙擦眼淚...",
  "全爆補助金：給老哥買碗暖心熱湯喝...",
  "給鐵匠維修槌子的磨損費與精神賠償...",
  "贊助苦主吸收技能書灰燼的心理治療費...",
  "技能書爆破受害者保護協會急難救助金...",
  "給可憐人買本初級教科書冷靜一下...",
  "贊助苦主打不到寶的洗面乳 (洗把臉再來)...",
  "空包彈受害者急難救助金 (請節哀)...",
  "贊助苦主打怪打到手抽筋的特效酸痛貼布...",
  "施捨一張回村卷軸買水錢，兄弟撐住！"
];

const BOOK_SUCCESS_QUOTES = [
  "給你機會你不中用呀！竟然點過了，善款沒收省下一筆！",
  "恭喜點過！這筆善款是要捐給難民的，看來你不需要了～",
  "可惡！本來想看煙火的，省下一筆急難救助金！",
  "算你運氣好！這筆心靈撫慰金留給下一個爆書的苦主吧！",
  "居然過了！？救濟金自動退回慈善家口袋～"
];

const wizardSessionMap = new Map();
const userChoiceMap = new Map();
const expTrackerMap = new Map();

function getRandomPityQuote() { return PITY_QUOTES[Math.floor(Math.random() * PITY_QUOTES.length)]; }
function getRandomBookSuccessQuote() { return BOOK_SUCCESS_QUOTES[Math.floor(Math.random() * BOOK_SUCCESS_QUOTES.length)]; }
function isSuperAdmin(userId, perms) { return userId === SUPER_ADMIN_ID || perms?.has(PermissionFlagsBits.Administrator); }

// ==========================================
// 2. Firebase 初始化連線
// ==========================================
let db;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    console.log('✅ Firebase Firestore 連線成功');
  } else {
    console.log('⚠️ 未偵測到 FIREBASE_CREDENTIALS，跳過資料庫連線');
  }
} catch (error) {
  console.error('❌ Firebase 初始化失敗:', error.message);
}

// ==========================================
// 3. Client 實例建立
// ==========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ==========================================
// 4. 輔助計算工具
// ==========================================
function parseDeadline(inputStr) {
  if (!inputStr) return null;
  const str = inputStr.trim().toLowerCase();
  const now = new Date();
  const rel = str.match(/^(\d+)(m|h|d|min|hr|day|分|小時|天)$/);
  if (rel) {
    const val = parseInt(rel[1]);
    const u = rel[2];
    if (u.startsWith('m') || u === '分') return now.getTime() + val * 60000;
    if (u.startsWith('h') || u === '小時') return now.getTime() + val * 3600000;
    if (u.startsWith('d') || u === '天') return now.getTime() + val * 86400000;
  }
  const time = str.match(/^(\d{1,2}):(\d{2})$/);
  if (time) {
    const t = new Date(now);
    t.setHours(parseInt(time[1]), parseInt(time[2]), 0, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    return t.getTime();
  }
  const parsed = Date.parse(inputStr);
  if (!isNaN(parsed) && parsed > now.getTime()) return parsed;
  const num = parseInt(str);
  return (!isNaN(num) && num > 0) ? now.getTime() + num * 60000 : null;
}

function parseMoneyInput(rawStr) {
  if (!rawStr) return 0;
  const s = rawStr.toLowerCase().trim();
  if (s.includes('w') || s.includes('萬')) return (parseFloat(s.replace(/[^0-9.]/g, '')) || 0) * 10000;
  if (s.includes('e') || s.includes('億')) return (parseFloat(s.replace(/[^0-9.]/g, '')) || 0) * 100000000;
  return parseInt(s.replace(/[^0-9]/g, '')) || 0;
}

function parseExpInput(rawStr, level) {
  if (!rawStr) return 0;
  const s = rawStr.trim();
  const needExp = CLASSIC_EXP_TABLE[level] || 1;
  if (s.includes('%')) {
    const pct = parseFloat(s.replace(/[^0-9.]/g, '')) || 0;
    return Math.round((pct / 100) * needExp);
  }
  return parseMoneyInput(s);
}

function formatMeso(amount) {
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(2)} 億`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(0)} 萬`;
  return (amount || 0).toLocaleString();
}

function calculateMinTransfers(balances) {
  const debtors = [], creditors = [];
  for (const [id, data] of Object.entries(balances)) {
    const net = Math.round(data.net);
    if (net < -1) debtors.push({ id, ign: data.ign, amount: -net });
    else if (net > 1) creditors.push({ id, ign: data.ign, amount: net });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let d = 0, c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amt = Math.min(debtors[d].amount, creditors[c].amount);
    if (amt > 0) {
      transfers.push({ from: debtors[d].ign, to: creditors[c].ign, amount: amt });
      debtors[d].amount -= amt;
      creditors[c].amount -= amt;
    }
    if (debtors[d].amount === 0) d++;
    if (creditors[c].amount === 0) c++;
  }
  return transfers;
}

async function fetchUserDocSafe(userId) {
  if (!db || !userId) return {};
  try {
    const doc = await Promise.race([
      db.collection('member_profiles').doc(userId).get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
    ]);
    return doc?.exists ? doc.data() : {};
  } catch { return {}; }
}

async function getCharStatusDoc(charIgn) {
  if (!db || !charIgn) return null;
  try {
    const doc = await db.collection('char_statuses').doc(charIgn.toLowerCase()).get();
    return doc.exists ? doc.data() : null;
  } catch { return null; }
}

async function getActiveBetDoc() {
  if (!db) return null;
  try {
    const snap = await db.collection('active_bets').where('isSettled', '==', false).limit(1).get();
    return snap.empty ? null : snap.docs[0];
  } catch { return null; }
}

// ==========================================
// 5. UI 模組建構
// ==========================================
function createExpCalculatorEmbed(sessionData) {
  const isRunning = !!sessionData?.startTime;
  const lvText = sessionData?.startLevel ? `Lv.${sessionData.startLevel}` : '未設定';
  const expStartText = sessionData?.expStart !== undefined ? sessionData.expStart.toLocaleString() : '未設定';
  const mesoStartText = sessionData?.mesoStart ? formatMeso(sessionData.mesoStart) : '未設定';

  return new EmbedBuilder()
    .setColor(isRunning ? 0xFEE75C : 0x3498DB)
    .setTitle('📊【練等經驗與楓幣效率計算器】(支援升級精算)')
    .setDescription(
      isRunning
        ? `⏱️ **計時進行中！**\n` +
          `⏰ **開始時間**：<t:${Math.floor(sessionData.startTime / 1000)}:T> (<t:${Math.floor(sessionData.startTime / 1000)}:R>)\n` +
          `⚔️ **起始等級**：\`${lvText}\`\n` +
          `📊 **起始經驗值**：\`${expStartText} EXP\`\n` +
          `💰 **起始楓幣量**：\`${mesoStartText} 楓幣\`\n\n` +
          `💡 練完後請點擊下方 **「🛑 結束計算」**（點擊瞬間立即暫停計時），填寫結束等級與數據即可自動精算！`
        : `✨ 點擊下方 **「⏱️ 開始計算」** 輸入起始等級與數據後將自動開始計時！\n即使練等中途**升級**，系統也會透過經典經驗表精準換算為 **標準 10 分鐘與 1 小時產出**！`
    )
    .setFooter({ text: '楓之谷練等工具箱 | 升級防呆精算' });
}

function createExpCalculatorComponents(isRunning = false) {
  const row = new ActionRowBuilder();
  if (!isRunning) {
    row.addComponents(new ButtonBuilder().setCustomId('exp_calc_trigger_start').setLabel('⏱️ 開始計算').setStyle(ButtonStyle.Success));
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId('exp_calc_stop').setLabel('🛑 結束計算 (暫停計時)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('exp_calc_cancel').setLabel('❌ 取消計時').setStyle(ButtonStyle.Secondary)
    );
  }
  return [row];
}

function createPartyEmbed(partyData) {
  const members = partyData.members || [];
  let currentHeadCount = 0;
  members.forEach(m => currentHeadCount += (parseInt(m.seatCount) || 1));
  const isFull = currentHeadCount >= partyData.maxCount;

  const buffPool = [];
  members.forEach(m => {
    Object.entries(m.buffs || {}).forEach(([k, v]) => buffPool.push(`${k}(${v})`));
  });

  let memberListText = members.length === 0 ? '• 目前尚無成員加入' : '';
  members.forEach((m, idx) => {
    const buffs = Object.entries(m.buffs || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    const extraSeats = (parseInt(m.seatCount) || 1) > 1 ? ` *(含帶機共佔 ${m.seatCount} 人)*` : '';
    memberListText += `${idx + 1}. **${m.ign}** (${m.job} Lv.${m.level})${extraSeats} - <@${m.userId}>\n   └ 💡 技能：\`${buffs || '無'}\`\n`;
  });

  const titles = { training: '⚔️【冒險者團練】', raid: '🐉【Boss 突襲遠征】', pq: '🧩【經典組隊任務】' };

  return new EmbedBuilder()
    .setColor(partyData.isClosed ? 0x95A5A6 : (isFull ? 0xF1C40F : 0x3498DB))
    .setTitle(`${titles[partyData.partyType] || '⚔️【冒險揪團】'}${partyData.target}`)
    .setDescription(
      `👑 **隊長**：<@${partyData.creatorId}>\n` +
      `⏰ **開打時間**：\`${partyData.startTime}\` | 📌 **備註**：\`${partyData.bindReq || '無'}\`\n` +
      `📱 **隊長可開設備**：\`${partyData.devicesCount || 0} 台\`\n` +
      `👥 **總佔用人數**：\`${currentHeadCount} / ${partyData.maxCount} 人\` ${isFull ? '🔴 **(已滿員)**' : '🟢 **(招募中)**'}\n` +
      `✨ **隊伍 Buff 總覽**：\`${buffPool.length ? buffPool.join(' | ') : '尚未有 Buff'}\`\n` +
      `狀態：${partyData.isClosed ? '🔒 **已結束招募**' : '🔥 **歡迎報名加入！**'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n📋 **【目前名冊】**\n${memberListText}`
    );
}

function createPartyComponents(partyId, isClosed = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party_join_${partyId}`).setLabel('✋ 報名加入').setStyle(ButtonStyle.Success).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_leave_select_${partyId}`).setLabel('❌ 退出/修改角色').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_edit_info_${partyId}`).setLabel('✏️ 修改揪團').setStyle(ButtonStyle.Primary).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_close_${partyId}`).setLabel('🚪 關閉').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_delete_${partyId}`).setLabel('🗑️ 刪除').setStyle(ButtonStyle.Danger)
    )
  ];
}

function createMultiBetEmbed(betData) {
  let playerPool = 0;
  betData.options.forEach(opt => playerPool += (opt.pool || 0));
  const totalPool = playerPool + (betData.seedMoney || 0);
  const isExpired = Date.now() >= betData.deadline;

  const embed = new EmbedBuilder()
    .setColor(betData.isPaused ? 0xE74C3C : (isExpired ? 0x95A5A6 : 0xE67E22))
    .setTitle(`🎲【社群競猜】${betData.title}`)
    .setDescription(
      `👑 **發起人**：<@${betData.creatorId}> | 🎁 **底池加碼**：\`${formatMeso(betData.seedMoney || 0)}\`\n` +
      `⏳ **截止時間**：<t:${Math.floor(betData.deadline / 1000)}:R> | 💰 **公開總彩池**：\`${formatMeso(totalPool)} 楓幣\`\n` +
      `狀態：${betData.isPaused ? '⏸️ **暫停下注**' : (isExpired ? '🔴 **已截止**' : '🟢 **下注進行中**')}\n━━━━━━━━━━━━━━━━━━━━`
    );

  betData.options.forEach((opt, idx) => {
    const odds = (opt.pool > 0) ? (totalPool / opt.pool).toFixed(2) : (totalPool > 0 ? '超高賠率' : '1.00');
    const optLabel = (betData.betType === 'scroll_step') ? `🎯 [${idx}] ${opt.name}` : `🎯 [${idx + 1}] ${opt.name}`;
    embed.addFields({ name: optLabel, value: `💵 彩池：\`${formatMeso(opt.pool || 0)}\`\n📈 賠率：\`${odds}x\``, inline: true });
  });
  return embed;
}

function createMultiBetComponents(betId, options) {
  if (options.length <= 2) {
    const r1 = new ActionRowBuilder();
    options.forEach((opt, idx) => {
      r1.addComponents(new ButtonBuilder().setCustomId(`bet_qk_${betId}_${idx}`).setLabel(`${opt.name} (+100w)`).setStyle(idx === 0 ? ButtonStyle.Success : ButtonStyle.Danger));
    });
    r1.addComponents(new ButtonBuilder().setCustomId(`bet_custom_${betId}`).setLabel('✏️ 自訂下注').setStyle(ButtonStyle.Primary));

    const r2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_pity_${betId}`).setLabel('🩹 同情抖內').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bet_settle_${betId}`).setLabel('⚖️ 結算').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_del_${betId}`).setLabel('🗑️ 廢除').setStyle(ButtonStyle.Danger)
    );
    return [r1, r2];
  } else {
    const selectOptions = options.map((opt, idx) => new StringSelectMenuOptionBuilder().setLabel(opt.name.substring(0, 100)).setValue(`${idx}`));
    const r1 = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`bet_selopt_${betId}`).setPlaceholder('🔽 點此選擇你要投注的選項').addOptions(selectOptions.slice(0, 25)));
    const r2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_act100w_${betId}`).setLabel('💵 +100w').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_custom_${betId}`).setLabel('✏️ 自訂下注').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bet_pity_${betId}`).setLabel('🩹 同情抖內').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bet_settle_${betId}`).setLabel('⚖️ 結算').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_del_${betId}`).setLabel('🗑️ 廢除').setStyle(ButtonStyle.Danger)
    );
    return [r1, r2];
  }
}

// ==========================================
// 6. 頂層指令註冊
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('距離200等')
    .setDescription('經典版/Big Bang前楓之谷升級時間精算器 (計算至200等所需時間)')
    .addIntegerOption(o => o.setName('目前等級').setDescription('您目前的角色等級 (1 ~ 199)').setRequired(true).setMinValue(1).setMaxValue(199))
    .addStringOption(o => o.setName('目前經驗值').setDescription('目前累積經驗 (可輸入百分比如 35% 或 實際數字如 5000000)').setRequired(true))
    .addStringOption(o => o.setName('十分鐘經驗值').setDescription('實測 10 分鐘獲得經驗 (可輸入如 120w、1200000)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('經驗計算器')
    .setDescription('測量練等經驗值與楓幣收益 (換算為標準 10 分鐘效率，支援跨等級升級計算)'),

  new SlashCommandBuilder()
    .setName('賭局')
    .setDescription('發起社群競猜系統 (技能書 / 衝卷 / 打寶)')
    .addStringOption(o => o.setName('類型').setDescription('選擇賭局類型').setRequired(true)
      .addChoices(
        { name: '📖 技能書點擊賭局', value: 'BET_BOOK' },
        { name: '📜 裝備衝裝/數值落點盤', value: 'BET_SCROLL' },
        { name: '🎁 玩家打寶競猜', value: 'BET_LOOT' }
      )
    )
    .addStringOption(o => o.setName('目標項目').setDescription('技能書名 / 裝備名 / 打寶目標').setRequired(true))
    .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：15m、1h、20:00 等').setRequired(true))
    .addStringOption(o => o.setName('自訂選項1').setDescription('自訂選項 1').setRequired(false))
    .addStringOption(o => o.setName('自訂選項2').setDescription('自訂選項 2').setRequired(false))
    .addStringOption(o => o.setName('自訂選項3').setDescription('自訂選項 3').setRequired(false))
    .addStringOption(o => o.setName('自訂選項4').setDescription('自訂選項 4').setRequired(false))
    .addStringOption(o => o.setName('自訂選項5').setDescription('自訂選項 5').setRequired(false))
    .addIntegerOption(o => o.setName('最大卷數').setDescription('衝裝階梯玩法上限 (預設 7，未填自訂選項時生效)').setRequired(false).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('底池金額').setDescription('加碼底池 (選填，例: 500w)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('揪團')
    .setDescription('發起組隊揪團 (團練 / 突襲 / 組隊任務)')
    .addStringOption(o => o.setName('類型').setDescription('選擇揪團類型').setRequired(true)
      .addChoices(
        { name: '⚔️ 團練', value: 'TYPE_TRAINING' },
        { name: '🐉 突襲 (Boss遠征)', value: 'TYPE_RAID' },
        { name: '🧩 組隊任務 (PQ)', value: 'TYPE_PQ' }
      )
    )
    .addStringOption(o => o.setName('地點或名稱').setDescription('例如：忘卻6、闇黑龍王、羅密歐').setRequired(true))
    .addStringOption(o => o.setName('開打時間').setDescription('例如：今晚 8 點、20:00').setRequired(true))
    .addIntegerOption(o => o.setName('需要人數').setDescription('人數預設 6 人').setRequired(false).setMinValue(2).setMaxValue(30))
    .addStringOption(o => o.setName('備註').setDescription('例如：綁定主教、需洗血 (選填)').setRequired(false))
    .addIntegerOption(o => o.setName('可開設備').setDescription('隊長可開幾台設備支援 (填數字)').setRequired(false).setMinValue(0).setMaxValue(10)),

  new SlashCommandBuilder()
    .setName('查看')
    .setDescription('統一查詢中心 (查看進行中揪團或賭局)')
    .addStringOption(o => o.setName('類別').setDescription('選擇要查看的項目').setRequired(true)
      .addChoices(
        { name: '📜 全部揪團 (完整面板可直接加入/管理)', value: 'VIEW_ALL_PARTIES' },
        { name: '🎲 全部賭局 (完整面板可直接下注)', value: 'VIEW_BET' }
      )
    ),

  new SlashCommandBuilder()
    .setName('放圖')
    .setDescription('發起熱門地圖交接/放圖')
    .addStringOption(o => o.setName('地圖名稱').setDescription('例如：忘卻6、蛋龍').setRequired(true))
    .addIntegerOption(o => o.setName('頻道').setDescription('頻道號碼').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('預計多久離開').setDescription('例如：10分鐘後、21:30').setRequired(true))
    .addStringOption(o => o.setName('備註說明').setDescription('選填說明').setRequired(false)),

  new SlashCommandBuilder()
    .setName('幸運頻道')
    .setDescription('抽取今日幸運頻道')
    .addIntegerOption(o => o.setName('最大頻道').setDescription('最大頻道數').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('角色報到')
    .setDescription('發送官方名冊報到與更新面板 (含多頁精靈/獨立角色拆分)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('角色狀態')
    .setDescription('共用帳號管理 (儀表板 / 授權 / 撤銷 / 全服總覽)')
    .addStringOption(o => o.setName('功能').setDescription('選擇要執行的功能').setRequired(true)
      .addChoices(
        { name: '📊 角色狀態儀表板 (私密)', value: 'ACT_DASHBOARD' },
        { name: '🤝 授權角色 (從名冊選角)', value: 'ACT_AUTH' },
        { name: '🔒 撤銷借用 (從授權名單選角)', value: 'ACT_REVOKE' },
        { name: '🌐 全服角色授權總覽 (管理員專用)', value: 'ACT_MATRIX' }
      )
    ),

  new SlashCommandBuilder()
    .setName('個人名片')
    .setDescription('個人名片與公會成員名冊')
    .addStringOption(o => o.setName('模式').setDescription('選擇要檢視的模式').setRequired(true)
      .addChoices(
        { name: '🪪 我的名片 (含角色管理與隱私欄位)', value: 'CARD_MY' },
        { name: '📋 成員名冊 (按職業分類/全部)', value: 'CARD_ROSTER' }
      )
    ),

  new SlashCommandBuilder()
    .setName('管理員功能')
    .setDescription('【超級管理員專用】管理手冊、代填/代更新名冊與全服特權')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('模式').setDescription('選擇管理操作').setRequired(true)
      .addChoices(
        { name: '📖 說明手冊 (help) - 檢視目前所有管理員功能清單', value: 'ADMIN_HELP' },
        { name: '📝 代填/代更新成員名冊', value: 'ADMIN_PROXY_REGISTER' },
        { name: '👥 管理員代管專用控制台 (代添/代更/代刪)', value: 'ADMIN_ROSTER_PANEL' }
      )
    )
    .addUserOption(o => o.setName('對象成員').setDescription('代填名冊時選擇對象成員 (@成員)').setRequired(false))
].map(c => c.toJSON());

client.once(Events.ClientReady, async () => {
  console.log(`✅ 機器人已成功上線，登入身分：${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
    }
  } catch (e) { console.error('❌ 指令註冊失敗:', e); }
});

// ==========================================
// 7. 核心互動監聽 (全域 Try-Catch & 升級經驗精算)
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令分派
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // 1. /距離200等
      if (commandName === '距離200等') {
        await interaction.deferReply();
        const curLevel = interaction.options.getInteger('目前等級');
        const rawCurExp = interaction.options.getString('目前經驗值').trim();
        const raw10MinExp = interaction.options.getString('十分鐘經驗值').trim();

        const curLevelNeedExp = CLASSIC_EXP_TABLE[curLevel] || 1;
        const currentExpNum = parseExpInput(rawCurExp, curLevel);
        const exp10Min = parseMoneyInput(raw10MinExp);
        if (exp10Min <= 0) return interaction.editReply('❌ 10分鐘經驗值必須大於 0！');

        let remainingExp = Math.max(0, curLevelNeedExp - currentExpNum);
        for (let lv = curLevel + 1; lv < 200; lv++) {
          remainingExp += (CLASSIC_EXP_TABLE[lv] || 0);
        }

        const expPerHour = exp10Min * 6;
        const totalHoursNeeded = (remainingExp / expPerHour);
        const totalDaysNeeded = (totalHoursNeeded / 24).toFixed(1);

        const embed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`⏳【經典版 / 原始倍率】距離 200 等巔峰精算報告`)
          .setDescription(
            `👤 **冒險家**：<@${interaction.user.id}>\n` +
            `📊 **目前進度**：\`Lv.${curLevel} (${((currentExpNum / curLevelNeedExp) * 100).toFixed(2)}%)\`\n` +
            `⚡ **目前效率**：\`+${exp10Min.toLocaleString()} EXP / 10分\` (\`+${expPerHour.toLocaleString()} EXP / 小時\`)\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🎯 **距離 200 等還需總經驗**：\`${remainingExp.toLocaleString()} EXP\`\n` +
            `⏱️ **預估還需修煉時間**：\`${totalHoursNeeded.toFixed(1)} 小時\` (約 \`${totalDaysNeeded} 天\` 不斷線)\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 *本試算遵循 Big Bang 改版前 v113 原始經典倍率經驗公式，祝您早日登頂典獄長！*`
          )
          .setFooter({ text: '楓之谷經典經驗精算庫' });

        return await interaction.editReply({ embeds: [embed] });
      }

      // 2. /經驗計算器
      if (commandName === '經驗計算器') {
        const session = expTrackerMap.get(interaction.user.id);
        return await interaction.reply({ embeds: [createExpCalculatorEmbed(session)], components: createExpCalculatorComponents(!!session?.startTime), ephemeral: true });
      }

      // 3. /賭局
      if (commandName === '賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const activeBet = await getActiveBetDoc();
        if (activeBet) return interaction.reply({ content: '⚠️ 目前全服已有進行中的賭局，請等待結算！', ephemeral: true });

        await interaction.deferReply();
        const type = interaction.options.getString('類型');
        const target = interaction.options.getString('目標項目');
        const deadline = parseDeadline(interaction.options.getString('截止時間'));
        const maxScroll = interaction.options.getInteger('最大卷數') || 7;
        const seedMoney = parseMoneyInput(interaction.options.getString('底池金額'));

        const customOpts = [
          interaction.options.getString('自訂選項1'),
          interaction.options.getString('自訂選項2'),
          interaction.options.getString('自訂選項3'),
          interaction.options.getString('自訂選項4'),
          interaction.options.getString('自訂選項5')
        ].filter(Boolean).map(s => s.trim());

        if (!deadline) return interaction.editReply('❌ 時間格式無效！請輸入如 `15m`、`1h`、`21:30`。');

        let title, options = [], betType = 'book';

        if (type === 'BET_BOOK') {
          title = `【${target}】能不能點過？`;
          options = [{ name: '🟢 過', pool: 0, bets: {} }, { name: '🔴 不過', pool: 0, bets: {} }];
        } else if (type === 'BET_SCROLL') {
          if (customOpts.length > 0) {
            betType = 'scroll_custom';
            title = `【${target}】自訂數值落點盤`;
            options = customOpts.map(c => ({ name: c, pool: 0, bets: {} }));
          } else {
            betType = 'scroll_step';
            title = `【${target}】能過幾卷？(上限 +${maxScroll})`;
            for (let i = 0; i <= maxScroll; i++) {
              const label = (i === 0) ? '💀 過0卷 (全爆)' : (i === maxScroll ? `👑 過${i}卷 (完美神裝)` : `過${i}卷`);
              options.push({ name: label, pool: 0, bets: {} });
            }
          }
        } else if (type === 'BET_LOOT') {
          betType = 'loot';
          title = `【${target}】打寶競猜`;
          if (customOpts.length > 0) {
            options = customOpts.map(c => ({ name: c, pool: 0, bets: {} }));
          } else {
            options = [{ name: '🟢 大豐收', pool: 0, bets: {} }, { name: '🔴 大暴死', pool: 0, bets: {} }];
          }
        }

        const bRef = db.collection('active_bets').doc();
        const bData = { id: bRef.id, creatorId: interaction.user.id, creatorName: interaction.user.username, betType, title, options, deadline, seedMoney, pityDonations: {}, isSettled: false, isPaused: false };
        const msg = await interaction.editReply({ embeds: [createMultiBetEmbed(bData)], components: createMultiBetComponents(bRef.id, options) });
        bData.channelId = interaction.channelId;
        bData.messageId = msg.id;
        await bRef.set(bData);
        return;
      }

      // 4. /查看
      if (commandName === '查看') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const view = interaction.options.getString('類別');
        await interaction.deferReply();

        if (view === 'VIEW_BET') {
          const doc = await getActiveBetDoc();
          if (!doc) return interaction.editReply('🎲 目前沒有進行中的賭局。');
          const d = doc.data();
          return await interaction.editReply({ embeds: [createMultiBetEmbed(d)], components: createMultiBetComponents(d.id, d.options) });
        }

        if (view === 'VIEW_ALL_PARTIES') {
          const snap = await db.collection('party_trainings').where('isClosed', '==', false).get();
          if (snap.empty) return interaction.editReply('📜 目前沒有招募中的隊伍。');

          await interaction.editReply(`⚔️ **【進行中揪團總覽】（共 ${snap.size} 團進行中，可直接在下方操作加入或管理）**`);
          for (const doc of snap.docs) {
            const d = doc.data();
            await interaction.followUp({ embeds: [createPartyEmbed(d)], components: createPartyComponents(doc.id, d.isClosed) });
          }
          return;
        }
      }

      // 5. /揪團
      if (commandName === '揪團') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply();
        const type = interaction.options.getString('類型');
        const target = interaction.options.getString('地點或名稱');
        const startTime = interaction.options.getString('開打時間');
        const bindReq = interaction.options.getString('備註') || '無';
        const devicesCount = interaction.options.getInteger('可開設備') || 0;
        const maxCount = interaction.options.getInteger('需要人數') || 6;

        let partyType = 'training';
        if (type === 'TYPE_RAID') partyType = 'raid';
        else if (type === 'TYPE_PQ') partyType = 'pq';

        const pRef = db.collection('party_trainings').doc();
        const pData = {
          id: pRef.id,
          creatorId: interaction.user.id,
          partyType, target, startTime, bindReq, devicesCount, maxCount,
          members: [], isClosed: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const msg = await interaction.editReply({ embeds: [createPartyEmbed(pData)], components: createPartyComponents(pRef.id, false) });
        pData.channelId = interaction.channelId;
        pData.messageId = msg.id;
        await pRef.set(pData);
        return;
      }

      // 6. /放圖
      if (commandName === '放圖') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply();
        const mapName = interaction.options.getString('地圖名稱');
        const channelNum = interaction.options.getInteger('頻道');
        const leaveTime = interaction.options.getString('預計多久離開');
        const note = interaction.options.getString('備註說明') || '無特殊備註';

        const mapRef = db.collection('map_shares').doc();
        const mapData = {
          id: mapRef.id, creatorId: interaction.user.id, mapName, channelNum, leaveTime, note,
          takerId: null, isFinished: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const msg = await interaction.editReply({ embeds: [createMapShareEmbed(mapData)], components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`map_take_${mapRef.id}`).setLabel('✋ 我要圖 (立即預約)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`map_done_${mapRef.id}`).setLabel('🤝 已交接完成').setStyle(ButtonStyle.Primary)
          )
        ] });
        mapData.channelId = interaction.channelId;
        mapData.messageId = msg.id;
        await mapRef.set(mapData);
        return;
      }

      // 7. /幸運頻道
      if (commandName === '幸運頻道') {
        await interaction.deferReply();
        const max = interaction.options.getInteger('最大頻道') || 20;
        const luckyNum = Math.floor(Math.random() * max) + 1;
        const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('🎲 今日幸運頻道').setDescription(`冒險家 **${interaction.user.username}** 的幸運頻道：\n\n✨ **第 ${luckyNum} 頻道** (範圍 1 ~ ${max})`);
        return await interaction.editReply({ embeds: [embed] });
      }

      // 8. /角色報到
      if (commandName === '角色報到') {
        const embed = new EmbedBuilder().setColor(0x57F287).setTitle('📝 冒險家報到 / 名冊更新').setDescription('歡迎來到伺服器！請點擊下方按鈕進行 **多頁精靈報到與角色獨立登記**！');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_trigger_wizard_main').setLabel('📝 填寫表單').setStyle(ButtonStyle.Success));
        return await interaction.reply({ embeds: [embed], components: [row] });
      }
    }

    // ----------------------------------------
    // [B] 按鈕處理
    // ----------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // 經驗計算器：開始彈窗 (新增起始等級輸入)
      if (customId === 'exp_calc_trigger_start') {
        const modal = new ModalBuilder().setCustomId('modal_exp_calc_start').setTitle('開始計算 - 輸入起始數據');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_start_level').setLabel('1. 起始等級 (必填，1 ~ 199)').setPlaceholder('例如：120').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_exp_start').setLabel('2. 起始經驗值 (支援數字或 35%)').setPlaceholder('例如：12500000 或 35%').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_meso_start').setLabel('3. 起始金幣 (選填)').setPlaceholder('例如：500w 或 5000000').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'exp_calc_cancel') {
        expTrackerMap.delete(interaction.user.id);
        const embed = createExpCalculatorEmbed(null);
        const comps = createExpCalculatorComponents(false);
        return await interaction.update({ embeds: [embed], components: comps });
      }

      // 經驗計算器：結束暫停計時並彈窗 (新增結束等級輸入)
      if (customId === 'exp_calc_stop') {
        const session = expTrackerMap.get(interaction.user.id);
        if (!session?.startTime) return interaction.reply({ content: '⚠️ 計時尚未開始，請先點擊開始！', ephemeral: true });

        session.stopTime = Date.now();
        expTrackerMap.set(interaction.user.id, session);

        const modal = new ModalBuilder().setCustomId('modal_exp_calc_finish').setTitle('結束計算 - 輸入結束數據');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_end_level').setLabel('1. 結束等級 (必填，若升級請填新等級)').setValue(`${session.startLevel || 120}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_exp_end').setLabel('2. 結束經驗值 (支援數字或 42%)').setPlaceholder('例如：13200000 或 42%').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_meso_end').setLabel('3. 結束金幣 (選填)').setPlaceholder('例如：420w 或 4200000').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'exp_calc_trigger_share') {
        const report = expTrackerMap.get(`report_${interaction.user.id}`);
        if (!report) return interaction.reply({ content: '❌ 報告已失效，請重新計算！', ephemeral: true });

        const modal = new ModalBuilder().setCustomId('modal_exp_calc_share').setTitle('📢 分享效率報告至頻道');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('share_map_name').setLabel('地圖名稱 (必填)').setPlaceholder('例如：忘卻6、蛋龍、主巢穴').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('share_job').setLabel('職業 (必填)').setPlaceholder('例如：黑騎士、主教、夜使者').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('share_level').setLabel('等級 (必填)').setValue(`${report.endLevel || report.startLevel || 120}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('share_note').setLabel('備註說明 (選填)').setPlaceholder('例如：自帶祈禱機、單練、開雙倍').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      // 賭局：快捷下注 (+100w)
      if (customId.startsWith('bet_qk_') || customId.startsWith('bet_act100w_')) {
        await interaction.deferReply({ ephemeral: true });
        const isAct = customId.startsWith('bet_act100w_');
        const bId = isAct ? customId.replace('bet_act100w_', '') : customId.split('_')[2];
        const optIdx = isAct ? userChoiceMap.get(`bet_choice_${interaction.user.id}_${bId}`) : parseInt(customId.split('_')[3]);

        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局已失效。');
        const d = doc.data();
        if (Date.now() >= d.deadline) return interaction.editReply('🛑 該賭局已截止下注！');
        if (optIdx === undefined || isNaN(optIdx) || !d.options[optIdx]) return interaction.editReply('⚠️ 請先在上方選單選擇你要投注的選項！');

        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.mainIgn || interaction.user.displayName;
        const cur = d.options[optIdx].bets[interaction.user.id]?.amount || 0;
        d.options[optIdx].bets[interaction.user.id] = { ign, amount: cur + 1000000 };
        d.options[optIdx].pool = (d.options[optIdx].pool || 0) + 1000000;

        await db.collection('active_bets').doc(bId).update({ options: d.options });

        if (d.channelId && d.messageId) {
          const ch = await client.channels.fetch(d.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(d.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createMultiBetEmbed(d)], components: createMultiBetComponents(bId, d.options) });
          }
        }
        return await interaction.editReply(`✅ 成功為 **${d.options[optIdx].name}** 下注 \`+100 萬 楓幣\`！(累計下注: ${formatMeso(cur + 1000000)})`);
      }

      // 賭局：自訂下注
      if (customId.startsWith('bet_custom_')) {
        const bId = customId.replace('bet_custom_', '');
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.reply({ content: '❌ 賭局已失效。', ephemeral: true });
        const d = doc.data();
        if (Date.now() >= d.deadline) return interaction.reply({ content: '🛑 該賭局已截止下注！', ephemeral: true });

        const isStep = (d.betType === 'scroll_step');
        let optHintList = '';
        if (isStep) {
          optHintList = d.options.map((o, idx) => `${idx}:${o.name}`).join(' | ');
        } else {
          optHintList = d.options.map((o, idx) => `${idx + 1}:${o.name}`).join(' | ');
        }

        const modal = new ModalBuilder().setCustomId(`modal_bet_custom_${bId}`).setTitle('自訂下注金額 (最低 100 萬)');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_bet_choice').setLabel(isStep ? '選項編號 (填 0, 1, 2...)' : '選項編號 (填 1, 2, 3...)').setPlaceholder(`選項：${optHintList.substring(0, 80)}`).setValue('').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_bet_amount').setLabel('下注金額 (最低100w，支援 100w, 500w, 1e)').setPlaceholder('例如：100w、500w、1000000').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      // 賭局：同情抖內
      if (customId.startsWith('bet_pity_')) {
        const bId = customId.replace('bet_pity_', '');
        const modal = new ModalBuilder().setCustomId(`modal_pity_donate_${bId}`).setTitle('🩹 暴死同情救濟慰問 (私密)');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('input_pity_amount').setLabel(getRandomPityQuote().substring(0, 44)).setPlaceholder('填寫救濟金額 (隨意自訂，例: 10w、100w)').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      // 賭局：結算/廢除
      if (customId.startsWith('bet_settle_') || customId.startsWith('bet_del_')) {
        await interaction.deferReply({ ephemeral: true });
        const isDelete = customId.startsWith('bet_del_');
        const bId = customId.replace(isDelete ? 'bet_del_' : 'bet_settle_', '');
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局不存在。');
        const d = doc.data();

        if (isDelete) {
          if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.editReply('❌ 僅管理員可廢除賭局！');
          await db.collection('active_bets').doc(bId).delete();
          return await interaction.editReply('🗑️ 賭局已廢除！');
        }

        const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);
        if (d.creatorId !== interaction.user.id && !isAdmin) return interaction.editReply('❌ 只有發起人或管理員可結算！');
        if (Date.now() < d.deadline && !isAdmin) return interaction.editReply(`⏳ 尚未到達截止時間！請在 <t:${Math.floor(d.deadline / 1000)}:R> 後再進行結算。`);

        const selectOptions = d.options.map((opt, i) => new StringSelectMenuOptionBuilder().setLabel(`🏆 勝方：${opt.name}`).setValue(`${i}`));
        return await interaction.editReply({
          content: '⚖️ **請選擇最終獲勝選項進行派彩：**',
          components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`settle_fin_${bId}`).setPlaceholder('選擇獲勝選項').addOptions(selectOptions))]
        });
      }
    }

    // ----------------------------------------
    // [C] 下拉選單處理
    // ----------------------------------------
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      const customId = interaction.customId;

      if (customId.startsWith('bet_selopt_')) {
        const bId = customId.replace('bet_selopt_', '');
        userChoiceMap.set(`bet_choice_${interaction.user.id}_${bId}`, parseInt(interaction.values[0]));
        return await interaction.reply({ content: `👉 已選中第 ${parseInt(interaction.values[0]) + 1} 個選項，請點擊按鈕完成下注！`, ephemeral: true });
      }

      if (customId.startsWith('settle_fin_')) {
        await interaction.deferReply();
        const bId = customId.replace('settle_fin_', '');
        const winIdx = parseInt(interaction.values[0]);
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局已失效。');
        const d = doc.data();

        let playerPool = 0, winPool = d.options[winIdx].pool || 0;
        d.options.forEach(o => playerPool += (o.pool || 0));
        const totalPool = playerPool + (d.seedMoney || 0);
        const loserPool = totalPool - winPool;

        const balances = {};
        if (d.seedMoney > 0) balances[d.creatorId] = { ign: d.creatorName || '發起人底池', net: -d.seedMoney };

        d.options.forEach(o => {
          Object.entries(o.bets || {}).forEach(([uid, b]) => {
            if (!balances[uid]) balances[uid] = { ign: b.ign, net: 0 };
            balances[uid].net -= b.amount;
          });
        });

        const winnerList = [], loserList = [], donorList = [];
        Object.entries(d.options[winIdx].bets || {}).forEach(([uid, b]) => {
          const share = winPool > 0 ? (b.amount / winPool) * loserPool : 0;
          const profit = Math.floor(share);
          balances[uid].net += (b.amount + profit);
          winnerList.push({ ign: b.ign, bet: b.amount, gain: profit });
        });

        d.options.forEach((o, idx) => {
          if (idx !== winIdx) {
            Object.entries(o.bets || {}).forEach(([uid, b]) => {
              loserList.push({ ign: b.ign, bet: b.amount });
            });
          }
        });

        Object.entries(d.pityDonations || {}).forEach(([uid, b]) => {
          donorList.push({ ign: b.ign, amount: b.amount });
        });

        const isBookPassed = d.betType === 'book' && d.options[winIdx].name.includes('過') && !d.options[winIdx].name.includes('不過');

        let ansiReport = '```ansi\n';
        ansiReport += '\u001b[1;32m🏆 贏家【哪有賭狗天天輸】\u001b[0m\n';
        if (winnerList.length) {
          winnerList.forEach(w => ansiReport += `\u001b[32m[${w.ign} _ 下注 ${formatMeso(w.bet)} _ +${formatMeso(w.gain)} 楓幣]\u001b[0m\n`);
        } else {
          ansiReport += '\u001b[32m• 本局無人押中勝方\u001b[0m\n';
        }

        ansiReport += '\n\u001b[1;31m💀 輸家【賭狗賭狗賭到最後一無所有】\u001b[0m\n';
        if (loserList.length) {
          loserList.forEach(l => ansiReport += `\u001b[31m[${l.ign} _ 下注 ${formatMeso(l.bet)} _ -${formatMeso(l.bet)} 楓幣]\u001b[0m\n`);
        } else {
          ansiReport += '\u001b[31m• 本局無輸家\u001b[0m\n';
        }

        if (donorList.length) {
          ansiReport += '\n\u001b[1;36m🩹 慈善家【人間自有真情在】\u001b[0m\n';
          donorList.forEach(dn => {
            const quote = isBookPassed ? getRandomBookSuccessQuote() : getRandomPityQuote();
            const payText = isBookPassed ? '(恭喜過書，善款無須支付)' : `-${formatMeso(dn.amount)} 楓幣`;
            ansiReport += `\u001b[36m[${dn.ign} _ ${quote} _ ${payText}]\u001b[0m\n`;
          });
        }
        ansiReport += '```';

        const transfers = calculateMinTransfers(balances);
        let tGuide = `🧾 **【最少交易轉帳清單】**\n` + (transfers.length ? transfers.map((t, i) => `${i + 1}. ➡️ **${t.from}** 交易給 **${t.to}**：\`${formatMeso(t.amount)} 楓幣\`${t.amount >= 10000000 ? ' *(💡 單筆達 1000w 以上，可協議拆單降手續費率)*' : ''}`).join('\n') : '• 本局無須進行跨玩家轉帳');

        await db.collection('active_bets').doc(bId).update({ isSettled: true });

        const embed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`🎉【競猜結算】${d.title}`)
          .setDescription(`🏆 **最終獲勝**：**【${d.options[winIdx].name}】**\n💰 **公開總彩池**：\`${formatMeso(totalPool)} 楓幣\`\n\n${ansiReport}\n${tGuide}`);

        return await interaction.editReply({ embeds: [embed] });
      }
    }

    // ----------------------------------------
    // [D] Modal 提交 (升級計算自動累加)
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      // 經驗計算器：開始數據提交
      if (customId === 'modal_exp_calc_start') {
        const startLevel = parseInt(interaction.fields.getTextInputValue('input_start_level')) || 120;
        const rawExp = interaction.fields.getTextInputValue('input_exp_start');
        const expStart = parseExpInput(rawExp, startLevel);
        const mesoStart = parseMoneyInput(interaction.fields.getTextInputValue('input_meso_start'));
        const startTime = Date.now();

        const session = { startTime, startLevel, expStart, mesoStart };
        expTrackerMap.set(interaction.user.id, session);

        const embed = createExpCalculatorEmbed(session);
        const comps = createExpCalculatorComponents(true);
        return await interaction.reply({ content: `✅ **已成功鎖定 Lv.${startLevel} 起始數據，計時開始！**`, embeds: [embed], components: comps, ephemeral: true });
      }

      // 經驗計算器：結束數據提交 (跨等級經驗累積計算)
      if (customId === 'modal_exp_calc_finish') {
        await interaction.deferReply({ ephemeral: true });
        const session = expTrackerMap.get(interaction.user.id);
        if (!session?.startTime) return interaction.editReply('❌ 計時已失效，請重新開始！');

        const endTime = session.stopTime || Date.now();
        const durationSec = Math.max(1, Math.round((endTime - session.startTime) / 1000));
        const durationMinText = `${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`;

        const endLevel = parseInt(interaction.fields.getTextInputValue('input_end_level')) || session.startLevel;
        const rawExpEnd = interaction.fields.getTextInputValue('input_exp_end');
        const expEnd = parseExpInput(rawExpEnd, endLevel);

        // 精算跨等級總獲得經驗
        let totalGainExp = 0;
        if (endLevel === session.startLevel) {
          totalGainExp = Math.max(0, expEnd - session.expStart);
        } else if (endLevel > session.startLevel) {
          const startLvNeed = CLASSIC_EXP_TABLE[session.startLevel] || 1;
          totalGainExp = Math.max(0, startLvNeed - session.expStart);
          for (let lv = session.startLevel + 1; lv < endLevel; lv++) {
            totalGainExp += (CLASSIC_EXP_TABLE[lv] || 0);
          }
          totalGainExp += expEnd;
        } else {
          totalGainExp = Math.max(0, expEnd - session.expStart);
        }

        const mesoEnd = parseMoneyInput(interaction.fields.getTextInputValue('input_meso_end'));
        const hasMeso = session.mesoStart > 0 || interaction.fields.getTextInputValue('input_meso_end');
        const deltaMeso = mesoEnd - session.mesoStart;

        const expPer10Min = Math.round((totalGainExp / durationSec) * 600);
        const expPerHour = Math.round((totalGainExp / durationSec) * 3600);
        const mesoPer10Min = Math.round((deltaMeso / durationSec) * 600);
        const mesoPerHour = Math.round((deltaMeso / durationSec) * 3600);

        let mesoReport = '';
        if (hasMeso) {
          const sign10 = mesoPer10Min >= 0 ? '🟢 淨賺' : '🔴 虧損';
          const signHour = mesoPerHour >= 0 ? '🟢 淨賺' : '🔴 虧損';
          mesoReport = `━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 **實測楓幣收支**：\`${deltaMeso >= 0 ? '+' : ''}${formatMeso(deltaMeso)}\`\n` +
            `🔹 **標準 10 分鐘損益**：${sign10} \`${formatMeso(Math.abs(mesoPer10Min))}\`\n` +
            `🔹 **預估 1 小時損益**：${signHour} \`${formatMeso(Math.abs(mesoPerHour))}\``;
        }

        const reportData = {
          durationMinText, durationSec, deltaExp: totalGainExp,
          expPer10Min, expPerHour, hasMeso, deltaMeso, mesoPer10Min, mesoPerHour,
          startLevel: session.startLevel, endLevel
        };
        expTrackerMap.set(`report_${interaction.user.id}`, reportData);
        expTrackerMap.delete(interaction.user.id);

        const levelUpTag = endLevel > session.startLevel ? ` 🆙 **(恭喜升級！Lv.${session.startLevel} ➔ Lv.${endLevel})**` : '';

        const reportEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle(`📈【練等效率分析報告出爐】${levelUpTag}`)
          .setDescription(
            `⏱️ **實測時間**：\`${durationMinText}\` (共 ${durationSec} 秒)\n` +
            `📊 **實測獲得總經驗**：\`+${totalGainExp.toLocaleString()} EXP\`\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⚡ **標準 10 分鐘效率**：\`+${expPer10Min.toLocaleString()} EXP\`\n` +
            `🔥 **預估 1 小時效率**：\`+${expPerHour.toLocaleString()} EXP\`\n` +
            mesoReport
          )
          .setFooter({ text: '練等效益精算 | 點擊下方按鈕可將結果分享至頻道！' });

        const rowShare = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('exp_calc_trigger_share').setLabel('📢 分享至頻道').setStyle(ButtonStyle.Primary)
        );
        return await interaction.editReply({ embeds: [reportEmbed], components: [rowShare] });
      }

      // 經驗計算器：公開分享
      if (customId === 'modal_exp_calc_share') {
        const report = expTrackerMap.get(`report_${interaction.user.id}`);
        if (!report) return interaction.reply({ content: '❌ 報告已失效，請重新計算！', ephemeral: true });

        const mapName = interaction.fields.getTextInputValue('share_map_name').trim();
        const job = interaction.fields.getTextInputValue('share_job').trim();
        const level = interaction.fields.getTextInputValue('share_level').trim();
        const note = interaction.fields.getTextInputValue('share_note')?.trim() || '無特殊備註';

        let mesoReport = '';
        if (report.hasMeso) {
          const sign10 = report.mesoPer10Min >= 0 ? '🟢 淨賺' : '🔴 虧損';
          mesoReport = `\n💰 **10分鐘楓幣收支**：${sign10} \`${formatMeso(Math.abs(report.mesoPer10Min))}\``;
        }

        const shareEmbed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle(`📢【練等效率分享】${mapName}`)
          .setDescription(
            `👤 **冒險家**：<@${interaction.user.id}>\n` +
            `⚔️ **職業/等級**：\`${job} (Lv.${level})\`\n` +
            `📍 **練等地點**：\`${mapName}\`\n` +
            `⏱️ **實測時間**：\`${report.durationMinText}\`\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⚡ **標準 10 分鐘經驗**：\`+${report.expPer10Min.toLocaleString()} EXP\`\n` +
            `🔥 **預估 1 小時經驗**：\`+${report.expPerHour.toLocaleString()} EXP\`` +
            mesoReport + `\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `📝 **備註說明**：\`${note}\``
          )
          .setFooter({ text: '社群效率分享庫 | 感謝分享' });

        await interaction.channel.send({ embeds: [shareEmbed] });
        return await interaction.reply({ content: '✅ 成功將效率報告分享至頻道！', ephemeral: true });
      }

      // 賭局自訂下注
      if (customId.startsWith('modal_bet_custom_')) {
        await interaction.deferReply({ ephemeral: true });
        const bId = customId.replace('modal_bet_custom_', '');
        const choiceRaw = interaction.fields.getTextInputValue('input_bet_choice').trim();
        const amt = parseMoneyInput(interaction.fields.getTextInputValue('input_bet_amount'));

        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局不存在。');
        const d = doc.data();
        if (Date.now() >= d.deadline) return interaction.editReply('🛑 該賭局已截止下注！');

        if (amt < 1000000) {
          return interaction.editReply('❌ **自訂下注金額最低限制為 100 萬楓幣** (例如輸入 100w、1000000)！');
        }

        const isStep = (d.betType === 'scroll_step');
        let optIdx = isStep ? parseInt(choiceRaw) : (parseInt(choiceRaw) - 1);

        if (isNaN(optIdx) || optIdx < 0 || optIdx >= d.options.length) {
          return interaction.editReply(`❌ 選項編號無效，請填寫 ${isStep ? `0 ~ ${d.options.length - 1}` : `1 ~ ${d.options.length}`}！`);
        }

        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.mainIgn || interaction.user.displayName;
        const cur = d.options[optIdx].bets[interaction.user.id]?.amount || 0;

        d.options[optIdx].bets[interaction.user.id] = { ign, amount: cur + amt };
        d.options[optIdx].pool = (d.options[optIdx].pool || 0) + amt;

        await db.collection('active_bets').doc(bId).update({ options: d.options });

        if (d.channelId && d.messageId) {
          const ch = await client.channels.fetch(d.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(d.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createMultiBetEmbed(d)], components: createMultiBetComponents(bId, d.options) });
          }
        }

        return await interaction.editReply(`✅ 成功為 **${d.options[optIdx].name}** 下注 \`${formatMeso(amt)} 楓幣\`！(累計下注: ${formatMeso(cur + amt)})`);
      }

      // 同情抖內提交
      if (customId.startsWith('modal_pity_donate_')) {
        await interaction.deferReply({ ephemeral: true });
        const bId = customId.replace('modal_pity_donate_', '');
        const amt = parseMoneyInput(interaction.fields.getTextInputValue('input_pity_amount'));
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局不存在。');
        const d = doc.data();

        if (amt <= 0) return interaction.editReply('❌ 金額無效！');
        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.mainIgn || interaction.user.displayName;

        d.pityDonations = d.pityDonations || {};
        d.pityDonations[interaction.user.id] = { ign, amount: (d.pityDonations[interaction.user.id]?.amount || 0) + amt };
        await db.collection('active_bets').doc(bId).update({ pityDonations: d.pityDonations });
        return await interaction.editReply(`🩹 已成功登記同情救濟 \`${formatMeso(amt)} 楓幣\`！感謝您的暖心善舉！`);
      }
    }
  } catch (err) {
    console.error('互動處理錯誤:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ 處理超時或發生異常，請重試！' }).catch(() => {});
      } else {
        await interaction.reply({ content: '❌ 處理失敗，請重試！', ephemeral: true }).catch(() => {});
      }
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);
