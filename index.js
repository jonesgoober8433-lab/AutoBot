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
// 0. 全域防崩潰守護 (防止任何未捕獲錯誤導致 Bot 下線)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ 攔截到未處理的 Promise 拒絕:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ 攔截到未捕獲的例外異常:', err);
});

// ==========================================
// 1. 喚醒伺服器設定 (Express)
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
// 3. Client 實例建立 (含 Client Error 攔截)
// ==========================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});
client.on('error', (err) => console.error('⚠️ Discord Client 發生錯誤:', err));

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

async function syncMemberRoles(guild, userId, profileData) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    const activeJobs = new Set();
    if (profileData.mainJob) activeJobs.add(profileData.mainJob);
    (profileData.subs || []).forEach(s => {
      if (s?.job) activeJobs.add(s.job);
    });

    const rolesToAdd = [ROLES.VERIFIED];
    activeJobs.forEach(jobName => {
      if (ROLES.JOBS[jobName]) rolesToAdd.push(ROLES.JOBS[jobName]);
    });
    if (parseInt(profileData.mainLevel) >= 200) rolesToAdd.push(ROLES.WARDEN_200);

    const allJobIds = Object.values(ROLES.JOBS);
    const rolesToRemove = member.roles.cache.filter(r =>
      (allJobIds.includes(r.id) && !rolesToAdd.includes(r.id)) ||
      r.id === ROLES.UNVERIFIED ||
      (r.id === ROLES.WARDEN_200 && parseInt(profileData.mainLevel) < 200)
    );

    if (rolesToRemove.size) await member.roles.remove(rolesToRemove).catch(() => {});
    await member.roles.add(rolesToAdd).catch(() => {});
  } catch (e) { console.error('身分組同步異常:', e.message); }
}

// ==========================================
// 5. UI 模組建構
// ==========================================
async function buildAllCharStatusEmbed() {
  if (!db) return new EmbedBuilder().setColor(0xED4245).setDescription('❌ 資料庫連線異常');
  const snap = await db.collection('char_statuses').get();

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('🌐【全服公用角色狀態看板】(依職業排序)')
    .setDescription('✨ 全服角色公開借用！登記借用與歸還時，系統將**自動私訊通知號主**！\n━━━━━━━━━━━━━━━━━━━━');

  if (snap.empty) {
    embed.addFields({ name: '目前無角色', value: '尚無任何成員登記角色。' });
    return embed;
  }

  const grouped = {};
  Object.keys(ROLES.JOBS).forEach(j => grouped[j] = []);
  grouped['其他'] = [];

  snap.docs.forEach(doc => {
    const d = doc.data();
    const job = d.job || '其他';
    if (!grouped[job]) grouped[job] = [];
    grouped[job].push(d);
  });

  let hasAnyChar = false;
  for (const jobName of Object.keys(ROLES.JOBS)) {
    const list = grouped[jobName];
    if (list && list.length > 0) {
      hasAnyChar = true;
      let fieldText = '';
      list.forEach((c, idx) => {
        const ign = c.charIgn;
        const isOnline = c.isOnline || false;
        const statusTag = isOnline ? `🔴 使用中 (<@${c.currentUserId}>)` : '🟢 閒置中';
        const owners = (c.owners || []).map(u => `<@${u}>`).join(', ') || '無登記號主';
        const expTime = c.expectedEndTime || 0;
        const timeText = isOnline && expTime > 0 ? ` ｜ ⏳ 預計至 <t:${Math.floor(expTime / 1000)}:R>` : '';

        fieldText += `${idx + 1}. **${ign}** ｜ ${statusTag}${timeText}\n   └ 👑 號主/共權人：${owners}\n`;
      });
      embed.addFields({ name: `⚔️ ${jobName} (${list.length})`, value: fieldText.substring(0, 1024), inline: false });
    }
  }

  if (!hasAnyChar) {
    embed.addFields({ name: '目前狀態', value: '尚無任何角色登記。' });
  }

  embed.setFooter({ text: '私密看板 | 借用或歸還角色請點擊下方按鈕' });
  return embed;
}

function buildAllCharStatusComponents() {
  const r1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('borrow_btn_job_hub').setLabel('🔍 按職業挑選 (中繼站)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('borrow_btn_take_quick').setLabel('🟢 快速選取閒置角色').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('borrow_btn_take_manual').setLabel('✏️ 手動輸入角色名借用').setStyle(ButtonStyle.Secondary)
  );
  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('borrow_btn_return').setLabel('🔴 我已離線 (釋放角色)').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('borrow_btn_force').setLabel('⚡ 號主/管理員強制收回').setStyle(ButtonStyle.Secondary)
  );
  return [r1, r2];
}

function buildWizardConfigCard(userId) {
  const session = wizardSessionMap.get(userId);
  if (!session) return null;
  const isMain = session.step === 'MAIN';
  const char = isMain ? session.main : session.currentSub;

  const jobOptions = Object.keys(ROLES.JOBS).map(j =>
    new StringSelectMenuOptionBuilder().setLabel(j).setValue(j).setDefault(char.job === j)
  );

  const rowJob = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('wiz_select_job').setPlaceholder(`🔽 選擇 ${char.ign} 的職業 (目前: ${char.job || '未選擇'})`).addOptions(jobOptions)
  );
  const rowOwners = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('wiz_select_owners').setPlaceholder('👥 設定共同所有權人 (選填，可多選)').setMinValues(0).setMaxValues(10)
  );
  const rowBtns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wiz_btn_add_sub').setLabel('➕ 加填分身角色').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('wiz_btn_finish').setLabel('✅ 填寫完畢，立即建檔').setStyle(ButtonStyle.Success)
  );

  const ownersMention = (char.owners || []).map(u => `<@${u}>`).join(', ') || '僅限本人';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📝【名冊精靈登記】正在設定：${isMain ? '👑 本尊角色' : `⚔️ 分身角色 #${session.subs.length + 1}`}`)
    .setDescription(
      `🎯 **目標登記成員**：<@${session.targetUserId}>\n` +
      `🔹 **角色ID**：\`${char.ign}\`\n` +
      `🔹 **職業**：\`${char.job || '請在下方選單選擇'}\`\n` +
      `🔹 **等級**：\`Lv. ${char.level}\`\n` +
      (isMain ? `🔹 **遊玩時間**：\`${session.playtime || '未填'}\`\n🔹 **加入原因**：\`${session.joinReason || '未填'}\`\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 **共同所有權人**：${ownersMention}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 **請在下方配置職業與共同所有權人，完成後點擊「立即建檔」！**`
    );

  return { embeds: [embed], components: [rowJob, rowOwners, rowBtns] };
}

