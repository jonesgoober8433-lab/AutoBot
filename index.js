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
// 3. Client 實例優先建立 (避免任何未定義錯誤)
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

async function checkLevelMilestone(guild, user, prevLevel, newLevel, mainIgn, job) {
  const pL = parseInt(prevLevel) || 0;
  const nL = parseInt(newLevel) || 0;
  if (nL <= pL) return null;

  let privateEmbed = null;
  if (nL >= 70 && pL < 70) {
    privateEmbed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🎖️【三轉強者誕生】達成 70 級重大突破！')
      .setDescription(`恭喜 <@${user.id}>（\`${mainIgn}\`）順利突破 70 級！\n正式踏入 ${job} 的高階冒險領域，向更強大的首領邁進吧！✨`);
  }

  if (nL >= 120 && nL % 10 === 0 && Math.floor(pL / 10) < Math.floor(nL / 10)) {
    try {
      const channel = await guild.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (channel?.isTextBased()) {
        const publicEmbed = new EmbedBuilder()
          .setColor(nL === 200 ? 0xF1C40F : 0xE67E22)
          .setTitle(nL === 200 ? '👑【全伺服器賀喜】頂點傳奇達成！Lv 200 典獄長誕生！' : '🎉【公會榮耀里程碑】等級重大突破！')
          .setDescription(`冒險家 <@${user.id}>（\`${mainIgn}\`）達成 **Lv.${nL} ${job}** 壯舉！\n全體成員為這份堅持與熱血喝采！🔥`)
          .setTimestamp();
        await channel.send({ content: nL === 200 ? '🎊 @everyone 傳奇現世！' : undefined, embeds: [publicEmbed] });
      }
    } catch (e) { console.error('發送升級祝賀失敗:', e); }
  }
  return privateEmbed;
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
  const rowAuths = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('wiz_select_auths').setPlaceholder('🤝 設定授權借用人 (選填，可多選)').setMinValues(0).setMaxValues(10)
  );
  const rowBtns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wiz_btn_add_sub').setLabel('➕ 加填分身角色').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('wiz_btn_finish').setLabel('✅ 填寫完畢，立即建檔').setStyle(ButtonStyle.Success)
  );

  const ownersMention = (char.owners || []).map(u => `<@${u}>`).join(', ') || '僅限本人';
  const authsMention = (char.authorizedUsers || []).map(u => `<@${u}>`).join(', ') || '暫無授權他人';

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
      `🤝 **授權借用人**：${authsMention}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 **請依序在下方選單配置職業、共同所有權人與授權借用人，完成後點擊按鈕！**`
    );

  return { embeds: [embed], components: [rowJob, rowOwners, rowAuths, rowBtns] };
}

function createCharStatusEmbed(charIgn, statusData, userRoleText) {
  const isOnline = statusData?.isOnline || false;
  const now = Date.now();
  const startTime = statusData?.startTime || 0;
  const expTime = statusData?.expectedEndTime || 0;
  const isOverdue = isOnline && now > expTime;
  const usedMinutes = Math.floor((now - startTime) / 60000);
  const overdueMinutes = Math.floor((now - expTime) / 60000);

  let statusTitle = '🟢 目前狀態：【閒置中 / 可借用】';
  let statusColor = 0x57F287;
  let desc = `✨ 該角色目前在線上無人佔用，具備權限者可直接登記上線！`;

  if (isOnline) {
    if (isOverdue) {
      statusTitle = '🟡 目前狀態：【可能已離線 (已逾時)】';
      statusColor = 0xFEE75C;
      desc = `⚠️ **目前登記者**：<@${statusData.currentUserId}> (\`${statusData.currentUserName || '冒險家'}\`)\n` +
             `⏱️ **已使用時長**：\`${usedMinutes} 分鐘\` (已逾時 \`${overdueMinutes} 分鐘\`)\n` +
             `💡 該成員可能已離開遊戲忘記下線，可點擊下方按鈕進行提醒或強制收回。`;
    } else {
      statusTitle = '🔴 目前狀態：【使用中 (請勿頂號)】';
      statusColor = 0xED4245;
      desc = `⚠️ **目前登記者**：<@${statusData.currentUserId}> (\`${statusData.currentUserName || '冒險家'}\`)\n` +
             `⏱️ **已使用時長**：\`${usedMinutes} 分鐘\`\n` +
             `⏳ **預計釋放時間**：<t:${Math.floor(expTime / 1000)}:R> (<t:${Math.floor(expTime / 1000)}:T>)\n\n` +
             `🚫 **請勿強行登入頂號！** 如有預約需求請點擊下方「🔔 敲門提醒 (60分鐘後預約)」。`;
    }
  }

  return new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`🔑 角色共用儀表板 - 【${charIgn}】`)
    .setDescription(`👤 **您的角色權限**：\`${userRoleText}\`\n━━━━━━━━━━━━━━━━━━━━\n${statusTitle}\n\n${desc}`)
    .setFooter({ text: '私密儀表板 | 換手上線請隨手登記' });
}

function createCharStatusComponents(charIgn, statusData, isOwner, isCurrentUser) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`char_act_online_${charIgn}`).setLabel('🟢 我要上線使用').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`char_act_offline_${charIgn}`).setLabel('🔴 我已離線 / 釋放').setStyle(ButtonStyle.Danger)
  );

  const isOnline = statusData?.isOnline || false;
  if (isOnline && !isCurrentUser) {
    row.addComponents(new ButtonBuilder().setCustomId(`char_act_knock_${charIgn}`).setLabel('🔔 敲門排隊 (60分後預約)').setStyle(ButtonStyle.Secondary));
  }
  return [row];
}

function createExpCalculatorEmbed(sessionData) {
  const isRunning = !!sessionData?.startTime;
  const expStartText = sessionData?.expStart ? sessionData.expStart.toLocaleString() : '未設定';
  const mesoStartText = sessionData?.mesoStart ? formatMeso(sessionData.mesoStart) : '未設定';

  return new EmbedBuilder()
    .setColor(isRunning ? 0xFEE75C : 0x3498DB)
    .setTitle('📊【練等經驗與楓幣效率計算器】')
    .setDescription(
      isRunning
        ? `⏱️ **計時進行中！**\n` +
          `⏰ **開始時間**：<t:${Math.floor(sessionData.startTime / 1000)}:T> (<t:${Math.floor(sessionData.startTime / 1000)}:R>)\n` +
          `📊 **起始經驗值**：\`${expStartText} EXP\`\n` +
          `💰 **起始楓幣量**：\`${mesoStartText} 楓幣\`\n\n` +
          `💡 練完後請點擊下方 **「🛑 結束計算」**（點擊瞬間立即暫停計時），再填寫結束數據！`
        : `✨ 點擊下方 **「⏱️ 開始計算」** 輸入起始數據後將自動開始計時！\n練等結束後點擊結束，系統將自動精算並換算為 **標準 10 分鐘與 1 小時產出**！`
    )
    .setFooter({ text: '楓之谷練等工具箱 | 精準至秒數計算' });
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

function createMapShareEmbed(mapData) {
  const isTaken = !!mapData.takerId;
  const isFinished = mapData.isFinished || false;
  let statusText = isFinished ? '🔒 **地圖已完成交接！**' : (isTaken ? `🟡 **已被預約**：由 <@${mapData.takerId}> 鎖定中！` : '🟢 **空檔釋出中，點擊下方「我要圖」進行預約！**');
  let color = isFinished ? 0x95A5A6 : (isTaken ? 0xFEE75C : 0x57F287);

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🗺️【熱門地圖交接/放圖】${mapData.mapName}`)
    .setDescription(
      `👑 **放圖者**：<@${mapData.creatorId}>\n` +
      `📍 **所屬頻道**：\`第 ${mapData.channelNum} 頻道\`\n` +
      `⏳ **預計離開時間**：\`${mapData.leaveTime}\`\n` +
      `🐛 **備註說明**：\`${mapData.note || '無特殊備註'}\`\n━━━━━━━━━━━━━━━━━━━━\n狀態：${statusText}`
    );
}

