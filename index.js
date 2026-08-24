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
// 1. 常數與設定
// ==========================================
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

const userChoiceMap = new Map();

const DONOR_ACTIONS = ["救濟了一碗暖心熱湯", "贊助了一包強力面紙", "請喝了一杯全糖珍奶", "施捨了一張回村卷軸", "送上一份心靈慰問金"];
const PITY_TEXTS = {
  scroll: ["贊助苦主買包面紙擦眼淚...", "全爆補助金：給老哥買碗熱湯喝..."],
  book: ["贊助苦主吸收技能書灰燼的心理治療費...", "技能書爆破受害者慰問金..."],
  loot: ["贊助苦主打不到寶的洗面乳...", "空包彈受害者急難救助金..."]
};

function getRandomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function isSuperAdmin(userId, perms) { return userId === SUPER_ADMIN_ID || perms?.has(PermissionFlagsBits.Administrator); }

// ==========================================
// 2. 格式化與計算輔助
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

function parseSubCharacter(rawText) {
  if (!rawText?.trim()) return null;
  const parts = rawText.split(/[/\\|\s,，_-]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const ign = parts[0];
  let job = '未知職業', level = '1';
  for (const p of parts.slice(1)) {
    for (const validJob of Object.keys(ROLES.JOBS)) {
      if (p.includes(validJob)) { job = validJob; break; }
    }
    const cleanNum = p.replace(/[^0-9]/g, '');
    if (cleanNum && !isNaN(cleanNum)) level = cleanNum;
  }
  return { ign, job, level, raw: rawText.trim() };
}

// ==========================================
// 3. 資料庫存取
// ==========================================
let db;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CREDENTIALS)) });
    db = admin.firestore();
    console.log('✅ Firebase 連線成功');
  }
} catch (e) { console.error('❌ Firebase 連線失敗:', e.message); }

async function fetchUserDocSafe(userId) {
  if (!db) return {};
  try {
    const doc = await db.collection('member_profiles').doc(userId).get();
    return doc.exists ? doc.data() : {};
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
// 4. UI 面板產生器
// ==========================================
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
             `🚫 **請勿強行登入頂號！** 如有急用請點擊下方「🔔 敲門提醒」發送換手通知。`;
    }
  }

  return new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`🔑 角色共用儀表板 - 【${charIgn}】`)
    .setDescription(`👤 **您的角色權限**：\`${userRoleText}\`\n━━━━━━━━━━━━━━━━━━━━\n${statusTitle}\n\n${desc}`)
    .setFooter({ text: '私密儀表板 | 換手上線請隨手登記' });
}

