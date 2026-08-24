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
// 1. 常數、身分組與特權設定
// ==========================================
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID || '1476762995454640159';
const WELCOME_REGISTER_CHANNEL_ID = '1540052273743532122';
const SUPER_ADMIN_ID = '923054816937254932'; // 最高超級管理員特權

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
  '黑騎士': ['🔥神聖之火', '🛡️力量消除'],
  '聖騎士': ['🛡️魔法消除'],
  '英雄': ['⚔️激勵'],
  '箭神': ['🎯會心之眼'],
  '神射手': ['🎯會心之眼'],
  '主教': ['✨神聖祈禱', '👼天使祝福'],
  '冰雷': ['🧠精神強化'],
  '火毒': ['🧠精神強化'],
  '鏢賊': ['⚡速', '🍀幸運術'],
  '刀賊': ['⚡速'],
  '拳霸': ['🥊最終極速'],
  '槍神': []
};

const userChoiceMap = new Map();

const DONOR_ACTIONS = [
  "救濟了發起人一碗暖心熱湯", "贊助了一整包強力吸水面紙", "請喝了一杯全糖壓驚珍奶",
  "施捨了一張回村卷軸買水錢", "送上一份心靈創傷慰問金", "贊助鐵匠維修槌磨損費"
];

function getRandomDonorAction() {
  return DONOR_ACTIONS[Math.floor(Math.random() * DONOR_ACTIONS.length)];
}

const PITY_TEXTS = {
  scroll: ["贊助苦主買包面紙擦眼淚...", "全爆補助金：給老哥買碗熱湯喝...", "給鐵匠維修槌子的磨損費..."],
  book: ["贊助苦主吸收技能書灰燼的心理治療費...", "技能書爆破受害者保護協會慰問金...", "給可憐人買本初級教科書冷靜一下..."],
  loot: ["贊助苦主打不到寶的洗面乳...", "空包彈受害者急難救助金...", "贊助苦主打怪打到手抽筋的貼布..."]
};

function getRandomPity(type) {
  const list = PITY_TEXTS[type] || PITY_TEXTS.scroll;
  return list[Math.floor(Math.random() * list.length)];
}

function isSuperAdmin(userId, permissions) {
  return userId === SUPER_ADMIN_ID || permissions?.has(PermissionFlagsBits.Administrator);
}

// ==========================================
// 2. 工具函式庫
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
// 3. 放圖與地圖交接模組
// ==========================================

function createMapShareEmbed(mapData) {
  const isTaken = !!mapData.takerId;
  const isFinished = mapData.isFinished || false;

  let statusText = '🟢 **空檔釋出中，點擊下方「我要圖」進行預約！**';
  let color = 0x57F287;

  if (isFinished) {
    statusText = `🔒 **地圖已完成交接，此輪放圖已順利結束！**`;
    color = 0x95A5A6;
  } else if (isTaken) {
    statusText = `🟡 **已被預約**：由 <@${mapData.takerId}> 鎖定中！(若臨時不來可點擊取消)`;
    color = 0xFEE75C;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🗺️【熱門地圖交接/放圖】${mapData.mapName}`)
    .setDescription(
      `👑 **放圖者**：<@${mapData.creatorId}>\n` +
      `📍 **所屬頻道**：\`第 ${mapData.channelNum} 頻道\`\n` +
      `⏳ **預計離開時間**：\`${mapData.leaveTime}\`\n` +
      `🐛 **備註 / 地圖Bug**：\`${mapData.note || '無特殊備註'}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `狀態：${statusText}`
    )
    .setFooter({ text: '楓之谷地圖交接中心 | 誠信排隊，請勿插隊' });
}

function createMapShareComponents(mapId, mapData) {
  const isTaken = !!mapData.takerId;
  const isFinished = mapData.isFinished || false;
  const row = new ActionRowBuilder();

  if (!isFinished) {
    if (!isTaken) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`map_take_${mapId}`).setLabel('✋ 我要圖 (立即預約)').setStyle(ButtonStyle.Success)
      );
    } else {
      row.addComponents(
        new ButtonBuilder().setCustomId(`map_cancel_${mapId}`).setLabel('❌ 取消預約 (釋出)').setStyle(ButtonStyle.Secondary)
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId(`map_done_${mapId}`).setLabel('🤝 已交接完成').setStyle(ButtonStyle.Primary)
    );
  }

  return row.components.length ? [row] : [];
}

// ==========================================
// 4. 帳號共用狀態模組 (單一角色顆粒度)
// ==========================================

async function getCharStatusDoc(charIgn) {
  if (!db) return null;
  const doc = await db.collection('char_statuses').doc(charIgn.toLowerCase()).get();
  return doc.exists ? doc.data() : null;
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
      desc = `⚠️ **目前登記者**：<@${statusData.currentUserId}> (\`${statusData.currentUserName}\`)\n` +
             `⏱️ **已使用時長**：\`${usedMinutes} 分鐘\` (已逾時 \`${overdueMinutes} 分鐘\`)\n` +
             `💡 該成員可能已離開遊戲忘記下線，可點擊下方按鈕進行提醒或強制收回。`;
    } else {
      statusTitle = '🔴 目前狀態：【使用中 (請勿頂號)】';
      statusColor = 0xED4245;
      desc = `⚠️ **目前登記者**：<@${statusData.currentUserId}> (\`${statusData.currentUserName}\`)\n` +
             `⏱️ **已使用時長**：\`${usedMinutes} 分鐘\`\n` +
             `⏳ **預計釋放時間**：<t:${Math.floor(expTime / 1000)}:R> (<t:${Math.floor(expTime / 1000)}:T>)\n\n` +
             `🚫 **請勿強行登入頂號！** 如有急用請點擊下方「🔔 敲門提醒」發送換手通知。`;
    }
  }

  return new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`🔑 角色共用儀表板 - 【${charIgn}】`)
    .setDescription(
      `👤 **您的角色權限**：\`${userRoleText}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${statusTitle}\n\n${desc}`
    )
    .setFooter({ text: '私密儀表板 | 換手上線請隨手登記，保障雙方練等權益' });
}

function createCharStatusComponents(charIgn, statusData, isOwner, isCurrentUser) {
  const isOnline = statusData?.isOnline || false;
  const row = new ActionRowBuilder();

  if (!isOnline) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`char_act_online_${charIgn}`).setLabel('🟢 我要上線使用').setStyle(ButtonStyle.Success)
    );
  } else {
    if (isCurrentUser || isOwner) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`char_act_offline_${charIgn}`).setLabel('🔴 我已離線 / 釋放').setStyle(ButtonStyle.Primary)
      );
    }
    if (!isCurrentUser) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`char_act_knock_${charIgn}`).setLabel('🔔 敲門提醒使用者').setStyle(ButtonStyle.Secondary)
      );
    }
    if (isOwner && !isCurrentUser) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`char_act_force_${charIgn}`).setLabel('⚡ 強制重置為閒置 (擁有者特權)').setStyle(ButtonStyle.Danger)
      );
    }
  }

  return [row];
}