function createMapShareComponents(mapId, mapData) {
  if (mapData.isFinished) return [];
  const row = new ActionRowBuilder();
  if (!mapData.takerId) {
    row.addComponents(new ButtonBuilder().setCustomId(`map_take_${mapId}`).setLabel('✋ 我要圖 (立即預約)').setStyle(ButtonStyle.Success));
  } else {
    row.addComponents(new ButtonBuilder().setCustomId(`map_cancel_${mapId}`).setLabel('❌ 取消預約 (釋出)').setStyle(ButtonStyle.Secondary));
  }
  row.addComponents(new ButtonBuilder().setCustomId(`map_done_${mapId}`).setLabel('🤝 已交接完成').setStyle(ButtonStyle.Primary));
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
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`party_join_${partyId}`).setLabel('✋ 報名加入').setStyle(ButtonStyle.Success).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_leave_select_${partyId}`).setLabel('❌ 退出/修改角色').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_edit_info_${partyId}`).setLabel('✏️ 修改揪團').setStyle(ButtonStyle.Primary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_close_${partyId}`).setLabel('🚪 關閉').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_delete_${partyId}`).setLabel('🗑️ 刪除').setStyle(ButtonStyle.Danger)
  );
  return [row];
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

  betData.options.forEach(opt => {
    const odds = (opt.pool > 0) ? (totalPool / opt.pool).toFixed(2) : (totalPool > 0 ? '超高賠率' : '1.00');
    embed.addFields({ name: opt.name, value: `💵 彩池：\`${formatMeso(opt.pool || 0)}\`\n📈 賠率：\`${odds}x\``, inline: true });
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
// 6. 頂層指令註冊 (Guild 秒速同步)
// ==========================================
const commands = [
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
    .setName('經驗計算器')
    .setDescription('測量練等經驗值與楓幣收益 (換算為標準 10 分鐘效率)'),

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
    .addStringOption(o => o.setName('自訂選項').setDescription('自訂門檻/落點選項 (逗號分隔，如: 110攻以下, 剛好111攻, 112~114攻, 115攻以上)').setRequired(false))
    .addIntegerOption(o => o.setName('最大卷數').setDescription('衝裝階梯玩法上限 (預設 7)').setRequired(false).setMinValue(1).setMaxValue(10))
    .addStringOption(o => o.setName('底池金額').setDescription('加碼底池 (選填，例: 500w)').setRequired(false)),

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
    console.log('✅ 指令更新成功');
  } catch (e) { console.error('❌ 指令註冊失敗:', e); }

  // 排程巡檢
  cron.schedule('0 * * * *', async () => {
    if (!db) return;
    try {
      const now = Date.now();
      const mapSnap = await db.collection('map_shares').where('isFinished', '==', false).get();
      for (const doc of mapSnap.docs) {
        const d = doc.data();
        const created = d.createdAt?.toMillis?.() || (now - 129600000);
        if (now - created >= 129600000) {
          await db.collection('map_shares').doc(doc.id).update({ isFinished: true });
          if (d.channelId && d.messageId) {
            const ch = await client.channels.fetch(d.channelId).catch(() => null);
            if (ch) {
              const m = await ch.messages.fetch(d.messageId).catch(() => null);
              if (m) await m.edit({ embeds: [createMapShareEmbed({ ...d, isFinished: true })], components: [] });
            }
          }
        }
      }

      const partySnap = await db.collection('party_trainings').where('isClosed', '==', false).get();
      for (const doc of partySnap.docs) {
        const d = doc.data();
        const created = d.createdAt?.toMillis?.() || now;
        if (now - created >= 86400000) {
          await db.collection('party_trainings').doc(doc.id).update({ isClosed: true });
          if (d.channelId && d.messageId) {
            const ch = await client.channels.fetch(d.channelId).catch(() => null);
            if (ch) {
              const m = await ch.messages.fetch(d.messageId).catch(() => null);
              if (m) await m.edit({ embeds: [createPartyEmbed({ ...d, isClosed: true })], components: createPartyComponents(doc.id, true) });
            }
          }
        }
      }
    } catch (e) { console.error('自動巡檢異常:', e.message); }
  });

  cron.schedule('0 0 8 * * *', async () => {
    try {
      const channel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
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
    } catch (e) { console.error('199廣播異常:', e.message); }
  }, { timezone: 'Asia/Taipei' });

  cron.schedule('0 0 9 * * 1', async () => {
    try {
      const ch = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('🔔【每週例行提醒】突襲遠征結算倒數')
          .setDescription('週二即將進行維護/重置，請把握時間打完突襲王！');
        await ch.send({ embeds: [embed] });
      }
    } catch (e) { console.error('週一廣播異常:', e.message); }
  }, { timezone: 'Asia/Taipei' });

  const sendTuesdayBroadcast = async () => {
    try {
      const ch = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🔔【每週名冊維護】請大家更新角色資訊唷！')
          .setDescription('點擊下方按鈕將**自動帶入您上週的登記資料**，快速調整等級即可秒速完成更新！');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_trigger_wizard_main').setLabel('📝 快速更新名冊 (自動帶入舊資料)').setStyle(ButtonStyle.Success)
        );
        await ch.send({ embeds: [embed], components: [row] });
      }
    } catch (e) { console.error('週二廣播異常:', e.message); }
  };

  cron.schedule('0 0 9 * * 2', sendTuesdayBroadcast, { timezone: 'Asia/Taipei' });
  cron.schedule('0 0 19 * * 2', sendTuesdayBroadcast, { timezone: 'Asia/Taipei' });
});

client.on(Events.GuildMemberAdd, async (member) => {
  member.roles.add(ROLES.UNVERIFIED).catch(() => {});
  try {
    const welcome = await client.channels.fetch(WELCOME_REGISTER_CHANNEL_ID).catch(() => null);
    if (welcome && welcome.isTextBased()) {
      const embed = new EmbedBuilder().setColor(0x57F287).setTitle('🎉 歡迎新冒險家！').setDescription(`歡迎 <@${member.id}> 加入！請點擊下方按鈕完成 **名冊報到登記**！`);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_trigger_wizard_main').setLabel('📝 填寫表單').setStyle(ButtonStyle.Success));
      await welcome.send({ content: `<@${member.id}>`, embeds: [embed], components: [row] });
    }
  } catch {}
});