function createCharStatusComponents(charIgn, statusData, isOwner, isCurrentUser) {
  const isOnline = statusData?.isOnline || false;
  const row = new ActionRowBuilder();
  if (!isOnline) {
    row.addComponents(new ButtonBuilder().setCustomId(`char_act_online_${charIgn}`).setLabel('🟢 我要上線使用').setStyle(ButtonStyle.Success));
  } else {
    if (isCurrentUser || isOwner) {
      row.addComponents(new ButtonBuilder().setCustomId(`char_act_offline_${charIgn}`).setLabel('🔴 我已離線 / 釋放').setStyle(ButtonStyle.Primary));
    }
    if (!isCurrentUser) {
      row.addComponents(new ButtonBuilder().setCustomId(`char_act_knock_${charIgn}`).setLabel('🔔 敲門提醒使用者').setStyle(ButtonStyle.Secondary));
    }
    if (isOwner && !isCurrentUser) {
      row.addComponents(new ButtonBuilder().setCustomId(`char_act_force_${charIgn}`).setLabel('⚡ 強制重置 (擁有者特權)').setStyle(ButtonStyle.Danger));
    }
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
  const isFull = members.length >= partyData.maxCount;
  const buffPool = [];
  const extraDevices = [];
  members.forEach(m => {
    Object.entries(m.buffs || {}).forEach(([k, v]) => buffPool.push(`${k}(${v})`));
    if (m.extraDevice) extraDevices.push(`${m.ign}: ${m.extraDevice}`);
  });

  let memberListText = members.length === 0 ? '• 目前尚無成員加入' : '';
  members.forEach((m, idx) => {
    const buffs = Object.entries(m.buffs || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    memberListText += `${idx + 1}. **${m.ign}** (${m.job} Lv.${m.level}) - <@${m.userId}>\n   └ 💡 技能：\`${buffs || '無'}\`${m.extraDevice ? `\n   └ 📱 自帶支援：\`${m.extraDevice}\`` : ''}\n`;
  });

  const titles = { training: '⚔️【冒險者團練】', raid: '🐉【Boss 突襲遠征】', pq: '🧩【經典組隊任務】' };

  return new EmbedBuilder()
    .setColor(partyData.isClosed ? 0x95A5A6 : (isFull ? 0xF1C40F : 0x3498DB))
    .setTitle(`${titles[partyData.partyType] || '⚔️【冒險揪團】'}${partyData.target}`)
    .setDescription(
      `👑 **隊長**：<@${partyData.creatorId}>\n` +
      `⏰ **時間**：\`${partyData.startTime}\` | 📌 **限制**：\`${partyData.bindReq || '無'}\`\n` +
      `👥 **人數**：\`${members.length} / ${partyData.maxCount} 人\` ${isFull ? '🔴 **(已滿員)**' : '🟢 **(招募中)**'}\n` +
      `✨ **隊伍 Buff**：\`${buffPool.length ? buffPool.join(' | ') : '尚未有 Buff'}\`\n` +
      `📱 **全隊外置支援**：\`${extraDevices.length ? extraDevices.join(' | ') : '無'}\`\n` +
      `狀態：${partyData.isClosed ? '🔒 **已結束招募**' : '🔥 **歡迎報名加入！**'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n📋 **【目前名冊】**\n${memberListText}`
    );
}

function createPartyComponents(partyId, isClosed = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party_join_${partyId}`).setLabel('✋ 報名加入').setStyle(ButtonStyle.Success).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_leave_${partyId}`).setLabel('❌ 取消報名').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_close_${partyId}`).setLabel('🚪 關閉揪團').setStyle(ButtonStyle.Danger).setDisabled(isClosed)
    )
  ];
}

function createRegisterModal(selectedJob, prevData) {
  const modal = new ModalBuilder().setCustomId('modal_register_page1').setTitle(`名冊登記 (主職：${selectedJob})`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_main_ign').setLabel('1. 本尊遊戲ID (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainIgn || '').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_main_level').setLabel('2. 本尊等級 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.mainLevel || '').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_playtime').setLabel('3. 遊玩時間 (必填)').setStyle(TextInputStyle.Short).setValue(prevData.playtime || '').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_subs_1_2').setLabel('4. 小號 1~2 (格式: ID/職業/等級)').setStyle(TextInputStyle.Paragraph).setValue([prevData.subs?.[0]?.raw, prevData.subs?.[1]?.raw].filter(Boolean).join('\n')).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_subs_3_4').setLabel('5. 小號 3~4 (格式: ID/職業/等級)').setStyle(TextInputStyle.Paragraph).setValue([prevData.subs?.[2]?.raw, prevData.subs?.[3]?.raw].filter(Boolean).join('\n')).setRequired(false))
  );
  return modal;
}

function createPartyBuffModal(partyId, charIgn, charJob, charLevel) {
  const modal = new ModalBuilder().setCustomId(`modal_party_buffs_${partyId}`).setTitle(`揪團報名 (${charJob})`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_char_info').setLabel('角色ID / 職業 / 等級').setValue(`${charIgn}/${charJob}/${charLevel}`).setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_maple_buff').setLabel('【🍁楓葉祝福】等級 (填: 滿 或 數字)').setValue('滿').setStyle(TextInputStyle.Short).setRequired(true))
  );
  const buffs = JOB_BUFFS[charJob] || [];
  if (buffs.length > 0) {
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_job_buff_1').setLabel(`【${buffs[0]}】等級 (填: 滿 或 數字)`).setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)));
  }
  if (buffs.length > 1) {
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_job_buff_2').setLabel(`【${buffs[1]}】等級 (填: 滿 或 數字)`).setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)));
  }
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_extra_device').setLabel('📱自帶支援 (無則留空)').setPlaceholder('例如：自帶 1 台祈禱機').setStyle(TextInputStyle.Short).setRequired(false)));
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
      `👑 **發起人**：<@${betData.creatorId}> | 🎁 **底池**：\`${formatMeso(betData.seedMoney || 0)}\`\n` +
      `⏳ **截止時間**：<t:${Math.floor(betData.deadline / 1000)}:R> | 💰 **總獎池**：\`${formatMeso(totalPool)} 楓幣\`\n` +
      `狀態：${betData.isPaused ? '⏸️ **暫停下注**' : (isExpired ? '🔴 **已截止**' : '🟢 **下注進行中**')}\n━━━━━━━━━━━━━━━━━━━━`
    );

  betData.options.forEach(opt => {
    const odds = (opt.pool > 0) ? (totalPool / opt.pool).toFixed(2) : (totalPool > 0 ? '超高賠率' : '1.00');
    embed.addFields({ name: opt.name, value: `💵 彩池：\`${formatMeso(opt.pool || 0)}\`\n📈 賠率：\`${odds}x\``, inline: true });
  });
  return embed;
}

function createMultiBetComponents(betId, options, isScroll = false) {
  const isMulti = options.length > 3 || isScroll;
  if (!isMulti) {
    const r1 = new ActionRowBuilder();
    options.forEach((opt, idx) => r1.addComponents(new ButtonBuilder().setCustomId(`bet_quick_${betId}_${idx}`).setLabel(`${opt.name} (+100w)`).setStyle(ButtonStyle.Primary)));
    r1.addComponents(new ButtonBuilder().setCustomId(`bet_custom_btn_${betId}`).setLabel('✏️ 自訂').setStyle(ButtonStyle.Success));
    const r2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_pity_donate_${betId}`).setLabel('🩹 同情抖內').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bet_settle_btn_${betId}`).setLabel('⚖️ 結算').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_admin_delete_${betId}`).setLabel('🗑️ 廢除').setStyle(ButtonStyle.Danger)
    );
    return [r1, r2];
  } else {
    const selectOptions = options.map((opt, idx) => new StringSelectMenuOptionBuilder().setLabel(opt.name.substring(0, 100)).setValue(`${idx}`));
    const r1 = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`bet_select_opt_${betId}`).setPlaceholder('🔽 選擇投注選項').addOptions(selectOptions.slice(0, 25)));
    const r2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_act_100w_${betId}`).setLabel('💵 +100w').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_custom_btn_${betId}`).setLabel('✏️ 自訂').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bet_pity_donate_${betId}`).setLabel('🩹 同情抖內').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bet_settle_btn_${betId}`).setLabel('⚖️ 結算').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_admin_delete_${betId}`).setLabel('🗑️ 廢除').setStyle(ButtonStyle.Danger)
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

// ==========================================
// 5. Web Server & Discord 斜線指令註冊
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Auto-Bot Online!'));
app.listen(process.env.PORT || 3000, () => console.log('✅ Web Server Online'));

