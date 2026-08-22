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
  WARDEN_200: '1540337376994402376',
  JOBS: {
    '黑騎士': '1540050432796266526', '聖騎士': '1540051178396844153', '英雄': '1540051228459929631',
    '箭神': '1540051260005154967', '神射手': '1540051322525716601', '冰雷': '1540051347376832594',
    '火毒': '1540051370416017449', '主教': '1540051392138444880', '槍神': '1540051430050897921',
    '拳霸': '1540051450904969317', '刀賊': '1540051596518494228', '鏢賊': '1540051618345652275'
  }
};

// 職業核心 Buff 圖示與名稱
const JOB_BUFFS = {
  '黑騎士': ['🔥神聖之火', '🛡️力量消除'],
  '聖騎士': ['🛡️魔法消除'],
  '英雄': ['⚔️激勵'],
  '箭神': ['🎯會心之眼'],
  '神射手': ['🎯會心之眼'],
  '主教': ['✨神聖祈禱', '👼天使祝福'],
  '冰雷': ['🧠精神強化'],
  '火毒': ['🧠精神強化'],
  '鏢賊': ['⚡速', '🤑幸運術'],
  '刀賊': ['⚡速'],
  '拳霸': ['🥊最終極速'],
  '槍神': []
};

const userChoiceMap = new Map();

// 搞笑救濟文案庫
const DONOR_ACTIONS = [
  "救濟了發起人一碗暖心熱湯", "贊助了一整包強力吸水面紙", "請喝了一杯全糖壓驚珍奶",
  "施捨了一張回村卷軸買水錢", "送上一份心靈創傷慰問金", "贊助鐵匠維修槌磨損費"
];

function getRandomDonorAction() {
  return DONOR_ACTIONS[Math.floor(Math.random() * DONOR_ACTIONS.length)];
}

const PITY_TEXTS = {
  scroll: ["贊助苦主買包面紙擦眼淚...", "全爆補助金：給老哥買碗熱湯喝...", "給鐵匠維修槌子的磨損費..."],
  book: ["贊助苦主吸收技能書灰燼的心理治療費...", "技能書爆破受害者保護協會慰問金...", "給可憐人買本初級教科書冷靜一下..."]
};

function getRandomPity(type) {
  const list = PITY_TEXTS[type] || PITY_TEXTS.scroll;
  return list[Math.floor(Math.random() * list.length)];
}

// ==========================================
// 2. 輔助工具函式
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
      transfers.push({ from: debtor.ign, to: creditor.ign, amount: transferAmount });
      debtor.amount -= transferAmount;
      creditor.amount -= transferAmount;
    }
    if (debtor.amount === 0) dIdx++;
    if (creditor.amount === 0) cIdx++;
  }
  return transfers;
}

// ==========================================
// 3. 團練揪團 UI 與資料建構
// ==========================================