async function processBorrowCharacter(interaction, ign, durationStr) {
  const endMs = parseDeadline(durationStr) || (Date.now() + 3600000);
  const prevDoc = await getCharStatusDoc(ign);
  if (!prevDoc) {
    return interaction.editReply(`❌ 找不到角色【**${ign}**】，請確認角色名稱是否正確！`);
  }
  if (prevDoc.isOnline) {
    return interaction.editReply(`⚠️ 該角色目前正被 <@${prevDoc.currentUserId}> 使用中！`);
  }

  const prev = await fetchUserDocSafe(interaction.user.id);
  const newStatus = {
    charIgn: prevDoc.charIgn || ign,
    isOnline: true,
    currentUserId: interaction.user.id,
    currentUserName: prev.mainIgn || interaction.user.displayName,
    startTime: Date.now(),
    expectedEndTime: endMs
  };

  await db.collection('char_statuses').doc(ign.toLowerCase()).set(newStatus, { merge: true });

  const owners = prevDoc.owners || [];
  for (const ownerUid of owners) {
    if (ownerUid !== interaction.user.id) {
      const ownerUser = await client.users.fetch(ownerUid).catch(() => null);
      if (ownerUser) {
        await ownerUser.send(`🔔 **【公用角色借用通知】** 冒險家 <@${interaction.user.id}>（\`${prev.mainIgn || interaction.user.displayName}\`）剛剛登記借用了您的角色【**${prevDoc.charIgn || ign}**】，預計使用至 <t:${Math.floor(endMs / 1000)}:T> (<t:${Math.floor(endMs / 1000)}:R>)！`).catch(() => {});
      }
    }
  }

  return interaction.editReply(`🟢 成功登記借用【**${prevDoc.charIgn || ign}**】！預計使用至 <t:${Math.floor(endMs / 1000)}:T> (<t:${Math.floor(endMs / 1000)}:R>)，號主已收到私訊通知！`);
}

async function processReturnCharacter(interaction, ign) {
  const prevDoc = await getCharStatusDoc(ign);
  if (!prevDoc) return interaction.editReply('❌ 角色不存在。');

  await db.collection('char_statuses').doc(ign.toLowerCase()).set({
    isOnline: false, currentUserId: null, currentUserName: null, startTime: 0, expectedEndTime: 0
  }, { merge: true });

  const prev = await fetchUserDocSafe(interaction.user.id);
  const owners = prevDoc.owners || [];
  for (const ownerUid of owners) {
    if (ownerUid !== interaction.user.id) {
      const ownerUser = await client.users.fetch(ownerUid).catch(() => null);
      if (ownerUser) {
        await ownerUser.send(`📢 **【公用角色歸還通知】** 冒險家 <@${interaction.user.id}>（\`${prev.mainIgn || interaction.user.displayName}\`）已下線並歸還了您的角色【**${prevDoc.charIgn || ign}**】，目前狀態為【🟢 閒置中】！`).catch(() => {});
      }
    }
  }

  return interaction.editReply(`✅ 已成功釋放並歸還角色【**${prevDoc.charIgn || ign}**】，號主已收到歸還通知！`);
}

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

function createPartyBuffModal(partyId, charIgn, charJob, charLevel) {
  const modal = new ModalBuilder().setCustomId(`modal_party_buffs_${partyId}`).setTitle(`揪團報名 (${charJob})`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_char_info').setLabel('角色ID / 職業 / 等級').setValue(`${charIgn}/${charJob}/${charLevel}`).setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_seat_count').setLabel('本角色加帶機台共佔幾人？(預設: 1)').setValue('1').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_maple_buff').setLabel('【🍁楓葉祝福】等級 (填: 滿 或 數字)').setValue('滿').setStyle(TextInputStyle.Short).setRequired(true))
  );
  const buffs = JOB_BUFFS[charJob] || [];
  if (buffs.length > 0) {
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_job_buff_1').setLabel(`【${buffs[0]}】等級 (填: 滿 或 數字)`).setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)));
  }
  if (buffs.length > 1) {
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_job_buff_2').setLabel(`【${buffs[1]}】等級 (填: 滿 或 數字)`).setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)));
  }
  return modal;
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

async function generateJobEmbed(targetJob) {
  if (!db) return new EmbedBuilder().setColor(0xED4245).setDescription('❌ 資料庫連線異常');
  const snapshot = await db.collection('member_profiles').get();
  if (snapshot.empty) return new EmbedBuilder().setColor(0x3498DB).setTitle('📋 名冊總覽').setDescription('尚無紀錄。');

  const members = [];
  snapshot.forEach(doc => members.push(doc.data()));

  if (targetJob === 'WARDEN_LIST') {
    const wardens = members.filter(m => !m.isRetired && parseInt(m.mainLevel) >= 200);
    const desc = wardens.length
      ? wardens.map((m, i) => `${i + 1}. 👑 \`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}>`).join('\n')
      : '目前尚未誕生 Lv 200 典獄長！';
    return new EmbedBuilder().setColor(0xF1C40F).setTitle('👑【尊榮的 Lv 200_典獄長】傳奇名冊').setDescription(desc);
  }

  if (targetJob === 'ALL_JOBS_LIST') {
    const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📋【全伺服器職業名冊總覽】');
    let fCount = 0;
    for (const j of Object.keys(ROLES.JOBS)) {
      const charList = [];
      members.forEach(m => {
        if (m.isRetired) return;
        if (m.mainJob === j) charList.push({ text: `\`(${m.mainIgn}_Lv.${m.mainLevel})\` <@${m.userId}> **【本】**`, lv: parseInt(m.mainLevel) || 0 });
        (m.subs || []).forEach(s => {
          if (s?.job === j) charList.push({ text: `\`(${s.ign}_Lv.${s.level})\` <@${m.userId}> *(本尊: ${m.mainIgn})*`, lv: parseInt(s.level) || 0 });
        });
      });
      if (charList.length && fCount < 24) {
        charList.sort((a, b) => b.lv - a.lv);
        embed.addFields({ name: `⚔️ ${j} (${charList.length})`, value: charList.map(c => `• ${c.text}`).join('\n').substring(0, 1024), inline: false });
        fCount++;
      }
    }
    return embed;
  }

  const list = [];
  members.forEach(m => {
    if (m.isRetired) return;
    if (m.mainJob === targetJob) list.push({ text: `\`(${m.mainIgn}_Lv.${m.mainLevel})\` - <@${m.userId}> **【本尊】**`, lv: parseInt(m.mainLevel) || 0 });
    (m.subs || []).forEach(s => {
      if (s?.job === targetJob) list.push({ text: `\`(${s.ign}_Lv.${s.level})\` - <@${m.userId}> [本尊: \`${m.mainIgn}\`]`, lv: parseInt(s.level) || 0 });
    });
  });
  list.sort((a, b) => b.lv - a.lv);
  return new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`📋【${targetJob}】名冊 (共 ${list.length} 位)`)
    .setDescription(list.length ? list.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n').substring(0, 4000) : `尚無【${targetJob}】登記。`);
}