const commands = [
  new SlashCommandBuilder()
    .setName('角色狀態')
    .setDescription('共用帳號管理')
    .addSubcommand(sub => sub.setName('儀表板').setDescription('查看與切換共用/借用角色的上線狀態 (私密)'))
    .addSubcommand(sub =>
      sub.setName('授權')
        .setDescription('授權指定成員借用您的特定角色')
        .addStringOption(o => o.setName('角色名稱').setDescription('填寫要授權的角色ID').setRequired(true))
        .addUserOption(o => o.setName('對象成員').setDescription('選擇要授權的成員 (@成員)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('撤銷')
        .setDescription('收回指定成員對角色的借用權限')
        .addStringOption(o => o.setName('角色名稱').setDescription('填寫要收回的角色ID').setRequired(true))
        .addUserOption(o => o.setName('對象成員').setDescription('選擇要撤銷權限的成員 (@成員)').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('放圖')
    .setDescription('發起熱門地圖交接/放圖')
    .addStringOption(o => o.setName('地圖名稱').setDescription('例如：忘卻6、蛋龍').setRequired(true))
    .addIntegerOption(o => o.setName('頻道').setDescription('頻道號碼').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('預計多久離開').setDescription('例如：10分鐘後、21:30').setRequired(true))
    .addStringOption(o => o.setName('備註說明').setDescription('選填說明').setRequired(false)),

  new SlashCommandBuilder()
    .setName('揪團')
    .setDescription('社群組隊發起')
    .addSubcommand(sub =>
      sub.setName('團練')
        .setDescription('發起一般團練')
        .addStringOption(o => o.setName('地點').setDescription('例如：忘卻6、蛋龍').setRequired(true))
        .addStringOption(o => o.setName('開打時間').setDescription('例如：今晚 8 點').setRequired(true))
        .addStringOption(o => o.setName('綁定需求').setDescription('選填需求').setRequired(false))
        .addStringOption(o => o.setName('自備機台').setDescription('支援裝置').setRequired(false))
        .addIntegerOption(o => o.setName('需要人數').setDescription('人數預設 6 人').setRequired(false).setMinValue(2).setMaxValue(30))
    )
    .addSubcommand(sub =>
      sub.setName('突襲')
        .setDescription('發起 Boss 遠征')
        .addStringOption(o => o.setName('目標王').setDescription('例如：闇黑龍王、炎魔').setRequired(true))
        .addStringOption(o => o.setName('開打時間').setDescription('開打時間').setRequired(true))
        .addIntegerOption(o => o.setName('需要人數').setDescription('人數預設 6 人').setRequired(false).setMinValue(2).setMaxValue(30))
    )
    .addSubcommand(sub =>
      sub.setName('組隊任務')
        .setDescription('發起組隊任務 (PQ)')
        .addStringOption(o => o.setName('任務名稱').setDescription('例如：羅密歐、101').setRequired(true))
        .addIntegerOption(o => o.setName('人數').setDescription('需要人數').setRequired(true).setMinValue(2).setMaxValue(6))
        .addStringOption(o => o.setName('開打時間').setDescription('開打時間').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('賭局')
    .setDescription('社群競猜系統')
    .addSubcommand(sub =>
      sub.setName('技能書')
        .setDescription('技能書二選一賭局')
        .addStringOption(o => o.setName('技能書名稱').setDescription('例如：三飛閃30').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('例如：15m、21:30').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('例如：500w').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('衝卷')
        .setDescription('裝備衝卷或數值落點盤')
        .addStringOption(o => o.setName('裝備名稱').setDescription('例如：紫色衝浪板').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('例如：15m、20:00').setRequired(true))
        .addIntegerOption(o => o.setName('最大卷數').setDescription('過卷上限 (預設 7)').setRequired(false).setMinValue(1).setMaxValue(10))
        .addStringOption(o => o.setName('選項1').setDescription('自訂選項 1').setRequired(false))
        .addStringOption(o => o.setName('選項2').setDescription('自訂選項 2').setRequired(false))
        .addStringOption(o => o.setName('選項3').setDescription('自訂選項 3').setRequired(false))
        .addStringOption(o => o.setName('選項4').setDescription('自訂選項 4').setRequired(false))
        .addStringOption(o => o.setName('底池金額').setDescription('例如：500w').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('打寶')
        .setDescription('打寶競猜')
        .addStringOption(o => o.setName('目標玩家').setDescription('目標玩家ID').setRequired(true))
        .addStringOption(o => o.setName('打寶門檻').setDescription('例如：價值 1000w 以上寶物').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('例如：1h、2h').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('例如：500w').setRequired(false))
    ),

  new SlashCommandBuilder()
    .setName('查看')
    .setDescription('統一查詢中心')
    .addStringOption(o => o.setName('類別').setDescription('選擇要查看的項目').setRequired(true)
      .addChoices(
        { name: '⚔️ 團練', value: 'VIEW_TRAINING' },
        { name: '🐉 突襲', value: 'VIEW_RAID' },
        { name: '🧩 組隊任務', value: 'VIEW_PQ' },
        { name: '📜 全部揪團', value: 'VIEW_ALL_PARTIES' },
        { name: '🎲 賭局', value: 'VIEW_BET' }
      )
    ),

  new SlashCommandBuilder().setName('幸運頻道').setDescription('抽取幸運頻道')
    .addIntegerOption(o => o.setName('最大頻道').setDescription('最大頻道數').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('報到').setDescription('【管理員專用】發送報到面板').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('職業查詢').setDescription('依職業查看成員名冊')
    .addStringOption(o => o.setName('職業名稱').setDescription('選擇職業').setRequired(false)
      .addChoices(
        { name: '📋 全部名冊 (依職業分組)', value: 'ALL_JOBS_LIST' },
        ...Object.keys(ROLES.JOBS).map(j => ({ name: j, value: j }))
      )),
  new SlashCommandBuilder().setName('個人名片').setDescription('查看自己的名冊資料')
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
      const now = new Date();
      if (now.getDate() === 1 && db) {
        const snap = await db.collection('member_profiles').get();
        const regUids = new Set();
        snap.forEach(d => regUids.add(d.data().userId));
        for (const guild of client.guilds.cache.values()) {
          const members = await guild.members.fetch().catch(() => null);
          if (members) {
            for (const m of members.values()) {
              if (!m.user.bot && !regUids.has(m.id)) {
                await m.roles.add(ROLES.UNVERIFIED).catch(() => {});
                await m.send(`📢 **【公會每月例行提醒】** 請前往 <#${WELCOME_REGISTER_CHANNEL_ID}> 或輸入 \`/報到\` 登記名冊！`).catch(() => {});
              }
            }
          }
        }
      }
    } catch (e) { console.error('排程稽核異常:', e.message); }
  }, { timezone: 'Asia/Taipei' });
});

client.on(Events.GuildMemberAdd, async (member) => {
  member.roles.add(ROLES.UNVERIFIED).catch(() => {});
  try {
    const welcome = await client.channels.fetch(WELCOME_REGISTER_CHANNEL_ID).catch(() => null);
    if (welcome && welcome.isTextBased()) {
      const embed = new EmbedBuilder().setColor(0x57F287).setTitle('🎉 歡迎新冒險家！').setDescription(`歡迎 <@${member.id}> 加入！請點擊下方按鈕完成 **名冊登記**！`);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_new_member_register').setLabel('📝 點我報到').setStyle(ButtonStyle.Success));
      await welcome.send({ content: `<@${member.id}>`, embeds: [embed], components: [row] });
    }
  } catch {}
});

// ==========================================
// 6. 互動事件監聽
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // 1. /角色狀態
      if (commandName === '角色狀態') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const sub = interaction.options.getSubcommand();

        if (sub === '儀表板') {
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
          if (!display.length) return interaction.editReply('📜 您尚未在 `/報到` 登記角色，或未獲借用授權。');

          const selectOptions = display.slice(0, 25).map(c =>
            new StringSelectMenuOptionBuilder().setLabel(c.label.substring(0, 100)).setValue(`char_select_${c.ign}`)
          );
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_char_status_dashboard').setPlaceholder('🔽 選擇角色查看狀態').addOptions(selectOptions)
          );
          return await interaction.editReply({ content: '👉 **請選擇要查看狀態的角色：**', components: [row] });
        }

        if (sub === '授權' || sub === '撤銷') {
          await interaction.deferReply({ ephemeral: true });
          const targetIgn = interaction.options.getString('角色名稱').trim();
          const targetUser = interaction.options.getUser('對象成員');
          const statusDoc = await getCharStatusDoc(targetIgn);

          if (!statusDoc) return interaction.editReply(`❌ 找不到角色【**${targetIgn}**】！`);
          const isOwner = (statusDoc.owners || []).includes(interaction.user.id) || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
          if (!isOwner) return interaction.editReply(`❌ 您不是【**${targetIgn}**】的所有權人！`);

          let auths = statusDoc.authorizedUsers || [];
          if (sub === '授權') {
            if (!auths.includes(targetUser.id)) auths.push(targetUser.id);
          } else {
            auths = auths.filter(u => u !== targetUser.id);
          }
          await db.collection('char_statuses').doc(targetIgn.toLowerCase()).update({ authorizedUsers: auths });
          return await interaction.editReply(`✅ 已成功對 <@${targetUser.id}> ${sub === '授權' ? '授權' : '收回'}角色【**${targetIgn}**】借用權限！`);
        }
      }

      // 2. /放圖
      if (commandName === '放圖') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply();
        const mapName = interaction.options.getString('地圖名稱');
        const channelNum = interaction.options.getInteger('頻道');
        const leaveTime = interaction.options.getString('預計多久離開');
        const note = interaction.options.getString('備註說明') || '無特殊備註';

        const mapRef = db.collection('map_shares').doc();
        const mapData = { id: mapRef.id, creatorId: interaction.user.id, mapName, channelNum, leaveTime, note, takerId: null, isFinished: false };
        const msg = await interaction.editReply({ embeds: [createMapShareEmbed(mapData)], components: createMapShareComponents(mapRef.id, mapData) });
        mapData.channelId = interaction.channelId;
        mapData.messageId = msg.id;
        await mapRef.set(mapData);
        return;
      }

      // 3. /揪團 (發起)
      if (commandName === '揪團') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();
        let partyType = 'training', target, startTime, bindReq = '無', creatorDevice = '無自備', duration = '配合隊伍', maxCount = 6;

        if (sub === '團練') {
          target = interaction.options.getString('地點');
          startTime = interaction.options.getString('開打時間');
          bindReq = interaction.options.getString('綁定需求') || '無';
          creatorDevice = interaction.options.getString('自備機台') || '無自備';
          maxCount = interaction.options.getInteger('需要人數') || 6;
        } else if (sub === '突襲') {
          partyType = 'raid';
          target = interaction.options.getString('目標王');
          startTime = interaction.options.getString('開打時間');
          maxCount = interaction.options.getInteger('需要人數') || 6;
        } else if (sub === '組隊任務') {
          partyType = 'pq';
          target = interaction.options.getString('任務名稱');
          maxCount = interaction.options.getInteger('人數');
          startTime = interaction.options.getString('開打時間');
        }

        const pRef = db.collection('party_trainings').doc();
        const pData = { id: pRef.id, creatorId: interaction.user.id, partyType, target, startTime, bindReq, creatorDevice, duration, maxCount, members: [], isClosed: false, createdAt: admin.firestore.FieldValue.serverTimestamp() };
        const msg = await interaction.editReply({ embeds: [createPartyEmbed(pData)], components: createPartyComponents(pRef.id, false) });
        pData.channelId = interaction.channelId;
        pData.messageId = msg.id;
        await pRef.set(pData);
        return;
      }

      // 4. /賭局 (發起)
      if (commandName === '賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const activeBet = await getActiveBetDoc();
        if (activeBet) return interaction.reply({ content: '⚠️ 目前已有進行中的賭局，請先等待結算！', ephemeral: true });

        await interaction.deferReply();
        const sub = interaction.options.getSubcommand();
        let title, options = [], deadline, seedMoney = parseMoneyInput(interaction.options.getString('底池金額')), betType = 'book';

        if (sub === '技能書') {
          const bookName = interaction.options.getString('技能書名稱');
          deadline = parseDeadline(interaction.options.getString('截止時間'));
          title = `【${bookName}】能不能點過？`;
          options = [{ name: '🟢 會過', pool: 0, bets: {} }, { name: '🔴 爆掉', pool: 0, bets: {} }];
        } else if (sub === '衝卷') {
          betType = 'scroll';
          const equip = interaction.options.getString('裝備名稱');
          deadline = parseDeadline(interaction.options.getString('截止時間'));
          const maxScroll = interaction.options.getInteger('最大卷數') || 7;
          const custom = [1,2,3,4].map(i => interaction.options.getString(`選項${i}`)).filter(Boolean);
          if (custom.length >= 2) {
            title = `【${equip}】自訂數值落點盤`;
            options = custom.map(c => ({ name: `🎯 ${c}`, pool: 0, bets: {} }));
          } else {
            title = `【${equip}】能過幾卷？(上限 +${maxScroll})`;
            for (let i = 0; i <= maxScroll; i++) options.push({ name: i === 0 ? '💀 +0 (全爆)' : (i === maxScroll ? `👑 +${i} (完美)` : `+${i} 卷`), pool: 0, bets: {} });
          }
        } else if (sub === '打寶') {
          betType = 'loot';
          const target = interaction.options.getString('目標玩家');
          const goal = interaction.options.getString('打寶門檻');
          deadline = parseDeadline(interaction.options.getString('截止時間'));
          title = `【${target}】能否打到寶？門檻：${goal}`;
          options = [{ name: `🟢【大豐收】成功打到 (${goal})`, pool: 0, bets: {} }, { name: `🔴【大暴死】槓龜`, pool: 0, bets: {} }];
        }

        if (!deadline) return interaction.editReply('❌ 時間格式無效！請輸入如 `15m`、`1h`、`21:30`。');
        const bRef = db.collection('active_bets').doc();
        const bData = { id: bRef.id, creatorId: interaction.user.id, creatorName: interaction.user.username, betType, title, options, deadline, seedMoney, pityDonations: {}, isScroll: betType === 'scroll', isSettled: false, isPaused: false };
        await bRef.set(bData);
        return await interaction.editReply({ embeds: [createMultiBetEmbed(bData)], components: createMultiBetComponents(bRef.id, options, bData.isScroll) });
      }

      // 5. /查看
      if (commandName === '查看') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const view = interaction.options.getString('類別');
        await interaction.deferReply();

        if (view === 'VIEW_BET') {
          const doc = await getActiveBetDoc();
          if (!doc) return interaction.editReply('🎲 目前沒有進行中的賭局。');
          const d = doc.data();
          return await interaction.editReply({ embeds: [createMultiBetEmbed(d)], components: createMultiBetComponents(d.id, d.options, d.isScroll) });
        }

        const snap = await db.collection('party_trainings').where('isClosed', '==', false).get();
        if (snap.empty) return interaction.editReply('📜 目前沒有招募中的隊伍。');

        const now = Date.now();
        let list = [];
        for (const doc of snap.docs) {
          const d = doc.data();
          if (now - (d.createdAt?.toMillis?.() || now) > 43200000) {
            await db.collection('party_trainings').doc(d.id).update({ isClosed: true }).catch(() => {});
          } else {
            list.push(d);
          }
        }

        if (view === 'VIEW_TRAINING') list = list.filter(p => p.partyType === 'training');
        else if (view === 'VIEW_RAID') list = list.filter(p => p.partyType === 'raid');
        else if (view === 'VIEW_PQ') list = list.filter(p => p.partyType === 'pq');

        if (!list.length) return interaction.editReply('📜 該分類目前沒有進行中的隊伍。');

        const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('⚔️【進行中揪團總覽】');
        const selectOptions = [];
        list.slice(0, 5).forEach((d, i) => {
          embed.addFields({ name: `${i + 1}. 📍 ${d.target} (${(d.members || []).length}/${d.maxCount}人)`, value: `⏰ **時間**：\`${d.startTime}\` | 隊長: <@${d.creatorId}>`, inline: false });
          selectOptions.push(new StringSelectMenuOptionBuilder().setLabel(`${i + 1}. 報名【${d.target}】`.substring(0, 100)).setValue(`party_view_join_${d.id}`));
        });

        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_party_to_join').setPlaceholder('🔽 點此加入其中一團').addOptions(selectOptions));
        return await interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (commandName === '幸運頻道') {
        const max = interaction.options.getInteger('最大頻道');
        return await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('🎲 今日幸運頻道').setDescription(`✨ **第 ${Math.floor(Math.random() * max) + 1} 頻道**`)] });
      }

      if (commandName === '報到') {
        return await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('📝 冒險家報到').setDescription('請在下方下拉選單選擇主要職業！')], components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_job_register').setPlaceholder('🔽 請選擇主要職業').addOptions([
              ...Object.keys(ROLES.JOBS).map(j => new StringSelectMenuOptionBuilder().setLabel(j).setValue(j)),
              new StringSelectMenuOptionBuilder().setLabel('💤 暫.退休').setValue('RETIRED_OPTION')
            ])
          )
        ] });
      }

      if (commandName === '職業查詢') {
        await interaction.deferReply();
        const j = interaction.options.getString('職業名稱') || 'ALL_JOBS_LIST';
        return await interaction.editReply({ embeds: [await generateJobEmbed(j)] });
      }

      if (commandName === '個人名片') {
        await interaction.deferReply({ ephemeral: true });
        const d = await fetchUserDocSafe(interaction.user.id);
        if (!d.mainIgn) return interaction.editReply('📜 您尚未建立名冊資料，請透過 `/報到` 登記。');
        const subList = (d.subs || []).map((s, i) => `${i + 1}. \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n') || '無';
        const embed = new EmbedBuilder().setColor(0x3498DB).setTitle(`🪪 冒險家名片 - ${d.mainIgn}`)
          .addFields({ name: '👑 本尊', value: `${d.mainJob} (Lv.${d.mainLevel})`, inline: true }, { name: '⏱️ 時間', value: d.playtime || '未填', inline: true }, { name: '⚔️ 分身', value: subList, inline: false });
        return await interaction.editReply({ embeds: [embed] });
      }
    }

    // ----------------------------------------
    // [B] 按鈕處理
    // ----------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId === 'btn_new_member_register') {
        const prev = await fetchUserDocSafe(interaction.user.id);
        userChoiceMap.set(interaction.user.id, Object.keys(ROLES.JOBS)[0]);
        return await interaction.showModal(createRegisterModal(Object.keys(ROLES.JOBS)[0], prev));
      }

      // 地圖放圖操作
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

      // 角色狀態按鈕
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
        return await interaction.editReply(`✅ 角色【**${ign}**】已釋放為【🟢 閒置中】！`);
      }

      if (customId.startsWith('char_act_knock_')) {
        const ign = customId.replace('char_act_knock_', '');
        const modal = new ModalBuilder().setCustomId(`modal_char_knock_${ign}`).setTitle(`敲門提醒 - 【${ign}】`);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_knock_minutes').setLabel('預計幾分鐘後使用？(最低 10 分)').setValue('15').setStyle(TextInputStyle.Short).setRequired(true)));
        return await interaction.showModal(modal);
      }

      // 揪團按鈕
      if (customId.startsWith('party_join_')) {
        const pId = customId.replace('party_join_', '');
        const prev = await fetchUserDocSafe(interaction.user.id);
        const rows = [];
        const r1 = new ActionRowBuilder();
        if (prev.mainIgn) r1.addComponents(new ButtonBuilder().setCustomId(`party_reg_char_${pId}_main`).setLabel(`👑 本尊：${prev.mainIgn}`.substring(0, 80)).setStyle(ButtonStyle.Success));
        (prev.subs || []).slice(0, 3).forEach((s, idx) => r1.addComponents(new ButtonBuilder().setCustomId(`party_reg_char_${pId}_sub_${idx}`).setLabel(`⚔️ ${s.ign}`.substring(0, 80)).setStyle(ButtonStyle.Primary)));
        if (r1.components.length) rows.push(r1);
        rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`party_reg_char_${pId}_custom`).setLabel('✏️ 自訂角色報名').setStyle(ButtonStyle.Secondary)));
        return await interaction.reply({ content: '👉 **請選擇報名角色：**', components: rows, ephemeral: true });
      }

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

      if (customId.startsWith('party_leave_') || customId.startsWith('party_close_')) {
        await interaction.deferReply({ ephemeral: true });
        const isClose = customId.startsWith('party_close_');
        const pId = customId.replace(isClose ? 'party_close_' : 'party_leave_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const d = doc.data();

        if (isClose) {
          if (d.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.editReply('❌ 只有隊長可關閉揪團！');
          await db.collection('party_trainings').doc(pId).update({ isClosed: true });
          d.isClosed = true;
        } else {
          d.members = (d.members || []).filter(m => m.userId !== interaction.user.id);
          await db.collection('party_trainings').doc(pId).update({ members: d.members });
        }

        if (d.channelId && d.messageId) {
          const ch = await client.channels.fetch(d.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(d.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createPartyEmbed(d)], components: createPartyComponents(pId, d.isClosed) });
          }
        }
        return await interaction.editReply(isClose ? '🔒 揪團已關閉！' : '✅ 已取消報名！');
      }

      // 賭局按鈕
      if (customId.startsWith('bet_settle_btn_') || customId.startsWith('bet_admin_delete_')) {
        await interaction.deferReply({ ephemeral: true });
        const isDelete = customId.startsWith('bet_admin_delete_');
        const bId = customId.replace(isDelete ? 'bet_admin_delete_' : 'bet_settle_btn_', '');
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局不存在。');
        const d = doc.data();

        if (isDelete) {
          if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.editReply('❌ 僅管理員可廢除賭局！');
          await db.collection('active_bets').doc(bId).delete();
          return await interaction.editReply('🗑️ 賭局已廢除！');
        }

        if (d.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.editReply('❌ 只有發起人可結算！');
        const selectOptions = d.options.map((opt, i) => new StringSelectMenuOptionBuilder().setLabel(`🏆 勝方：${opt.name}`).setValue(`${i}`));
        return await interaction.editReply({
          content: '⚖️ **請選擇最終獲勝選項進行派彩：**',
          components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`settle_finalize_${bId}`).setPlaceholder('選擇獲勝選項').addOptions(selectOptions))]
        });
      }

      if (customId.startsWith('bet_quick_') || customId.startsWith('bet_act_100w_')) {
        await interaction.deferReply({ ephemeral: true });
        const parts = customId.split('_');
        const bId = parts[2];
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局已失效。');
        const d = doc.data();

        let optIdx = customId.startsWith('bet_quick_') ? parseInt(parts[3]) : userChoiceMap.get(`bet_choice_${interaction.user.id}_${bId}`);
        if (optIdx === undefined || isNaN(optIdx)) return interaction.editReply('⚠️ 請先在上方選單選擇你要投注的選項！');

        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.mainIgn || interaction.user.displayName;
        const cur = d.options[optIdx].bets[interaction.user.id]?.amount || 0;
        d.options[optIdx].bets[interaction.user.id] = { ign, amount: cur + 1000000 };
        d.options[optIdx].pool = (d.options[optIdx].pool || 0) + 1000000;

        await db.collection('active_bets').doc(bId).update({ options: d.options });
        return await interaction.editReply(`✅ 成功為 **${d.options[optIdx].name}** 下注 \`+100 萬 楓幣\`！`);
      }

      if (customId.startsWith('bet_custom_btn_')) {
        const bId = customId.replace('bet_custom_btn_', '');
        const modal = new ModalBuilder().setCustomId(`modal_bet_custom_${bId}`).setTitle('自訂下注金額');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_bet_choice').setLabel('選項編號 (例如: 1)').setValue('1').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_bet_amount').setLabel('下注金額 (例如: 500w)').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('bet_pity_donate_')) {
        const bId = customId.replace('bet_pity_donate_', '');
        const modal = new ModalBuilder().setCustomId(`modal_pity_donate_${bId}`).setTitle('🩹 同情救濟');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_pity_amount').setLabel('救濟金額 (例如: 100w)').setStyle(TextInputStyle.Short).setRequired(true)));
        return await interaction.showModal(modal);
      }
    }

    // ----------------------------------------
    // [C] 下拉選單處理
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;

      if (customId === 'select_char_status_dashboard') {
        await interaction.deferReply({ ephemeral: true });
        const ign = interaction.values[0].replace('char_select_', '');
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

      if (customId.startsWith('bet_select_opt_')) {
        const bId = customId.replace('bet_select_opt_', '');
        userChoiceMap.set(`bet_choice_${interaction.user.id}_${bId}`, parseInt(interaction.values[0]));
        return await interaction.reply({ content: `👉 已選中第 ${parseInt(interaction.values[0]) + 1} 個選項！`, ephemeral: true });
      }

      if (customId.startsWith('settle_finalize_')) {
        await interaction.deferReply();
        const bId = customId.replace('settle_finalize_', '');
        const winIdx = parseInt(interaction.values[0]);
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局已失效。');
        const d = doc.data();

        let pPool = 0, winPool = d.options[winIdx].pool || 0;
        d.options.forEach(o => pPool += (o.pool || 0));
        const total = pPool + (d.seedMoney || 0);
        const bonus = total - winPool;

        const balances = {};
        if (d.seedMoney > 0) balances[d.creatorId] = { ign: d.creatorName || '發起人底池', net: -d.seedMoney };
        d.options.forEach(o => {
          Object.entries(o.bets || {}).forEach(([uid, b]) => {
            if (!balances[uid]) balances[uid] = { ign: b.ign, net: 0 };
            balances[uid].net -= b.amount;
          });
        });

        const winBets = Object.entries(d.options[winIdx].bets || {});
        winBets.forEach(([uid, b]) => {
          const share = winPool > 0 ? (b.amount / winPool) * bonus : 0;
          balances[uid].net += (b.amount + Math.floor(share));
        });

        const transfers = calculateMinTransfers(balances);
        let tGuide = `🧾 **【最少交易轉帳清單】**\n` + (transfers.length ? transfers.map((t, i) => `${i + 1}. ➡️ **${t.from}** 交易給 **${t.to}**：\`${formatMeso(t.amount)} 楓幣\``).join('\n') : '• 無需轉帳');

        await db.collection('active_bets').doc(bId).update({ isSettled: true });
        const embed = new EmbedBuilder().setColor(0xF1C40F).setTitle(`🎉【結算】${d.title}`).setDescription(`🏆 勝方：**【${d.options[winIdx].name}】**\n總彩池：\`${formatMeso(total)} 楓幣\`\n\n${tGuide}`);
        return await interaction.editReply({ embeds: [embed] });
      }

      if (customId === 'select_job_register') {
        const val = interaction.values[0];
        const prev = await fetchUserDocSafe(interaction.user.id);
        if (val === 'RETIRED_OPTION') {
          await db.collection('member_profiles').doc(interaction.user.id).set({ userId: interaction.user.id, isRetired: true }, { merge: true });
          return await interaction.reply({ content: '💤 已切換為退休狀態！', ephemeral: true });
        }
        userChoiceMap.set(interaction.user.id, val);
        return await interaction.showModal(createRegisterModal(val, prev));
      }
    }

    // ----------------------------------------
    // [D] Modal 提交
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

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
        const min = Math.max(10, parseInt(interaction.fields.getTextInputValue('input_knock_minutes')) || 15);
        const doc = await getCharStatusDoc(ign);
        if (!doc?.isOnline) return interaction.editReply('💡 角色目前閒置中，可直接登記！');

        const u = await client.users.fetch(doc.currentUserId).catch(() => null);
        if (u) {
          await u.send(`🔔 **【共用提醒】** <@${interaction.user.id}> 預計在 **\`${min} 分鐘後\`** 使用【**${ign}**】，請留意換手！`).catch(() => {});
          return await interaction.editReply(`✅ 已私訊提醒目前使用者 <@${doc.currentUserId}>！`);
        }
        return await interaction.editReply(`⚠️ 對方關閉了私訊，請直接在頻道中 @ 他！`);
      }

      if (customId.startsWith('modal_party_buffs_')) {
        await interaction.deferReply({ ephemeral: true });
        const pId = customId.replace('modal_party_buffs_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        const raw = interaction.fields.getTextInputValue('input_char_info').split(/[/\\|\s,，_-]+/);
        const ign = raw[0] || interaction.user.displayName, job = raw[1] || '冒險家', lv = raw[2] || '120';
        const buffs = { '楓祝': interaction.fields.getTextInputValue('input_maple_buff') || '滿' };

        const defined = JOB_BUFFS[job] || [];
        if (defined[0]) buffs[defined[0]] = interaction.fields.getTextInputValue('input_job_buff_1') || '滿';
        if (defined[1]) buffs[defined[1]] = interaction.fields.getTextInputValue('input_job_buff_2') || '滿';

        const extraDevice = interaction.fields.getTextInputValue('input_extra_device') || '';
        const members = (pData.members || []).filter(m => !(m.userId === interaction.user.id && m.ign === ign));
        members.push({ userId: interaction.user.id, ign, job, level: lv, buffs, extraDevice });

        await db.collection('party_trainings').doc(pId).update({ members });
        if (pData.channelId && pData.messageId) {
          const ch = await client.channels.fetch(pData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(pData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createPartyEmbed({ ...pData, members })] });
          }
        }
        return await interaction.editReply(`🎉 成功加入揪團！角色：\`${ign}\` (${job} Lv.${lv})`);
      }

      if (customId === 'modal_register_page1') {
        await interaction.deferReply();
        const mainIgn = interaction.fields.getTextInputValue('input_main_ign').trim();
        const mainLevel = interaction.fields.getTextInputValue('input_main_level').replace(/[^0-9]/g, '') || '1';
        const playtime = interaction.fields.getTextInputValue('input_playtime').trim();
        const mainJob = userChoiceMap.get(interaction.user.id) || '黑騎士';

        const s1 = interaction.fields.getTextInputValue('input_subs_1_2').split('\n');
        const s2 = interaction.fields.getTextInputValue('input_subs_3_4').split('\n');
        const subs = [...s1, ...s2].map(parseSubCharacter).filter(Boolean);

        if (db) {
          await db.collection('member_profiles').doc(interaction.user.id).set({
            userId: interaction.user.id, mainIgn, mainJob, mainLevel, playtime, subs, isRetired: false, timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

          // 自動拆分獨立為本尊與小號建檔
          const allChars = [{ ign: mainIgn, job: mainJob }, ...subs];
          for (const c of allChars) {
            const sDoc = await getCharStatusDoc(c.ign);
            const owners = sDoc?.owners || [];
            if (!owners.includes(interaction.user.id)) owners.push(interaction.user.id);
            await db.collection('char_statuses').doc(c.ign.toLowerCase()).set({
              charIgn: c.ign, job: c.job, owners, authorizedUsers: sDoc?.authorizedUsers || [], isOnline: sDoc?.isOnline || false
            }, { merge: true });
          }
        }

        try {
          const m = await interaction.guild.members.fetch(interaction.user.id);
          await m.roles.add(ROLES.VERIFIED).catch(() => {});
          if (ROLES.JOBS[mainJob]) await m.roles.add(ROLES.JOBS[mainJob]).catch(() => {});
          await m.setNickname(`[${mainLevel}_${mainJob}] ${mainIgn}`.substring(0, 32)).catch(() => {});
        } catch {}

        return await interaction.editReply(`🎉 名冊已成功更新！本尊：\`${mainIgn}\` (${mainJob} Lv.${mainLevel})`);
      }

      if (customId.startsWith('modal_bet_custom_')) {
        await interaction.deferReply({ ephemeral: true });
        const bId = customId.replace('modal_bet_custom_', '');
        const optIdx = parseInt(interaction.fields.getTextInputValue('input_bet_choice')) - 1;
        const amt = parseMoneyInput(interaction.fields.getTextInputValue('input_bet_amount'));
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局不存在。');
        const d = doc.data();

        if (isNaN(optIdx) || optIdx < 0 || optIdx >= d.options.length || amt <= 0) return interaction.editReply('❌ 選項或金額無效！');
        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.mainIgn || interaction.user.displayName;
        const cur = d.options[optIdx].bets[interaction.user.id]?.amount || 0;
        d.options[optIdx].bets[interaction.user.id] = { ign, amount: cur + amt };
        d.options[optIdx].pool = (d.options[optIdx].pool || 0) + amt;

        await db.collection('active_bets').doc(bId).update({ options: d.options });
        return await interaction.editReply(`✅ 成功為 **${d.options[optIdx].name}** 下注 \`${formatMeso(amt)} 楓幣\`！`);
      }
    }
  } catch (err) {
    console.error('互動處理錯誤:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