function createPartyEmbed(partyData) {
  const members = partyData.members || [];
  const isFull = members.length >= partyData.maxCount;
  const isClosed = partyData.isClosed;

  const buffPool = [];
  const extraDevices = [];
  members.forEach(m => {
    Object.entries(m.buffs || {}).forEach(([bName, bLv]) => buffPool.push(`${bName}(${bLv})`));
    if (m.extraDevice) extraDevices.push(`${m.ign} 提供: ${m.extraDevice}`);
  });

  const uniqueBuffSummary = buffPool.length > 0 ? buffPool.join(' | ') : '尚未有任何 Buff';

  let memberListText = members.length === 0 ? '• 目前尚無成員加入' : '';
  members.forEach((m, idx) => {
    const buffs = Object.entries(m.buffs || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    memberListText += `${idx + 1}. **${m.ign}** (${m.job} Lv.${m.level}) - <@${m.userId}>\n   └ 💡 技能：\`${buffs || '無'}\`${m.extraDevice ? `\n   └ 📱 自帶支援：\`${m.extraDevice}\`` : ''}\n`;
  });

  return new EmbedBuilder()
    .setColor(isClosed ? 0x95A5A6 : (isFull ? 0xF1C40F : 0x3498DB))
    .setTitle(`⚔️【冒險者團練揪團】${partyData.target}`)
    .setDescription(
      `👑 **主揪隊長**：<@${partyData.creatorId}>\n` +
      `⏰ **開打時間**：\`${partyData.startTime}\`\n` +
      `📌 **綁定限制**：\`${partyData.bindReq || '無限制'}\`\n` +
      `📱 **主揪自備機**：\`${partyData.creatorDevice || '無'}\`\n` +
      `⏱️ **備註時長**：\`${partyData.duration || '無備註'}\`\n` +
      `👥 **隊伍人數**：\`${members.length} / ${partyData.maxCount} 人\` ${isFull ? '🔴 **(已滿員)**' : '🟢 **(招募中)**'}\n` +
      `✨ **隊伍 Buff 總覽**：\`${uniqueBuffSummary}\`\n` +
      `📱 **全隊外置支援**：\`${extraDevices.length ? extraDevices.join(' | ') : '無'}\`\n` +
      `狀態：${isClosed ? '🔒 **已結束招募**' : '🔥 **歡迎各位冒險家點擊下方按鈕報名加入！**'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 **【目前隊伍名冊】**\n${memberListText}`
    )
    .setFooter({ text: '點擊下方按鈕即可選擇名冊角色並登記 Buff' });
}

function createPartyComponents(partyId, isClosed = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`party_join_${partyId}`).setLabel('✋ 報名加入').setStyle(ButtonStyle.Success).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_leave_${partyId}`).setLabel('❌ 取消報名').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
      new ButtonBuilder().setCustomId(`party_close_${partyId}`).setLabel('🚪 關閉/完成揪團').setStyle(ButtonStyle.Danger).setDisabled(isClosed)
    )
  ];
}

function createPartyBuffModal(partyId, charIgn, charJob, charLevel) {
  const modal = new ModalBuilder().setCustomId(`modal_party_buffs_${partyId}`).setTitle(`團練報名 (${charJob})`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_char_info').setLabel('角色ID / 職業 / 等級').setValue(`${charIgn}/${charJob}/${charLevel}`).setStyle(TextInputStyle.Short).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_maple_buff').setLabel('【🍁楓葉祝福】技能等級 (填: 滿 或 數字)').setPlaceholder('例如：滿、20、10、無').setValue('滿').setStyle(TextInputStyle.Short).setRequired(true)
    )
  );

  const buffs = JOB_BUFFS[charJob] || [];
  if (buffs.length > 0) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('input_job_buff_1').setLabel(`【${buffs[0]}】技能等級 (填: 滿 或 數字)`).setPlaceholder('例如：滿、30、無').setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)
      )
    );
  }

  if (buffs.length > 1) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('input_job_buff_2').setLabel(`【${buffs[1]}】技能等級 (填: 滿 或 數字)`).setPlaceholder('例如：滿、20、無').setValue('滿').setStyle(TextInputStyle.Short).setRequired(false)
      )
    );
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('input_extra_device').setLabel('📱自帶 Buff 機/支援裝置 (無則留空)').setPlaceholder('例如：自帶 1 台祈禱機、雙開帶火').setStyle(TextInputStyle.Short).setRequired(false)
    )
  );

  return modal;
}

// ==========================================
// 4. 賭局 UI 面板建構
// ==========================================

function createMultiBetEmbed(betData) {
  let playerPool = 0;
  betData.options.forEach(opt => playerPool += (opt.pool || 0));
  const totalPool = playerPool + (betData.seedMoney || 0);
  const isExpired = Date.now() >= betData.deadline;

  let statusText = '🟢 **下注進行中！賠率即時跳動**';
  if (betData.isPaused) statusText = '⏸️ **管理員已暫停下注**';
  else if (isExpired) statusText = '🔴 **已截止下注，等待結算**';

  const embed = new EmbedBuilder()
    .setColor(betData.isPaused ? 0xE74C3C : (isExpired ? 0x95A5A6 : 0xE67E22))
    .setTitle(betData.isScroll ? `📜【裝備衝卷競猜】${betData.title}` : `📖【技能書點擊賭局】${betData.title}`)
    .setDescription(
      `👑 **發起人**：<@${betData.creatorId}>\n` +
      `🎁 **發起人底池**：\`${formatMeso(betData.seedMoney || 0)} 楓幣\`\n` +
      `⏳ **截止時間**：<t:${Math.floor(betData.deadline / 1000)}:R> (<t:${Math.floor(betData.deadline / 1000)}:F>)\n` +
      `💰 **總獎金池**：\`${formatMeso(totalPool)} 楓幣\`\n` +
      `狀態：${statusText}\n` +
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

function createMultiBetComponents(betId, options, isScroll = false) {
  const isMulti = options.length > 3 || isScroll;

  if (!isMulti) {
    const row1 = new ActionRowBuilder();
    options.forEach((opt, idx) => {
      row1.addComponents(
        new ButtonBuilder().setCustomId(`bet_quick_${betId}_${idx}`).setLabel(`${opt.name} (+100w)`).setStyle(ButtonStyle.Primary)
      );
    });
    row1.addComponents(
      new ButtonBuilder().setCustomId(`bet_custom_btn_${betId}`).setLabel('✏️ 自訂下注').setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_pity_donate_${betId}`).setLabel('🩹 暴死同情抖內').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bet_settle_btn_${betId}`).setLabel('⚖️ 結算').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_admin_pause_${betId}`).setLabel('⏸️ 暫停/恢復').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bet_admin_delete_${betId}`).setLabel('🗑️ 廢除').setStyle(ButtonStyle.Danger)
    );
    return [row1, row2];
  } else {
    const selectOptions = options.map((opt, idx) =>
      new StringSelectMenuOptionBuilder().setLabel(opt.name).setValue(`${idx}`).setDescription(`選擇投注【${opt.name}】`)
    );
    const row1 = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`bet_select_opt_${betId}`).setPlaceholder('🔽 請先點此選擇你要押注的選項/過卷數').addOptions(selectOptions)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bet_act_100w_${betId}`).setLabel('💵 快捷 +100w').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_custom_btn_${betId}`).setLabel('✏️ 自訂下注').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bet_pity_donate_${betId}`).setLabel('🩹 暴死同情抖內').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`bet_settle_btn_${betId}`).setLabel('⚖️ 結算').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bet_admin_delete_${betId}`).setLabel('🗑️ 廢除').setStyle(ButtonStyle.Danger)
    );
    return [row1, row2];
  }
}