function buildJobQueryMenu(isAdmin = false) {
  const options = [
    new StringSelectMenuOptionBuilder().setLabel('📋 全部人員 (依職業分組)').setValue('ALL_JOBS_LIST'),
    new StringSelectMenuOptionBuilder().setLabel('👑 Lv 200 典獄長名冊').setValue('WARDEN_LIST')
  ];
  Object.keys(ROLES.JOBS).forEach(j => {
    options.push(new StringSelectMenuOptionBuilder().setLabel(j).setValue(j));
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('select_profile_job_view').setPlaceholder('🔍 按職業分類或查看全部人員').addOptions(options.slice(0, 25))
  );
}

// ==========================================
// 6. 頂層指令清單
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('角色狀態')
    .setDescription('查看全服公用角色狀態看板 (依職業排序、中繼站挑選、借用與釋放)'),

  new SlashCommandBuilder()
    .setName('升級試算')
    .setDescription('經典版/Big Bang前楓之谷升級時間精算器 (自訂目標等級與每日目標)')
    .addIntegerOption(o => o.setName('目前等級').setDescription('您目前的角色等級 (1 ~ 199)').setRequired(true).setMinValue(1).setMaxValue(199))
    .addIntegerOption(o => o.setName('目標等級').setDescription('想要升到的目標等級 (2 ~ 200)').setRequired(true).setMinValue(2).setMaxValue(200))
    .addStringOption(o => o.setName('目前經驗值').setDescription('目前累積經驗 (可輸入百分比如 35% 或 實際數字如 5000000)').setRequired(true))
    .addStringOption(o => o.setName('十分鐘經驗值').setDescription('實測 10 分鐘經驗 (例: 120w，可與每日目標二選一)').setRequired(false))
    .addStringOption(o => o.setName('每日目標經驗').setDescription('每天預計打多少經驗值 (例: 2000w、1e)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('經驗計算器')
    .setDescription('測量練等經驗值與楓幣收益 (換算為標準 10 分鐘效率，支援升級精算)'),

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
    console.log('✅ 指令註冊更新完成');
  } catch (e) { console.error('❌ 指令註冊失敗:', e); }

  cron.schedule('*/15 * * * *', async () => {
    if (!db) return;
    try {
      const now = Date.now();
      const snapBet = await db.collection('active_bets').where('isSettled', '==', false).get();
      for (const doc of snapBet.docs) {
        const d = doc.data();
        if (now >= d.deadline) {
          const creator = await client.users.fetch(d.creatorId).catch(() => null);
          if (creator) {
            await creator.send(`🔔 **【賭局結算提醒】** 您發起的社群賭局 **【${d.title}】** 已到達截止時間，請盡速前往頻道點擊「⚖️ 結算」進行派彩！`).catch(() => {});
          }
          if (d.channelId) {
            const ch = await client.channels.fetch(d.channelId).catch(() => null);
            if (ch && ch.isTextBased()) {
              await ch.send(`📢 **【賭局截止催促】** <@${d.creatorId}> 發起的賭局 **【${d.title}】** 已截止下注，請發起人或管理員盡速點擊下方「⚖️ 結算」按鈕派彩！`).catch(() => {});
            }
          }
        }
      }

      const snapChar = await db.collection('char_statuses').where('isOnline', '==', true).get();
      for (const doc of snapChar.docs) {
        const d = doc.data();
        if (d.expectedEndTime && now > d.expectedEndTime && d.currentUserId) {
          const overdueMin = Math.floor((now - d.expectedEndTime) / 60000);
          const borrower = await client.users.fetch(d.currentUserId).catch(() => null);
          if (borrower) {
            await borrower.send(`⏳ **【角色借用逾時提醒】** 您借用的公用角色【**${d.charIgn}**】已逾時 **${overdueMin} 分鐘**！若已使用完畢，請盡速透過 \`/角色狀態\` 點擊「🔴 我已離線」釋放角色給其他夥伴使用！`).catch(() => {});
          }
        }
      }
    } catch (e) { console.error('15分鐘定時巡檢異常:', e.message); }
  });
});