// ==========================================
// 5. 揪團系統 UI 模組 (團練 / 突襲 / 組隊任務)
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

  const typeTitles = {
    training: '⚔️【冒險者團練揪團】',
    raid: '🐉【Boss 突襲遠征揪團】',
    pq: '🧩【經典組隊任務揪團】'
  };

  return new EmbedBuilder()
    .setColor(isClosed ? 0x95A5A6 : (isFull ? 0xF1C40F : 0x3498DB))
    .setTitle(`${typeTitles[partyData.partyType] || '⚔️【冒險揪團】'}${partyData.target}`)
    .setDescription(
      `👑 **主揪隊長**：<@${partyData.creatorId}>\n` +
      `⏰ **開打時間**：\`${partyData.startTime}\`\n` +
      `📌 **等級/限制**：\`${partyData.bindReq || '無特殊限制'}\`\n` +
      `📱 **主揪支援**：\`${partyData.creatorDevice || '無自備'}\`\n` +
      `⏱️ **備註時長**：\`${partyData.duration || '無備註'}\`\n` +
      `👥 **隊伍人數**：\`${members.length} / ${partyData.maxCount} 人\` ${isFull ? '🔴 **(已滿員)**' : '🟢 **(招募中)**'}\n` +
      `✨ **隊伍 Buff 總覽**：\`${uniqueBuffSummary}\`\n` +
      `📱 **全隊外置支援**：\`${extraDevices.length ? extraDevices.join(' | ') : '無'}\`\n` +
      `狀態：${isClosed ? '🔒 **已結束招募**' : '🔥 **歡迎冒險家點擊下方按鈕報名加入！**'}\n` +
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
  const modal = new ModalBuilder().setCustomId(`modal_party_buffs_${partyId}`).setTitle(`揪團報名 (${charJob})`);

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

async function updatePartyMainMessage(partyData, newMembers, isClosed = false) {
  if (partyData.channelId && partyData.messageId) {
    try {
      const channel = await client.channels.fetch(partyData.channelId);
      if (channel && channel.isTextBased()) {
        const msg = await channel.messages.fetch(partyData.messageId);
        await msg.edit({
          embeds: [createPartyEmbed({ ...partyData, members: newMembers, isClosed })],
          components: createPartyComponents(partyData.id, isClosed)
        });
      }
    } catch (e) {
      console.error('更新揪團主面板失敗:', e.message);
    }
  }
}

// ==========================================
// 6. 賭局 UI 面板建構 (二選一 / 衝卷 / 打寶)
// ==========================================

function createMultiBetEmbed(betData) {
  let playerPool = 0;
  betData.options.forEach(opt => playerPool += (opt.pool || 0));
  const totalPool = playerPool + (betData.seedMoney || 0);
  const isExpired = Date.now() >= betData.deadline;

  let statusText = '🟢 **下注進行中！賠率即時跳動**';
  if (betData.isPaused) statusText = '⏸️ **管理員已暫停下注**';
  else if (isExpired) statusText = '🔴 **已截止下注，等待結算**';

  const typeTitles = {
    book: '📖【技能書賭局】',
    scroll: '📜【衝卷/數值賭局】',
    loot: '🎁【冒險打寶競猜】'
  };

  const embed = new EmbedBuilder()
    .setColor(betData.isPaused ? 0xE74C3C : (isExpired ? 0x95A5A6 : 0xE67E22))
    .setTitle(`${typeTitles[betData.betType] || '🎲【社群競猜】'}${betData.title}`)
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
      new StringSelectMenuBuilder().setCustomId(`bet_select_opt_${betId}`).setPlaceholder('🔽 請先點此選擇你要押注的選項/區間').addOptions(selectOptions)
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
// 7. 名冊與個人資料模組
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
        if (m.mainJob === jobName) charList.push({ text: `\`(${m.mainIgn}_Lv.${m.mainLevel})\` <@${m.userId}> **【本】**`, level: parseInt(m.mainLevel) || 0 });
        if (m.subs && Array.isArray(m.subs)) {
          m.subs.forEach(s => {
            if (s?.job === jobName) charList.push({ text: `\`(${s.ign}_Lv.${s.level})\` <@${m.userId}> *(本尊: ${m.mainIgn})*`, level: parseInt(s.level) || 0 });
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
// 8. Express 伺服器 & Firebase 初始化
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
// 9. 斜線指令樹註冊
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('角色狀態')
    .setDescription('共用帳號管理 (儀表板 / 一鍵單一角色授權 / 撤銷)')
    .addSubcommand(sub => sub.setName('儀表板').setDescription('查看與切換共用/借用角色的上線與在線狀態 (私密)'))
    .addSubcommand(sub =>
      sub.setName('授權')
        .setDescription('授權指定成員借用您的特定角色')
        .addStringOption(o => o.setName('角色名稱').setDescription('填寫您要授權借出的角色ID (例: 拿錢來)').setRequired(true))
        .addUserOption(o => o.setName('對象成員').setDescription('選擇要授權借用的成員 (@小明)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('撤銷')
        .setDescription('收回指定成員對您特定角色的借用權限')
        .addStringOption(o => o.setName('角色名稱').setDescription('填寫您要收回借出的角色ID (例: 拿錢來)').setRequired(true))
        .addUserOption(o => o.setName('對象成員').setDescription('選擇要撤銷借用權限的成員 (@小明)').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('放圖')
    .setDescription('發起熱門地圖交接/放圖')
    .addStringOption(o => o.setName('地圖名稱').setDescription('例如：神木村後半、忘卻6、蛋龍').setRequired(true))
    .addIntegerOption(o => o.setName('頻道').setDescription('所屬頻道號碼 (例: 5)').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('預計多久離開').setDescription('例如：10分鐘後、21:30、半小時後').setRequired(true))
    .addStringOption(o => o.setName('備註說明').setDescription('例如：有死角Bug、需自備祈禱 (選填)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('揪團')
    .setDescription('社群組隊揪團發起 (團練 / 突襲 / 組隊任務)')
    .addSubcommand(sub =>
      sub.setName('團練')
        .setDescription('發起一般地圖團練')
        .addStringOption(o => o.setName('地點').setDescription('例如：蛋龍、忘卻6、神木村').setRequired(true))
        .addStringOption(o => o.setName('開打時間').setDescription('例如：2026.08.22 13:00 或 今晚 8 點').setRequired(true))
        .addStringOption(o => o.setName('綁定需求').setDescription('例如：需綁定主教、鏢賊綁眼、缺火 (選填)').setRequired(false))
        .addStringOption(o => o.setName('自備機台').setDescription('主揪自備支援設備 (例如：設備上限2台，火+祈禱機)').setRequired(false))
        .addStringOption(o => o.setName('備註時長').setDescription('例如：打氣場、打 Hot time 2 小時').setRequired(false))
        .addIntegerOption(o => o.setName('需要人數').setDescription('預計招募人數 (預設 6 人)').setRequired(false).setMinValue(2).setMaxValue(30))
    )
    .addSubcommand(sub =>
      sub.setName('突襲')
        .setDescription('發起 Boss 突襲遠征隊')
        .addStringOption(o => o.setName('目標王').setDescription('例如：闇黑龍王、殘暴炎魔、皮卡啾').setRequired(true))
        .addStringOption(o => o.setName('開打時間').setDescription('例如：今晚 21:00、週六 14:00').setRequired(true))
        .addStringOption(o => o.setName('門檻要求').setDescription('例如：需洗血、主教自備復活用品 (選填)').setRequired(false))
        .addIntegerOption(o => o.setName('需要人數').setDescription('預計招募人數 (預設 6 人)').setRequired(false).setMinValue(2).setMaxValue(30))
    )
    .addSubcommand(sub =>
      sub.setName('組隊任務')
        .setDescription('發起經典組隊任務 (PQ)')
        .addStringOption(o => o.setName('任務名稱').setDescription('例如：羅密歐、女神塔、101、毒霧').setRequired(true))
        .addIntegerOption(o => o.setName('人數').setDescription('需要人數 (必填)').setRequired(true).setMinValue(2).setMaxValue(6))
        .addStringOption(o => o.setName('開打時間').setDescription('例如：現在、半小時後、20:00').setRequired(true))
        .addStringOption(o => o.setName('等級以上').setDescription('例如：70等以上、90等以上 (選填)').setRequired(false))
        .addStringOption(o => o.setName('綁定職業').setDescription('例如：缺法師傳送、缺飛俠瞬移 (選填)').setRequired(false))
    ),

  new SlashCommandBuilder()
    .setName('賭局')
    .setDescription('社群競猜賭局系統 (技能書 / 衝卷 / 打寶)')
    .addSubcommand(sub =>
      sub.setName('技能書')
        .setDescription('發起技能書點擊二選一賭局 (會過 / 爆掉)')
        .addStringOption(o => o.setName('技能書名稱').setDescription('例如：三飛閃30、暴風神射30').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：15m、30m、1h、21:30 等').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('加碼底池 (選填，例如：500w、1000w)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('衝卷')
        .setDescription('發起裝備衝卷過幾卷或自訂數值落點里程碑盤')
        .addStringOption(o => o.setName('裝備名稱').setDescription('例如：紫色衝浪板、楓葉之盔').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：15m、1h、20:00 等').setRequired(true))
        .addIntegerOption(o => o.setName('最大卷數').setDescription('過卷數上限 (1~10，若填自訂選項可不理會)').setRequired(false).setMinValue(1).setMaxValue(10))
        .addStringOption(o => o.setName('選項1').setDescription('【自訂門檻】選項 1 (例：放棄 < 85 G)').setRequired(false))
        .addStringOption(o => o.setName('選項2').setDescription('【自訂門檻】選項 2 (例：及格 85~95 G)').setRequired(false))
        .addStringOption(o => o.setName('選項3').setDescription('【自訂門檻】選項 3 (例：極品 96~105 G)').setRequired(false))
        .addStringOption(o => o.setName('選項4').setDescription('【自訂門檻】選項 4 (例：神裝 > 106 G)').setRequired(false))
        .addStringOption(o => o.setName('選項5').setDescription('【自訂門檻】選項 5 (選填)').setRequired(false))
        .addStringOption(o => o.setName('選項6').setDescription('【自訂門檻】選項 6 (選填)').setRequired(false))
        .addStringOption(o => o.setName('底池金額').setDescription('加碼底池 (選填，例如：500w、1000w)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('打寶')
        .setDescription('發起玩家打寶收穫競猜 (大豐收 / 大暴死)')
        .addStringOption(o => o.setName('目標玩家').setDescription('例如：owl、小明').setRequired(true))
        .addStringOption(o => o.setName('打寶門檻').setDescription('例如：打到價值 1000w 以上寶物、掉落日鏢算過').setRequired(true))
        .addStringOption(o => o.setName('截止時間').setDescription('填寫範例：1h、2h、今晚 23:00').setRequired(true))
        .addStringOption(o => o.setName('底池金額').setDescription('加碼底池 (選填，例如：500w、1000w)').setRequired(false))
    ),

  new SlashCommandBuilder()
    .setName('查看')
    .setDescription('統一查詢中心 (查看進行中團練、突襲、組隊任務、全部揪團或賭局)')
    .addStringOption(o => o.setName('類別').setDescription('選擇要查看的項目').setRequired(true)
      .addChoices(
        { name: '⚔️ 團練', value: 'VIEW_TRAINING' },
        { name: '🐉 突襲', value: 'VIEW_RAID' },
        { name: '🧩 組隊任務', value: 'VIEW_PQ' },
        { name: '📜 全部揪團', value: 'VIEW_ALL_PARTIES' },
        { name: '🎲 賭局', value: 'VIEW_BET' }
      )
    ),

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

  // 每日 08:00 定時任務
  cron.schedule('0 0 8 * * *', async () => {
    try {
      const now = new Date();
      const isFirstDayOfMonth = now.getDate() === 1;

      if (isFirstDayOfMonth && db) {
        try {
          const profilesSnap = await db.collection('member_profiles').get();
          const registeredUids = new Set();
          profilesSnap.forEach(doc => registeredUids.add(doc.data().userId));

          for (const guild of client.guilds.cache.values()) {
            const members = await guild.members.fetch().catch(() => null);
            if (members) {
              for (const member of members.values()) {
                if (!member.user.bot && !registeredUids.has(member.id)) {
                  await member.roles.add(ROLES.UNVERIFIED).catch(() => {});
                  await member.send(`📢 **【冒險家公會每月例行提醒】**\n親愛的冒險家 <@${member.id}>，您尚未在伺服器中完成名冊登記！\n請前往 <#${WELCOME_REGISTER_CHANNEL_ID}> 或輸入 \`/報到\` 登記您的主要職業與角色資訊以獲取完整權限！`).catch(() => {});
                }
              }
            }
          }
        } catch (auditErr) {
          console.error('每月1號稽核失敗:', auditErr.message);
        }
      }

      const channel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (channel && channel.isTextBased()) {
        if (db) {
          const snap = await db.collection('member_profiles').where('mainLevel', '==', '199').where('isRetired', '==', false).get();
          if (!snap.empty) {
            const nowMs = Date.now();
            const countdownTexts = [];
            snap.forEach(doc => {
              const data = doc.data();
              const start = data.reach199At ? data.reach199At.toMillis() : nowMs;
              const days = Math.floor((nowMs - start) / (1000 * 60 * 60 * 24)) + 1;
              countdownTexts.push(`🔥 <@${data.userId}>（\`${data.mainIgn}\` - ${data.mainJob}）邁向 200 等修煉：**第 ${days} 天**！`);
            });
            if (countdownTexts.length) {
              const embed199 = new EmbedBuilder().setColor(0xE74C3C).setTitle('⏳【即將登頂 200 等】巔峰修煉倒數').setDescription(countdownTexts.join('\n'));
              await channel.send({ embeds: [embed199] });
            }
          }
        }

        if (now.getDay() === 2) {
          const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📢【每週例行更新】名冊與等級維護')
            .setDescription('早安冒險家們！又到了每週二更新時間囉～\n請在下方選單選擇職業更新資料！');
          await channel.send({ embeds: [embed], components: [buildMainSelectMenu()] });
        }
      }
    } catch (err) { console.error('定時任務異常:', err); }
  }, { timezone: 'Asia/Taipei' });

  // 每 10 分鐘共用帳號巡檢
  cron.schedule('*/10 * * * *', async () => {
    if (!db) return;
    try {
      const snap = await db.collection('char_statuses').where('isOnline', '==', true).get();
      const now = Date.now();

      for (const doc of snap.docs) {
        const d = doc.data();
        if (now > d.expectedEndTime) {
          const lastNotice = d.lastOverdueNotice || d.expectedEndTime;
          if (now - lastNotice >= 1800000) {
            const user = await client.users.fetch(d.currentUserId).catch(() => null);
            if (user) {
              const overdueMinutes = Math.floor((now - d.expectedEndTime) / 60000);
              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`char_act_offline_${d.charIgn}`).setLabel('🔴 我已離線 (一鍵釋放)').setStyle(ButtonStyle.Danger)
              );

              await user.send({
                content: `⚠️ **【共用帳號逾時提醒】**\n您使用的角色【**${d.charIgn}**】已逾時 \`${overdueMinutes} 分鐘\`！\n若您已離開遊戲，請點擊下方按鈕將狀態釋放為閒置，讓下一位夥伴使用！`,
                components: [row]
              }).catch(() => {});
            }
            await db.collection('char_statuses').doc(doc.id).update({ lastOverdueNotice: now });
          }
        }
      }
    } catch (e) {
      console.error('共用帳號定時巡檢異常:', e.message);
    }
  });
});

client.on(Events.GuildMemberAdd, async (member) => {
  member.roles.add(ROLES.UNVERIFIED).catch(() => {});

  try {
    const welcomeChannel = await client.channels.fetch(WELCOME_REGISTER_CHANNEL_ID).catch(() => null);
    if (welcomeChannel && welcomeChannel.isTextBased()) {
      const welcomeEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🎉 歡迎新冒險家加入伺服器！')
        .setDescription(`歡迎 <@${member.id}> 加入我們的大家庭！\n請點擊下方按鈕完成 **冒險家名冊登記**，即可解鎖完整頻道權限與各項公會工具！`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_new_member_register').setLabel('📝 點我進行新人報到').setStyle(ButtonStyle.Success)
      );

      await welcomeChannel.send({ content: `<@${member.id}>`, embeds: [welcomeEmbed], components: [row] });
    }
  } catch (err) {
    console.error('新人進群引流失敗:', err.message);
  }
});

// ==========================================
// 10. 互動事件核心監聽
// ==========================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ----------------------------------------
    // [A] 斜線指令處理
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // 1. /角色狀態 (儀表板 / 單一角色授權 / 撤銷)
      if (commandName === '角色狀態') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const subCommand = interaction.options.getSubcommand();

        if (subCommand === '儀表板') {
          await interaction.deferReply({ ephemeral: true });

          const allCharsSnap = await db.collection('char_statuses').get();
          const isSuper = interaction.user.id === SUPER_ADMIN_ID;

          const myOwnedChars = [];
          const authorizedChars = [];
          const otherChars = [];

          allCharsSnap.forEach(doc => {
            const d = doc.data();
            const charIgn = d.charIgn;
            const job = d.job || '冒險家';
            const owners = d.owners || [];
            const authUsers = d.authorizedUsers || [];

            if (owners.includes(interaction.user.id)) {
              myOwnedChars.push({ ign: charIgn, job, type: 'OWNED', label: `👑 本人角色：${charIgn} (${job})` });
            } else if (authUsers.includes(interaction.user.id)) {
              authorizedChars.push({ ign: charIgn, job, type: 'AUTH', label: `🤝 已授權借用：${charIgn} (${job})` });
            } else if (isSuper) {
              otherChars.push({ ign: charIgn, job, type: 'OTHER', label: `🌐 全服角色：${charIgn} (${job})` });
            }
          });

          const displayChars = isSuper
            ? [...myOwnedChars, ...authorizedChars, ...otherChars]
            : [...myOwnedChars, ...authorizedChars];

          if (displayChars.length === 0) {
            return interaction.editReply('📜 您尚未在 `/報到` 中登記角色，或尚未獲得任何角色的借用授權。');
          }

          const options = displayChars.map(c =>
            new StringSelectMenuOptionBuilder()
              .setLabel(c.label.substring(0, 100))
              .setValue(`char_select_${c.ign}`)
              .setDescription(`${c.type === 'OWNED' ? '擁有者特權' : (c.type === 'AUTH' ? '已獲借用授權' : '上帝視角全服角色')}`)
          );

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_char_status_dashboard').setPlaceholder('🔽 請點此選擇要查看狀態的角色').addOptions(options.slice(0, 25))
          );

          return await interaction.editReply({
            content: '👉 **請在下方選單選擇角色，即可查看即時在線/借用狀態：**',
            components: [row]
          });
        }

        if (subCommand === '授權') {
          await interaction.deferReply({ ephemeral: true });
          const targetIgn = interaction.options.getString('角色名稱').trim();
          const targetUser = interaction.options.getUser('對象成員');

          const statusDoc = await getCharStatusDoc(targetIgn);
          if (!statusDoc) return interaction.editReply(`❌ 找不到角色【**${targetIgn}**】！請確認該角色已在 \`/報到\` 中登記。`);

          const isOwner = statusDoc.owners?.includes(interaction.user.id) || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
          if (!isOwner) return interaction.editReply(`❌ 您不是角色【**${targetIgn}**】的所有權人，無法進行授權操作！`);

          const authUsers = statusDoc.authorizedUsers || [];
          if (!authUsers.includes(targetUser.id)) {
            authUsers.push(targetUser.id);
            await db.collection('char_statuses').doc(targetIgn.toLowerCase()).update({ authorizedUsers: authUsers });
          }

          return await interaction.editReply(`🎉 成功授權 <@${targetUser.id}> 借用您的單一角色【**${targetIgn}**】！\n對方的 \`/角色狀態 儀表板\` 選單中已可直接查看與登記該角色！`);
        }

        if (subCommand === '撤銷') {
          await interaction.deferReply({ ephemeral: true });
          const targetIgn = interaction.options.getString('角色名稱').trim();
          const targetUser = interaction.options.getUser('對象成員');

          const statusDoc = await getCharStatusDoc(targetIgn);
          if (!statusDoc) return interaction.editReply(`❌ 找不到角色【**${targetIgn}**】！`);

          const isOwner = statusDoc.owners?.includes(interaction.user.id) || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
          if (!isOwner) return interaction.editReply(`❌ 您不是角色【**${targetIgn}**】的所有權人，無法進行撤銷操作！`);

          let authUsers = statusDoc.authorizedUsers || [];
          authUsers = authUsers.filter(uid => uid !== targetUser.id);
          await db.collection('char_statuses').doc(targetIgn.toLowerCase()).update({ authorizedUsers: authUsers });

          return await interaction.editReply(`🔒 已成功收回 <@${targetUser.id}> 對角色【**${targetIgn}**】的單一借用授權。`);
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
        const mapData = {
          id: mapRef.id,
          creatorId: interaction.user.id,
          mapName, channelNum, leaveTime, note,
          takerId: null,
          isFinished: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const msg = await interaction.editReply({
          embeds: [createMapShareEmbed(mapData)],
          components: createMapShareComponents(mapRef.id, mapData)
        });

        mapData.channelId = interaction.channelId;
        mapData.messageId = msg.id;
        await mapRef.set(mapData);
        return;
      }

      // 3. /揪團 (發起)
      if (commandName === '揪團') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const subCommand = interaction.options.getSubcommand();
        await interaction.deferReply();

        let target, startTime, bindReq, creatorDevice, duration, maxCount, partyType;

        if (subCommand === '團練') {
          partyType = 'training';
          target = interaction.options.getString('地點');
          startTime = interaction.options.getString('開打時間');
          bindReq = interaction.options.getString('綁定需求') || '無特殊限制';
          creatorDevice = interaction.options.getString('自備機台') || '無自備';
          duration = interaction.options.getString('備註時長') || '打氣場 / 配合隊伍';
          maxCount = interaction.options.getInteger('需要人數') || 6;
        } else if (subCommand === '突襲') {
          partyType = 'raid';
          target = interaction.options.getString('目標王');
          startTime = interaction.options.getString('開打時間');
          bindReq = interaction.options.getString('門檻要求') || '無特殊限制';
          creatorDevice = '無自備';
          duration = '打完為止';
          maxCount = interaction.options.getInteger('需要人數') || 6;
        } else if (subCommand === '組隊任務') {
          partyType = 'pq';
          target = interaction.options.getString('任務名稱');
          maxCount = interaction.options.getInteger('人數');
          startTime = interaction.options.getString('開打時間');
          const minLv = interaction.options.getString('等級以上') || '無限制';
          const bindJob = interaction.options.getString('綁定職業') || '無限制';
          bindReq = `等級: ${minLv} | 綁定: ${bindJob}`;
          creatorDevice = '無自備';
          duration = '連刷/配合隊伍';
        }

        const partyRef = db.collection('party_trainings').doc();
        const partyData = {
          id: partyRef.id,
          creatorId: interaction.user.id,
          partyType, target, startTime, bindReq, creatorDevice, duration, maxCount,
          members: [],
          isClosed: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const msg = await interaction.editReply({
          embeds: [createPartyEmbed(partyData)],
          components: createPartyComponents(partyRef.id, false)
        });

        partyData.channelId = interaction.channelId;
        partyData.messageId = msg.id;
        await partyRef.set(partyData);
        return;
      }

      // 4. /賭局 (發起)
      if (commandName === '賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const subCommand = interaction.options.getSubcommand();

        const activeBet = await getActiveBetDoc();
        if (activeBet) return interaction.reply({ content: '⚠️ 目前已有進行中的賭局，請先使用 `/查看 賭局` 或等待結算！', ephemeral: true });

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
            betType: 'book',
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
          const rawDeadline = interaction.options.getString('截止時間');
          const maxScroll = interaction.options.getInteger('最大卷數') || 7;
          const rawSeed = interaction.options.getString('底池金額');

          const deadline = parseDeadline(rawDeadline);
          const seedMoney = parseMoneyInput(rawSeed);

          if (!deadline) return interaction.editReply('❌ 時間格式無效！請輸入如 `15m`、`1h`、`20:00`。');

          const customOptions = [
            interaction.options.getString('選項1'),
            interaction.options.getString('選項2'),
            interaction.options.getString('選項3'),
            interaction.options.getString('選項4'),
            interaction.options.getString('選項5'),
            interaction.options.getString('選項6')
          ].filter(Boolean);

          const options = [];

          if (customOptions.length >= 2) {
            customOptions.forEach(optText => {
              options.push({ name: `🎯 ${optText.trim()}`, pool: 0, bets: {} });
            });
          } else {
            for (let i = 0; i <= maxScroll; i++) {
              let label = `+${i} 卷`;
              if (i === 0) label = `💀 +0 (全爆)`;
              else if (i === maxScroll) label = `👑 +${i} (完美神裝)`;
              options.push({ name: label, pool: 0, bets: {} });
            }
          }

          const betDocRef = db.collection('active_bets').doc();
          const betData = {
            id: betDocRef.id,
            creatorId: interaction.user.id,
            creatorName: interaction.user.username,
            betType: 'scroll',
            title: customOptions.length >= 2 ? `【${equipName}】自訂數值落點/里程碑盤` : `【${equipName}】能過幾卷？(上限 +${maxScroll})`,
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

        if (subCommand === '打寶') {
          await interaction.deferReply();
          const targetPlayer = interaction.options.getString('目標玩家');
          const lootGoal = interaction.options.getString('打寶門檻');
          const rawDeadline = interaction.options.getString('截止時間');
          const rawSeed = interaction.options.getString('底池金額');

          const deadline = parseDeadline(rawDeadline);
          const seedMoney = parseMoneyInput(rawSeed);

          if (!deadline) return interaction.editReply('❌ 時間格式無效！請輸入如 `1h`、`2h`、`23:00`。');

          const betDocRef = db.collection('active_bets').doc();
          const options = [
            { name: `🟢【大豐收】成功打到 (${lootGoal})`, pool: 0, bets: {} },
            { name: `🔴【大暴死】槓龜 / 未達門檻`, pool: 0, bets: {} }
          ];

          const betData = {
            id: betDocRef.id,
            creatorId: interaction.user.id,
            creatorName: interaction.user.username,
            betType: 'loot',
            title: `【${targetPlayer}】能否打到寶？門檻：${lootGoal}`,
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
      }

      // 5. /查看 (統一查詢中心)
      if (commandName === '查看') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', ephemeral: true });
        const viewType = interaction.options.getString('類別');
        await interaction.deferReply();

        if (viewType === 'VIEW_BET') {
          const activeBetDoc = await getActiveBetDoc();
          if (!activeBetDoc) return interaction.editReply('🎲 目前沒有進行中的賭局，輸入 `/賭局` 來開一盤吧！');
          const betData = activeBetDoc.data();
          return await interaction.editReply({
            embeds: [createMultiBetEmbed(betData)],
            components: createMultiBetComponents(betData.id, betData.options, betData.isScroll)
          });
        }

        const snap = await db.collection('party_trainings').where('isClosed', '==', false).get();
        if (snap.empty) return interaction.editReply('📜 目前沒有進行招募中的隊伍，使用 `/揪團` 發起一個吧！');

        const nowMs = Date.now();
        let activeParties = [];

        for (const doc of snap.docs) {
          const d = doc.data();
          const createdMs = d.createdAt?.toMillis?.() || nowMs;
          if (nowMs - createdMs > 43200000) {
            await db.collection('party_trainings').doc(d.id).update({ isClosed: true }).catch(() => {});
          } else {
            activeParties.push(d);
          }
        }

        if (viewType === 'VIEW_TRAINING') activeParties = activeParties.filter(p => p.partyType === 'training');
        else if (viewType === 'VIEW_RAID') activeParties = activeParties.filter(p => p.partyType === 'raid');
        else if (viewType === 'VIEW_PQ') activeParties = activeParties.filter(p => p.partyType === 'pq');

        if (activeParties.length === 0) {
          return interaction.editReply('📜 該分類目前沒有進行招募中的隊伍，使用 `/揪團` 發起一個新團吧！');
        }

        activeParties.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        const partyListEmbed = new EmbedBuilder().setColor(0x3498DB).setTitle('⚔️【進行中揪團總覽】');
        const selectMenuOptions = [];

        activeParties.slice(0, 5).forEach((d, idx) => {
          const memberCount = d.members?.length || 0;
          const buffPool = [];
          (d.members || []).forEach(m => {
            Object.entries(m.buffs || {}).forEach(([k, v]) => buffPool.push(`${k}(${v})`));
          });

          partyListEmbed.addFields({
            name: `${idx + 1}. 📍 ${d.target} (${memberCount}/${d.maxCount}人) - 隊長: <@${d.creatorId}>`,
            value: `⏰ **時間**：\`${d.startTime}\` | 📌 **限制**：\`${d.bindReq}\`\n✨ **Buff**：\`${buffPool.length ? buffPool.join(' | ') : '暫無'}\``,
            inline: false
          });

          selectMenuOptions.push(
            new StringSelectMenuOptionBuilder()
              .setLabel(`${idx + 1}. 報名【${d.target}】(${memberCount}/${d.maxCount}人)`.substring(0, 100))
              .setValue(`party_view_join_${d.id}`)
              .setDescription(`時間: ${d.startTime}`.substring(0, 100))
          );
        });

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_party_to_join').setPlaceholder('🔽 點此直接選擇並加入其中一團').addOptions(selectMenuOptions)
        );

        return await interaction.editReply({ embeds: [partyListEmbed], components: [row] });
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

      if (customId === 'btn_new_member_register') {
        const prevData = await fetchUserDocSafe(interaction.user.id);
        const defaultJob = Object.keys(ROLES.JOBS)[0];
        userChoiceMap.set(interaction.user.id, defaultJob);
        return await interaction.showModal(createRegisterModal(defaultJob, prevData));
      }

      // 放圖操作
      if (customId.startsWith('map_take_')) {
        await interaction.deferReply({ ephemeral: true });
        const mapId = customId.replace('map_take_', '');
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.editReply('❌ 該放圖資訊已失效。');
        const mapData = mapDoc.data();

        if (mapData.takerId) return interaction.editReply(`⚠️ 該地圖剛好被 <@${mapData.takerId}> 搶先預約囉！`);

        await db.collection('map_shares').doc(mapId).update({ takerId: interaction.user.id });
        mapData.takerId = interaction.user.id;

        if (mapData.channelId && mapData.messageId) {
          const ch = await client.channels.fetch(mapData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(mapData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createMapShareEmbed(mapData)], components: createMapShareComponents(mapId, mapData) });
          }
        }
        return await interaction.editReply(`🎉 成功預約地圖【**${mapData.mapName}** (第 ${mapData.channelNum} 頻)】！請依照約定時間前往交接。`);
      }

      if (customId.startsWith('map_cancel_')) {
        await interaction.deferReply({ ephemeral: true });
        const mapId = customId.replace('map_cancel_', '');
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.editReply('❌ 該放圖資訊已失效。');
        const mapData = mapDoc.data();

        const isTaker = mapData.takerId === interaction.user.id;
        const isOwner = mapData.creatorId === interaction.user.id;
        const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);

        if (!isTaker && !isOwner && !isAdmin) return interaction.editReply('❌ 您不是預約者或放圖者，無法取消預約！');

        await db.collection('map_shares').doc(mapId).update({ takerId: null });
        mapData.takerId = null;

        if (mapData.channelId && mapData.messageId) {
          const ch = await client.channels.fetch(mapData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(mapData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createMapShareEmbed(mapData)], components: createMapShareComponents(mapId, mapData) });
          }
        }
        return await interaction.editReply(`✅ 已取消對【**${mapData.mapName}**】的預約，地圖已重新釋出！`);
      }

      if (customId.startsWith('map_done_')) {
        await interaction.deferReply({ ephemeral: true });
        const mapId = customId.replace('map_done_', '');
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.editReply('❌ 該放圖資訊已失效。');
        const mapData = mapDoc.data();

        const isOwner = mapData.creatorId === interaction.user.id;
        const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);

        if (!isOwner && !isAdmin) return interaction.editReply('❌ 只有放圖者或管理員可確認交接完成！');

        await db.collection('map_shares').doc(mapId).update({ isFinished: true });
        mapData.isFinished = true;

        if (mapData.channelId && mapData.messageId) {
          const ch = await client.channels.fetch(mapData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(mapData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createMapShareEmbed(mapData)], components: [] });
          }
        }
        return await interaction.editReply(`🤝 地圖【**${mapData.mapName}**】交接完成，面板已順利結案！`);
      }

      // 角色共用操作
      if (customId.startsWith('char_act_online_')) {
        const charIgn = customId.replace('char_act_online_', '');
        const modal = new ModalBuilder().setCustomId(`modal_char_online_${charIgn}`).setTitle(`登記上線 - 【${charIgn}】`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('input_use_duration')
            .setLabel('預計使用時長 (例: 10m, 30m, 1h, 2h)')
            .setPlaceholder('純放Buff填 10m，練等填 1h 或 2h')
            .setValue('1h')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('char_act_offline_')) {
        await interaction.deferReply({ ephemeral: true });
        const charIgn = customId.replace('char_act_offline_', '');
        const statusDoc = await getCharStatusDoc(charIgn);

        const isOwner = statusDoc?.owners?.includes(interaction.user.id) || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
        const isCurrentUser = statusDoc?.currentUserId === interaction.user.id;

        if (!isCurrentUser && !isOwner) {
          return interaction.editReply('❌ 您不是目前的使用者或所有權人，無法執行離線操作！');
        }

        await db.collection('char_statuses').doc(charIgn.toLowerCase()).set({
          charIgn, isOnline: false, currentUserId: null, currentUserName: null,
          startTime: 0, expectedEndTime: 0, lastOverdueNotice: 0
        }, { merge: true });

        const embed = createCharStatusEmbed(charIgn, { isOnline: false }, isOwner ? '👑 所有權人' : '🤝 授權使用者');
        const components = createCharStatusComponents(charIgn, { isOnline: false }, isOwner, false);

        return await interaction.editReply({ content: `✅ 角色【**${charIgn}**】已成功標記為【🟢 閒置中】，感謝您的配合！`, embeds: [embed], components });
      }

      if (customId.startsWith('char_act_knock_')) {
        const charIgn = customId.replace('char_act_knock_', '');
        const modal = new ModalBuilder().setCustomId(`modal_char_knock_${charIgn}`).setTitle(`敲門提醒 - 【${charIgn}】`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('input_knock_minutes')
            .setLabel('預計幾分鐘後需要使用？(最低限制 10 分鐘)')
            .setPlaceholder('填寫數字，例如：15、30、60')
            .setValue('15')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('char_act_force_')) {
        await interaction.deferReply({ ephemeral: true });
        const charIgn = customId.replace('char_act_force_', '');
        const statusDoc = await getCharStatusDoc(charIgn);

        const isOwner = statusDoc?.owners?.includes(interaction.user.id) || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
        if (!isOwner) return interaction.editReply('❌ 只有角色所有權人或超級管理員可以使用強制收回特權！');

        const prevUser = statusDoc?.currentUserId;
        await db.collection('char_statuses').doc(charIgn.toLowerCase()).set({
          charIgn, isOnline: false, currentUserId: null, currentUserName: null,
          startTime: 0, expectedEndTime: 0, lastOverdueNotice: 0
        }, { merge: true });

        if (prevUser) {
          const userObj = await client.users.fetch(prevUser).catch(() => null);
          if (userObj) {
            userObj.send(`⚡ **【角色收回通知】**\n角色【**${charIgn}**】的管理特權擁有者 <@${interaction.user.id}> 已強制收回並重置狀態為閒置。`).catch(() => {});
          }
        }

        const embed = createCharStatusEmbed(charIgn, { isOnline: false }, '👑 所有權人');
        const components = createCharStatusComponents(charIgn, { isOnline: false }, true, false);

        return await interaction.editReply({ content: `⚡ 已強制將【**${charIgn}**】收回並重置為【🟢 閒置中】！`, embeds: [embed], components });
      }

      // 揪團報名
      if (customId.startsWith('party_join_')) {
        const partyId = customId.replace('party_join_', '');
        const partyDoc = await db.collection('party_trainings').doc(partyId).get();
        if (!partyDoc.exists) return interaction.reply({ content: '❌ 該揪團已不存在。', ephemeral: true });

        const partyData = partyDoc.data();
        if (partyData.isClosed) return interaction.reply({ content: '🔒 該揪團已關閉招募。', ephemeral: true });

        const prevData = await fetchUserDocSafe(interaction.user.id);
        const rows = [];
        let currentRow = new ActionRowBuilder();

        if (prevData.mainIgn) {
          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`party_reg_char_${partyId}_main`)
              .setLabel(`👑 本尊：${prevData.mainIgn} (${prevData.mainJob})`.substring(0, 80))
              .setStyle(ButtonStyle.Success)
          );
        }

        if (prevData.subs && Array.isArray(prevData.subs)) {
          prevData.subs.slice(0, 3).forEach((s, idx) => {
            currentRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`party_reg_char_${partyId}_sub_${idx}`)
                .setLabel(`⚔️ ${s.ign} (${s.job})`.substring(0, 80))
                .setStyle(ButtonStyle.Primary)
            );
          });
        }

        if (currentRow.components.length > 0) rows.push(currentRow);

        const customRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`party_reg_char_${partyId}_custom`)
            .setLabel('✏️ 自訂角色資訊與職業')
            .setStyle(ButtonStyle.Secondary)
        );
        rows.push(customRow);

        return await interaction.reply({
          content: '👉 **請點擊下方按鈕選擇你要報名的角色（將直接打開 Buff 登記表單）：**',
          components: rows,
          ephemeral: true
        });
      }

      if (customId.startsWith('party_reg_char_')) {
        const parts = customId.split('_');
        const partyId = parts[3];
        const type = parts[4];

        const prevData = await fetchUserDocSafe(interaction.user.id);
        let charIgn = prevData.mainIgn || interaction.user.displayName;
        let charJob = prevData.mainJob || '黑騎士';
        let charLevel = prevData.mainLevel || '120';

        if (type === 'sub') {
          const subIdx = parseInt(parts[5]);
          const sub = prevData.subs?.[subIdx];
          if (sub) { charIgn = sub.ign; charJob = sub.job; charLevel = sub.level; }
        } else if (type === 'custom') {
          charIgn = interaction.user.displayName;
          charJob = '黑騎士';
          charLevel = '120';
        }

        return await interaction.showModal(createPartyBuffModal(partyId, charIgn, charJob, charLevel));
      }

      if (customId.startsWith('party_leave_')) {
        const partyId = customId.replace('party_leave_', '');
        const partyDoc = await db.collection('party_trainings').doc(partyId).get();
        if (!partyDoc.exists) return interaction.reply({ content: '❌ 該揪團已不存在。', ephemeral: true });

        const partyData = partyDoc.data();
        const newMembers = (partyData.members || []).filter(m => m.userId !== interaction.user.id);

        await db.collection('party_trainings').doc(partyId).update({ members: newMembers });
        await updatePartyMainMessage(partyData, newMembers, partyData.isClosed);

        return await interaction.reply({ content: '✅ 已為您取消報名此揪團！', ephemeral: true });
      }

      if (customId.startsWith('party_close_')) {
        const partyId = customId.replace('party_close_', '');
        const partyDoc = await db.collection('party_trainings').doc(partyId).get();
        if (!partyDoc.exists) return interaction.reply({ content: '❌ 該揪團已不存在。', ephemeral: true });

        const partyData = partyDoc.data();
        const isCreator = interaction.user.id === partyData.creatorId;
        const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);

        if (!isCreator && !isAdmin) return interaction.reply({ content: '❌ 只有主揪隊長或管理員可關閉揪團！', ephemeral: true });

        await db.collection('party_trainings').doc(partyId).update({ isClosed: true });
        await updatePartyMainMessage(partyData, partyData.members || [], true);

        return await interaction.reply({ content: '🔒 揪團已成功關閉！祝各位冒險家任務順利！', ephemeral: true });
      }

      if (customId === 'btn_quick_edit') {
        const prevData = await fetchUserDocSafe(interaction.user.id);
        const defaultJob = Object.keys(ROLES.JOBS)[0];
        userChoiceMap.set(interaction.user.id, defaultJob);
        return await interaction.showModal(createRegisterModal(defaultJob, prevData));
      }

      // 賭局管理
      if (customId.startsWith('bet_admin_pause_')) {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.reply({ content: '❌ 僅伺服器管理員可操作！', ephemeral: true });
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

      if (customId.startsWith('bet_admin_delete_')) {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.reply({ content: '❌ 僅伺服器管理員可操作！', ephemeral: true });
        const betId = customId.replace('bet_admin_delete_', '');
        await db.collection('active_bets').doc(betId).delete();
        await interaction.message.edit({ content: '🗑️ **【賭局已廢除】該局已被管理員手動取消與刪除。**', embeds: [], components: [] });
        return await interaction.reply({ content: '✅ 已成功刪除廢除該賭局！', ephemeral: true });
      }

      if (customId.startsWith('bet_settle_btn_')) {
        const betId = customId.replace('bet_settle_btn_', '');
        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 該賭局已失效。', ephemeral: true });

        const betData = betDoc.data();
        const isCreator = interaction.user.id === betData.creatorId;
        const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);

        if (!isCreator && !isAdmin) return interaction.reply({ content: '❌ 只有發起人或管理員可以結算！', ephemeral: true });
        if (Date.now() < betData.deadline && !isAdmin) return interaction.reply({ content: `⏳ 尚未到達截止時間！請在 <t:${Math.floor(betData.deadline / 1000)}:R> 後再進行結算。`, ephemeral: true });
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

      if (customId.startsWith('bet_pity_donate_')) {
        const betId = customId.replace('bet_pity_donate_', '');
        const betDoc = await db.collection('active_bets').doc(betId).get();
        if (!betDoc.exists) return interaction.reply({ content: '❌ 賭局已失效', ephemeral: true });
        const betData = betDoc.data();

        if (betData.isPaused || Date.now() >= betData.deadline) return interaction.reply({ content: '🛑 該賭局目前不接受下注/抖內！', ephemeral: true });

        const randomPityQuote = getRandomPity(betData.betType);
        const modal = new ModalBuilder().setCustomId(`modal_pity_donate_${betId}`).setTitle(`🩹 暴死深切救濟慰問 (私密)`);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('input_pity_amount').setLabel(`${randomPityQuote.substring(0, 44)}`).setPlaceholder('填寫救濟金額 (例如：100w、500w)').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

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
    // [C] 下拉選單處理
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_char_status_dashboard') {
        await interaction.deferReply({ ephemeral: true });
        const selectedVal = interaction.values[0];
        const charIgn = selectedVal.replace('char_select_', '');

        const statusDoc = await getCharStatusDoc(charIgn);
        const myProfile = await fetchUserDocSafe(interaction.user.id);

        let isOwner = false;
        if (myProfile.mainIgn?.toLowerCase() === charIgn.toLowerCase()) isOwner = true;
        if (myProfile.subs && myProfile.subs.some(s => s?.ign?.toLowerCase() === charIgn.toLowerCase())) isOwner = true;
        if (statusDoc?.owners?.includes(interaction.user.id)) isOwner = true;
        if (isSuperAdmin(interaction.user.id, interaction.memberPermissions)) isOwner = true;

        const isCurrentUser = statusDoc?.currentUserId === interaction.user.id;
        const userRoleText = isOwner ? '👑 所有權人 (具備管理特權)' : '🤝 授權借用者';

        const embed = createCharStatusEmbed(charIgn, statusDoc, userRoleText);
        const components = createCharStatusComponents(charIgn, statusDoc, isOwner, isCurrentUser);

        return await interaction.editReply({ embeds: [embed], components });
      }

      if (interaction.customId === 'select_party_to_join') {
        const selectedVal = interaction.values[0];
        const partyId = selectedVal.replace('party_view_join_', '');

        const prevData = await fetchUserDocSafe(interaction.user.id);
        const rows = [];
        let currentRow = new ActionRowBuilder();

        if (prevData.mainIgn) {
          currentRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`party_reg_char_${partyId}_main`)
              .setLabel(`👑 本尊：${prevData.mainIgn} (${prevData.mainJob})`.substring(0, 80))
              .setStyle(ButtonStyle.Success)
          );
        }

        if (prevData.subs && Array.isArray(prevData.subs)) {
          prevData.subs.slice(0, 3).forEach((s, idx) => {
            currentRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`party_reg_char_${partyId}_sub_${idx}`)
                .setLabel(`⚔️ ${s.ign} (${s.job})`.substring(0, 80))
                .setStyle(ButtonStyle.Primary)
            );
          });
        }

        if (currentRow.components.length > 0) rows.push(currentRow);

        const customRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`party_reg_char_${partyId}_custom`)
            .setLabel('✏️ 自訂角色資訊與職業')
            .setStyle(ButtonStyle.Secondary)
        );
        rows.push(customRow);

        return await interaction.reply({
          content: '👉 **請點擊下方按鈕選擇你要報名的角色（將直接打開 Buff 登記表單）：**',
          components: rows,
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith('bet_select_opt_')) {
        const betId = interaction.customId.replace('bet_select_opt_', '');
        const optIdx = parseInt(interaction.values[0]);
        userChoiceMap.set(`bet_choice_${interaction.user.id}_${betId}`, optIdx);
        return await interaction.reply({ content: `👉 已選中第 ${optIdx + 1} 個選項，現在可點擊下方按鈕下注！`, ephemeral: true });
      }

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

        const isBust = winOption.name.includes('+0') || winOption.name.includes('全爆') || winOption.name.includes('爆掉') || winOption.name.includes('放棄') || winOption.name.includes('大暴死');
        const donations = Object.entries(betData.pityDonations || {});

        if (isBust && donations.length > 0) {
          resultsText += `\n\u001b[1;35m=== 乾爹乾媽名冊 (功德無量暖心救濟） ===\u001b[0m\n`;
          donations.forEach(([uid, d]) => {
            const action = getRandomDonorAction();
            resultsText += `\u001b[0;35m[${d.ign}_${action}_+${formatMeso(d.amount)}楓幣]\u001b[0m\n`;
          });
        }

        resultsText += '