async function getActiveBetDoc() {
  if (!db) return null;
  const snap = await db.collection('active_bets').where('isSettled', '==', false).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

// ==========================================
// 5. 名冊工具模組
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
  const options = [
    new StringSelectMenuOptionBuilder().setLabel('📋 全部名冊 (依職業分組)').setValue('ALL_JOBS_LIST').setDescription('查看全伺服器成員職業名冊')
  ];

  Object.keys(ROLES.JOBS).forEach(job => {
    options.push(new StringSelectMenuOptionBuilder().setLabel(job).setValue(job).setDescription(`查看【${job}】名冊`));
  });

  options.push(
    new StringSelectMenuOptionBuilder().setLabel('👑 Lv 200 典獄長名冊').setValue('WARDEN_LIST').setDescription('查看達成 200 等傳奇成員'),
    new StringSelectMenuOptionBuilder().setLabel('💤 暫.退休名單').setValue('RETIRED_LIST').setDescription('查看退休成員名單')
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('select_query_job').setPlaceholder('🔍 點此切換查看名冊').addOptions(options.slice(0, 25))
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
  const modal = new ModalBuilder().setCustomId('modal_register_page1').setTitle(`名冊更新 (主職：${selectedJob})`);
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
  if (snapshot.empty) return new EmbedBuilder().setColor(0x3498DB).setTitle('📋 名冊總覽').setDescription('目前尚無任何紀錄。');

  const members = [];
  snapshot.forEach(doc => members.push(doc.data()));

  if (targetJob === 'ALL_JOBS_LIST') {
    const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📋【伺服器全部名冊總覽】(依職業分組)');
    let fieldCount = 0;

    for (const jobName of Object.keys(ROLES.JOBS)) {
      const charList = [];
      for (const m of members) {
        if (m.isRetired) continue;
        if (m.mainJob === jobName) {
          charList.push({ text: `\`(${m.mainIgn}_Lv.${m.mainLevel})\` <@${m.userId}> **【本】**`, level: parseInt(m.mainLevel) || 0 });
        }
        if (m.subs && Array.isArray(m.subs)) {
          m.subs.forEach(s => {
            if (s?.job === jobName) {
              charList.push({ text: `\`(${s.ign}_Lv.${s.level})\` <@${m.userId}> *(本尊: ${m.mainIgn})*`, level: parseInt(s.level) || 0 });
            }
          });
        }
      }

      if (charList.length > 0 && fieldCount < 24) {
        charList.sort((a, b) => b.level - a.level);
        embed.addFields({
          name: `⚔️ ${jobName} (${charList.length})`,
          value: charList.map(c => `• ${c.text}`).join('\n').substring(0, 1024),
          inline: false
        });
        fieldCount++;
      }
    }

    const retired = members.filter(m => m.isRetired);
    if (retired.length > 0 && fieldCount < 25) {
      embed.addFields({
        name: `💤 暫.退休 (${retired.length})`,
        value: retired.map(m => `• <@${m.userId}> (\`${m.mainIgn || '退休'}\`)`).join('\n').substring(0, 1024),
        inline: false
      });
    }
    return embed;
  }

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

  const list = [];
  for (const m of members) {
    if (m.isRetired) continue;
    if (m.mainJob === targetJob) list.push({ text: `\`(${m.mainIgn}_${m.mainJob}_${m.mainLevel}等)\` - <@${m.userId}> **【本尊】**`, level: parseInt(m.mainLevel) || 0 });
    if (m.subs && Array.isArray(m.subs)) {
      m.subs.forEach(s => {
        if (s?.job === targetJob) list.push({ text: `\`(${s.ign}_${s.job}_${s.level}等)\` - <@${m.userId}> [本尊: \`${m.mainIgn}\`]`, level: parseInt(s.level) || 0 });
      });
    }
  }

  list.sort((a, b) => b.level - a.level);
  const desc = list.length ? list.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n') : `目前尚無【${targetJob}】的本尊或分身登記。`;
  return new EmbedBuilder().setColor(0x3498DB).setTitle(`📋【${targetJob}】名冊 (共 ${list.length} 位角色)`).setDescription(desc.substring(0, 4000));
}

// ==========================================
// 6. Express 伺服器 & Firebase
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
// 7. 斜線指令註冊
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('團練')
    .setDescription('發起團練揪團 (可設定綁定需求與自備 Buff 機)')
    .addStringOption(o => o.setName('地點').setDescription('例如：蛋龍、忘卻6、神木村').setRequired(true))
    .addStringOption(o => o.setName('開打時間').setDescription('例如：2026.08.22 13:00 或 今晚 8 點').setRequired(true))
    .addStringOption(o => o.setName('綁定需求').setDescription('例如：需綁定主教、鏢賊綁眼、缺火 (無則留空)').setRequired(false))
    .addStringOption(o => o.setName('自備機台').setDescription('主揪自備支援機台 (例如：自帶2台火+祈禱機)').setRequired(false))
    .addStringOption(o => o.setName('備註時長').setDescription('例如：打氣場、打 Hot time 2 小時').setRequired(false))
    .addIntegerOption(o => o.setName('需要人數').setDescription('預計招募人數 (預設 6 人)').setRequired(false).setMinValue(2).setMaxValue(30)),

  new SlashCommandBuilder().setName('查看團練').setDescription('查看目前所有進行中招募的團練與 Buff 總覽'),

  new SlashCommandBuilder()
    .setName('發起賭局')
    .setDescription('發起社群競猜賭局 (同時間全服限一局)')
    .addSubcommand(sub =>
      sub.setName('技能書')
        .setDescription('發起技能書點擊賭局 (會過 / 爆掉)')
        .addStringOption(o => o.setName('技能書名稱').setDescription('例如：三飛閃30、暴風神射30').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：15m、30m、1h、21:30 等').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('加碼底池 (選填，例如：500w、1000w)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('衝卷')
        .setDescription('發起裝備衝卷過幾卷競猜 (+0 ~ +10)')
        .addStringOption(o => o.setName('裝備名稱').setDescription('例如：紫色衝浪板、楓葉之盔').setRequired(true))
        .addIntegerOption(o => o.setName('最大卷數').setDescription('該裝備總卷數上限 (例如：2、7 或 10)').setRequired(true).setMinValue(1).setMaxValue(10))
        .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：15m、1h、20:00 等').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('加碼底池 (選填，例如：500w、1000w)').setRequired(false))
    ),

  new SlashCommandBuilder().setName('查看賭局').setDescription('查看目前進行中的賭局面板'),
  new SlashCommandBuilder().setName('幸運頻道').setDescription('抽取今日幸運頻道')
    .addIntegerOption(o => o.setName('最大頻道').setDescription('最大頻道數').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('報到').setDescription('【管理員專用】發送報到面板').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('職業查詢').setDescription('依職業或全部名冊查看成員資訊')
    .addStringOption(o => o.setName('職業名稱').setDescription('選擇要查看的職業 (留空可看全部)').setRequired(false)
      .addChoices(
        { name: '📋 全部名冊 (依職業分組)', value: 'ALL_JOBS_LIST' },
        ...Object.keys(ROLES.JOBS).map(j => ({ name: j, value: j }))
      )),
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
// 8. 互動事件核心監聽
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // 1. /團練
      if (commandName === '團練') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply();

        const target = interaction.options.getString('地點');
        const startTime = interaction.options.getString('開打時間');
        const bindReq = interaction.options.getString('綁定需求') || '無特殊限制';
        const creatorDevice = interaction.options.getString('自備機台') || '無自備';
        const duration = interaction.options.getString('備註時長') || '打氣場 / 配合隊伍';
        const maxCount = interaction.options.getInteger('需要人數') || 6;

        const partyRef = db.collection('party_trainings').doc();
        const partyData = {
          id: partyRef.id,
          creatorId: interaction.user.id,
          target, startTime, bindReq, creatorDevice, duration, maxCount,
          members: [],
          isClosed: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await partyRef.set(partyData);
        return await interaction.editReply({
          embeds: [createPartyEmbed(partyData)],
          components: createPartyComponents(partyRef.id, false)
        });
      }

      // 2. /查看團練
      if (commandName === '查看團練') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply();

        const snap = await db.collection('party_trainings').where('isClosed', '==', false).orderBy('createdAt', 'desc').limit(5).get();
        if (snap.empty) return interaction.editReply('📜 目前沒有進行招募中的團練，使用 `/團練` 發起一個吧！');

        const partyListEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('⚔️【進行中團練總覽】');
        snap.forEach(doc => {
          const d = doc.data();
          const memberCount = d.members?.length || 0;
          const buffPool = [];
          (d.members || []).forEach(m => {
            Object.entries(m.buffs || {}).forEach(([k, v]) => buffPool.push(`${k}(${v})`));
          });

          partyListEmbed.addFields({
            name: `📍 地點：${d.target} (${memberCount}/${d.maxCount}人) - 隊長: <@${d.creatorId}>`,
            value: `⏰ **時間**：\`${d.startTime}\` | 📌 **綁定**：\`${d.bindReq}\`\n✨ **Buff**：\`${buffPool.length ? buffPool.join(' | ') : '暫無'}\``,
            inline: false
          });
        });

        return await interaction.editReply({ embeds: [partyListEmbed] });
      }

      // 3. /發起賭局
      if (commandName === '發起賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });

        const activeBet = await getActiveBetDoc();
        if (activeBet) return interaction.reply({ content: '⚠️ 目前已有進行中的賭局，請先使用 `/查看賭局` 或等待結算！', ephemeral: true });

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
          const options = [{ name: `🟢 會過`, pool: 0, bets: {} }, { name: `🔴 爆掉`, pool: 0, bets: {} }];

          const betData = {
            id: betDocRef.id,
            creatorId: interaction.user.id,
            creatorName: interaction.user.username,
            title: `【${bookName}】能不能點過？`,
            options, deadline, seedMoney,
            pityDonations: {},
            isScroll: false, isSettled: false, isPaused: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          };

          await betDocRef.set(betData);
          return await interaction.editReply({
            embeds: [createMultiBetEmbed(betData)],
            components: createMultiBetComponents(betDocRef.id, options, false)
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
            pityDonations: {},
            isScroll: true, isSettled: false, isPaused: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          };

          await betDocRef.set(betData);
          return await interaction.editReply({
            embeds: [createMultiBetEmbed(betData)],
            components: createMultiBetComponents(betDocRef.id, options, true)
          });
        }
      }

      if (commandName === '查看賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        await interaction.deferReply();
        const activeBetDoc = await getActiveBetDoc();
        if (!activeBetDoc) return interaction.editReply('🎲 目前沒有進行中的賭局，輸入 `/發起賭局` 來開一盤吧！');
        const betData = activeBetDoc.data();
        return await interaction.editReply({
          embeds: [createMultiBetEmbed(betData)],
          components: createMultiBetComponents(betData.id, betData.options, betData.isScroll)
        });
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
        const targetJob = interaction.options.getString('職業名稱') || 'ALL_JOBS_LIST';
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
    // [B] 按鈕處理
    // ----------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // 1. 團練報名按鈕 (發送專屬選單，點選後直接打開 Modal)
      if (customId.startsWith('party_join_')) {
        const partyId = customId.replace('party_join_', '');
        const partyDoc = await db.collection('party_trainings').doc(partyId).get();
        if (!partyDoc.exists) return interaction.reply({ content: '❌ 該團練已不存在。', ephemeral: true });

        const partyData = partyDoc.data();
        if (partyData.isClosed) return interaction.reply({ content: '🔒 該團練已關閉招募。', ephemeral: true });

        const prevData = await fetchUserDocSafe(interaction.user.id);
        const charOptions = [];

        if (prevData.mainIgn) {
          charOptions.push(new StringSelectMenuOptionBuilder()
            .setLabel(`👑 本尊：${prevData.mainIgn} (${prevData.mainJob} Lv.${prevData.mainLevel})`)
            .setValue(`CHAR_MAIN`));
        }

        if (prevData.subs && Array.isArray(prevData.subs)) {
          prevData.subs.forEach((s, idx) => {
            charOptions.push(new StringSelectMenuOptionBuilder()
              .setLabel(`⚔️ 分身：${s.ign} (${s.job} Lv.${s.level})`)
              .setValue(`CHAR_SUB_${idx}`));
          });
        }

        charOptions.push(new StringSelectMenuOptionBuilder()
          .setLabel('✏️ 自訂其他角色/職業')
          .setValue('CHAR_CUSTOM'));

        return await interaction.reply({
          content: '👉 **請從你的名冊中選擇要報名團練的角色：**',
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`party_select_char_${partyId}`).setPlaceholder('點此選擇名冊角色').addOptions(charOptions)
          )],
          ephemeral: true
        });
      }

      // 2. 團練取消報名
      if (customId.startsWith('party_leave_')) {
        const partyId = customId.replace('party_leave_', '');
        const partyDoc = await db.collection('party_trainings').doc(partyId).get();
        if (!partyDoc.exists) return interaction.reply({ content: '❌ 該團練已不存在。', ephemeral: true });

        const partyData = partyDoc.data();
        const newMembers = (partyData.members || []).filter(m => m.userId !== interaction.user.id);

        await db.collection('party_trainings').doc(partyId).update({ members: newMembers });
        await interaction.message.edit({ embeds: [createPartyEmbed({ ...partyData, members: newMembers })] });

        return await interaction.reply({ content: '✅ 已為您取消報名此團練！', ephemeral: true });
      }

      // 3. 關閉揪團
      if (customId.startsWith('party_close_')) {
        const partyId = customId.replace('party_close_', '');
        const partyDoc = await db.collection('party_trainings').doc(partyId).get();
        if (!partyDoc.exists) return interaction.reply({ content: '❌ 該團練已不存在。', ephemeral: true });

        const partyData = partyDoc.data();
        const isCreator = interaction.user.id === partyData.creatorId;
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

        if (!isCreator && !isAdmin) return interaction.reply({ content: '❌ 只有主揪隊長或管理員可關閉揪團！', ephemeral: true });

        await db.collection('party_trainings').doc(partyId).update({ isClosed: true });
        await interaction.message.edit({
          embeds: [createPartyEmbed({ ...partyData, isClosed: true })],
          components: createPartyComponents(partyId, true)
        });

        return await interaction.reply({ content: '🔒 團練揪團已成功關閉！祝各位冒險家練等順利！', ephemeral: true });
      }

      if (customId === 'btn_quick_edit') {
        const prevData = await fetchUserDocSafe(interaction.user.id);
        const defaultJob = prevData.mainJob || Object.keys(ROLES.JOBS)[0];
        userChoiceMap.set(interaction.user.id, defaultJob);
        return await interaction.showModal(createRegisterModal(defaultJob, prevData));
      }

      // 管理員暫停/恢復賭局
      if (customId.startsWith('bet_admin_pause_')) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ 僅伺服器管理員可操作！', ephemeral: true });
        const betId = customId.replace('bet_admin_pause_', '');
        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });

        const betData = betDoc.data();
        const nextState = !betData.isPaused;
        await db.collection('active_bets').doc(betId).update({ isPaused: nextState });

        const updatedData = { ...betData, isPaused: nextState };
        await interaction.message.edit({ embeds: [createMultiBetEmbed(updatedData)], components: createMultiBetComponents(betId, updatedData.options, updatedData.isScroll) });
        return await interaction.reply({ content: `✅ 管理員已成功將賭局【${nextState ? '暫停下注' : '恢復下注'}】！`, ephemeral: true });
      }

      // 管理員廢除賭局
      if (customId.startsWith('bet_admin_delete_')) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ 僅伺服器管理員可操作！', ephemeral: true });
        const betId = customId.replace('bet_admin_delete_', '');
        await db.collection('active_bets').doc(betId).delete();
        await interaction.message.edit({ content: '🗑️ **【賭局已廢除】該局已被管理員手動取消與刪除。**', embeds: [], components: [] });
        return await interaction.reply({ content: '✅ 已成功刪除廢除該賭局！', ephemeral: true });
      }

      // 賭局結算按鈕
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

      // 同情抖內
      if (customId.startsWith('bet_pity_donate_')) {
        const betId = customId.replace('bet_pity_donate_', '');
        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (betData.isPaused || Date.now() >= betData.deadline) return interaction.reply({ content: '🛑 該賭局目前不接受下注/抖內！', ephemeral: true });

        const randomPityQuote = getRandomPity(betData.isScroll ? 'scroll' : 'book');
        const modal = new ModalBuilder().setCustomId(`modal_pity_donate_${betId}`).setTitle(`🩹 暴死深切救濟慰問 (私密)`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('input_pity_amount').setLabel(`${randomPityQuote.substring(0, 44)}`).setPlaceholder('填寫救濟金額 (例如：100w、500w)').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      // 快捷下注 +100w
      if (customId.startsWith('bet_quick_')) {
        const parts = customId.split('_');
        const betId = parts[2];
        const optIdx = parseInt(parts[3]);

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (betData.isPaused) return interaction.reply({ content: '⏸️ 賭局已暫停下注！', ephemeral: true });
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

      // 衝卷多選項快捷 +100w
      if (customId.startsWith('bet_act_100w_')) {
        const betId = customId.replace('bet_act_100w_', '');
        const selectedOptIdx = userChoiceMap.get(`bet_choice_${interaction.user.id}_${betId}`);
        if (selectedOptIdx === undefined) return interaction.reply({ content: '⚠️ 請先在上方下拉選單點選你要下注的【選項】！', ephemeral: true });

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (betData.isPaused) return interaction.reply({ content: '⏸️ 賭局已暫停下注！', ephemeral: true });
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

      // 自訂金額彈窗
      if (customId.startsWith('bet_custom_btn_')) {
        const betId = customId.replace('bet_custom_btn_', '');
        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (betData.isPaused || Date.now() >= betData.deadline) return interaction.reply({ content: '🛑 該賭局目前不接受下注！', ephemeral: true });

        const isMulti = betData.options.length > 3 || betData.isScroll;
        let selectedOptIdx = userChoiceMap.get(`bet_choice_${interaction.user.id}_${betId}`);

        if (isMulti && selectedOptIdx === undefined) {
          return interaction.reply({ content: '⚠️ 請先在上方下拉選單點選你要下注的【選項 / 卷數】！', ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`modal_bet_custom_${betId}`).setTitle(`自訂下注金額`);
        if (!isMulti) {
          let descList = betData.options.map((opt, i) => `${i + 1}:${opt.name}`).join(' | ');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('input_bet_choice').setLabel(`選擇選項編號 (1 ~ ${betData.options.length})`).setPlaceholder(`選項：${descList}`).setStyle(TextInputStyle.Short).setRequired(true)
          ));
        }

        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('input_bet_amount').setLabel(`下注金額 (支援 500w, 1e 或純數字)`).setPlaceholder(`例如：500w 或 5000000`).setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }
    }

    // ----------------------------------------
    // [C] 下拉選單處理 (直接調用 Modal，防止卡住)
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      // 團練名冊角色選擇 -> 直接開啟 Modal
      if (interaction.customId.startsWith('party_select_char_')) {
        const partyId = interaction.customId.replace('party_select_char_', '');
        const selectedVal = interaction.values[0];
        const prevData = await fetchUserDocSafe(interaction.user.id);

        let charIgn = prevData.mainIgn || interaction.user.displayName;
        let charJob = prevData.mainJob || '黑騎士';
        let charLevel = prevData.mainLevel || '120';

        if (selectedVal.startsWith('CHAR_SUB_')) {
          const subIdx = parseInt(selectedVal.replace('CHAR_SUB_', ''));
          const sub = prevData.subs?.[subIdx];
          if (sub) { charIgn = sub.ign; charJob = sub.job; charLevel = sub.level; }
        }

        return await interaction.showModal(createPartyBuffModal(partyId, charIgn, charJob, charLevel));
      }

      // 賭局選項選取
      if (interaction.customId.startsWith('bet_select_opt_')) {
        const betId = interaction.customId.replace('bet_select_opt_', '');
        const optIdx = parseInt(interaction.values[0]);
        userChoiceMap.set(`bet_choice_${interaction.user.id}_${betId}`, optIdx);
        return await interaction.reply({ content: `👉 已選中第 ${optIdx + 1} 個選項，現在可點擊下方按鈕下注！`, ephemeral: true });
      }

      // 賭局結算執行
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
          balances[betData.creatorId] = { ign: betData.creatorName || '發起人底池', net: -(betData.seedMoney) };
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

        if (winBets.length > 0) {
          resultsText += `\u001b[1;32m=== 贏家名冊 (哪有賭狗天天輸） ===\u001b[0m\n`;
          for (const [uid, b] of winBets) {
            const share = winPool > 0 ? (b.amount / winPool) * bonusPool : 0;
            const totalReturn = b.amount + Math.floor(share);
            balances[uid].net += totalReturn;
            resultsText += `\u001b[0;32m[${b.ign}_下注:${formatMeso(b.amount)}_+${formatMeso(Math.floor(share))}楓幣 (領回:${formatMeso(totalReturn)})]\u001b[0m\n`;
          }
        } else {
          resultsText += `\u001b[0;32m無人押中此選項，底池與彩池保留。\u001b[0m\n`;
        }

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

        const isBust = winOption.name.includes('+0') || winOption.name.includes('全爆') || winOption.name.includes('爆掉');
        const donations = Object.entries(betData.pityDonations || {});

        if (isBust && donations.length > 0) {
          resultsText += `\n\u001b[1;35m=== 乾爹乾媽名冊 (功德無量暖心救濟） ===\u001b[0m\n`;
          donations.forEach(([uid, d]) => {
            const action = getRandomDonorAction();
            resultsText += `\u001b[0;35m[${d.ign}_${action}_+${formatMeso(d.amount)}楓幣]\u001b[0m\n`;
          });
        }

        resultsText += '```';

        const transfers = calculateMinTransfers(balances);
        let transferGuide = `🧾 **【最少交易次數轉帳指引（共 ${transfers.length} 筆）】**\n\n`;

        if (transfers.length === 0) {
          transferGuide += `• 無需進行任何轉帳交易。`;
        } else {
          transfers.forEach((t, i) => {
            transferGuide += `${i + 1}. ➡️ **${t.from}** 交易給 **${t.to}**：\`${formatMeso(t.amount)} 楓幣\``;
            if (t.amount >= 10000000) transferGuide += ` *(💡 單筆達 1000w 以上，可協議拆單降手續費率)*`;
            transferGuide += `\n`;
          });
        }

        await db.collection('active_bets').doc(betId).update({ isSettled: true });

        const settleEmbed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`🎉【競猜結算公告】${betData.title}`)
          .setDescription(`恭喜 **【${winOption.name}】** 成功開出！\n總獎金池 \`${formatMeso(totalPool)} 楓幣\` 已派發完畢！\n\n${resultsText}\n${transferGuide}`);

        await interaction.editReply({ embeds: [settleEmbed] });

        if (isBust) {
          let pityText = `😭 **【暴死深切救濟清單】**\n${getRandomPity(betData.isScroll ? 'scroll' : 'book')}\n以下是好心人給你的同情救濟金，請自行找他們領取買藥：\n\n`;
          let totalPity = 0;
          if (donations.length > 0) {
            donations.forEach(([uid, d], idx) => {
              totalPity += d.amount;
              pityText += `${idx + 1}. <@${uid}> (\`${d.ign}\`) 捐贈：\`${formatMeso(d.amount)} 楓幣\`\n`;
            });
            pityText += `\n💰 **總計收到救濟金**：\`${formatMeso(totalPity)} 楓幣\``;
          } else {
            pityText += `可惜... 這次沒有人留下救濟金，請堅強活下去！`;
          }

          try { await interaction.followUp({ content: pityText, ephemeral: true }); } catch (e) {}
        }
        return;
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
        userChoiceMap.set(interaction.user.id, val);
        return await interaction.showModal(createRegisterModal(val, prevData));
      }
    }

    // ----------------------------------------
    // [D] Modal 表單提交
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      // 1. 團練 Buff 登記
      if (interaction.customId.startsWith('modal_party_buffs_')) {
        await interaction.deferReply({ ephemeral: true });
        const partyId = interaction.customId.replace('modal_party_buffs_', '');

        const partyDoc = await db.collection('party_trainings').doc(partyId).get();
        if (!partyDoc.exists) return interaction.editReply('❌ 該團練揪團已失效。');
        const partyData = partyDoc.data();

        const rawCharInfo = interaction.fields.getTextInputValue('input_char_info');
        const parts = rawCharInfo.split(/[/\\|\s,，_-]+/).map(s => s.trim()).filter(Boolean);
        const ign = parts[0] || interaction.user.displayName;
        const job = parts[1] || '冒險家';
        const level = parts[2] || '120';

        const mapleBuff = interaction.fields.getTextInputValue('input_maple_buff')?.trim() || '滿';
        const extraDevice = interaction.fields.getTextInputValue('input_extra_device')?.trim() || '';
        const buffs = { '楓祝': mapleBuff };

        const definedBuffs = JOB_BUFFS[job] || [];
        if (definedBuffs.length > 0) {
          try {
            const b1 = interaction.fields.getTextInputValue('input_job_buff_1')?.trim();
            if (b1) buffs[definedBuffs[0]] = b1;
          } catch (e) {}
        }
        if (definedBuffs.length > 1) {
          try {
            const b2 = interaction.fields.getTextInputValue('input_job_buff_2')?.trim();
            if (b2) buffs[definedBuffs[1]] = b2;
          } catch (e) {}
        }

        const members = (partyData.members || []).filter(m => m.userId !== interaction.user.id);
        members.push({ userId: interaction.user.id, ign, job, level, buffs, extraDevice });

        await db.collection('party_trainings').doc(partyId).update({ members });
        await interaction.message.edit({ embeds: [createPartyEmbed({ ...partyData, members })] });

        return await interaction.editReply(`🎉 成功加入【${partyData.target}】團練！\n角色：\`${ign}\` (${job} Lv.${level})\nBuff：\`${Object.entries(buffs).map(([k, v]) => `${k}:${v}`).join(', ')}\`${extraDevice ? `\n自帶支援：\`${extraDevice}\`` : ''}`);
      }

      // 2. 同情抖內提交
      if (interaction.customId.startsWith('modal_pity_donate_')) {
        await interaction.deferReply({ ephemeral: true });
        const betId = interaction.customId.replace('modal_pity_donate_', '');
        const donateAmount = parseMoneyInput(interaction.fields.getTextInputValue('input_pity_amount').trim());

        if (donateAmount <= 0) return interaction.editReply('❌ 金額無效，未登記抖內。');

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.editReply('❌ 賭局已失效');
        const betData = betDoc.data();

        if (betData.isPaused || Date.now() >= betData.deadline) return interaction.editReply('🛑 該賭局目前不接受下注/抖內！');

        const userDoc = await fetchUserDocSafe(interaction.user.id);
        const playerIgn = userDoc.mainIgn || interaction.user.displayName || interaction.user.username;

        const pityDonations = betData.pityDonations || {};
        pityDonations[interaction.user.id] = { ign: playerIgn, amount: donateAmount };

        await db.collection('active_bets').doc(betId).update({ pityDonations });
        return await interaction.editReply(`🩹 已成功登記同情救濟 \`${formatMeso(donateAmount)} 楓幣\`！\n*(若最終暴死，系統會公開乾爹乾媽名冊，並私密通知苦主領取)*`);
      }

      // 3. 自訂下注提交
      if (interaction.customId.startsWith('modal_bet_custom_')) {
        await interaction.deferReply({ ephemeral: true });
        const betId = interaction.customId.replace('modal_bet_custom_', '');
        const rawAmount = interaction.fields.getTextInputValue('input_bet_amount').trim();

        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.editReply('❌ 賭局已失效');
        const betData = betDoc.data();

        if (betData.isPaused || Date.now() >= betData.deadline) return interaction.editReply('🛑 該賭局目前不接受下注！');

        let optIdx;
        if (betData.options.length > 3 || betData.isScroll) {
          optIdx = userChoiceMap.get(`bet_choice_${interaction.user.id}_${betId}`);
        } else {
          optIdx = parseInt(interaction.fields.getTextInputValue('input_bet_choice')?.trim()) - 1;
        }

        const betAmount = parseMoneyInput(rawAmount);
        if (betAmount <= 0) return interaction.editReply('❌ 下注金額格式無效！');
        if (isNaN(optIdx) || optIdx < 0 || optIdx >= betData.options.length) return interaction.editReply(`❌ 選項無效，請重新選擇！`);

        const userDoc = await fetchUserDocSafe(interaction.user.id);
        const playerIgn = userDoc.mainIgn || interaction.user.displayName || interaction.user.username;

        const options = betData.options;
        const currentBet = options[optIdx].bets[interaction.user.id]?.amount || 0;
        options[optIdx].bets[interaction.user.id] = { ign: playerIgn, amount: currentBet + betAmount };
        options[optIdx].pool = (options[optIdx].pool || 0) + betAmount;

        await db.collection('active_bets').doc(betId).update({ options });
        return await interaction.editReply(`✅ 成功為 **${options[optIdx].name}** 下注 \`${formatMeso(betAmount)} 楓幣\`！(個人累計: ${formatMeso(currentBet + betAmount)})`);
      }

      // 4. 名冊更新
      if (interaction.customId === 'modal_register_page1') {
        await interaction.deferReply();
        const mainIgn = interaction.fields.getTextInputValue('input_main_ign').trim();
        const mainLevel = interaction.fields.getTextInputValue('input_main_level').replace(/[^0-9]/g, '') || '1';
        const playtime = interaction.fields.getTextInputValue('input_playtime').trim();
        const mainJob = userChoiceMap.get(interaction.user.id) || '未知職業';
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
          .setTitle(parseInt(mainLevel) >= 200 ? '👑 傳奇登頂！Lv 200 典獄長名冊已更新！' : '🎉 冒險家名冊已成功更新！')
          .addFields(
            { name: '👑 本尊角色', value: `\`${mainIgn}\` (${mainJob} / Lv.${mainLevel})`, inline: true },
            { name: '⏱️ 遊玩時間', value: playtime, inline: true },
            { name: `⚔️ 分身名單 (${fullSubs.length} 隻)`, value: fullSubs.map(s => `• \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n') || '無', inline: false },
            { name: '🏷️ 伺服器暱稱', value: `\`${newNick}\``, inline: true },
            { name: '✨ 身分組', value: `【已驗證】、 【${jobNames.join('】、 【')}】`, inline: true }
          );

        await interaction.editReply({ embeds: [embed] });
        userChoiceMap.delete(interaction.user.id);
      }

      // 5. 退休
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