// ==========================================
// 7. 核心互動監聽
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令分派
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === '角色狀態') {
        await interaction.deferReply({ ephemeral: true });
        const embed = await buildAllCharStatusEmbed();
        return await interaction.editReply({ embeds: [embed], components: buildAllCharStatusComponents() });
      }

      if (commandName === '升級試算') {
        await interaction.deferReply();
        const curLevel = interaction.options.getInteger('目前等級');
        const targetLevel = interaction.options.getInteger('目標等級');
        const rawCurExp = interaction.options.getString('目前經驗值').trim();
        const raw10MinExp = interaction.options.getString('十分鐘經驗值')?.trim();
        const rawDailyGoal = interaction.options.getString('每日目標經驗')?.trim();

        if (targetLevel <= curLevel) return interaction.editReply('❌ 目標等級必須大於目前等級！');

        const curLevelNeedExp = CLASSIC_EXP_TABLE[curLevel] || 1;
        const currentExpNum = parseExpInput(rawCurExp, curLevel);

        let remainingExp = Math.max(0, curLevelNeedExp - currentExpNum);
        for (let lv = curLevel + 1; lv < targetLevel; lv++) {
          remainingExp += (CLASSIC_EXP_TABLE[lv] || 0);
        }

        let efficiencyReport = '';
        if (raw10MinExp) {
          const exp10Min = parseMoneyInput(raw10MinExp);
          if (exp10Min > 0) {
            const expPerHour = exp10Min * 6;
            const hoursNeeded = (remainingExp / expPerHour);
            const days24h = (hoursNeeded / 24).toFixed(1);
            efficiencyReport += `⚡ **實測效率**：\`+${exp10Min.toLocaleString()} EXP / 10分\` (\`+${expPerHour.toLocaleString()} EXP / 小時\`)\n` +
                                `⏱️ **不斷線總需時間**：\`${hoursNeeded.toFixed(1)} 小時\` (約 \`${days24h} 天\`)\n` +
                                `📅 **休閒換算**：每天練 2 小時約需 \`${(hoursNeeded / 2).toFixed(0)} 天\` ｜ 每天 4 小時約需 \`${(hoursNeeded / 4).toFixed(0)} 天\`\n`;
          }
        }

        let dailyGoalReport = '';
        if (rawDailyGoal) {
          const dailyExp = parseMoneyInput(rawDailyGoal);
          if (dailyExp > 0) {
            const daysNeeded = Math.ceil(remainingExp / dailyExp);
            dailyGoalReport += `🎯 **每日目標產出**：\`+${dailyExp.toLocaleString()} EXP / 天\`\n` +
                               `📆 **預計達成天數**：約需 \`${daysNeeded} 天\` 即可升至 Lv.${targetLevel}！\n`;
          }
        }

        const embed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`⏳【經典版 / 原始倍率】Lv.${curLevel} ➔ Lv.${targetLevel} 升級精算報告`)
          .setDescription(
            `👤 **冒險家**：<@${interaction.user.id}>\n` +
            `📊 **目前進度**：\`Lv.${curLevel} (${((currentExpNum / curLevelNeedExp) * 100).toFixed(2)}%)\`\n` +
            `🎯 **升到 Lv.${targetLevel} 還需總經驗**：\`${remainingExp.toLocaleString()} EXP\`\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            (efficiencyReport || dailyGoalReport ? `${efficiencyReport}${dailyGoalReport}` : `💡 *您可於指令中選填「十分鐘經驗值」或「每日目標經驗」進行時間推算！*\n`) +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 *本試算遵循 Big Bang 改版前 v113 原始經典倍率經驗公式，祝您早日達標！*`
          )
          .setFooter({ text: '楓之谷經典經驗精算庫' });

        return await interaction.editReply({ embeds: [embed] });
      }

      if (commandName === '經驗計算器') {
        const session = expTrackerMap.get(interaction.user.id);
        return await interaction.reply({ embeds: [createExpCalculatorEmbed(session)], components: createExpCalculatorComponents(!!session?.startTime), ephemeral: true });
      }

      if (commandName === '個人名片') {
        const mode = interaction.options.getString('模式');
        if (mode === 'CARD_MY') {
          await interaction.deferReply({ ephemeral: true });
          const d = await fetchUserDocSafe(interaction.user.id);
          if (!d.mainIgn) return interaction.editReply('📜 您尚未建立名冊資料，請透過 `/角色報到` 登記。');

          const subList = (d.subs || []).map((s, i) => `${i + 1}. \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n') || '無';
          const ownersList = (d.owners || []).map(u => `<@${u}>`).join(', ') || '僅限本人';

          const isWarden = parseInt(d.mainLevel) >= 200;
          const embed = new EmbedBuilder().setColor(d.isRetired ? 0x95A5A6 : (isWarden ? 0xF1C40F : 0x3498DB))
            .setTitle(`🪪 冒險家名片 - ${d.mainIgn} ${isWarden ? '👑 [Lv.200 典獄長]' : ''}`)
            .addFields(
              { name: '👑 本尊角色', value: `${d.mainJob} (Lv.${d.mainLevel})`, inline: true },
              { name: '⏱️ 遊玩時間', value: d.playtime || '未填', inline: true },
              { name: '💬 加入原因', value: d.joinReason || '未填', inline: true },
              { name: '👥 共同所有權人', value: ownersList, inline: false },
              { name: `⚔️ 分身角色 (${(d.subs || []).length} 隻)`, value: subList, inline: false }
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('card_btn_add_char').setLabel('➕ 新增分身').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('card_btn_update_level').setLabel('🆙 更新等級').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('card_btn_delete_char').setLabel('🗑️ 刪除分身').setStyle(ButtonStyle.Danger)
          );
          return await interaction.editReply({ embeds: [embed], components: [row] });
        }

        if (mode === 'CARD_ROSTER') {
          await interaction.deferReply();
          const embed = await generateJobEmbed('ALL_JOBS_LIST');
          const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);
          const components = [buildJobQueryMenu(isAdmin)];

          if (isAdmin) {
            components.push(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_roster_add_btn').setLabel('➕ 代添角色').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('admin_roster_update_btn').setLabel('🆙 代更等級').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('admin_roster_delete_btn').setLabel('🗑️ 代刪角色').setStyle(ButtonStyle.Danger)
              )
            );
          }
          return await interaction.editReply({ embeds: [embed], components });
        }
      }

      if (commandName === '管理員功能') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.reply({ content: '❌ 僅超級管理員可使用！', ephemeral: true });
        const mode = interaction.options.getString('模式');

        if (mode === 'ADMIN_HELP') {
          const helpEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('📖【超級管理員功能手冊】')
            .setDescription('1. 📝 代填名冊\n2. 👥 代管控制台\n3. 🚪 強制刪除揪團/廢除賭局');
          return await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
        }

        if (mode === 'ADMIN_ROSTER_PANEL') {
          const rowUser = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('admin_select_user_for_panel').setPlaceholder('👥 選擇要管理名冊的 Discord 成員').setMinValues(1).setMaxValues(1)
          );
          return await interaction.reply({ content: '👉 **【管理員代管專區】請先選擇目標成員：**', components: [rowUser], ephemeral: true });
        }

        if (mode === 'ADMIN_PROXY_REGISTER') {
          const targetUser = interaction.options.getUser('對象成員');
          if (!targetUser) return interaction.reply({ content: '❌ 請選擇要代為登記的成員！', ephemeral: true });

          wizardSessionMap.set(interaction.user.id, {
            userId: interaction.user.id,
            targetUserId: targetUser.id,
            step: 'MAIN',
            playtime: '未填',
            joinReason: '管理員代填',
            main: { ign: '', job: '黑騎士', level: '120', owners: [targetUser.id] },
            subs: [],
            currentSub: null
          });

          const modal = new ModalBuilder().setCustomId('modal_wizard_step1_main').setTitle(`代填【${targetUser.username}】本尊資料`);
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_ign').setLabel('本尊遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_level').setLabel('本尊等級 (必填)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_playtime').setLabel('遊玩時間 (選填)').setValue('未填').setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_join_reason').setLabel('加入原因 (選填)').setValue('管理員代填').setStyle(TextInputStyle.Paragraph).setRequired(false))
          );
          return await interaction.showModal(modal);
        }
      }

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

          await interaction.editReply(`⚔️ **【進行中揪團總覽】（共 ${snap.size} 團進行中）**`);
          for (const doc of snap.docs) {
            const d = doc.data();
            await interaction.followUp({ embeds: [createPartyEmbed(d)], components: createPartyComponents(doc.id, d.isClosed) });
          }
          return;
        }
      }

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
        const msg = await interaction.editReply({ embeds: [
          new EmbedBuilder().setColor(0x57F287).setTitle(`🗺️【熱門地圖交接/放圖】${mapName}`).setDescription(`👑 放圖者: <@${interaction.user.id}>\n📍 頻道: \`第 ${channelNum} 頻道\`\n⏳ 預計離開: \`${leaveTime}\`\n備註: \`${note}\``)
        ], components: [
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

      if (commandName === '幸運頻道') {
        await interaction.deferReply();
        const max = interaction.options.getInteger('最大頻道') || 20;
        const luckyNum = Math.floor(Math.random() * max) + 1;
        const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('🎲 今日幸運頻道').setDescription(`冒險家 **${interaction.user.username}** 的幸運頻道：\n\n✨ **第 ${luckyNum} 頻道** (範圍 1 ~ ${max})`);
        return await interaction.editReply({ embeds: [embed] });
      }

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

      // 角色狀態公佈欄按鈕：按職業挑選 (中繼站)
      if (customId === 'borrow_btn_job_hub') {
        const jobOptions = Object.keys(ROLES.JOBS).map(j =>
          new StringSelectMenuOptionBuilder().setLabel(`⚔️ ${j}`).setValue(`hub_job_${j}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_borrow_job_hub').setPlaceholder('🔽 請選擇你要借用的職業 (如: 主教)').addOptions(jobOptions)
        );
        return await interaction.reply({ content: '👉 **【職業中繼站】請選擇您想挑選借用的職業：**', components: [row], ephemeral: true });
      }

      // 角色狀態公佈欄按鈕：快速選取閒置角色
      if (customId === 'borrow_btn_take_quick') {
        await interaction.deferReply({ ephemeral: true });
        const snap = await db.collection('char_statuses').where('isOnline', '==', false).get();
        if (snap.empty) return interaction.editReply('📜 目前全伺服器沒有處於【閒置中】的角色可供借用！');

        const selectOptions = snap.docs.slice(0, 25).map((doc, i) => {
          const d = doc.data();
          const ign = d.charIgn || doc.id;
          return new StringSelectMenuOptionBuilder().setLabel(`🟢 ${ign} (${d.job || '冒險家'})`).setValue(`take_char_${i}_${ign}`);
        });

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_borrow').setPlaceholder('🔽 請選擇你要借用的閒置角色').addOptions(selectOptions)
        );
        return await interaction.editReply({ content: '👉 **請選擇您要借用上線的角色：**', components: [row] });
      }

      // 角色狀態公佈欄按鈕：手動輸入角色名借用
      if (customId === 'borrow_btn_take_manual') {
        const modal = new ModalBuilder().setCustomId('modal_borrow_manual').setTitle('手動輸入角色名借用');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('m_char_ign').setLabel('角色遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('m_duration').setLabel('預計借用時長 (例: 30m, 1h, 2h, 21:30)').setValue('1h').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      // 角色狀態公佈欄按鈕：釋放歸還角色
      if (customId === 'borrow_btn_return') {
        await interaction.deferReply({ ephemeral: true });
        const snap = await db.collection('char_statuses').where('currentUserId', '==', interaction.user.id).where('isOnline', '==', true).get();

        if (snap.empty) return interaction.editReply('💡 您目前沒有正在借用佔用中的角色！');

        const selectOptions = snap.docs.slice(0, 25).map((doc, i) => {
          const d = doc.data();
          const ign = d.charIgn || doc.id;
          return new StringSelectMenuOptionBuilder().setLabel(`🔴 釋放：${ign} (${d.job || '冒險家'})`).setValue(`return_char_${i}_${ign}`);
        });

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_return').setPlaceholder('🔽 請選擇你要釋放歸還的角色').addOptions(selectOptions)
        );
        return await interaction.editReply({ content: '👉 **請選擇您要下線並釋放的角色：**', components: [row] });
      }

      // 角色狀態公佈欄按鈕：強制收回
      if (customId === 'borrow_btn_force') {
        await interaction.deferReply({ ephemeral: true });
        const snap = await db.collection('char_statuses').where('isOnline', '==', true).get();
        const forceList = [];

        snap.docs.forEach(doc => {
          const d = doc.data();
          const ign = d.charIgn || doc.id;
          const isOwner = (d.owners || []).includes(interaction.user.id);
          const isManager = isSuperAdmin(interaction.user.id, interaction.memberPermissions);
          if (isOwner || isManager) {
            forceList.push({ ign, job: d.job || '冒險家', borrower: d.currentUserName || '夥伴' });
          }
        });

        if (!forceList.length) return interaction.editReply('💡 目前沒有您名下且正在被他人借用中的角色！');

        const selectOptions = forceList.slice(0, 25).map((c, i) =>
          new StringSelectMenuOptionBuilder().setLabel(`⚡ 強制收回：${c.ign} (由 ${c.borrower} 借用中)`).setValue(`force_char_${i}_${c.ign}`)
        );

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_force_return').setPlaceholder('⚠️ 選擇要強制踢除下線的角色').addOptions(selectOptions)
        );
        return await interaction.editReply({ content: '👉 **請選擇要強制收回的角色：**', components: [row] });
      }

      // 名片管理按鈕
      if (customId === 'card_btn_add_char') {
        userChoiceMap.set(`target_add_user_${interaction.user.id}`, interaction.user.id);
        const modal = new ModalBuilder().setCustomId('modal_card_add_char').setTitle('名片管理 - 新增分身角色');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_ign').setLabel('角色遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_job').setLabel('職業 (例如: 黑騎士、主教、夜使者)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_level').setLabel('等級 (必填)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'card_btn_update_level') {
        await interaction.deferReply({ ephemeral: true });
        const profile = await fetchUserDocSafe(interaction.user.id);
        const chars = [];
        if (profile.mainIgn) chars.push({ ign: profile.mainIgn, job: profile.mainJob, lv: profile.mainLevel, isMain: true });
        (profile.subs || []).forEach(s => chars.push({ ign: s.ign, job: s.job, lv: s.level, isMain: false }));

        if (!chars.length) return interaction.editReply('❌ 您尚未登記任何角色！');

        userChoiceMap.set(`target_mod_user_${interaction.user.id}`, interaction.user.id);
        const selectOptions = chars.slice(0, 25).map((c, i) =>
          new StringSelectMenuOptionBuilder().setLabel(`${c.isMain ? '👑 本尊' : '⚔️ 分身'}：${c.ign} (${c.job} Lv.${c.lv})`.substring(0, 100)).setValue(`lvl_update_${interaction.user.id}_${i}_${c.ign}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_update_level').setPlaceholder('🔽 請選擇要更新等級的角色').addOptions(selectOptions)
        );
        return await interaction.editReply({ content: '👉 **請選擇要升級/調整等級的角色：**', components: [row] });
      }

      if (customId === 'card_btn_delete_char') {
        await interaction.deferReply({ ephemeral: true });
        const profile = await fetchUserDocSafe(interaction.user.id);
        const chars = (profile.subs || []).map((s, i) => ({ ign: s.ign, job: s.job, lv: s.level, idx: i }));

        if (!chars.length) return interaction.editReply('💡 您目前沒有可刪除的分身角色 (本尊無法直接刪除，請重新報到覆蓋)！');

        userChoiceMap.set(`target_del_user_${interaction.user.id}`, interaction.user.id);
        const selectOptions = chars.slice(0, 25).map(c =>
          new StringSelectMenuOptionBuilder().setLabel(`🗑️ 刪除：${c.ign} (${c.job} Lv.${c.lv})`.substring(0, 100)).setValue(`del_char_${interaction.user.id}_${c.idx}_${c.ign}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_delete').setPlaceholder('⚠️ 請選擇欲刪除的分身角色').addOptions(selectOptions)
        );
        return await interaction.editReply({ content: '👉 **請選擇要從名冊中刪除的分身角色：**', components: [row] });
      }

      if (customId.startsWith('btn_confirm_delete_char_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = customId.split('_');
        const targetUid = parts[4];
        const charIdx = parseInt(parts[5]);
        const ign = parts.slice(6).join('_');
        const profile = await fetchUserDocSafe(targetUid);

        let newSubs = (profile.subs || []);
        if (!isNaN(charIdx) && newSubs[charIdx] && newSubs[charIdx].ign.toLowerCase() === ign.toLowerCase()) {
          newSubs.splice(charIdx, 1);
        } else {
          newSubs = newSubs.filter(s => s.ign.toLowerCase() !== ign.toLowerCase());
        }

        await db.collection('member_profiles').doc(targetUid).update({ subs: newSubs });
        await db.collection('char_statuses').doc(ign.toLowerCase()).delete().catch(() => {});

        await syncMemberRoles(interaction.guild, targetUid, { ...profile, subs: newSubs });
        return await interaction.editReply(`🗑️ 角色【**${ign}**】已成功自名冊與資料庫中徹底刪除，無效身分組已同步清理！`);
      }

      // 管理員名冊代操作按鈕
      if (customId === 'admin_roster_add_btn') {
        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('admin_select_user_to_add_char').setPlaceholder('👥 選擇要為哪位成員新增角色').setMinValues(1).setMaxValues(1)
        );
        return await interaction.reply({ content: '👉 **【管理員代添角色】請先選擇目標成員：**', components: [rowUser], ephemeral: true });
      }

      if (customId === 'admin_roster_update_btn') {
        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('admin_select_user_to_update_lvl').setPlaceholder('👥 選擇要為哪位成員調整等級').setMinValues(1).setMaxValues(1)
        );
        return await interaction.reply({ content: '👉 **【管理員代更等級】請先選擇目標成員：**', components: [rowUser], ephemeral: true });
      }

      if (customId === 'admin_roster_delete_btn') {
        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('admin_select_user_to_delete_char').setPlaceholder('👥 選擇要為哪位成員刪除角色').setMinValues(1).setMaxValues(1)
        );
        return await interaction.reply({ content: '👉 **【管理員代刪角色】請先選擇目標成員：**', components: [rowUser], ephemeral: true });
      }

      // 經驗計算器按鈕
      if (customId === 'exp_calc_trigger_start') {
        const modal = new ModalBuilder().setCustomId('modal_exp_calc_start').setTitle('開始計算 - 輸入起始數據');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_start_level').setLabel('1. 起始等級 (1 ~ 199)').setPlaceholder('例如：120').setStyle(TextInputStyle.Short).setRequired(true)),
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

      if (customId === 'exp_calc_stop') {
        const session = expTrackerMap.get(interaction.user.id);
        if (!session?.startTime) return interaction.reply({ content: '⚠️ 計時尚未開始，請先點擊開始！', ephemeral: true });

        session.stopTime = Date.now();
        expTrackerMap.set(interaction.user.id, session);

        const modal = new ModalBuilder().setCustomId('modal_exp_calc_finish').setTitle('結束計算 - 輸入結束數據');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_end_level').setLabel('1. 結束等級 (若升級請填新等級)').setValue(`${session.startLevel || 120}`).setStyle(TextInputStyle.Short).setRequired(true)),
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
        let optHintList = isStep
          ? d.options.map((o, idx) => `${idx}:${o.name}`).join(' | ')
          : d.options.map((o, idx) => `${idx + 1}:${o.name}`).join(' | ');

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

      // 角色報到主按鈕
      if (customId === 'btn_trigger_wizard_main') {
        const prev = await fetchUserDocSafe(interaction.user.id);

        wizardSessionMap.set(interaction.user.id, {
          userId: interaction.user.id,
          targetUserId: interaction.user.id,
          step: 'MAIN',
          playtime: prev.playtime || '未填',
          joinReason: prev.joinReason || '未填',
          main: {
            ign: prev.mainIgn || '',
            job: prev.mainJob || '黑騎士',
            level: prev.mainLevel || '120',
            owners: prev.owners || [interaction.user.id]
          },
          subs: prev.subs || [],
          currentSub: null
        });

        const modal = new ModalBuilder().setCustomId('modal_wizard_step1_main').setTitle('名冊登記 - 步驟 1: 本尊資料');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_ign').setLabel('本尊遊戲 ID (必填)').setValue(prev.mainIgn || '').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_level').setLabel('本尊等級 (必填)').setValue(prev.mainLevel || '120').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_playtime').setLabel('遊玩時間 (選填)').setValue(prev.playtime || '').setStyle(TextInputStyle.Short).setRequired(false)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_join_reason').setLabel('加入原因 (選填)').setValue(prev.joinReason || '').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'wiz_btn_add_sub') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新點擊報到！', ephemeral: true });

        if (session.step === 'SUB' && session.currentSub) {
          session.subs.push(session.currentSub);
        }

        const modal = new ModalBuilder().setCustomId('modal_wizard_step_sub').setTitle(`加填分身 #${session.subs.length + 1}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_sub_ign').setLabel('分身遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_sub_level').setLabel('分身等級 (必填)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'wiz_btn_finish') {
        await interaction.deferReply({ ephemeral: true });
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.editReply('❌ 報到已逾時，請重新點擊報到！');

        if (session.step === 'SUB' && session.currentSub) {
          session.subs.push(session.currentSub);
        }

        const mainIgn = session.main.ign;
        const mainJob = session.main.job || '黑騎士';
        const mainLevel = session.main.level;
        const targetUid = session.targetUserId || interaction.user.id;

        if (db) {
          await db.collection('member_profiles').doc(targetUid).set({
            userId: targetUid,
            mainIgn, mainJob, mainLevel,
            playtime: session.playtime,
            joinReason: session.joinReason,
            owners: session.main.owners,
            subs: session.subs,
            isRetired: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

          const mainStatus = await getCharStatusDoc(mainIgn);
          const mergedMainOwners = Array.from(new Set([...(mainStatus?.owners || []), ...session.main.owners]));
          await db.collection('char_statuses').doc(mainIgn.toLowerCase()).set({
            charIgn: mainIgn, job: mainJob, owners: mergedMainOwners, isOnline: mainStatus?.isOnline || false
          }, { merge: true });

          for (const s of session.subs) {
            const subStatus = await getCharStatusDoc(s.ign);
            const mergedSubOwners = Array.from(new Set([...(subStatus?.owners || []), ...s.owners]));
            await db.collection('char_statuses').doc(s.ign.toLowerCase()).set({
              charIgn: s.ign, job: s.job, owners: mergedSubOwners, isOnline: subStatus?.isOnline || false
            }, { merge: true });
          }
        }

        await syncMemberRoles(interaction.guild, targetUid, {
          mainJob, mainLevel, subs: session.subs
        });

        try {
          const member = await interaction.guild.members.fetch(targetUid).catch(() => null);
          if (member) await member.setNickname(`[${mainLevel}_${mainJob}] ${mainIgn}`.substring(0, 32)).catch(() => {});
        } catch {}

        wizardSessionMap.delete(interaction.user.id);

        const publicChannel = await client.channels.fetch(WELCOME_REGISTER_CHANNEL_ID).catch(() => null);
        if (publicChannel && publicChannel.isTextBased()) {
          const publicEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🎉 冒險家名冊已成功更新！')
            .setDescription(`本尊：**${mainIgn}** ( <@&${ROLES.JOBS[mainJob] || ROLES.VERIFIED}> , LV. ${mainLevel} )`);
          await publicChannel.send({ content: `<@${targetUid}>`, embeds: [publicEmbed] });
        }

        return await interaction.editReply(`🎉 恭喜完成名冊建檔！成員 <@${targetUid}> 的本尊與 ${session.subs.length} 隻分身已全部獨立拆分建檔，身分組已自動發放！`);
      }
    }

    // ----------------------------------------
    // [C] 下拉選單處理
    // ----------------------------------------
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      const customId = interaction.customId;

      // 1. 中繼站選擇職業後，篩選並列出全服所有該職業角色
      if (customId === 'select_borrow_job_hub') {
        await interaction.deferUpdate();
        const selectedJob = interaction.values[0].replace('hub_job_', '');
        const snap = await db.collection('char_statuses').where('job', '==', selectedJob).get();

        if (snap.empty) {
          return await interaction.followUp({ content: `💡 目前全伺服器尚未有【**${selectedJob}**】角色登記！`, ephemeral: true });
        }

        const selectOptions = snap.docs.slice(0, 25).map((doc, i) => {
          const d = doc.data();
          const ign = d.charIgn || doc.id;
          const isOnline = d.isOnline || false;
          const statusText = isOnline ? `🔴 (使用中 - ${d.currentUserName})` : '🟢 (閒置可借)';
          return new StringSelectMenuOptionBuilder().setLabel(`${ign} ${statusText}`).setValue(`take_char_${i}_${ign}`);
        });

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_borrow').setPlaceholder(`🔽 選擇你要借用的【${selectedJob}】`).addOptions(selectOptions)
        );

        return await interaction.followUp({ content: `👉 **【${selectedJob} 中繼站】全體角色清單如下，請選擇要借用的角色：**`, components: [row], ephemeral: true });
      }

      // 2. 選擇角色借用 -> 彈出借用時長彈窗
      if (customId === 'select_char_to_borrow') {
        const val = interaction.values[0];
        const ign = val.split('_').slice(3).join('_');
        userChoiceMap.set(`borrow_ign_${interaction.user.id}`, ign);

        const modal = new ModalBuilder().setCustomId(`modal_borrow_char_${ign}`).setTitle(`登記借用 - 【${ign}】`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('borrow_duration').setLabel('預計借用時長 (例: 30m, 1h, 2h, 21:30)').setValue('1h').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      // 3. 選擇釋放歸還角色 (執行並私訊通知號主)
      if (customId === 'select_char_to_return') {
        await interaction.deferReply({ ephemeral: true });
        const val = interaction.values[0];
        const ign = val.split('_').slice(3).join('_');
        return await processReturnCharacter(interaction, ign);
      }

      // 4. 選擇強制收回角色
      if (customId === 'select_char_to_force_return') {
        await interaction.deferReply({ ephemeral: true });
        const val = interaction.values[0];
        const ign = val.split('_').slice(3).join('_');
        return await processReturnCharacter(interaction, ign);
      }

      // 5. 個人名片/管理員代管選單
      if (customId === 'admin_select_user_for_panel') {
        const targetUid = interaction.values[0];
        userChoiceMap.set(`admin_target_user_${interaction.user.id}`, targetUid);
        const profile = await fetchUserDocSafe(targetUid);
        const ign = profile.mainIgn || '未登記';
        const job = profile.mainJob || '無';
        const lv = profile.mainLevel || '1';

        const embed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`🛠️【管理員名冊代管控制台】`)
          .setDescription(`🎯 **目前選定目標成員**：<@${targetUid}>\n👑 **本尊**：\`${ign}\` (${job} Lv.${lv})\n⚔️ **分身數量**：\`${(profile.subs || []).length} 隻\`\n\n請在下方點擊對應管理按鈕進行操作：`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('admin_roster_add_btn').setLabel('➕ 代添分身角色').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('admin_roster_update_btn').setLabel('🆙 代更角色等級').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('admin_roster_delete_btn').setLabel('🗑️ 代刪分身角色').setStyle(ButtonStyle.Danger)
        );
        return await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      if (customId === 'admin_select_user_to_add_char') {
        const targetUid = interaction.values[0];
        userChoiceMap.set(`target_add_user_${interaction.user.id}`, targetUid);
        const modal = new ModalBuilder().setCustomId('modal_card_add_char').setTitle(`代添角色`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_ign').setLabel('角色遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_job').setLabel('職業 (例如: 黑騎士、主教、夜使者)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_level').setLabel('等級 (必填)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'admin_select_user_to_update_lvl') {
        await interaction.deferUpdate();
        const targetUid = interaction.values[0];
        userChoiceMap.set(`target_mod_user_${interaction.user.id}`, targetUid);
        const profile = await fetchUserDocSafe(targetUid);
        const chars = [];
        if (profile.mainIgn) chars.push({ ign: profile.mainIgn, job: profile.mainJob, lv: profile.mainLevel, isMain: true });
        (profile.subs || []).forEach(s => chars.push({ ign: s.ign, job: s.job, lv: s.level, isMain: false }));

        if (!chars.length) return interaction.followUp({ content: '❌ 該成員尚未登記任何角色！', ephemeral: true });

        const selectOptions = chars.slice(0, 25).map((c, i) =>
          new StringSelectMenuOptionBuilder().setLabel(`${c.isMain ? '👑 本尊' : '⚔️ 分身'}：${c.ign} (${c.job} Lv.${c.lv})`.substring(0, 100)).setValue(`lvl_update_${targetUid}_${i}_${c.ign}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_update_level').setPlaceholder('🔽 請選擇要更新等級的角色').addOptions(selectOptions)
        );
        return await interaction.followUp({ content: `👉 **【代更等級】已選定成員 <@${targetUid}>，請選擇其名下角色：**`, components: [row], ephemeral: true });
      }

      if (customId === 'admin_select_user_to_delete_char') {
        await interaction.deferUpdate();
        const targetUid = interaction.values[0];
        userChoiceMap.set(`target_del_user_${interaction.user.id}`, targetUid);
        const profile = await fetchUserDocSafe(targetUid);
        const chars = (profile.subs || []).map((s, i) => ({ ign: s.ign, job: s.job, lv: s.level, idx: i }));

        if (!chars.length) return interaction.followUp({ content: '💡 該成員沒有可刪除的分身角色！', ephemeral: true });

        const selectOptions = chars.slice(0, 25).map(c =>
          new StringSelectMenuOptionBuilder().setLabel(`🗑️ 刪除：${c.ign} (${c.job} Lv.${c.lv})`.substring(0, 100)).setValue(`del_char_${targetUid}_${c.idx}_${c.ign}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_delete').setPlaceholder('⚠️ 請選擇欲刪除的分身角色').addOptions(selectOptions)
        );
        return await interaction.followUp({ content: `👉 **【代刪角色】已選定成員 <@${targetUid}>，請選擇要刪除的分身：**`, components: [row], ephemeral: true });
      }

      if (customId === 'select_char_to_update_level') {
        const val = interaction.values[0];
        const parts = val.split('_');
        let targetUid = userChoiceMap.get(`target_mod_user_${interaction.user.id}`) || interaction.user.id;
        let charIdx = 0;
        let ign = '';

        if (parts.length >= 5) {
          targetUid = parts[2];
          charIdx = parseInt(parts[3]);
          ign = parts.slice(4).join('_');
        } else {
          charIdx = parseInt(parts[2]);
          ign = parts.slice(3).join('_');
        }

        userChoiceMap.set(`target_mod_user_${interaction.user.id}`, targetUid);
        userChoiceMap.set(`target_mod_idx_${interaction.user.id}`, charIdx);

        const modal = new ModalBuilder().setCustomId(`modal_card_set_level_${targetUid}_${charIdx}_${ign}`).setTitle(`更新【${ign}】等級`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_level_input').setLabel('請輸入最新等級 (純數字)').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'select_char_to_delete') {
        const val = interaction.values[0];
        const parts = val.split('_');
        let targetUid = userChoiceMap.get(`target_del_user_${interaction.user.id}`) || interaction.user.id;
        let charIdx = 0;
        let ign = '';

        if (parts.length >= 5) {
          targetUid = parts[2];
          charIdx = parseInt(parts[3]);
          ign = parts.slice(4).join('_');
        } else {
          charIdx = parseInt(parts[2]);
          ign = parts.slice(3).join('_');
        }

        userChoiceMap.set(`target_del_user_${interaction.user.id}`, targetUid);

        const embedConfirm = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle(`⚠️ 刪除確認：【${ign}】`)
          .setDescription(`您確定要將分身角色【**${ign}**】從名冊與共用資料庫中徹底刪除嗎？\n刪除後對應的副職業身分組將一併清理！`);
        const rowConfirm = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`btn_confirm_delete_char_${targetUid}_${charIdx}_${ign}`).setLabel('🗑️ 確定刪除').setStyle(ButtonStyle.Danger)
        );
        return await interaction.reply({ embeds: [embedConfirm], components: [rowConfirm], ephemeral: true });
      }

      if (customId === 'wiz_select_job') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新登記！', ephemeral: true });
        const selectedJob = interaction.values[0];
        if (session.step === 'MAIN') session.main.job = selectedJob;
        else if (session.currentSub) session.currentSub.job = selectedJob;
        return await interaction.update(buildWizardConfigCard(interaction.user.id));
      }

      if (customId === 'wiz_select_owners') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新登記！', ephemeral: true });
        const targetUid = session.targetUserId || interaction.user.id;
        const selectedUsers = Array.from(new Set([targetUid, ...interaction.values]));
        if (session.step === 'MAIN') session.main.owners = selectedUsers;
        else if (session.currentSub) session.currentSub.owners = selectedUsers;
        return await interaction.update(buildWizardConfigCard(interaction.user.id));
      }

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
    // [D] Modal 提交 (借用/歸還私訊號主)
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      // 角色借用提交 (選單觸發)
      if (customId.startsWith('modal_borrow_char_')) {
        await interaction.deferReply({ ephemeral: true });
        const ign = customId.replace('modal_borrow_char_', '');
        const durationStr = interaction.fields.getTextInputValue('borrow_duration').trim();
        return await processBorrowCharacter(interaction, ign, durationStr);
      }

      // 手動輸入角色名借用提交
      if (customId === 'modal_borrow_manual') {
        await interaction.deferReply({ ephemeral: true });
        const ign = interaction.fields.getTextInputValue('m_char_ign').trim();
        const durationStr = interaction.fields.getTextInputValue('m_duration').trim();
        return await processBorrowCharacter(interaction, ign, durationStr);
      }

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

      // 經驗計算器：結束數據提交 (跨等級升級累加)
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

      // 名片等級更新提交
      if (customId.startsWith('modal_card_set_level_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = customId.replace('modal_card_set_level_', '').split('_');
        const targetUid = parts[0];
        const charIdx = parseInt(parts[1]);
        const ign = parts.slice(2).join('_');
        const newLevel = interaction.fields.getTextInputValue('new_level_input').replace(/[^0-9]/g, '') || '1';
        const profile = await fetchUserDocSafe(targetUid);

        let isMain = profile.mainIgn?.toLowerCase() === ign.toLowerCase();
        let prevLevel = isMain ? profile.mainLevel : '1';

        if (isMain) {
          profile.mainLevel = newLevel;
          if (newLevel === '199' && prevLevel !== '199') profile.reach199At = admin.firestore.FieldValue.serverTimestamp();
          else if (newLevel !== '199') profile.reach199At = null;
        } else {
          if (!isNaN(charIdx) && profile.subs && profile.subs[charIdx]) {
            prevLevel = profile.subs[charIdx].level;
            profile.subs[charIdx].level = newLevel;
          } else {
            profile.subs = (profile.subs || []).map(s => {
              if (s.ign.toLowerCase() === ign.toLowerCase()) {
                prevLevel = s.level;
                return { ...s, level: newLevel };
              }
              return s;
            });
          }
        }

        await db.collection('member_profiles').doc(targetUid).set(profile, { merge: true });
        await syncMemberRoles(interaction.guild, targetUid, profile);

        return await interaction.editReply(`🆙 角色【**${ign}**】等級已成功更新為 **Lv.${newLevel}**！`);
      }

      // 名片新增分身提交
      if (customId === 'modal_card_add_char') {
        await interaction.deferReply({ ephemeral: true });
        const ign = interaction.fields.getTextInputValue('add_char_ign').trim();
        const rawJob = interaction.fields.getTextInputValue('add_char_job').trim();
        const level = interaction.fields.getTextInputValue('add_char_level').replace(/[^0-9]/g, '') || '120';
        const targetUid = userChoiceMap.get(`target_add_user_${interaction.user.id}`) || interaction.user.id;

        let job = '黑騎士';
        for (const validJob of Object.keys(ROLES.JOBS)) {
          if (rawJob.includes(validJob)) { job = validJob; break; }
        }

        const profile = await fetchUserDocSafe(targetUid);
        const subs = profile.subs || [];
        subs.push({ ign, job, level, raw: `${ign}/${job}/${level}` });

        await db.collection('member_profiles').doc(targetUid).set({ subs }, { merge: true });

        const sDoc = await getCharStatusDoc(ign);
        const owners = sDoc?.owners || [];
        if (!owners.includes(targetUid)) owners.push(targetUid);
        await db.collection('char_statuses').doc(ign.toLowerCase()).set({
          charIgn: ign, job, owners, isOnline: sDoc?.isOnline || false
        }, { merge: true });

        await syncMemberRoles(interaction.guild, targetUid, { ...profile, subs });
        userChoiceMap.delete(`target_add_user_${interaction.user.id}`);
        return await interaction.editReply(`🎉 成功為 <@${targetUid}> 新增分身角色【**${ign}**】(${job} Lv.${level})！對應副職身分組已自動加發！`);
      }

      // 賭局自訂下注提交
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
            if (m) await m.edit({ embeds: [createMultiBetEmbed(d)], components: createMultiBetComponents(bId, d.options) }).catch(() => {});
          }
        }

        return await interaction.editReply(`✅ 成功為 **${d.options[optIdx].name}** 下注 \`${formatMeso(amt)} 楓幣\`！(個人累計: ${formatMeso(cur + amt)})`);
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

      // 報到精靈第一步提交
      if (customId === 'modal_wizard_step1_main') {
        const ign = interaction.fields.getTextInputValue('wiz_main_ign').trim();
        const level = interaction.fields.getTextInputValue('wiz_main_level').replace(/[^0-9]/g, '') || '1';
        const playtime = interaction.fields.getTextInputValue('wiz_playtime')?.trim() || '未填';
        const joinReason = interaction.fields.getTextInputValue('wiz_join_reason')?.trim() || '未填';

        const session = wizardSessionMap.get(interaction.user.id) || {
          userId: interaction.user.id, targetUserId: interaction.user.id, subs: []
        };

        session.step = 'MAIN';
        session.playtime = playtime;
        session.joinReason = joinReason;
        session.main = {
          ign, job: session.main?.job || '黑騎士', level,
          owners: session.main?.owners || [session.targetUserId || interaction.user.id]
        };

        wizardSessionMap.set(interaction.user.id, session);
        return await interaction.reply({ ...buildWizardConfigCard(interaction.user.id), ephemeral: true });
      }

      if (customId === 'modal_wizard_step_sub') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新登記！', ephemeral: true });

        const ign = interaction.fields.getTextInputValue('wiz_sub_ign').trim();
        const level = interaction.fields.getTextInputValue('wiz_sub_level').replace(/[^0-9]/g, '') || '120';
        const targetUid = session.targetUserId || interaction.user.id;

        session.step = 'SUB';
        session.currentSub = { ign, job: '主教', level, owners: [targetUid] };

        return await interaction.reply({ ...buildWizardConfigCard(interaction.user.id), ephemeral: true });
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