// ==========================================
// 7. 互動事件監聽核心 (具備全域防崩潰 Try-Catch)
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令分派
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === '角色報到') {
        const embed = new EmbedBuilder().setColor(0x57F287).setTitle('📝 冒險家報到 / 名冊更新').setDescription('歡迎來到伺服器！請點擊下方按鈕進行 **多頁精靈報到與角色獨立登記**！');
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_trigger_wizard_main').setLabel('📝 填寫表單').setStyle(ButtonStyle.Success));
        return await interaction.reply({ embeds: [embed], components: [row] });
      }

      if (commandName === '經驗計算器') {
        const session = expTrackerMap.get(interaction.user.id);
        return await interaction.reply({ embeds: [createExpCalculatorEmbed(session)], components: createExpCalculatorComponents(!!session?.startTime), ephemeral: true });
      }

      if (commandName === '管理員功能') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.reply({ content: '❌ 僅超級管理員可使用！', ephemeral: true });
        const mode = interaction.options.getString('模式');

        if (mode === 'ADMIN_HELP') {
          const helpEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('📖【超級管理員功能與特權手冊】')
            .setDescription(
              `👑 **最高管理者特權** (ID: \`${SUPER_ADMIN_ID}\`)\n` +
              `無論系統重啟或更新，您均享有全服 100% 繞過身分檢查與即時覆蓋控制權。\n━━━━━━━━━━━━━━━━━━━━\n` +
              `**🛠️ 目前已實裝之管理員功能清單：**\n\n` +
              `1. 📝 **代填/代更新名冊 (\`/管理員功能 模式:代填名冊\`)\n` +
              `   └ 可指定任何成員，自動帶出舊資料為其建檔或修改本尊/分身。\n\n` +
              `2. 👥 **管理員代管專用控制台 (\`/管理員功能 模式:代管控制台\`)\n` +
              `   └ 選擇任一成員，直接為其代添角色、代更等級或代刪角色。\n\n` +
              `3. 🌐 **全服授權矩陣控制台 (\`/角色狀態 功能:全服總覽\`)\n` +
              `   └ 檢視所有角色在線/借用狀態，可一鍵重設所有權人、借用人或強制切換狀態。\n\n` +
              `4. ⚡ **強制重置/收回角色 (\`/角色狀態 儀表板\`)\n` +
              `   └ 巡檢全服在線角色，可無視擁有者限制直接一鍵將佔用角色釋放為閒置。\n\n` +
              `5. 🚪 **強制關閉/刪除任何揪團 (\`/揪團\` 或 \`/查看\` 面板)\n` +
              `   └ 隊長失聯或任務結束時，管理員可強制關閉或直接徹底刪除揪團貼文。\n\n` +
              `6. ⚖️ **無條件結算與廢除賭局 (\`/賭局\` 面板)\n` +
              `   └ 可提前結算派彩、生成轉帳清單，或一鍵刪除無效賭局。\n\n` +
              `7. 🤝 **地圖交接管理 (\`/放圖\` 面板)\n` +
              `   └ 可強制取消未履約的預約者，或一鍵將地圖完成交接結案。`
            )
            .setFooter({ text: '管理員專屬私密手冊 | 即時同步最新版本特權' });

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
            main: { ign: '', job: '黑騎士', level: '120', owners: [targetUser.id], authorizedUsers: [] },
            subs: [],
            currentSub: null
          });

          const modal = new ModalBuilder().setCustomId('modal_wizard_step1_main').setTitle(`代填【${targetUser.username}】本尊資料`);
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_ign').setLabel('本尊遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_level').setLabel('本尊等級 (必填)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_playtime').setLabel('遊玩時間 (選填)').setValue('未填').setStyle(TextInputStyle.Short).setRequired(false)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_join_reason').setLabel('加入原因 / 備註 (選填)').setValue('管理員代填').setStyle(TextInputStyle.Paragraph).setRequired(false))
          );
          return await interaction.showModal(modal);
        }
      }

      if (commandName === '角色狀態') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const action = interaction.options.getString('功能');

        if (action === 'ACT_DASHBOARD') {
          await interaction.deferReply({ ephemeral: true });
          const snap = await db.collection('char_statuses').get();
          const isSuper = interaction.user.id === SUPER_ADMIN_ID;
          const myChars = [], authChars = [], otherChars = [];

          snap.forEach(doc => {
            const d = doc.data();
            const ign = d.charIgn || doc.id;
            const job = d.job || '冒險家';
            const owners = d.owners || [];
            const auths = d.authorizedUsers || [];

            if (owners.includes(interaction.user.id)) myChars.push({ ign, job, label: `👑 本人：${ign} (${job})` });
            else if (auths.includes(interaction.user.id)) authChars.push({ ign, job, label: `🤝 借用：${ign} (${job})` });
            else if (isSuper) otherChars.push({ ign, job, label: `🌐 全服：${ign} (${job})` });
          });

          const display = isSuper ? [...myChars, ...authChars, ...otherChars] : [...myChars, ...authChars];
          if (!display.length) return interaction.editReply('📜 您尚未在 `/角色報到` 登記角色，或未獲借用授權。');

          const selectOptions = display.slice(0, 25).map((c, i) =>
            new StringSelectMenuOptionBuilder().setLabel(c.label.substring(0, 100)).setValue(`char_select_${i}_${c.ign}`)
          );
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_char_status_dashboard').setPlaceholder('🔽 選擇角色查看狀態').addOptions(selectOptions)
          );
          return await interaction.editReply({ content: '👉 **請選擇要查看狀態的角色：**', components: [row] });
        }

        if (action === 'ACT_AUTH') {
          await interaction.deferReply({ ephemeral: true });
          const myProfile = await fetchUserDocSafe(interaction.user.id);
          const myChars = [];
          if (myProfile.mainIgn) myChars.push(myProfile.mainIgn);
          (myProfile.subs || []).forEach(s => { if (s?.ign) myChars.push(s.ign); });

          if (!myChars.length) return interaction.editReply('📜 您尚未登記任何角色，無法進行授權！');

          const selectOptions = myChars.slice(0, 25).map((ign, i) => new StringSelectMenuOptionBuilder().setLabel(`👑 ${ign}`).setValue(`auth_char_${i}_${ign}`));
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_auth_step1_char').setPlaceholder('🔽 請先選擇你要授權借出的角色').addOptions(selectOptions)
          );
          return await interaction.editReply({ content: '👉 **【步驟 1/2】請選擇要借出的角色：**', components: [row] });
        }

        if (action === 'ACT_REVOKE') {
          await interaction.deferReply({ ephemeral: true });
          const myProfile = await fetchUserDocSafe(interaction.user.id);
          const myChars = [];
          if (myProfile.mainIgn) myChars.push(myProfile.mainIgn);
          (myProfile.subs || []).forEach(s => { if (s?.ign) myChars.push(s.ign); });

          if (!myChars.length) return interaction.editReply('📜 您尚未登記任何角色！');

          const selectOptions = myChars.slice(0, 25).map((ign, i) => new StringSelectMenuOptionBuilder().setLabel(`👑 ${ign}`).setValue(`revoke_char_${i}_${ign}`));
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_revoke_step1_char').setPlaceholder('🔽 請選擇你要收回授權的角色').addOptions(selectOptions)
          );
          return await interaction.editReply({ content: '👉 **【步驟 1/2】請選擇要收回權限的角色：**', components: [row] });
        }

        if (action === 'ACT_MATRIX') {
          if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.reply({ content: '❌ 僅超級管理員可使用！', ephemeral: true });
          await interaction.deferReply({ ephemeral: true });
          const snap = await db.collection('char_statuses').get();
          if (snap.empty) return interaction.editReply('尚無角色資料。');

          let matrixText = '';
          const selectOptions = [];
          snap.forEach((doc, i) => {
            const d = doc.data();
            const ign = d.charIgn || doc.id;
            const owners = (d.owners || []).map(u => `<@${u}>`).join(', ') || '無';
            const auths = (d.authorizedUsers || []).map(u => `<@${u}>`).join(', ') || '無';
            const statusTag = d.isOnline ? `🔴 使用中 (<@${d.currentUserId}>)` : '🟢 閒置';
            matrixText += `${i + 1}. **${ign}** (${d.job || '未知'}) | 狀態: ${statusTag}\n   └ 👑 擁有者: ${owners}\n   └ 🤝 授權名單: ${auths}\n`;
            if (selectOptions.length < 25) {
              selectOptions.push(new StringSelectMenuOptionBuilder().setLabel(`⚙️ 管理【${ign}】(${d.isOnline ? '使用中' : '閒置'})`).setValue(`matrix_edit_${i}_${ign}`));
            }
          });

          const embed = new EmbedBuilder().setColor(0xF1C40F).setTitle('🌐【全服角色狀態與授權總覽】').setDescription(matrixText.substring(0, 4000));
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_matrix_manage_char').setPlaceholder('⚙️ 點此選擇角色直接修改其狀態/所有權/授權人').addOptions(selectOptions)
          );
          return await interaction.editReply({ embeds: [embed], components: [row] });
        }
      }

      if (commandName === '個人名片') {
        const mode = interaction.options.getString('模式');
        if (mode === 'CARD_MY') {
          await interaction.deferReply({ ephemeral: true });
          const d = await fetchUserDocSafe(interaction.user.id);
          if (!d.mainIgn) return interaction.editReply('📜 您尚未建立名冊資料，請透過 `/角色報到` 登記。');

          const subList = (d.subs || []).map((s, i) => `${i + 1}. \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n') || '無';
          const ownersList = (d.owners || []).map(u => `<@${u}>`).join(', ') || '僅限本人';
          const authList = (d.authorizedUsers || []).map(u => `<@${u}>`).join(', ') || '無授權他人';

          const isWarden = parseInt(d.mainLevel) >= 200;
          const embed = new EmbedBuilder().setColor(d.isRetired ? 0x95A5A6 : (isWarden ? 0xF1C40F : 0x3498DB))
            .setTitle(`🪪 冒險家名片 - ${d.mainIgn} ${isWarden ? '👑 [Lv.200 典獄長]' : ''}`)
            .addFields(
              { name: '👑 本尊角色', value: `${d.mainJob} (Lv.${d.mainLevel})`, inline: true },
              { name: '⏱️ 遊玩時間', value: d.playtime || '未填', inline: true },
              { name: '💬 加入原因', value: d.joinReason || '未填', inline: true },
              { name: '👥 共同所有權人', value: ownersList, inline: false },
              { name: '🤝 授權借用人', value: authList, inline: false },
              { name: `⚔️ 分身角色 (${(d.subs || []).length} 隻)`, value: subList, inline: false }
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('card_btn_add_char').setLabel('➕ 新增角色').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('card_btn_update_level').setLabel('🆙 更新等級').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('card_btn_delete_char').setLabel('🗑️ 刪除角色').setStyle(ButtonStyle.Danger)
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

      if (commandName === '賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const activeBet = await getActiveBetDoc();
        if (activeBet) return interaction.reply({ content: '⚠️ 目前全服已有進行中的賭局，請等待結算！', ephemeral: true });

        await interaction.deferReply();
        const type = interaction.options.getString('類型');
        const target = interaction.options.getString('目標項目');
        const deadline = parseDeadline(interaction.options.getString('截止時間'));
        const customField = interaction.options.getString('自訂選項');
        const maxScroll = interaction.options.getInteger('最大卷數') || 7;
        const seedMoney = parseMoneyInput(interaction.options.getString('底池金額'));

        if (!deadline) return interaction.editReply('❌ 時間格式無效！請輸入如 `15m`、`1h`、`21:30`。');

        let title, options = [], betType = 'book';

        if (type === 'BET_BOOK') {
          title = `【${target}】能不能點過？`;
          options = [{ name: '🟢 過', pool: 0, bets: {} }, { name: '🔴 不過', pool: 0, bets: {} }];
        } else if (type === 'BET_SCROLL') {
          betType = 'scroll';
          if (customField) {
            title = `【${target}】自訂數值落點盤`;
            options = customField.split(/[,，/|]+/).map(s => s.trim()).filter(Boolean).slice(0, 5).map((c, i) => ({ name: `🎯 [${i + 1}] ${c}`, pool: 0, bets: {} }));
          } else {
            title = `【${target}】能過幾卷？(上限 +${maxScroll})`;
            for (let i = 0; i <= maxScroll; i++) options.push({ name: i === 0 ? '💀 過0卷 (全爆)' : (i === maxScroll ? `👑 過${i}卷 (完美神裝)` : `過${i}卷`), pool: 0, bets: {} });
          }
        } else if (type === 'BET_LOOT') {
          betType = 'loot';
          title = `【${target}】打寶競猜`;
          if (customField) {
            options = customField.split(/[,，/|]+/).map(s => s.trim()).filter(Boolean).slice(0, 5).map((c, i) => ({ name: `🎁 [${i + 1}] ${c}`, pool: 0, bets: {} }));
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

          await interaction.editReply(`⚔️ **【進行中揪團總覽】（共 ${snap.size} 團進行中，可直接在下方操作加入或管理）**`);
          for (const doc of snap.docs) {
            const d = doc.data();
            await interaction.followUp({ embeds: [createPartyEmbed(d)], components: createPartyComponents(doc.id, d.isClosed) });
          }
          return;
        }
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
        const msg = await interaction.editReply({ embeds: [createMapShareEmbed(mapData)], components: createMapShareComponents(mapRef.id, mapData) });
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
    }

    // ----------------------------------------
    // [B] 按鈕處理
    // ----------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // 揪團：報名名冊角色（本尊或分身）
      if (customId.startsWith('party_reg_char_')) {
        const parts = customId.split('_');
        const pId = parts[3];
        const type = parts[4];
        const prev = await fetchUserDocSafe(interaction.user.id);
        let ign = prev.mainIgn || interaction.user.displayName, job = prev.mainJob || '黑騎士', lv = prev.mainLevel || '120';
        if (type === 'sub') {
          const s = prev.subs?.[parseInt(parts[5])];
          if (s) { ign = s.ign; job = s.job; lv = s.level; }
        }
        return await interaction.showModal(createPartyBuffModal(pId, ign, job, lv));
      }

      // 揪團：報名加入選角入口
      if (customId.startsWith('party_join_')) {
        const pId = customId.replace('party_join_', '');
        const prev = await fetchUserDocSafe(interaction.user.id);
        const rows = [];
        const r1 = new ActionRowBuilder();
        if (prev.mainIgn) r1.addComponents(new ButtonBuilder().setCustomId(`party_reg_char_${pId}_main`).setLabel(`👑 本尊：${prev.mainIgn}`.substring(0, 80)).setStyle(ButtonStyle.Success));
        (prev.subs || []).slice(0, 3).forEach((s, idx) => r1.addComponents(new ButtonBuilder().setCustomId(`party_reg_char_${pId}_sub_${idx}`).setLabel(`⚔️ ${s.ign}`.substring(0, 80)).setStyle(ButtonStyle.Primary)));
        if (r1.components.length) rows.push(r1);
        rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`party_reg_custom_step1_${pId}`).setLabel('✏️ 自訂其他角色報名').setStyle(ButtonStyle.Secondary)));
        return await interaction.reply({ content: '👉 **請選擇要報名加入的本尊/分身角色（可重複報名多名角色）：**', components: rows, ephemeral: true });
      }

      // 揪團：自訂角色第一階段彈窗
      if (customId.startsWith('party_reg_custom_step1_')) {
        const pId = customId.replace('party_reg_custom_step1_', '');
        const modal = new ModalBuilder().setCustomId(`modal_party_custom_s1_${pId}`).setTitle('自訂角色報名 (步驟 1/2: 基本資料)');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_ign').setLabel('角色遊戲 ID').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_job').setLabel('職業名稱 (例如: 主教、黑騎士)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_lv').setLabel('等級').setValue('120').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_seats').setLabel('加帶機台共佔幾人？(預設 1)').setValue('1').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      // 揪團：退出/修改名下角色
      if (customId.startsWith('party_leave_select_')) {
        await interaction.deferReply({ ephemeral: true });
        const pId = customId.replace('party_leave_select_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        const myRegs = (pData.members || []).filter(m => m.userId === interaction.user.id);
        if (!myRegs.length) return interaction.editReply('💡 您目前尚未在此隊伍中報名任何角色！');

        const selectOptions = myRegs.slice(0, 25).map((m, idx) =>
          new StringSelectMenuOptionBuilder().setLabel(`退出：${m.ign} (${m.job} Lv.${m.level})`).setValue(`remove_${pId}_${m.ign}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_party_member_to_remove').setPlaceholder('🔽 請選擇要退出的指定角色').addOptions(selectOptions)
        );
        return await interaction.editReply({ content: '👉 **請選擇您要從隊伍中退出的角色：**', components: [row] });
      }

      // 揪團：修改資料
      if (customId.startsWith('party_edit_info_')) {
        const pId = customId.replace('party_edit_info_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.reply({ content: '❌ 揪團不存在。', ephemeral: true });
        const d = doc.data();

        if (d.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 只有隊長或管理員可修改揪團資料！', ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`modal_party_edit_${pId}`).setTitle('修改揪團資訊');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_target').setLabel('目標地點/名稱').setValue(d.target || '').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_time').setLabel('開打時間').setValue(d.startTime || '').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_max').setLabel('需要人數').setValue(`${d.maxCount || 6}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_dev').setLabel('隊長可開設備 (台數)').setValue(`${d.devicesCount || 0}`).setStyle(TextInputStyle.Short).setRequired(false)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_note').setLabel('備註說明').setValue(d.bindReq || '').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      // 揪團：刪除（發送私訊廣播退團通知）
      if (customId.startsWith('party_delete_')) {
        await interaction.deferReply({ ephemeral: true });
        const pId = customId.replace('party_delete_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const d = doc.data();

        if (d.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 只有隊長或管理員可刪除揪團！');
        }

        const notifiedUsers = new Set();
        (d.members || []).forEach(m => {
          if (m.userId !== interaction.user.id) notifiedUsers.add(m.userId);
        });

        for (const uid of notifiedUsers) {
          const u = await client.users.fetch(uid).catch(() => null);
          if (u) {
            await u.send(`📢 **【揪團取消通知】** 您所報名由 <@${d.creatorId}> 發起的 **【${d.target}】** 揪團已被取消/刪除！`).catch(() => {});
          }
        }

        await db.collection('party_trainings').doc(pId).delete().catch(() => {});
        if (d.channelId && d.messageId) {
          const ch = await client.channels.fetch(d.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(d.messageId).catch(() => null);
            if (m) await m.delete().catch(() => {});
          }
        }
        return await interaction.editReply(`🗑️ 揪團【**${d.target}**】已徹底刪除，已自動向所有報名成員發送取消通知！`);
      }

      // 揪團：關閉
      if (customId.startsWith('party_close_')) {
        await interaction.deferReply({ ephemeral: true });
        const pId = customId.replace('party_close_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const d = doc.data();

        if (d.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 只有隊長或管理員可關閉揪團！');
        }

        await db.collection('party_trainings').doc(pId).update({ isClosed: true });
        if (d.channelId && d.messageId) {
          const ch = await client.channels.fetch(d.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(d.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createPartyEmbed({ ...d, isClosed: true })], components: createPartyComponents(pId, true) });
          }
        }
        return await interaction.editReply('🔒 揪團已關閉招募！');
      }

      // 名片按鈕：新增角色
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

      // 名片按鈕：更新等級
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

      // 名片按鈕：刪除角色
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

      // 刪除確認按鈕
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

      // 賭局：快捷下注
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
        return await interaction.editReply(`✅ 成功為 **${d.options[optIdx].name}** 下注 \`+100 萬 楓幣\`！`);
      }

      // 賭局：自訂下注
      if (customId.startsWith('bet_custom_')) {
        const bId = customId.replace('bet_custom_', '');
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.reply({ content: '❌ 賭局已失效。', ephemeral: true });
        const d = doc.data();
        if (Date.now() >= d.deadline) return interaction.reply({ content: '🛑 該賭局已截止下注！', ephemeral: true });

        const optHintList = d.options.map((o, idx) => `${idx + 1}:${o.name}`).join(' | ');
        const modal = new ModalBuilder().setCustomId(`modal_bet_custom_${bId}`).setTitle('自訂下注金額');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_bet_choice').setLabel('選項編號 (填數字)').setPlaceholder(`選項：${optHintList.substring(0, 80)}`).setValue('').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_bet_amount').setLabel('下注金額 (支援 500w, 1e 或純數字)').setPlaceholder('例如：500w 或 5000000').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      // 賭局：同情抖內
      if (customId.startsWith('bet_pity_')) {
        const bId = customId.replace('bet_pity_', '');
        const modal = new ModalBuilder().setCustomId(`modal_pity_donate_${bId}`).setTitle('🩹 暴死同情救濟慰問 (私密)');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('input_pity_amount').setLabel(getRandomPityQuote().substring(0, 44)).setPlaceholder('填寫救濟金額 (例如：100w、500w)').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      // 賭局：結算
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

      // 經驗計算器：開始
      if (customId === 'exp_calc_trigger_start') {
        const modal = new ModalBuilder().setCustomId('modal_exp_calc_start').setTitle('開始計算 - 輸入起始數據');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_exp_start').setLabel('1. 起始經驗值 (必填)').setPlaceholder('例如：12500000').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_meso_start').setLabel('2. 起始金幣 (選填)').setPlaceholder('例如：500w 或 5000000').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'exp_calc_cancel') {
        expTrackerMap.delete(interaction.user.id);
        const embed = createExpCalculatorEmbed(null);
        const comps = createExpCalculatorComponents(false);
        return await interaction.update({ embeds: [embed], components: comps });
      }

      // 經驗計算器：結束 (點擊瞬間暫停計時)
      if (customId === 'exp_calc_stop') {
        const session = expTrackerMap.get(interaction.user.id);
        if (!session?.startTime) return interaction.reply({ content: '⚠️ 計時尚未開始，請先點擊開始！', ephemeral: true });

        session.stopTime = Date.now();
        expTrackerMap.set(interaction.user.id, session);

        const modal = new ModalBuilder().setCustomId('modal_exp_calc_finish').setTitle('結束計算 - 輸入結束數據');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_exp_end').setLabel('1. 結束經驗值 (必填)').setPlaceholder('例如：13200000').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_meso_end').setLabel('2. 結束金幣 (選填)').setPlaceholder('例如：420w 或 4200000').setStyle(TextInputStyle.Short).setRequired(false))
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
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('share_level').setLabel('等級 (必填)').setPlaceholder('例如：155').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('share_note').setLabel('備註說明 (選填)').setPlaceholder('例如：自帶祈禱機、單練、開雙倍').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        return await interaction.showModal(modal);
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
            owners: prev.owners || [interaction.user.id],
            authorizedUsers: prev.authorizedUsers || []
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
            authorizedUsers: session.main.authorizedUsers,
            subs: session.subs,
            isRetired: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

          const mainStatus = await getCharStatusDoc(mainIgn);
          const mergedMainOwners = Array.from(new Set([...(mainStatus?.owners || []), ...session.main.owners]));
          await db.collection('char_statuses').doc(mainIgn.toLowerCase()).set({
            charIgn: mainIgn, job: mainJob, owners: mergedMainOwners,
            authorizedUsers: session.main.authorizedUsers, isOnline: mainStatus?.isOnline || false
          }, { merge: true });

          for (const s of session.subs) {
            const subStatus = await getCharStatusDoc(s.ign);
            const mergedSubOwners = Array.from(new Set([...(subStatus?.owners || []), ...s.owners]));
            await db.collection('char_statuses').doc(s.ign.toLowerCase()).set({
              charIgn: s.ign, job: s.job, owners: mergedSubOwners,
              authorizedUsers: s.authorizedUsers, isOnline: subStatus?.isOnline || false
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

      // 地圖放圖按鈕
      if (customId.startsWith('map_take_') || customId.startsWith('map_cancel_') || customId.startsWith('map_done_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = customId.split('_');
        const action = parts[1];
        const mapId = parts[2];
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.editReply('❌ 放圖資訊已失效。');
        const mapData = mapDoc.data();

        if (action === 'take') {
          if (mapData.takerId) return interaction.editReply(`⚠️ 該地圖已被 <@${mapData.takerId}> 搶先預約！`);
          mapData.takerId = interaction.user.id;
          await db.collection('map_shares').doc(mapId).update({ takerId: interaction.user.id });
        } else if (action === 'cancel') {
          if (mapData.takerId !== interaction.user.id && mapData.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
            return interaction.editReply('❌ 您無權取消此預約！');
          }
          mapData.takerId = null;
          await db.collection('map_shares').doc(mapId).update({ takerId: null });
        } else if (action === 'done') {
          if (mapData.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
            return interaction.editReply('❌ 只有放圖者可確認完成！');
          }
          mapData.isFinished = true;
          await db.collection('map_shares').doc(mapId).update({ isFinished: true });
        }

        if (mapData.channelId && mapData.messageId) {
          const ch = await client.channels.fetch(mapData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(mapData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createMapShareEmbed(mapData)], components: createMapShareComponents(mapId, mapData) });
          }
        }
        return await interaction.editReply(`✅ 操作成功！`);
      }

      // 角色狀態上線/離線雙按鈕
      if (customId.startsWith('char_act_online_')) {
        const ign = customId.replace('char_act_online_', '');
        const modal = new ModalBuilder().setCustomId(`modal_char_online_${ign}`).setTitle(`登記上線 - 【${ign}】`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_use_duration').setLabel('預計時長 (例: 10m, 30m, 1h, 2h)').setValue('1h').setStyle(TextInputStyle.Short).setRequired(true)));
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('char_act_offline_') || customId.startsWith('char_act_force_')) {
        await interaction.deferReply({ ephemeral: true });
        const isForce = customId.startsWith('char_act_force_');
        const ign = customId.replace(isForce ? 'char_act_force_' : 'char_act_offline_', '');
        const doc = await getCharStatusDoc(ign);
        const isOwner = (doc?.owners || []).includes(interaction.user.id) || isSuperAdmin(interaction.user.id, interaction.memberPermissions);

        if (!isOwner && doc?.currentUserId !== interaction.user.id) return interaction.editReply('❌ 您無權執行此操作！');

        await db.collection('char_statuses').doc(ign.toLowerCase()).set({ isOnline: false, currentUserId: null, currentUserName: null, startTime: 0, expectedEndTime: 0 }, { merge: true });
        return await interaction.editReply(`✅ 角色【**${ign}**】已成功釋放為【🟢 閒置中】！`);
      }

      if (customId.startsWith('char_act_knock_')) {
        const ign = customId.replace('char_act_knock_', '');
        const modal = new ModalBuilder().setCustomId(`modal_char_knock_${ign}`).setTitle(`排隊預約提醒 - 【${ign}】`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_knock_minutes').setLabel('預計幾分鐘後使用？(最低 60 分鐘)').setValue('60').setStyle(TextInputStyle.Short).setRequired(true)));
        return await interaction.showModal(modal);
      }
    }

    // ----------------------------------------
    // [C] 下拉選單處理
    // ----------------------------------------
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      const customId = interaction.customId;

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

      if (customId === 'select_auth_step1_char') {
        const parts = interaction.values[0].split('_');
        const charIgn = parts.slice(3).join('_');
        userChoiceMap.set(`temp_auth_char_${interaction.user.id}`, charIgn);
        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('select_auth_step2_user').setPlaceholder(`🤝 選擇要借用【${charIgn}】的成員`).setMinValues(1).setMaxValues(1)
        );
        return await interaction.update({ content: `👉 **【步驟 2/2】已選定角色【${charIgn}】，請選擇要授權的對象成員：**`, components: [rowUser] });
      }

      if (customId === 'select_auth_step2_user') {
        await interaction.deferUpdate();
        const charIgn = userChoiceMap.get(`temp_auth_char_${interaction.user.id}`);
        const targetUserId = interaction.values[0];
        if (!charIgn) return await interaction.editReply('❌ 授權逾時，請重新操作！');

        const statusDoc = await getCharStatusDoc(charIgn);
        let auths = statusDoc?.authorizedUsers || [];
        if (!auths.includes(targetUserId)) auths.push(targetUserId);

        await db.collection('char_statuses').doc(charIgn.toLowerCase()).update({ authorizedUsers: auths });
        userChoiceMap.delete(`temp_auth_char_${interaction.user.id}`);
        return await interaction.editReply({ content: `🎉 成功授權 <@${targetUserId}> 借用您的角色【**${charIgn}**】！`, components: [] });
      }

      if (customId === 'select_revoke_step1_char') {
        const parts = interaction.values[0].split('_');
        const charIgn = parts.slice(3).join('_');
        const statusDoc = await getCharStatusDoc(charIgn);
        const auths = statusDoc?.authorizedUsers || [];

        if (!auths.length) {
          return await interaction.update({ content: `💡 角色【**${charIgn}**】目前沒有授權給任何人，無需撤銷！`, components: [] });
        }

        userChoiceMap.set(`temp_revoke_char_${interaction.user.id}`, charIgn);
        const selectOptions = [];
        for (const uid of auths) {
          const u = await client.users.fetch(uid).catch(() => null);
          selectOptions.push(new StringSelectMenuOptionBuilder().setLabel(u ? `@${u.username}` : `成員ID: ${uid}`).setValue(uid));
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_revoke_step2_user').setPlaceholder('🔒 選擇要收回借用權限的成員').addOptions(selectOptions.slice(0, 25))
        );
        return await interaction.update({ content: `👉 **【步驟 2/2】請選擇要收回【${charIgn}】權限的成員：**`, components: [row] });
      }

      if (customId === 'select_revoke_step2_user') {
        await interaction.deferUpdate();
        const charIgn = userChoiceMap.get(`temp_revoke_char_${interaction.user.id}`);
        const targetUserId = interaction.values[0];
        if (!charIgn) return await interaction.editReply('❌ 撤銷逾時，請重新操作！');

        const statusDoc = await getCharStatusDoc(charIgn);
        let auths = (statusDoc?.authorizedUsers || []).filter(u => u !== targetUserId);

        await db.collection('char_statuses').doc(charIgn.toLowerCase()).update({ authorizedUsers: auths });
        userChoiceMap.delete(`temp_revoke_char_${interaction.user.id}`);
        return await interaction.editReply({ content: `🔒 已成功收回 <@${targetUserId}> 對角色【**${charIgn}**】的借用授權！`, components: [] });
      }

      if (customId === 'select_matrix_manage_char') {
        const parts = interaction.values[0].split('_');
        const charIgn = parts.slice(3).join('_');
        userChoiceMap.set(`temp_matrix_char_${interaction.user.id}`, charIgn);
        const statusDoc = await getCharStatusDoc(charIgn);

        const ownersMention = (statusDoc?.owners || []).map(u => `<@${u}>`).join(', ') || '無';
        const authsMention = (statusDoc?.authorizedUsers || []).map(u => `<@${u}>`).join(', ') || '無';
        const isOnline = statusDoc?.isOnline || false;

        const rowOwners = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('select_matrix_set_owners').setPlaceholder('👥 重設共同所有權人').setMinValues(1).setMaxValues(10)
        );
        const rowAuths = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('select_matrix_set_auths').setPlaceholder('🤝 重設授權借用人').setMinValues(0).setMaxValues(10)
        );
        const rowToggle = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`matrix_btn_toggle_status_${charIgn}`).setLabel(isOnline ? '🔴 強制釋放為閒置' : '🟢 強制設為使用中').setStyle(isOnline ? ButtonStyle.Danger : ButtonStyle.Success)
        );

        return await interaction.update({
          content: `⚙️ **【管理員控制台】角色：${charIgn}**\n` +
                   `📊 目前狀態：\`${isOnline ? `🔴 使用中 (<@${statusDoc.currentUserId}>)` : '🟢 閒置中'}\`\n` +
                   `👑 目前所有權人：${ownersMention}\n` +
                   `🤝 目前授權借用人：${authsMention}\n請在下方直接修改：`,
          embeds: [],
          components: [rowOwners, rowAuths, rowToggle]
        });
      }

      if (customId === 'select_matrix_set_owners') {
        await interaction.deferUpdate();
        const charIgn = userChoiceMap.get(`temp_matrix_char_${interaction.user.id}`);
        if (!charIgn) return await interaction.editReply('❌ 操作逾時！');
        await db.collection('char_statuses').doc(charIgn.toLowerCase()).update({ owners: interaction.values });
        return await interaction.editReply({ content: `✅ 已成功重設【**${charIgn}**】的共同所有權人為：${interaction.values.map(u => `<@${u}>`).join(', ')}`, components: [] });
      }

      if (customId === 'select_matrix_set_auths') {
        await interaction.deferUpdate();
        const charIgn = userChoiceMap.get(`temp_matrix_char_${interaction.user.id}`);
        if (!charIgn) return await interaction.editReply('❌ 操作逾時！');
        await db.collection('char_statuses').doc(charIgn.toLowerCase()).update({ authorizedUsers: interaction.values });
        return await interaction.editReply({ content: `✅ 已成功重設【**${charIgn}**】的授權借用人為：${interaction.values.map(u => `<@${u}>`).join(', ') || '無'}`, components: [] });
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

      if (customId === 'wiz_select_auths') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新登記！', ephemeral: true });
        const selectedUsers = interaction.values;
        if (session.step === 'MAIN') session.main.authorizedUsers = selectedUsers;
        else if (session.currentSub) session.currentSub.authorizedUsers = selectedUsers;
        return await interaction.update(buildWizardConfigCard(interaction.user.id));
      }

      if (customId.startsWith('select_char_status_dashboard')) {
        await interaction.deferReply({ ephemeral: true });
        const val = interaction.values[0];
        const ign = val.split('_').slice(3).join('_');
        const doc = await getCharStatusDoc(ign);
        const myProfile = await fetchUserDocSafe(interaction.user.id);

        const isOwner = (doc?.owners || []).includes(interaction.user.id) ||
                        myProfile.mainIgn?.toLowerCase() === ign.toLowerCase() ||
                        (myProfile.subs || []).some(s => s?.ign?.toLowerCase() === ign.toLowerCase()) ||
                        isSuperAdmin(interaction.user.id, interaction.memberPermissions);

        const isCur = doc?.currentUserId === interaction.user.id;
        const embed = createCharStatusEmbed(ign, doc, isOwner ? '👑 所有權人' : '🤝 授權借用者');
        const comps = createCharStatusComponents(ign, doc, isOwner, isCur);
        return await interaction.editReply({ embeds: [embed], components: comps });
      }

      if (customId === 'select_profile_job_view') {
        await interaction.deferUpdate();
        const j = interaction.values[0];
        const embed = await generateJobEmbed(j);
        const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);
        return await interaction.editReply({ embeds: [embed], components: [buildJobQueryMenu(isAdmin)] });
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
    // [D] Modal 提交
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      // 揪團報名名冊角色提交
      if (customId.startsWith('modal_party_buffs_')) {
        await interaction.deferReply({ ephemeral: true });
        const pId = customId.replace('modal_party_buffs_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        const raw = interaction.fields.getTextInputValue('input_char_info').split(/[/\\|\s,，_-]+/);
        const ign = raw[0] || interaction.user.displayName, job = raw[1] || '冒險家', lv = raw[2] || '120';
        const seatCount = Math.max(1, parseInt(interaction.fields.getTextInputValue('input_seat_count')) || 1);
        const buffs = { '楓祝': interaction.fields.getTextInputValue('input_maple_buff') || '滿' };

        const defined = JOB_BUFFS[job] || [];
        if (defined[0]) buffs[defined[0]] = interaction.fields.getTextInputValue('input_job_buff_1') || '滿';
        if (defined[1]) buffs[defined[1]] = interaction.fields.getTextInputValue('input_job_buff_2') || '滿';

        const members = (pData.members || []).filter(m => !(m.userId === interaction.user.id && m.ign.toLowerCase() === ign.toLowerCase()));
        members.push({ userId: interaction.user.id, ign, job, level: lv, seatCount, buffs });

        await db.collection('party_trainings').doc(pId).update({ members });
        if (pData.channelId && pData.messageId) {
          const ch = await client.channels.fetch(pData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(pData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createPartyEmbed({ ...pData, members })], components: createPartyComponents(pId, pData.isClosed) });
          }
        }
        return await interaction.editReply(`🎉 成功加入揪團！角色：\`${ign}\` (${job} Lv.${lv}，共佔 ${seatCount} 人)`);
      }

      // 自訂角色第二階段彈窗觸發
      if (customId.startsWith('modal_party_custom_s1_')) {
        const pId = customId.replace('modal_party_custom_s1_', '');
        const ign = interaction.fields.getTextInputValue('c_ign').trim();
        const rawJob = interaction.fields.getTextInputValue('c_job').trim();
        const lv = interaction.fields.getTextInputValue('c_lv').replace(/[^0-9]/g, '') || '120';
        const seats = Math.max(1, parseInt(interaction.fields.getTextInputValue('c_seats')) || 1);

        let job = '黑騎士';
        for (const validJob of Object.keys(ROLES.JOBS)) {
          if (rawJob.includes(validJob)) { job = validJob; break; }
        }

        const modal = new ModalBuilder().setCustomId(`modal_party_custom_s2_${pId}`).setTitle(`自訂報名 (${job} Lv.${lv})`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_data').setLabel('確認資料 (ID/職業/等級/人數)').setValue(`${ign}/${job}/${lv}/${seats}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_maple').setLabel('【🍁楓葉祝福】等級').setValue('滿').setStyle(TextInputStyle.Short).setRequired(true))
        );
        const buffs = JOB_BUFFS[job] || [];
        if (buffs[0]) modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_buff1').setLabel(`【${buffs[0]}】等級`).setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)));
        if (buffs[1]) modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_buff2').setLabel(`【${buffs[1]}】等級`).setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)));
        return await interaction.showModal(modal);
      }

      // 自訂角色第二階段提交入隊
      if (customId.startsWith('modal_party_custom_s2_')) {
        await interaction.deferReply({ ephemeral: true });
        const pId = customId.replace('modal_party_custom_s2_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        const raw = interaction.fields.getTextInputValue('c_data').split('/');
        const ign = raw[0], job = raw[1], lv = raw[2], seatCount = parseInt(raw[3]) || 1;
        const buffs = { '楓祝': interaction.fields.getTextInputValue('c_maple') || '滿' };

        const defined = JOB_BUFFS[job] || [];
        if (defined[0] && interaction.fields.getTextInputValue('c_buff1')) buffs[defined[0]] = interaction.fields.getTextInputValue('c_buff1');
        if (defined[1] && interaction.fields.getTextInputValue('c_buff2')) buffs[defined[1]] = interaction.fields.getTextInputValue('c_buff2');

        const members = pData.members || [];
        members.push({ userId: interaction.user.id, ign, job, level: lv, seatCount, buffs });
        await db.collection('party_trainings').doc(pId).update({ members });

        if (pData.channelId && pData.messageId) {
          const ch = await client.channels.fetch(pData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(pData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createPartyEmbed({ ...pData, members })] });
          }
        }
        return await interaction.editReply(`🎉 成功加入揪團！角色：\`${ign}\` (${job} Lv.${lv}，共佔 ${seatCount} 人)`);
      }

      // 揪團修改提交
      if (customId.startsWith('modal_party_edit_')) {
        await interaction.deferReply({ ephemeral: true });
        const pId = customId.replace('modal_party_edit_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        pData.target = interaction.fields.getTextInputValue('e_target').trim();
        pData.startTime = interaction.fields.getTextInputValue('e_time').trim();
        pData.maxCount = Math.max(2, parseInt(interaction.fields.getTextInputValue('e_max')) || 6);
        pData.devicesCount = parseInt(interaction.fields.getTextInputValue('e_dev')) || 0;
        pData.bindReq = interaction.fields.getTextInputValue('e_note')?.trim() || '無';

        await db.collection('party_trainings').doc(pId).update(pData);
        if (pData.channelId && pData.messageId) {
          const ch = await client.channels.fetch(pData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(pData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createPartyEmbed(pData)] });
          }
        }
        return await interaction.editReply('✅ 揪團資訊已成功更新！');
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

        if (isMain) {
          try {
            const member = await interaction.guild.members.fetch(targetUid).catch(() => null);
            if (member) await member.setNickname(`[${newLevel}_${profile.mainJob}] ${profile.mainIgn}`.substring(0, 32)).catch(() => {});
          } catch {}
          const milestone = await checkLevelMilestone(interaction.guild, interaction.user, prevLevel, newLevel, profile.mainIgn, profile.mainJob);
          if (milestone) await interaction.followUp({ embeds: [milestone], ephemeral: true });
        }

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
          charIgn: ign, job, owners, authorizedUsers: sDoc?.authorizedUsers || [], isOnline: sDoc?.isOnline || false
        }, { merge: true });

        await syncMemberRoles(interaction.guild, targetUid, { ...profile, subs });
        userChoiceMap.delete(`target_add_user_${interaction.user.id}`);
        return await interaction.editReply(`🎉 成功為 <@${targetUid}> 新增分身角色【**${ign}**】(${job} Lv.${level})！對應副職身分組已自動加發！`);
      }

      // 經驗計算器開始
      if (customId === 'modal_exp_calc_start') {
        const expStart = parseFloat(interaction.fields.getTextInputValue('input_exp_start').replace(/[^0-9.]/g, '')) || 0;
        const mesoStart = parseMoneyInput(interaction.fields.getTextInputValue('input_meso_start'));
        const startTime = Date.now();

        const session = { startTime, expStart, mesoStart };
        expTrackerMap.set(interaction.user.id, session);

        const embed = createExpCalculatorEmbed(session);
        const comps = createExpCalculatorComponents(true);
        return await interaction.reply({ content: '✅ **已成功鎖定起始數據，計時開始！**', embeds: [embed], components: comps, ephemeral: true });
      }

      // 經驗計算器結束 (使用暫停時間精算)
      if (customId === 'modal_exp_calc_finish') {
        await interaction.deferReply({ ephemeral: true });
        const session = expTrackerMap.get(interaction.user.id);
        if (!session?.startTime) return interaction.editReply('❌ 計時已失效，請重新開始！');

        const endTime = session.stopTime || Date.now();
        const durationSec = Math.max(1, Math.round((endTime - session.startTime) / 1000));
        const durationMinText = `${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`;

        const expEnd = parseFloat(interaction.fields.getTextInputValue('input_exp_end').replace(/[^0-9.]/g, '')) || 0;
        const deltaExp = Math.max(0, expEnd - session.expStart);

        const mesoEnd = parseMoneyInput(interaction.fields.getTextInputValue('input_meso_end'));
        const hasMeso = session.mesoStart > 0 || interaction.fields.getTextInputValue('input_meso_end');
        const deltaMeso = mesoEnd - session.mesoStart;

        const expPer10Min = Math.round((deltaExp / durationSec) * 600);
        const expPerHour = Math.round((deltaExp / durationSec) * 3600);
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

        const reportData = { durationMinText, durationSec, deltaExp, expPer10Min, expPerHour, hasMeso, deltaMeso, mesoPer10Min, mesoPerHour };
        expTrackerMap.set(`report_${interaction.user.id}`, reportData);
        expTrackerMap.delete(interaction.user.id);

        const reportEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('📈【練等效率分析報告出爐】')
          .setDescription(
            `⏱️ **實測時間**：\`${durationMinText}\` (共 ${durationSec} 秒)\n` +
            `📊 **實測獲得經驗**：\`+${deltaExp.toLocaleString()} EXP\`\n` +
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
          owners: session.main?.owners || [session.targetUserId || interaction.user.id],
          authorizedUsers: session.main?.authorizedUsers || []
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
        session.currentSub = { ign, job: '主教', level, owners: [targetUid], authorizedUsers: [] };

        return await interaction.reply({ ...buildWizardConfigCard(interaction.user.id), ephemeral: true });
      }

      if (customId.startsWith('modal_char_online_')) {
        await interaction.deferReply({ ephemeral: true });
        const ign = customId.replace('modal_char_online_', '');
        const durationStr = interaction.fields.getTextInputValue('input_use_duration').trim();
        const endMs = parseDeadline(durationStr) || (Date.now() + 3600000);

        const prevDoc = await getCharStatusDoc(ign);
        if (prevDoc?.isOnline) return interaction.editReply(`⚠️ 該角色剛被 <@${prevDoc.currentUserId}> 登記上線！`);

        const prev = await fetchUserDocSafe(interaction.user.id);
        const owners = prevDoc?.owners || [interaction.user.id];
        if (!owners.includes(interaction.user.id)) owners.push(interaction.user.id);

        const newStatus = { charIgn: ign, isOnline: true, currentUserId: interaction.user.id, currentUserName: prev.mainIgn || interaction.user.displayName, owners, startTime: Date.now(), expectedEndTime: endMs };
        await db.collection('char_statuses').doc(ign.toLowerCase()).set(newStatus, { merge: true });
        return await interaction.editReply(`🟢 成功登記上線【**${ign}**】！預計使用至 <t:${Math.floor(endMs / 1000)}:T>。`);
      }

      if (customId.startsWith('modal_char_knock_')) {
        await interaction.deferReply({ ephemeral: true });
        const ign = customId.replace('modal_char_knock_', '');
        const min = Math.max(60, parseInt(interaction.fields.getTextInputValue('input_knock_minutes')) || 60);
        const doc = await getCharStatusDoc(ign);
        if (!doc?.isOnline) return interaction.editReply('💡 角色目前閒置中，可直接登記！');

        const u = await client.users.fetch(doc.currentUserId).catch(() => null);
        if (u) {
          await u.send(`🔔 **【換手預約通知】** 冒險家 <@${interaction.user.id}> 預計於 **\`${min} 分鐘後\`** 使用【**${ign}**】，請提早安排下線！\n💡 *如遇急用請務必先私訊協調確認後再登入，切勿強行頂號！*`).catch(() => {});
          return await interaction.editReply(`✅ 已私訊提醒目前使用者 <@${doc.currentUserId}>（預計 ${min} 分鐘後換手）！如遇急用請主動私訊對方說明！`);
        }
        return await interaction.editReply(`⚠️ 對方關閉了私訊，請直接在頻道中 @ 他！`);
      }

      if (customId.startsWith('modal_bet_custom_')) {
        await interaction.deferReply({ ephemeral: true });
        const bId = customId.replace('modal_bet_custom_', '');
        const optIdx = parseInt(interaction.fields.getTextInputValue('input_bet_choice')) - 1;
        const amt = parseMoneyInput(interaction.fields.getTextInputValue('input_bet_amount'));
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局不存在。');
        const d = doc.data();

        if (isNaN(optIdx) || optIdx < 0 || optIdx >= d.options.length || amt <= 0) return interaction.editReply('❌ 選項編號或金額無效！');
        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.mainIgn || interaction.user.displayName;
        const cur = d.options[optIdx].bets[interaction.user.id]?.amount || 0;
        d.options[optIdx].bets[interaction.user.id] = { ign, amount: cur + amt };
        d.options[optIdx].pool = (d.options[optIdx].pool || 0) + amt;

        await db.collection('active_bets').doc(bId).update({ options: d.options });
        return await interaction.editReply(`✅ 成功為 **${d.options[optIdx].name}** 下注 \`${formatMeso(amt)} 楓幣\`！`);
      }

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
