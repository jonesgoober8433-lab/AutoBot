require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, SlashCommandBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, PermissionFlagsBits, Events, MessageFlags
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');
const cron = require('node-cron');

// ==========================================
// 0. 全域防崩潰守護
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

// 隊伍 Buff 標準清單
const STANDARD_PARTY_BUFFS = ['眼', '速', '火', '祈禱', '楓祝', '煙霧彈', '置換', '極速'];

// 每個 Buff 的圖示（隊長設定需求時用 icon 點選增減）
const PARTY_BUFF_ICONS = {
  '眼': '🎯', '速': '⚡', '火': '🔥', '祈禱': '✨',
  '楓祝': '🍁', '煙霧彈': '💨', '置換': '🔄', '極速': '🥊'
};
function buffIcon(name) { return PARTY_BUFF_ICONS[name] || '✨'; }

// 使用者自填的暱稱／角色名可能含反引號或 *_~ 之類的 Markdown 符號。
// 只要有一個反引號，後面整段名冊的程式碼區塊就會錯位，排版全部跑掉。
// codeSafe：要放進 `...` 裡的字串，反引號換成外觀相近的全形撇號
function codeSafe(s) {
  return String(s ?? '').replace(/`/g, '＇').replace(/[\r\n]+/g, ' ');
}
// mdSafe：直接露在文字裡的字串，把 Markdown 符號逐一跳脫
function mdSafe(s) {
  return String(s ?? '').replace(/([\\`*_~|<>])/g, '\\$1').replace(/[\r\n]+/g, ' ');
}

// 正服/阿泰爾對齊經驗表
const CLASSIC_EXP_TABLE = [
  0, 15, 34, 57, 92, 135, 372, 560, 840, 1242,
  1600, 2100, 2750, 3550, 4550, 5800, 7350, 9250, 11550, 14350,
  17750, 21850, 26750, 32550, 39400, 47450, 56850, 67750, 80350, 94850,
  111500, 130500, 152100, 176600, 204300, 235500, 270500, 309700, 353500, 402300,
  456500, 516700, 583300, 656900, 738000, 827200, 925100, 1032300, 1149500, 1277300,
  1416500, 1567800, 1732000, 1910000, 2102500, 2310500, 2535000, 2777000, 3037700, 3318200,
  3619700, 3943400, 4290700, 4662800, 5061200, 5487400, 5942900, 6429400, 6948500, 7502000,
  8092000, 8720000, 9388000, 10098000, 10852000, 11652000, 12500000, 13398000, 14348000, 15352000,
  16412000, 17530000, 18708000, 19948000, 21252000, 22622000, 24060000, 25568000, 27148000, 28802000,
  30532000, 32340000, 34228000, 36198000, 38252000, 40392000, 42620000, 44938000, 47348000, 49852000,
  52452000, 55150000, 57948000, 60848000, 63852000, 66962000, 70180000, 73508000, 76948000, 80502000,
  84172000, 87960000, 91868000, 95898000, 100052000, 104332000, 108740000, 113278000, 117948000, 122752000,
  127692000, 132770000, 137988000, 143348000, 148852000, 154502000, 160300000, 166248000, 172348000, 178602000,
  185012000, 191580000, 198308000, 205198000, 212252000, 219472000, 226860000, 234418000, 242148000, 250052000,
  258132000, 266390000, 274787000, 283448000, 292252000, 301242000, 310420000, 319788000, 329348000, 339102000,
  349052000, 359200000, 369548000, 380098000, 390852000, 401812000, 412980000, 424358000, 435948000, 447752000,
  459772000, 472010000, 484468000, 497148000, 510052000, 523182000, 536540000, 550128000, 563948000, 578002000,
  592292000, 606820000, 621588000, 636598000, 651852000, 667235000, 682980000, 698868000, 715008000, 731402000,
  748052000, 764960000, 782128000, 799558000, 817252000, 835212000, 853440000, 871938000, 890708000, 909752000,
  929072000, 948670000, 968548000, 988708000, 1009152000, 1029882000, 1050900000, 1072208000, 1093808000, 1115702000
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
  "施捨一張回家卷軸買水錢，兄弟撐住！"
];

// 賭局選項數量上下限：上限 10 是因為面板最多排兩列按鈕（每列 5 顆）
const BET_MIN_OPTIONS = 2;
const BET_MAX_OPTIONS = 10;

// 把發起人填的「每行一個選項」轉成選項陣列
function parseBetOptions(raw) {
  const seen = new Set(), out = [];
  (raw || '').split(/\r?\n/).forEach(line => {
    const name = line.trim().slice(0, 80);          // 80 是 Discord 按鈕文字上限
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;                       // 同名選項只留一個
    seen.add(key);
    out.push({ name, pool: 0, bets: {} });
  });
  return out.slice(0, BET_MAX_OPTIONS);
}

const BOOK_SUCCESS_QUOTES = [
  "給你機會你不中用呀！竟然點過了，善款沒收省下一筆！",
  "恭喜點過！這筆善款是要捐給難民的，看來你不需要了～",
  "可惡！本來想看煙火的，省下一筆急難救助金！",
  "算你運氣好！這筆心靈撫慰金留給下一個爆書的苦主吧！",
  "居然過了！？救濟金自動退回慈善家口袋～"
];

const wizardSessionMap = new Map();
const userChoiceMap = new Map();

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
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});
client.on('error', (err) => console.error('⚠️ Discord Client 發生錯誤:', err));

// ==========================================
// 4. 輔助計算工具與里程碑判定
// ==========================================
async function checkLevelMilestone(guild, user, prevLevel, newLevel, mainIgn, job) {
  const pL = parseInt(prevLevel) || 0;
  const nL = parseInt(newLevel) || 0;
  if (nL <= pL) return null;

  let privateEmbed = null;

  if (pL < 70 && nL >= 70) {
    privateEmbed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🎖️【三轉強者誕生】達成 70 級重大突破！')
      .setDescription(`恭喜 <@${user.id}>（\`${mainIgn}\`）順利突破 70 級！\n正式踏入 ${job} 的高階冒險領域，向更強大的首領邁進吧！✨`);
  }

  const prevDecade = Math.floor(pL / 10);
  const newDecade = Math.floor(nL / 10);

  if (newDecade > prevDecade && nL >= 120) {
    const milestoneLevel = Math.min(200, newDecade * 10);
    try {
      const channel = await guild.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (channel?.isTextBased()) {
        const is200 = milestoneLevel === 200 || nL >= 200;
        const publicEmbed = new EmbedBuilder()
          .setColor(is200 ? 0xF1C40F : 0xE67E22)
          .setTitle(is200 ? '👑【全伺服器賀喜】頂點傳奇達成！Lv 200 典獄長誕生！' : '🎉【公會榮耀里程碑】等級重大突破！')
          .setDescription(`冒險家 <@${user.id}>（\`${mainIgn}\`）達成 **Lv.${milestoneLevel} ${job}** 壯舉！（目前已達 Lv.${nL}）\n全體成員為這份堅持與熱血喝采！🔥`)
          .setTimestamp();

        await channel.send({
          content: is200 ? '🎊 @everyone 傳奇現世！' : undefined,
          embeds: [publicEmbed]
        });
      }
    } catch (e) { console.error('發送升級祝賀失敗:', e); }
  }

  return privateEmbed;
}

// ==========================================
// 台北時區工具：Render 主機跑 UTC，所有「牆上時間」都必須明確換算
// 台灣無日光節約時間，固定 UTC+8
// ==========================================
const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;

// 把「台北的年月日時分」轉成正確的 epoch 毫秒
function tpeWallClockToMs(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0) - TPE_OFFSET_MS;
}

// 取得「現在」在台北是幾年幾月幾日
function tpeToday(nowMs = Date.now()) {
  const d = new Date(nowMs + TPE_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

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
    const hh = parseInt(time[1]), mm = parseInt(time[2]);
    if (hh > 23 || mm > 59) return null;
    const t = tpeToday(now.getTime());
    let ms = tpeWallClockToMs(t.year, t.month, t.day, hh, mm);
    if (ms <= now.getTime()) ms += 86400000; // 已過就算明天同一時刻
    return ms;
  }
  const parsed = Date.parse(inputStr);
  if (!isNaN(parsed) && parsed > now.getTime()) return parsed;
  const num = parseInt(str);
  return (!isNaN(num) && num > 0) ? now.getTime() + num * 60000 : null;
}

// 嚴格日期時間解析與驗證函式
function parseStrictPartyTimestamp(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const dStr = dateStr.trim();
  const tStr = timeStr.trim();

  // 正則檢查格式：YYYY-MM-DD 與 HH:mm (24小時制)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!dateRegex.test(dStr) || !timeRegex.test(tStr)) return null;

  const [year, month, day] = dStr.split('-').map(Number);
  const [hour, minute] = tStr.split(':').map(Number);

  // 驗證月日有效性 (防呆：例如 2026-02-31)
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== (month - 1) || probe.getUTCDate() !== day) {
    return null;
  }

  // 隊長填的是台北時間，必須明確換算，否則在 UTC 主機上會整整差 8 小時
  const ms = tpeWallClockToMs(year, month, day, hour, minute);
  return isNaN(ms) ? null : ms;
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

// ========== 名冊讀取：慢沒關係，但絕不假裝使用者沒資料 ==========
// Discord 規則：interaction 要在 3 秒內回應或 defer；defer 過後有 15 分鐘可用。
// 所以「已 defer 的路徑」可以慢慢讀，只有「要跳表單」的路徑才需要搶 3 秒。
const PROFILE_SLOW_MS = 10000;    // 已 defer：給 10 秒，不夠再重試
const PROFILE_FAST_MS = 2500;     // 要跳表單：搶在 Discord 3 秒上限內
const PROFILE_CACHE_TTL = 60000;  // 快取 60 秒；任何寫入都會讓它失效
const PROFILE_STALE_MS = 300000;  // 真的讀不到時，5 分鐘內的舊快取總比空白好
const PROFILE_CACHE = new Map();

const DB_SLOW_MSG = '⏳ 資料庫這次沒回應（伺服器剛喚醒時比較慢），請再按一次。你的資料沒有遺失。';

function cacheProfile(userId, data) {
  if (userId && data) PROFILE_CACHE.set(userId, { data, at: Date.now() });
}
function getCachedProfile(userId, maxAgeMs = PROFILE_CACHE_TTL) {
  const hit = PROFILE_CACHE.get(userId);
  if (!hit || Date.now() - hit.at > maxAgeMs) return null;
  return hit.data;
}
function invalidateProfile(userId) { if (userId) PROFILE_CACHE.delete(userId); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function withTimeout(promise, ms, label = 'Timeout') {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })
  ]);
}

// 回傳 { ok, exists, data, stale }
//   ok:false     → 真的讀不到（逾時／斷線）→ 呼叫端要說「資料庫沒回應」，不是「你沒報到」
//   exists:false → 連線正常，但這個人確實沒有名冊
async function fetchProfile(userId, opts = {}) {
  const { timeoutMs = PROFILE_SLOW_MS, retries = 1, useCache = false } = opts;
  if (!db || !userId) return { ok: false, exists: false, data: {}, reason: 'NO_DB' };

  if (useCache) {
    const cached = getCachedProfile(userId);
    if (cached) return { ok: true, exists: true, data: cached, cached: true };
  }

  for (let i = 0; i <= retries; i++) {
    try {
      const doc = await withTimeout(db.collection('member_profiles').doc(userId).get(), timeoutMs);
      const data = doc?.exists ? doc.data() : null;
      if (data) cacheProfile(userId, data); else invalidateProfile(userId);
      return { ok: true, exists: !!data, data: data || {} };
    } catch (e) {
      console.error(`讀取名冊失敗 (${userId}) 第 ${i + 1} 次：${e.message}`);
      if (i < retries) await sleep(500);
    }
  }

  const stale = getCachedProfile(userId, PROFILE_STALE_MS);
  if (stale) return { ok: true, exists: true, data: stale, stale: true };
  return { ok: false, exists: false, data: {}, reason: 'TIMEOUT' };
}

// 要跳表單的路徑用這個：先吃快取（剛開面板時已經讀過），讀不到也不會卡死 3 秒
async function fetchProfileFast(userId) {
  return fetchProfile(userId, { timeoutMs: PROFILE_FAST_MS, retries: 0, useCache: true });
}

// 舊介面，既有呼叫點沿用；底層已經變成 10 秒 + 重試 + 舊快取保底
async function fetchUserDocSafe(userId) {
  return (await fetchProfile(userId)).data;
}

// 等級一律夾在 1 ~ 200。原本只濾掉非數字，打成 1550 會原封不動存進去。
function clampLevel(raw, fallback = '120') {
  const n = parseInt(String(raw ?? '').replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return String(fallback);
  return String(Math.min(200, Math.max(1, n)));
}

// ── 共用視覺元件：面板一致的分隔線與進度條 ──
const PANEL_DIV = '━━━━━━━━━━━━━━━━';

// ANSI 進度條，用在突襲總計與揪團人數
function ansiBar(done, total, width = 16) {
  const t = Math.max(1, total);
  const filled = Math.max(0, Math.min(width, Math.round((done / t) * width)));
  const pct = Math.round((done / t) * 100);
  const color = pct >= 100 ? 32 : (pct >= 50 ? 33 : 31);
  return '\u001b[' + color + 'm' + '█'.repeat(filled) + '\u001b[30m' + '░'.repeat(width - filled)
    + '\u001b[0m ' + String(pct).padStart(3) + '%';
}

function tpeClock(ms = Date.now()) {
  const d = new Date(ms + TPE_OFFSET_MS);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// 📤 分享面板：只貼「當下狀態的快照」，不帶任何按鈕。
// 帶按鈕的話，別人按下去動到的是他自己的資料，或是產生第二份不會同步的活面板。
async function sharePanelSnapshot(interaction, embeds, opts = {}) {
  const parts = [`📤 由 <@${interaction.user.id}> 分享　‧　<t:${Math.floor(Date.now() / 1000)}:t>`];

  if (opts.hint) parts.push(opts.hint);
  try {
    const ch = interaction.channel;
    if (!ch?.isTextBased()) throw new Error('這裡不能發訊息');
    // 連結做成按鈕比藏在文字裡的 markdown 連結好按太多了
    const components = opts.jumpUrl
      ? [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('🔗 前往原面板（可操作）').setStyle(ButtonStyle.Link).setURL(opts.jumpUrl)
        )]
      : [];
    await ch.send({
      content: parts.join('　‧　'),
      embeds, components,
      allowedMentions: { parse: [] }   // 快照不要真的 tag 到人
    });
    return true;
  } catch (e) {
    console.error('分享面板失敗:', e.message);
    return false;
  }
}

async function replyShareResult(interaction, okFlag) {
  const msg = okFlag ? '📤 已把目前的畫面公開貼到這個頻道了。' : '❌ 分享失敗，機器人可能沒有在這個頻道發言的權限。';
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  } catch { /* ignore */ }
}

// 面板重繪失敗時，至少讓操作者知道（原本是 .catch(() => {}) 全部吞掉）
async function warnRefreshFailed(interaction, what) {
  if (!interaction) return;
  const msg = `⚠️ ${what}面板重繪失敗，但**資料已經存好了**。請按面板上的 🔄 即時更新 重新抓一次。`;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  } catch { /* 連通知都送不出去就算了 */ }
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

    // 退休只是「多一個標記」：職業身分組、已認證、Lv200 典獄長一律保留不動。
    // 200 等不代表退休，很多人還在玩小號，所以不會因為等級自動被標記。
    if (ROLES.RETIRED) {
      const hasRetired = member.roles.cache.has(ROLES.RETIRED);
      if (profileData.isRetired && !hasRetired) {
        await member.roles.add(ROLES.RETIRED).catch(() => {});
      } else if (!profileData.isRetired && hasRetired) {
        await member.roles.remove(ROLES.RETIRED).catch(() => {});
      }
    }

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

    const safeRolesToAdd = rolesToAdd.filter(Boolean);
    const allJobIds = Object.values(ROLES.JOBS).filter(Boolean);
    const rolesToRemove = member.roles.cache.filter(r =>
      (allJobIds.includes(r.id) && !safeRolesToAdd.includes(r.id)) ||
      r.id === ROLES.UNVERIFIED ||
      (r.id === ROLES.WARDEN_200 && parseInt(profileData.mainLevel) < 200)
    );

    if (rolesToRemove.size) await member.roles.remove(rolesToRemove).catch(() => {});
    if (safeRolesToAdd.length) await member.roles.add(safeRolesToAdd).catch(() => {});
  } catch (e) { console.error('身分組同步異常:', e.message); }
}

// ==========================================
// 5. UI 模組建構
// ==========================================
function buildRegisterPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('📝【冒險家名冊登記 / 更新中心】')
    .setDescription(
      `歡迎加入冒險公會！\n` +
      `點擊下方按鈕即可填寫您的 **本人綽號**、**本尊角色** 與 **多隻分身小號**。\n\n` +
      `✨ **機器人自動執行**：\n` +
      `• 自動將伺服器暱稱更新為 \`綽號[等級_職業]\`。\n` +
      `• 自動發放本尊與分身專屬職業身分組。`
    )
    .setFooter({ text: '點擊下方按鈕即可隨時建檔或更新' });
}

function buildRegisterPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_trigger_wizard_main').setLabel('📝 點我『填寫 / 更新』名冊資料').setStyle(ButtonStyle.Success)
    )
  ];
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
  const rowBtns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('wiz_btn_add_sub').setLabel('➕ 加填分身角色').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('wiz_btn_retire')
      .setLabel(session.isRetired ? '🚪 退休中（點此改回現役）' : '🟢 現役中（點此標記退休）')
      .setStyle(session.isRetired ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('wiz_btn_finish').setLabel('✅ 填寫完畢，立即建檔').setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📝【名冊精靈登記】正在設定：${isMain ? '👑 本尊角色' : `⚔️ 分身角色 #${session.subs.length + 1}`}`)
    .setDescription(
      `🎯 **目標登記成員**：<@${session.targetUserId}>\n` +
      (isMain ? `🏷️ **本人綽號**：\`${session.nickname || '未填'}\`\n` : '') +
      `🔹 **角色ID**：\`${char.ign}\`\n` +
      `🔹 **職業**：\`${char.job || '請在下方選單選擇'}\`\n` +
      `🔹 **等級**：\`Lv. ${char.level}\`\n` +
      (isMain ? `📌 **狀態**：${session.isRetired ? '🚪 退休（只多一個標記，身分組不會被拔掉）' : '🟢 現役'}\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      (session.subs.length
        ? `📒 **已登記的分身（會一併保留）**：${session.subs.map(x => `\`${x.ign} Lv.${x.level}\``).join('、')}\n`
        : '') +
      `💡 **請在下方選擇職業，完成後點擊「立即建檔」！**\n` +
      `🆙 *只是要改等級的話不用走這裡 —— 用 \`/名冊\` 的「更新等級」一次改完更快。*`
    );

  return { embeds: [embed], components: [rowJob, rowBtns] };
}

// ==========================================
// 揪團面板建構：簡化面板 (隊長、日期、時間、總人數、隊伍Buff、參加成員)
// ==========================================
function createPartyEmbed(partyData) {
  const members = partyData.members || [];
  const currentHeadCount = members.length;
  const isFull = currentHeadCount >= partyData.maxCount;

  // 整理所有隊員提供的隊伍 Buff
  const buffMap = new Map();
  members.forEach(m => {
    if (m.buffs && typeof m.buffs === 'object') {
      Object.entries(m.buffs).forEach(([bName, bLv]) => {
        if (!buffMap.has(bName)) buffMap.set(bName, new Set());
        buffMap.get(bName).add(`${bName}(${bLv})`);
      });
    }
  });

  const buffDisplayList = [];
  buffMap.forEach((valSet) => {
    buffDisplayList.push(Array.from(valSet).join('/'));
  });

  // 參加成員清單
  let memberListText = members.length === 0 ? '• 尚無成員加入' : '';
  members.forEach((m, idx) => {
    const bText = Object.entries(m.buffs || {}).map(([k, v]) => `${k}:${v}`).join(', ');
    memberListText += `${idx + 1}. **${m.ign}** (${m.job} Lv.${m.level}) - <@${m.userId}>` +
                      (bText ? `\n    └ 💡 Buff：\`${bText}\`\n` : '\n');
  });

  const embed = new EmbedBuilder()
    .setColor(partyData.isClosed ? 0x95A5A6 : (isFull ? 0xF1C40F : 0x00AE86))
    .setTitle(`⚔️【${mdSafe(partyData.kind || '組隊')} - 招募】${mdSafe(partyData.target)}`)
    .addFields(
      { name: '隊長', value: `<@${partyData.creatorId}>`, inline: true },
      { name: '日期', value: `${partyData.date}`, inline: true },
      { name: '時間', value: `${partyData.startTime}`, inline: true },
      { name: '總人數', value: `${currentHeadCount} / ${partyData.maxCount} 人 ${isFull ? '🔴 (已滿員)' : '🟢 (招募中)'}`, inline: true }
    );

  // 隊長設定的需求 Buff：已有的打勾、缺的留空格，一眼看出還缺什麼
  const reqBuffs = partyData.reqBuffs || [];
  if (reqBuffs.length > 0) {
    const reqText = reqBuffs.map(b => {
      const has = buffMap.has(b);
      return `${has ? '✅' : '⬜'} ${buffIcon(b)}${b}`;
    }).join('　');
    const missing = reqBuffs.filter(b => !buffMap.has(b));
    embed.addFields({
      name: missing.length ? `需求Buff（還缺 ${missing.length} 項）` : '需求Buff（已到齊 🎉）',
      value: reqText,
      inline: false
    });
  }

  // 若有填寫/提供隊伍 Buff 則顯示，若完全沒填寫則不顯示
  if (buffDisplayList.length > 0) {
    embed.addFields({
      name: '現有 Buff',
      value: buffDisplayList.join('、'),
      inline: false
    });
  }

  // 將原本名冊敘述改成「參加成員」
  embed.addFields({
    name: '參加成員',
    value: memberListText.substring(0, 1024),
    inline: false
  });

  if (partyData.bindReq && partyData.bindReq !== '無') {
    embed.setFooter({ text: `📌 備註：${partyData.bindReq}` });
  }

  return embed;
}

function createPartyComponents(partyId, isClosed = false, isFull = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`party_join_${partyId}`).setLabel('✋ 報名加入').setStyle(ButtonStyle.Success).setDisabled(isClosed || isFull),
    new ButtonBuilder().setCustomId(`party_set_buff_${partyId}`).setLabel('🪄 設定/更新我的隊伍Buff').setStyle(ButtonStyle.Primary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_leave_select_${partyId}`).setLabel('❌ 退出/修改角色').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_refresh_${partyId}`).setLabel('🔄 即時更新').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`share_party_${partyId}`).setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
  );

  // 隊長控管列
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`party_add_member_${partyId}`).setLabel('👥 隊長加人').setStyle(ButtonStyle.Primary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_kick_${partyId}`).setLabel('🚫 隊長踢人').setStyle(ButtonStyle.Danger).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_req_buff_${partyId}`).setLabel('🎯 設定需求Buff').setStyle(ButtonStyle.Primary).setDisabled(isClosed)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`party_edit_info_${partyId}`).setLabel('✏️ 修改揪團').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_close_${partyId}`).setLabel('🚪 關閉招募').setStyle(ButtonStyle.Secondary).setDisabled(isClosed),
    new ButtonBuilder().setCustomId(`party_delete_${partyId}`).setLabel('🗑️ 刪除揪團').setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3];
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
    const optLabel = `🎯 ${opt.name}`;
    embed.addFields({ name: optLabel, value: `💵 彩池：\`${formatMeso(opt.pool || 0)}\`\n📈 賠率：\`${odds}x\``, inline: true });
  });
  return embed;
}

function createMultiBetComponents(betId, options, isSettled = false) {
  if (isSettled) return [];
  const rows = [];
  // 選項按鈕：每列最多 5 顆，最多兩列
  for (let i = 0; i < options.length; i += 5) {
    const row = new ActionRowBuilder();
    options.slice(i, i + 5).forEach((opt, k) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`bet_opt_${betId}_${i + k}`)
          .setLabel(opt.name.substring(0, 80))
          .setStyle(ButtonStyle.Primary)
      );
    });
    rows.push(row);
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bet_pity_${betId}`).setLabel('🩹 同情抖內').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bet_settle_${betId}`).setLabel('⚖️ 結算').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bet_del_${betId}`).setLabel('🗑️ 廢除').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`bet_refresh_${betId}`).setLabel('🔄 即時更新').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`share_bet_${betId}`).setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
  ));
  return rows;
}

async function generateJobEmbed(targetJob) {
  if (!db) return new EmbedBuilder().setColor(0xED4245).setDescription('❌ 資料庫連線異常');
  const snapshot = await db.collection('member_profiles').get();
  if (snapshot.empty) return new EmbedBuilder().setColor(0x3498DB).setTitle('📋 名冊總覽').setDescription('尚無紀錄。');

  const members = [];
  snapshot.forEach(doc => members.push(doc.data()));

  if (targetJob === 'WARDEN_LIST') {
    const wardens = members.filter(m => parseInt(m.mainLevel) >= 200);
    const desc = wardens.length
      ? wardens.map((m, i) => `${i + 1}. 👑 \`${codeSafe(m.nickname || '')}[${codeSafe(m.mainLevel)}_${codeSafe(m.mainJob)}]\` - <@${m.userId}>${m.isRetired ? ' 🚪*已退休*' : ''}`).join('\n')
      : '目前尚未誕生 Lv 200 典獄長！';
    return new EmbedBuilder().setColor(0xF1C40F).setTitle('👑【尊榮的 Lv 200_典獄長】傳奇名冊').setDescription(desc);
  }

  if (targetJob === 'ALL_JOBS_LIST') {
    const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📋【全伺服器職業名冊總覽】');
    let fCount = 0;
    for (const j of Object.keys(ROLES.JOBS)) {
      const charList = [];
      members.forEach(m => {
        const retiredTag = m.isRetired ? ' 🚪*已退休*' : '';
        const nickPrefix = codeSafe(m.nickname || '');
        if (m.mainJob === j) charList.push({ text: `\`${nickPrefix}[${codeSafe(m.mainLevel)}_${codeSafe(m.mainJob)}]\`（${mdSafe(m.mainIgn)}）<@${m.userId}> **【本尊】**${retiredTag}`, lv: parseInt(m.mainLevel) || 0 });
        (m.subs || []).forEach(s => {
          if (s?.job === j) charList.push({ text: `\`${nickPrefix}[${codeSafe(s.level)}_${codeSafe(s.job)}]\`（${mdSafe(s.ign)}）<@${m.userId}> *(本尊: ${mdSafe(m.mainIgn)})*${retiredTag}`, lv: parseInt(s.level) || 0 });
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
    const retiredTag = m.isRetired ? ' 🚪*已退休*' : '';
    const nickPrefix = codeSafe(m.nickname || '');
    if (m.mainJob === targetJob) list.push({ text: `\`${nickPrefix}[${codeSafe(m.mainLevel)}_${codeSafe(m.mainJob)}]\`（${mdSafe(m.mainIgn)}）- <@${m.userId}> **【本尊】**${retiredTag}`, lv: parseInt(m.mainLevel) || 0 });
    (m.subs || []).forEach(s => {
      if (s?.job === targetJob) list.push({ text: `\`${nickPrefix}[${codeSafe(s.level)}_${codeSafe(s.job)}]\`（${mdSafe(s.ign)}）- <@${m.userId}> [本尊: \`${codeSafe(m.mainIgn)}\`]${retiredTag}`, lv: parseInt(s.level) || 0 });
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
    .setName('名冊')
    .setDescription('我的名片、報到登記、突襲進度、角色管理與成員名冊'),

  new SlashCommandBuilder()
    .setName('升級試算')
    .setDescription('楓之谷升級時間精算器 (自訂目標等級與每日目標)')
    .addIntegerOption(o => o.setName('目前等級').setDescription('您目前的角色等級 (1 ~ 199)').setRequired(true).setMinValue(1).setMaxValue(199))
    .addIntegerOption(o => o.setName('目標等級').setDescription('想要升到的目標等級 (2 ~ 200)').setRequired(true).setMinValue(2).setMaxValue(200))
    .addStringOption(o => o.setName('目前經驗值').setDescription('目前累積經驗 (可輸入百分比如 35% 或 實際數字如 5000000)').setRequired(true))
    .addStringOption(o => o.setName('十分鐘經驗值').setDescription('實測 10 分鐘經驗 (例: 120w，可與每日目標二選一)').setRequired(false))
    .addStringOption(o => o.setName('每日目標經驗').setDescription('每天預計打多少經驗值 (例: 2000w、1e)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('賭局')
    .setDescription('發起社群競猜 - 題目與選項都自己寫'),

  new SlashCommandBuilder()
    .setName('揪團')
    .setDescription('不填參數＝看進行中的團；填了地點日期時間＝開新團')
    .addStringOption(o => o.setName('地點或名稱').setDescription('要開新團才填。例如：忘卻6、闇黑龍王、羅密歐').setRequired(false))
    .addStringOption(o => o.setName('類型').setDescription('例如：突襲王、團練、付費吸趴。不填預設「組隊」').setRequired(false))
    .addStringOption(o => o.setName('日期').setDescription('開打日期 (格式：YYYY-MM-DD，例如 2026-09-15)').setRequired(false))
    .addStringOption(o => o.setName('時間').setDescription('開打時間 (24小時制，格式：HH:mm，例如 20:00)').setRequired(false))
    .addIntegerOption(o => o.setName('需要人數').setDescription('人數預設 6 人').setRequired(false).setMinValue(2).setMaxValue(30))
    .addStringOption(o => o.setName('備註').setDescription('例如：需洗血、純打王 (選填)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('地圖')
    .setDescription('地圖｜接圖排隊 — 放圖交接、輪流排隊'),

  new SlashCommandBuilder()
    .setName('幸運頻道')
    .setDescription('抽取今日幸運頻道')
    .addIntegerOption(o => o.setName('最大頻道').setDescription('最大頻道數').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('管理員功能')
    .setDescription('【超級管理員專用】')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('模式').setDescription('選擇管理操作').setRequired(true)
      .addChoices(
        { name: '📖 說明手冊 (help) - 檢視目前所有管理員功能清單', value: 'ADMIN_HELP' },
        { name: '📝 代填/代更新成員名冊', value: 'ADMIN_PROXY_REGISTER' },
        { name: '👥 管理員代管專用控制台 (代添/代更/代刪)', value: 'ADMIN_ROSTER_PANEL' },
        { name: '🔒 一鍵標記未報到成員為「未認證」', value: 'ADMIN_SET_UNVERIFIED_ALL' },
        { name: '🧹 一鍵清理名冊中的重複角色 ID', value: 'ADMIN_DEDUPE_ALL' },
        { name: '📌 張貼公開的「報到登記面板」到本頻道', value: 'ADMIN_POST_REGISTER' },
        { name: '⚔️ 查看全體成員的突襲王進度', value: 'ADMIN_RAID_OVERVIEW' },
        { name: '🩺 一鍵修正超出範圍的等級 (夾回 1~200)', value: 'ADMIN_FIX_LEVELS' }
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

  // 每分鐘定時檢查：開打前 30 分鐘提醒 & 開打後 2 天自動刪除
  cron.schedule('* * * * *', async () => {
    if (!db) return;
    try {
      const now = Date.now();
      const partiesSnap = await db.collection('party_trainings').get();

      for (const doc of partiesSnap.docs) {
        const p = doc.data();
        const startTs = p.startTimestamp || parseStrictPartyTimestamp(p.date, p.startTime);
        if (!startTs) continue;

        // 1. 開打前 30 分鐘提醒 (30 分鐘以內且仍在開打前)
        const diffMs = startTs - now;
        const diffMin = Math.floor(diffMs / 60000);

        if (diffMin <= 30 && diffMin > 0 && !p.reminded30m) {
          await db.collection('party_trainings').doc(doc.id).update({ reminded30m: true });
          if (p.channelId) {
            const ch = await client.channels.fetch(p.channelId).catch(() => null);
            if (ch && ch.isTextBased()) {
              const members = p.members || [];
              const mentions = members.map(m => `<@${m.userId}>`).join(' ') || `<@${p.creatorId}>`;
              const reminderEmbed = createPartyEmbed(p);

              await ch.send({
                content: `⏰ **【出團提醒】距離開打僅剩 30 分鐘，請大家準備準時參與！**\n名冊成員：${mentions}`,
                embeds: [reminderEmbed]
              }).catch(() => {});
            }
          }
        }

        // 2. 開打時間過後 2 天 (48 小時) 自動刪除
        const twoDaysAfterMs = startTs + (48 * 60 * 60 * 1000);
        if (now >= twoDaysAfterMs) {
          if (p.channelId && p.messageId) {
            const ch = await client.channels.fetch(p.channelId).catch(() => null);
            if (ch && ch.isTextBased()) {
              const m = await ch.messages.fetch(p.messageId).catch(() => null);
              if (m) await m.delete().catch(() => {});
            }
          }
          await db.collection('party_trainings').doc(doc.id).delete().catch(() => {});
        }
      }
    } catch (e) { console.error('揪團排程檢測異常:', e.message); }
  });

  // 定時巡檢 (賭局逾時與角色逾時)
  cron.schedule('*/15 * * * *', async () => {
    if (!db) return;
    try {
      const now = Date.now();

      // (A) 賭局催促
      const snapBet = await db.collection('active_bets').where('isSettled', '==', false).get();
      for (const doc of snapBet.docs) {
        const d = doc.data();
        if (now >= d.deadline) {
          const promptCount = (d.promptCount || 0) + 1;
          const isOver2Hours = (now - d.deadline) >= 7200000;

          if (promptCount <= 4) {
            const creator = await client.users.fetch(d.creatorId).catch(() => null);
            if (creator) {
              await creator.send(`🔔 **【賭局結算提醒 (${promptCount}/4)】** 您發起的社群賭局 **【${d.title}】** 已到達截止時間\n請盡速前往頻道點擊「⚖️ 結算」進行派彩！`).catch(() => {});
            }
            if (d.channelId) {
              const ch = await client.channels.fetch(d.channelId).catch(() => null);
              if (ch && ch.isTextBased()) {
                await ch.send(`📢 **【賭局截止催促】** <@${d.creatorId}> 發起的賭局 **【${d.title}】** 已截止下注\n請發起人或管理員盡速點擊下方「⚖️ 結算」按鈕派彩！`).catch(() => {});
              }
            }
            await db.collection('active_bets').doc(doc.id).update({ promptCount });
          } else if (isOver2Hours && !d.adminNotified) {
            const superAdmin = await client.users.fetch(SUPER_ADMIN_ID).catch(() => null);
            if (superAdmin) {
              await superAdmin.send(`🚨 **【管理員介入通報】** 發起人 <@${d.creatorId}> 的賭局 **【${d.title}】** 已截止超過 2 小時仍未結算，請管理員前往頻道協助強制派彩或廢除！`).catch(() => {});
            }
            await db.collection('active_bets').doc(doc.id).update({ adminNotified: true });
          }
        }
      }

    } catch (e) { console.error('15分鐘定時巡檢異常:', e.message); }
  });

  // 199等倒數廣播
  cron.schedule('0 0 8 * * *', async () => {
    try {
      const channel = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (!channel?.isTextBased()) return;
      if (db) {
        // 只用 mainLevel 篩選。原本多帶 where('isRetired','==',false)，但 Firestore 的
        // == false 要求欄位存在，沒寫過這欄位的人會被整個漏掉，等於收不到倒數推播。
        const snap = await db.collection('member_profiles').where('mainLevel', '==', '199').get();
        if (!snap.empty) {
          const now = Date.now();
          const countdownTexts = [];
          snap.forEach(doc => {
            const data = doc.data();
            const start = data.reach199At ? data.reach199At.toMillis() : now;
            const days = Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1;
            countdownTexts.push(`🔥 <@${data.userId}>（\`${data.nickname || ''}[${data.mainLevel}_${data.mainJob}]\`）邁向 200 等修煉：**第 ${days} 天**！`);
          });
          if (countdownTexts.length) {
            const embed199 = new EmbedBuilder().setColor(0xE74C3C).setTitle('⏳【即將登頂 200 等】巔峰修煉倒數').setDescription(countdownTexts.join('\n'));
            await channel.send({ embeds: [embed199] }).catch(() => {});
          }
        }
      }
    } catch (e) { console.error('199廣播異常:', e.message); }
  }, { timezone: 'Asia/Taipei' });

  // 週一突襲
  cron.schedule('0 0 9 * * 1', async () => {
    try {
      const ch = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('🔔【每週例行提醒】突襲遠征結算倒數')
          .setDescription(
            '週二 08:00 維護後次數就歸零了，請把握時間打完突襲王！\n' +
            '點下面的按鈕可以看**自己每一隻角色**還差幾次（只有你看得到）。'
          );
        const raidRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_raid_self').setLabel('⚔️ 看我的突襲進度').setStyle(ButtonStyle.Primary)
        );
        await ch.send({ embeds: [embed], components: [raidRow] }).catch(() => {});
      }
    } catch (e) { console.error('週一廣播異常:', e.message); }
  }, { timezone: 'Asia/Taipei' });

  // 週二名冊廣播
  const sendTuesdayBroadcast = async () => {
    try {
      const ch = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🔔【每週名冊維護】請大家更新角色資訊唷！')
          .setDescription('點擊下方按鈕將**自動帶入您所有角色的目前等級**，只要改數字就完成更新！\n新增／刪除角色請用 `/名冊`。');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_batch_level_self').setLabel('🆙 一次更新所有角色等級').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('btn_trigger_wizard_main').setLabel('📝 重新報到 / 加分身').setStyle(ButtonStyle.Secondary)
        );
        await ch.send({ embeds: [embed], components: [row] }).catch(() => {});
      }
    } catch (e) { console.error('週二廣播異常:', e.message); }
  };

  // 每晚 23:00：提醒大家更新突襲進度（不帶統計、不點名）
  cron.schedule('0 0 23 * * *', async () => {
    try {
      const ch = await client.channels.fetch(REPORT_CHANNEL_ID).catch(() => null);
      if (!ch?.isTextBased()) return;
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🌙【睡前確認】今天的突襲王打完了嗎？')
        .setDescription('點下面的按鈕看自己每一隻角色還差幾次，順手把今天打的記上去。\n只有你看得到，不會洗頻。');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_raid_self').setLabel('⚔️ 看我的突襲進度').setStyle(ButtonStyle.Primary)
      );
      await ch.send({ embeds: [embed], components: [row] }).catch(() => {});
    } catch (e) { console.error('23:00 突襲提醒異常:', e.message); }
  }, { timezone: 'Asia/Taipei' });

  // 每分鐘：熱門地圖排隊的換班提醒、30 分鐘預告、空格求援
  cron.schedule('* * * * *', async () => {
    if (!db) return;
    try {
      const snap = await db.collection('map_rotations').get();
      const now = Date.now();
      for (const doc of snap.docs) {
        const rot = doc.data();
        if (rot.isClosed) continue;
        const idx = rotCurrentIndex(rot, now);

        // ── 開打前 30 分鐘提醒 ──
        // 每格只提醒一次，用 preNotified 記住已經通知過的格子索引。
        const pre = Array.isArray(rot.preNotified) ? rot.preNotified.slice() : [];
        const due = [];
        for (let k = Math.max(0, idx); k < rot.slotCount; k++) {
          const left = rotSlotMs(rot, k) - now;
          if (left <= 0) continue;
          if (left > ROT_PRE_NOTIFY_MS) break;          // 格子按時間遞增，超過就不用再看了
          if (pre.includes(k)) continue;
          const sl = rotSlotUsers(rot, k);
          // 只把「有人認領」的格子標記成已通知。空格子留著不標，
          // 這樣有人在 T-20 才搶進來，下一分鐘照樣收得到提醒。
          if (!sl.length) continue;
          due.push({ k, sl });
          pre.push(k);
        }
        if (pre.length !== (rot.preNotified || []).length) {
          await doc.ref.update({ preNotified: pre }).catch(() => {});
        }
        for (const { k, sl } of due) {
          const ch2 = await client.channels.fetch(rot.channelId).catch(() => null);
          if (!ch2?.isTextBased()) continue;
          await ch2.send({
            content: `⏰ ${sl.map(u => `<@${u.userId}>`).join(' ')} 快輪到你了（<t:${Math.floor(rotSlotMs(rot, k) / 1000)}:R>）！\n` +
              `🗺️ **${rot.mapName}** ${rotChanLabel(rot)}　‧　` +
              `${rotDayLabel(rotSlotMs(rot, k))} ${rotSlotLabel(rot, k)}`
          }).catch(() => {});
        }

        // ── 空格求援：快到的時段沒人排，問後面有排的人能不能卡一下 ──
        const asked = Array.isArray(rot.gapAsked) ? rot.gapAsked.slice() : [];
        for (let k = Math.max(0, idx); k < rot.slotCount; k++) {
          const left = rotSlotMs(rot, k) - now;
          if (left <= 0) continue;
          if (left > ROT_PRE_NOTIFY_MS) break;
          if (asked.includes(k)) continue;
          if (rotSlotUsers(rot, k).length) continue;      // 有人排就不用求援

          // 找出後面還有排班的人，請他們評估能不能往前卡
          const later = [...new Set(
            Array.from({ length: rot.slotCount - k - 1 }, (_, n) => k + 1 + n)
              .flatMap(i => rotSlotUsers(rot, i).map(u => u.userId))
          )];
          asked.push(k);
          if (!later.length) continue;

          const chGap = await client.channels.fetch(rot.channelId).catch(() => null);
          if (!chGap?.isTextBased()) continue;
          await chGap.send({
            content: `${later.map(u => `<@${u}>`).join(' ')}\n`
              + `⚠️ **【缺人卡圖】${rot.mapName} ${rotChanLabel(rot)}**\n`
              + `${rotDayLabel(rotSlotMs(rot, k))} ${rotSlotLabel(rot, k)}（<t:${Math.floor(rotSlotMs(rot, k) / 1000)}:R>）**沒有人排**。\n`
              + `後面有排班的朋友，方便往前卡這一段嗎？可以的話到面板上點「✋ 我要接這段」。`
          }).catch(() => {});
        }
        if (asked.length !== (rot.gapAsked || []).length) {
          await doc.ref.update({ gapAsked: asked }).catch(() => {});
        }

        if (idx < 0 || idx >= rot.slotCount) continue;
        if (rot.notifiedIdx === idx) continue;

        await doc.ref.update({ notifiedIdx: idx }).catch(() => {});
        const curUsers = rotSlotUsers(rot, idx);
        await refreshRotationMessage(doc.id, { ...rot, notifiedIdx: idx });
        if (!curUsers.length) continue;
        const cur = curUsers[0];

        const ch = await client.channels.fetch(rot.channelId).catch(() => null);
        if (!ch?.isTextBased()) continue;

        let nextIdx = -1;
        for (let i = idx + 1; i < rot.slotCount; i++) { if (rotSlotOf(rot, i)) { nextIdx = i; break; } }
        const prev = rotSlotOf(rot, idx - 1);
        await ch.send({
          content: `🔔 **【接圖交接】${rot.mapName} ${rotChanLabel(rot)}**\n` +
            `輪到 ${curUsers.map(u => `<@${u.userId}>（\`${u.ign}\`）`).join('、')} 了！`
            + (curUsers.length > 1 ? '（團練）' : '') +
            (prev ? `　上一棒：<@${prev.userId}>` : '') +
            (nextIdx >= 0
              ? `\n⏭️ 下一棒：${rotSlotUsers(rot, nextIdx).map(u => `<@${u.userId}>`).join('、')}　${rotSlotLabel(rot, nextIdx)}`
              : '\n（後面沒有人排了，散場前記得喊一聲）')
        }).catch(() => {});
      }
    } catch (e) { console.error('熱門地圖排隊提醒異常:', e.message); }
  }, { timezone: 'Asia/Taipei' });

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
      await welcome.send({ content: `<@${member.id}>`, embeds: [embed], components: [row] }).catch(() => {});
    }
  } catch {}
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

      // 1. /名冊（報到、我的名片、角色管理、成員名冊）
      if (commandName === '名冊') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await fetchProfile(interaction.user.id);
        // 讀取失敗 ≠ 沒報到。不區分的話，資料庫一慢就會把老成員當新人。
        if (!r.ok) return await interaction.editReply(DB_SLOW_MSG);
        const d = r.data;
        if (!d.mainIgn) {
          // 還沒建檔：直接給他報到入口，不要只丟一句「請先去某某指令」
          return await interaction.editReply({
            embeds: [buildRegisterPanelEmbed()],
            components: buildRegisterPanelComponents()
          });
        }
        return await interaction.editReply(buildMyCardPayload(d));
      }

      // 3. /升級試算
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
          .setTitle(`⏳【經典正服】Lv.${curLevel} ➔ Lv.${targetLevel} 升級精算報告`)
          .setDescription(
            `👤 **冒險家**：<@${interaction.user.id}>\n` +
            `📊 **目前進度**：\`Lv.${curLevel} (${((currentExpNum / curLevelNeedExp) * 100).toFixed(2)}%)\`\n` +
            `🎯 **升到 Lv.${targetLevel} 還需總經驗**：\`${remainingExp.toLocaleString()} EXP\`\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            (efficiencyReport || dailyGoalReport ? `${efficiencyReport}${dailyGoalReport}` : `💡 *您可於指令中選填「十分鐘經驗值」或「每日目標經驗」進行時間推算！*\n`) +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 *數值已完整對齊阿泰爾版本經驗值公式*`
          )
          .setFooter({ text: '楓之谷阿泰爾經驗精算庫' });

        return await interaction.editReply({ embeds: [embed] });
      }

      // 6. /揪團 (嚴格日期時間格式驗證)
      if (commandName === '揪團') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', flags: MessageFlags.Ephemeral });

        const target = interaction.options.getString('地點或名稱');
        const rawDateOpt = interaction.options.getString('日期');
        const rawTimeOpt = interaction.options.getString('時間');

        // 什麼都沒填 = 看進行中的團
        if (!target && !rawDateOpt && !rawTimeOpt) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const snap = await db.collection('party_trainings').where('isClosed', '==', false).get();
          if (snap.empty) {
            return interaction.editReply('📜 目前沒有招募中的隊伍。\n想開一團？打 `/揪團 地點或名稱:… 日期:… 時間:…`');
          }
          const selectOptions = snap.docs.slice(0, 25).map((doc, idx) => {
            const d = doc.data();
            const count = (d.members || []).length;
            return new StringSelectMenuOptionBuilder()
              .setLabel(`[${idx + 1}] ${d.target} (${count}/${d.maxCount}人)`.substring(0, 100))
              .setDescription(`時間: ${d.date} ${d.startTime}`.substring(0, 100))
              .setValue(`view_party_${doc.id}`);
          });
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_view_party_panel')
              .setPlaceholder('🔽 請選擇你要查看/參與的揪團').addOptions(selectOptions)
          );
          return await interaction.editReply({
            content: `⚔️ **【進行中揪團】共 ${snap.size} 團，選一個調出面板：**`,
            components: [row]
          });
        }

        // 要開團就三個都要填
        if (!target || !rawDateOpt || !rawTimeOpt) {
          return await interaction.reply({
            content: '❌ 要開新團的話，**地點或名稱／日期／時間**三個都要填。\n只想看進行中的團，直接打 `/揪團` 不要帶參數。',
            flags: MessageFlags.Ephemeral
          });
        }
        const rawDate = rawDateOpt.trim();
        const rawTime = rawTimeOpt.trim();
        const bindReq = interaction.options.getString('備註') || '無';
        const maxCount = interaction.options.getInteger('需要人數') || 6;

        // 嚴格檢驗日期與時間格式
        const startTimestamp = parseStrictPartyTimestamp(rawDate, rawTime);
        if (!startTimestamp) {
          return await interaction.reply({
            content: `❌ **日期或時間格式填寫錯誤！**\n` +
                     `• **日期** 請嚴格依照 \`YYYY-MM-DD\` 格式（例如：\`2026-09-15\`）\n` +
                     `• **時間** 請嚴格依照 24 小時制 \`HH:mm\` 格式（例如：\`20:00\`、\`09:30\`）\n` +
                     `完整範例：日期填 \`2026-09-15\`，時間填 \`20:00\``,
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.deferReply();

        const pRef = db.collection('party_trainings').doc();
        const pData = {
          id: pRef.id,
          creatorId: interaction.user.id,
          target,
          kind: (interaction.options.getString('類型') || '').trim() || '組隊',
          date: rawDate,
          startTime: rawTime,
          startTimestamp,
          bindReq,
          maxCount,
          members: [],
          reqBuffs: [],
          isClosed: false,
          reminded30m: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const msg = await interaction.editReply({ embeds: [createPartyEmbed(pData)], components: createPartyComponents(pRef.id, false, false) });
        pData.channelId = interaction.channelId;
        pData.messageId = msg.id;
        await pRef.set(pData);
        return;
      }

      // 7. /賭局
      if (commandName === '賭局') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', flags: MessageFlags.Ephemeral });
        // 已有進行中的賭局就直接把那局叫出來（可直接下注），不用再開一個查看指令
        const activeBet = await getActiveBetDoc();
        if (activeBet) {
          const d = activeBet.data();
          return await interaction.reply({
            content: '🎲 **目前進行中的賭局**（想開新局請等這局結算）：',
            embeds: [createMultiBetEmbed(d)],
            components: createMultiBetComponents(d.id, d.options, d.isSettled),
            flags: MessageFlags.Ephemeral
          });
        }

        const modal = new ModalBuilder().setCustomId('modal_bet_create').setTitle('發起賭局');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('bet_title').setLabel('題目（大家要猜什麼？）')
              .setPlaceholder('例如：這本天使祝福點不點得過？').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('bet_options').setLabel(`選項：每行一個（${BET_MIN_OPTIONS}~${BET_MAX_OPTIONS} 個）`)
              .setPlaceholder('🟢 過\n🔴 不過').setStyle(TextInputStyle.Paragraph).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('bet_deadline').setLabel('截止時間（15m、1h、21:30）')
              .setValue('30m').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('bet_seed').setLabel('底池加碼（選填，例 500w）')
              .setStyle(TextInputStyle.Short).setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }

      // 8. /管理員功能
      if (commandName === '管理員功能') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        const mode = interaction.options.getString('模式');

        if (mode === 'ADMIN_HELP') {
          const helpEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('📖【超級管理員功能手冊】')
            .setDescription(
              `1. 📝 **代填名冊** (\`/管理員功能 模式:代填名冊\`)\n` +
              `2. 👥 **代管控制台** (\`/管理員功能 模式:代管控制台\`)\n` +
              `3. 🔒 **一鍵標記未報到成員為未認證** (\`/管理員功能 模式:一鍵標記未認證\`)\n` +
              `4. 🧹 **一鍵清理重複角色 ID** (\`/管理員功能 模式:一鍵清理重複\`)\n` +
              `5. 📌 **張貼公開的報到登記面板** (\`/管理員功能 模式:張貼報到面板\`)\n` +
              `6. ⚔️ **查看全體突襲王進度** (\`/管理員功能 模式:全體突襲進度\`)\n` +
              `7. 🩺 **一鍵修正超出範圍的等級** (\`/管理員功能 模式:一鍵修正等級\`)\n` +
              `8. 🚪 **強制刪除揪團 / 廢除賭局**`
            );
          return await interaction.reply({ embeds: [helpEmbed], flags: MessageFlags.Ephemeral });
        }

        if (mode === 'ADMIN_POST_REGISTER') {
          await interaction.reply({
            embeds: [buildRegisterPanelEmbed()],
            components: buildRegisterPanelComponents()
          });
          return;
        }

        if (mode === 'ADMIN_DEDUPE_ALL') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const snap = await db.collection('member_profiles').get();
          let touched = 0, removed = 0;
          const detail = [];

          for (const docSnap of snap.docs) {
            const d = docSnap.data();
            const before = (d.subs || []).length;
            const after = dedupeSubs(d.subs, d.mainIgn);
            if (after.length === before) continue;
            await db.collection('member_profiles').doc(docSnap.id).set({ subs: after }, { merge: true });
            invalidateProfile(docSnap.id);
            touched++; removed += (before - after.length);
            if (detail.length < 15) {
              detail.push(`• \`${d.nickname || d.mainIgn || docSnap.id}\`：${before} ➔ ${after.length} 隻（清掉 ${before - after.length} 筆）`);
            }
          }

          if (!touched) return await interaction.editReply('✅ 掃描完成，名冊中沒有重複的角色 ID。');
          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🧹【重複角色清理完成】')
            .setDescription(
              `共整理 **${touched}** 位成員，移除 **${removed}** 筆重複角色（同 ID 保留最新一筆）。\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` + detail.join('\n') +
              (touched > detail.length ? `\n…其餘 ${touched - detail.length} 位未列出` : '')
            );
          return await interaction.editReply({ embeds: [embed] });
        }

        if (mode === 'ADMIN_SET_UNVERIFIED_ALL') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const snap = await db.collection('member_profiles').get();
          const registeredUids = new Set();
          snap.forEach(doc => {
            const data = doc.data();
            if (data.mainIgn) registeredUids.add(doc.id); // 退休者仍是已報到的成員
          });

          const members = await interaction.guild.members.fetch();
          let count = 0;

          for (const member of members.values()) {
            if (member.user.bot) continue;
            if (!registeredUids.has(member.id)) {
              if (!member.roles.cache.has(ROLES.UNVERIFIED)) {
                await member.roles.add(ROLES.UNVERIFIED).catch(() => {});
                count++;
              }
            }
          }

          return await interaction.editReply(`🔒 **一鍵標記完成！** 已成功為伺服器內 **${count}** 位尚未完成報到的成員添加【未認證】身分組！`);
        }

        if (mode === 'ADMIN_FIX_LEVELS') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const snap = await db.collection('member_profiles').get();
          let touched = 0, fixedCount = 0;
          const detail = [];

          for (const docSnap of snap.docs) {
            const d = docSnap.data();
            const changes = [];
            const payload = {};

            if (d.mainIgn) {
              const fixed = clampLevel(d.mainLevel, d.mainLevel);
              if (String(d.mainLevel) !== fixed) {
                changes.push(`\`${d.mainIgn}\` ${d.mainLevel}➔${fixed}`);
                payload.mainLevel = fixed;
              }
            }

            const subs = (d.subs || []).map(s => ({ ...s }));
            subs.forEach(s => {
              const fixed = clampLevel(s.level, s.level);
              if (String(s.level) !== fixed) {
                changes.push(`\`${s.ign}\` ${s.level}➔${fixed}`);
                s.level = fixed;
              }
            });

            if (!changes.length) continue;
            payload.subs = subs;
            await db.collection('member_profiles').doc(docSnap.id).set(payload, { merge: true });
            invalidateProfile(docSnap.id);
            touched++; fixedCount += changes.length;
            if (detail.length < 15) detail.push(`• <@${docSnap.id}>：${changes.join('、')}`);

            // 本尊等級被夾回來的話，身分組與暱稱要跟著重算
            if (payload.mainLevel) {
              const merged = { ...d, ...payload, subs };
              await syncMemberRoles(interaction.guild, docSnap.id, merged);
              const member = await interaction.guild.members.fetch(docSnap.id).catch(() => null);
              if (member) {
                const nick = `${d.nickname || ''}[${payload.mainLevel}_${d.mainJob}]`.substring(0, 32);
                await member.setNickname(nick).catch(() => {});
              }
            }
          }

          if (!touched) return await interaction.editReply('✅ 掃描完成，所有角色等級都在 1~200 範圍內。');
          const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🩺【等級修正完成】')
            .setDescription(
              `共修正 **${touched}** 位成員、**${fixedCount}** 隻角色（超過 200 一律夾回 200）。\n` +
              `━━━━━━━━━━━━━━━━\n` + detail.join('\n') +
              (touched > detail.length ? `\n…其餘 ${touched - detail.length} 位未列出` : '')
            );
          return await interaction.editReply({ embeds: [embed] });
        }

        if (mode === 'ADMIN_RAID_OVERVIEW') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          return await interaction.editReply(await buildRaidAdminOverview());
        }

        if (mode === 'ADMIN_ROSTER_PANEL') {
          const rowUser = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('admin_select_user_for_panel').setPlaceholder('👥 選擇要管理名冊的 Discord 成員').setMinValues(1).setMaxValues(1)
          );
          return await interaction.reply({ content: '👉 **【管理員代管專區】請先選擇目標成員：**', components: [rowUser], flags: MessageFlags.Ephemeral });
        }

        if (mode === 'ADMIN_PROXY_REGISTER') {
          const targetUser = interaction.options.getUser('對象成員');
          if (!targetUser) return interaction.reply({ content: '❌ 請選擇要代為登記的成員！', flags: MessageFlags.Ephemeral });

          wizardSessionMap.set(interaction.user.id, {
            userId: interaction.user.id,
            targetUserId: targetUser.id,
            step: 'MAIN',
            nickname: targetUser.username,
            isRetired: false,
            main: { ign: '', job: '黑騎士', level: '120' },
            subs: [],
            currentSub: null
          });

          const modal = new ModalBuilder().setCustomId('modal_wizard_step1_main').setTitle(`代填【${targetUser.username}】本尊資料`);
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_nickname').setLabel('本人綽號 / 稱呼 (必填)').setValue(targetUser.username).setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_ign').setLabel('本尊遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_level').setLabel('本尊等級 (必填)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true))
          );
          return await interaction.showModal(modal);
        }
      }

      // 9. 其他指令 (放圖、幸運頻道)
      // /地圖 只負責開一個選單面板，實際的參數由各自的表單收集
      if (commandName === '地圖') {
        if (!db) return interaction.reply({ content: '❌ 資料庫未連線', flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder()
          .setColor(0x3498DB)
          .setTitle('🗺️【地圖｜接圖排隊】')
          .setDescription(
            '**🗺️ 放圖** — 你要離開了，把目前的圖交接給公會的人\n'
            + '**🗓️ 熱門地圖排隊** — 開一張輪流接圖的排隊表，大家自己認領時段\n'
            + `${PANEL_DIV}\n*選一個，接著填資料。*`
          );
        return await interaction.reply({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('map_menu_share').setLabel('🗺️ 放圖').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('map_menu_queue').setLabel('🗓️ 熱門地圖排隊').setStyle(ButtonStyle.Primary)
          )],
          flags: MessageFlags.Ephemeral
        });
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

      // 2. 報到精靈
      if (customId === 'btn_trigger_wizard_main') {
        const prev = (await fetchProfileFast(interaction.user.id)).data;
        wizardSessionMap.set(interaction.user.id, {
          userId: interaction.user.id,
          targetUserId: interaction.user.id,
          step: 'MAIN',
          nickname: prev.nickname || interaction.user.username,
          main: {
            ign: prev.mainIgn || '',
            job: prev.mainJob || '黑騎士',
            level: prev.mainLevel || '120'
          },
          subs: dedupeSubs(prev.subs, prev.mainIgn),
          isRetired: !!prev.isRetired,
          currentSub: null
        });

        const modal = new ModalBuilder().setCustomId('modal_wizard_step1_main').setTitle('名冊報到登記 - 本尊資料');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_nickname').setLabel('本人綽號 / 稱呼 (必填)').setValue(prev.nickname || interaction.user.username).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_ign').setLabel('本尊遊戲 ID (必填)').setValue(prev.mainIgn || '').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wiz_main_level').setLabel('本尊等級 (必填)').setValue(prev.mainLevel || '120').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'wiz_btn_retire') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新點擊報到！', flags: MessageFlags.Ephemeral });
        session.isRetired = !session.isRetired;
        return await interaction.update(buildWizardConfigCard(interaction.user.id));
      }

      if (customId === 'wiz_btn_add_sub') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新點擊報到！', flags: MessageFlags.Ephemeral });

        if (session.step === 'SUB' && session.currentSub && session.currentSub.ign) {
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
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.editReply('❌ 報到已逾時，請重新點擊報到！');

        if (session.step === 'SUB' && session.currentSub && session.currentSub.ign) {
          session.subs.push(session.currentSub);
        }

        const mainIgn = (session.main.ign || '').trim();
        const mainJob = session.main.job || '黑騎士';
        const mainLevel = (session.main.level || '120').replace(/[^0-9]/g, '') || '120';
        const nickname = (session.nickname || interaction.user.username).trim();
        const targetUid = session.targetUserId || interaction.user.id;

        // 同 ID 覆蓋舊資料，避免每週報到一次就多存一筆重複角色
        const rawSubs = (session.subs || []).filter(x => x && x.ign && x.ign.trim());
        const validSubs = dedupeSubs(rawSubs, mainIgn);
        const dedupedCount = rawSubs.length - validSubs.length;

        if (db) {
          invalidateProfile(targetUid);
          await db.collection('member_profiles').doc(targetUid).set({
            userId: targetUid,
            nickname,
            mainIgn, mainJob, mainLevel,
            subs: validSubs,
            isRetired: !!session.isRetired,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

        }

        await syncMemberRoles(interaction.guild, targetUid, {
          mainJob, mainLevel, subs: validSubs, isRetired: !!session.isRetired
        });

        try {
          const member = await interaction.guild.members.fetch(targetUid).catch(() => null);
          if (member) {
            const formattedNick = `${nickname}[${mainLevel}_${mainJob}]`.substring(0, 32);
            await member.setNickname(formattedNick).catch(() => {});
          }
        } catch {}

        wizardSessionMap.delete(interaction.user.id);

        const publicChannel = await client.channels.fetch(WELCOME_REGISTER_CHANNEL_ID).catch(() => null);
        if (publicChannel && publicChannel.isTextBased()) {
          const publicEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('🎉 冒險家名冊已成功更新！')
            .setDescription(`冒險家：**${nickname}**\n本尊：**${mainIgn}** ( <@&${ROLES.JOBS[mainJob] || ROLES.VERIFIED}> , LV. ${mainLevel} )`);
          await publicChannel.send({ content: `<@${targetUid}>`, embeds: [publicEmbed] }).catch(() => {});
        }

        return await interaction.editReply(
          `🎉 恭喜完成名冊建檔！成員 <@${targetUid}> 的本尊與 ${validSubs.length} 隻分身已建檔，身分組與伺服器暱稱已同步更新！` +
          (dedupedCount > 0 ? `\n🧹 偵測到 **${dedupedCount}** 筆重複角色 ID，已自動以最新資料覆蓋。` : '')
        );
      }

      // 3. 揪團報名入口
      if (customId.startsWith('party_join_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = customId.replace('party_join_', '');
        const prev = await fetchUserDocSafe(interaction.user.id);

        const allChars = [];
        if (prev.mainIgn) allChars.push({ ign: prev.mainIgn, job: prev.mainJob || '黑騎士', lv: prev.mainLevel || '120', isMain: true, idx: -1 });
        (prev.subs || []).forEach((s, idx) => {
          if (s?.ign) allChars.push({ ign: s.ign, job: s.job || '主教', lv: s.level || '120', isMain: false, idx });
        });

        const rows = [];
        let currentRow = new ActionRowBuilder();

        allChars.forEach((c) => {
          if (rows.length >= 4) return; // Discord 單訊息最多 5 排，保留 1 排給「自訂報名」
          if (currentRow.components.length >= 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
          }
          const btnId = c.isMain ? `party_reg_char_${pId}_main` : `party_reg_char_${pId}_sub_${c.idx}`;
          const label = c.isMain ? `👑 ${c.ign} (${c.job})` : `⚔️ ${c.ign} (${c.job})`;
          currentRow.addComponents(new ButtonBuilder().setCustomId(btnId).setLabel(label.substring(0, 80)).setStyle(c.isMain ? ButtonStyle.Success : ButtonStyle.Primary));
        });

        if (currentRow.components.length > 0 && rows.length < 4) {
          rows.push(currentRow);
        }

        const customRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`party_reg_custom_single_${pId}`).setLabel('✏️ 自訂其他角色報名').setStyle(ButtonStyle.Secondary)
        );
        rows.push(customRow);

        return await interaction.editReply({ content: '👉 **請選擇要報名加入的遊戲角色：**', components: rows });
      }

      // 4. 隊員設定/更新隊伍 Buff (下拉複選)
      if (customId.startsWith('party_set_buff_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = customId.replace('party_set_buff_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        const myRegs = (pData.members || []).filter(m => m.userId === interaction.user.id);
        if (!myRegs.length) return interaction.editReply('⚠️ 您尚未報名加入此隊伍，請先點擊「✋ 報名加入」！');

        userChoiceMap.set(`buff_pId_${interaction.user.id}`, pId);
        userChoiceMap.set(`buff_charIgn_${interaction.user.id}`, myRegs[0].ign);

        const buffOptions = STANDARD_PARTY_BUFFS.map(b =>
          new StringSelectMenuOptionBuilder().setLabel(`✨ ${b}`).setValue(b)
        );

        const rowSelect = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`party_member_buff_multiselect_${pId}`)
            .setPlaceholder('🔽 點擊複選您可提供的隊伍 Buff （支援複選）')
            .setMinValues(1)
            .setMaxValues(STANDARD_PARTY_BUFFS.length)
            .addOptions(buffOptions)
        );

        return await interaction.editReply({
          content: `👉 **【隊伍 Buff 設定】請勾選角色【${myRegs[0].ign}】能提供的 Buff 技能：**`,
          components: [rowSelect]
        });
      }

      if (customId.startsWith('party_reg_custom_single_')) {
        const pId = customId.replace('party_reg_custom_single_', '');
        const modal = new ModalBuilder().setCustomId(`modal_party_custom_single_${pId}`).setTitle('自訂角色報名');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_ign').setLabel('1. 角色遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_job').setLabel('2. 職業名稱 (例如: 主教、黑騎士)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_lv').setLabel('3. 等級 (純數字)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_buffs').setLabel('5. 提供Buff與等級 (選填，如: 火滿、速20)').setPlaceholder('眼、速、火、祈禱、楓祝、煙霧彈、置換、極速').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('party_reg_char_')) {
        const parts = customId.split('_');
        const pId = parts[3];
        const type = parts[4];
        const prev = (await fetchProfileFast(interaction.user.id)).data;
        let ign = prev.mainIgn || interaction.user.displayName, job = prev.mainJob || '黑騎士', lv = prev.mainLevel || '120';
        if (type === 'sub') {
          const s = prev.subs?.[parseInt(parts[5])];
          if (s) { ign = s.ign; job = s.job; lv = s.level; }
        }

        const modal = new ModalBuilder().setCustomId(`modal_party_reg_char_${pId}`).setTitle(`報名確認 - 【${ign}】`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_char_info').setLabel('角色ID / 職業 / 等級').setValue(`${ign}/${job}/${lv}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_buffs').setLabel('提供Buff與技能等級 (如: 火30, 楓祝20)').setPlaceholder('若無則留空；可包含：眼、速、火、祈禱、楓祝等').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      // 6-A. 隊長加人 步驟 1：先選人（一次一位，下一步才挑他要上哪幾隻）
      if (customId.startsWith('party_add_member_')) {
        const pId = customId.replace('party_add_member_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.reply({ content: '❌ 揪團不存在。', flags: MessageFlags.Ephemeral });
        if (!isPartyLeader(doc.data(), interaction)) {
          return interaction.reply({ content: '❌ 只有隊長或管理員可以直接加人！', flags: MessageFlags.Ephemeral });
        }
        const row = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId(`party_pick_user_${pId}`)
            .setPlaceholder('👥 先選要加入的成員（一次一位）').setMinValues(1).setMaxValues(1)
        );
        return await interaction.reply({
          content: '👉 **【隊長加人 · 第 1 步】選一位成員，下一步再挑他要上哪幾隻角色：**',
          components: [row], flags: MessageFlags.Ephemeral
        });
      }

      // 6-B. 隊長踢人
      if (customId.startsWith('party_kick_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = customId.replace('party_kick_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();
        if (!isPartyLeader(pData, interaction)) return interaction.editReply('❌ 只有隊長或管理員可以踢人！');

        const members = pData.members || [];
        if (!members.length) return interaction.editReply('💡 這團目前還沒有人報名。');

        const options = members.slice(0, 25).map((m, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${m.ign} (${m.job} Lv.${m.level})`.substring(0, 100))
            .setDescription(Object.keys(m.buffs || {}).length ? 'Buff：' + Object.keys(m.buffs).join('、') : '未提供 Buff')
            .setValue(`${i}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`party_kick_sel_${pId}`)
            .setPlaceholder('⚠️ 選擇要移除的隊員（可多選）')
            .setMinValues(1).setMaxValues(options.length).addOptions(options)
        );
        return await interaction.editReply({ content: '👉 **【隊長踢人】選擇要從隊伍移除的角色：**', components: [row] });
      }

      // 6-C. 隊長設定需求 Buff（icon 點選增減）
      if (customId.startsWith('party_bt_done_')) {
        const pId = customId.replace('party_bt_done_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        const reqBuffs = doc.exists ? (doc.data().reqBuffs || []) : [];
        const picked = reqBuffs.map(b => `${buffIcon(b)}${b}`).join('　') || '（未設定，代表不限）';
        return await interaction.update({ content: '✅ 需求 Buff 已儲存：' + picked, components: [] });
      }

      if (customId.startsWith('party_bt_')) {
        const rest = customId.replace('party_bt_', '');
        const cut = rest.lastIndexOf('_');
        const pId = rest.slice(0, cut);
        const idx = parseInt(rest.slice(cut + 1));
        const buffName = STANDARD_PARTY_BUFFS[idx];
        const ref = db.collection('party_trainings').doc(pId);
        const doc = await ref.get();
        if (!doc.exists || !buffName) {
          return interaction.update({ content: '❌ 揪團不存在或選項無效。', components: [] });
        }
        const pData = doc.data();
        if (!isPartyLeader(pData, interaction)) {
          return interaction.reply({ content: '❌ 只有隊長或管理員可以設定需求 Buff！', flags: MessageFlags.Ephemeral });
        }
        const set = new Set(pData.reqBuffs || []);
        if (set.has(buffName)) set.delete(buffName); else set.add(buffName);
        // 依標準清單順序存回，顯示才不會亂跳
        const reqBuffs = STANDARD_PARTY_BUFFS.filter(b => set.has(b));
        await ref.update({ reqBuffs });
        await refreshPartyMessage(pId, { ...pData, reqBuffs }, (pData.members || []).length >= pData.maxCount, interaction);
        return await interaction.update(buildReqBuffPanel(pId, reqBuffs));
      }

      if (customId.startsWith('party_req_buff_')) {
        const pId = customId.replace('party_req_buff_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.reply({ content: '❌ 揪團不存在。', flags: MessageFlags.Ephemeral });
        const pData = doc.data();
        if (!isPartyLeader(pData, interaction)) {
          return interaction.reply({ content: '❌ 只有隊長或管理員可以設定需求 Buff！', flags: MessageFlags.Ephemeral });
        }
        const panel = buildReqBuffPanel(pId, pData.reqBuffs || []);
        return await interaction.reply({ ...panel, flags: MessageFlags.Ephemeral });
      }

      // 6. 揪團其他按鈕操作
      if (customId.startsWith('party_leave_select_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

      if (customId.startsWith('party_edit_info_')) {
        const pId = customId.replace('party_edit_info_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.reply({ content: '❌ 揪團不存在。', flags: MessageFlags.Ephemeral });
        const d = doc.data();

        if (d.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 只有隊長或管理員可修改揪團資料！', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder().setCustomId(`modal_party_edit_${pId}`).setTitle('修改揪團資訊 (嚴格格式)');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_kind').setLabel('類型（突襲王／團練／付費吸趴…）').setValue(d.kind || '組隊').setStyle(TextInputStyle.Short).setRequired(false)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_target').setLabel('目標地點/名稱').setValue(d.target || '').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_when').setLabel('開打時間 (YYYY-MM-DD HH:mm)')
            .setValue(`${d.date || '2026-09-15'} ${d.startTime || '20:00'}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_max').setLabel('需要人數').setValue(`${d.maxCount || 6}`).setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('e_note').setLabel('備註說明').setValue(d.bindReq || '').setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('party_close_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
            if (m) await m.edit({ embeds: [createPartyEmbed({ ...d, isClosed: true })], components: createPartyComponents(pId, true, false) }).catch(() => {});
          }
        }
        return await interaction.editReply('🔒 揪團已關閉招募！');
      }

      if (customId.startsWith('party_delete_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

      // 7. 賭局：點選項 → 跳表單填金額（唯一一條下注路徑）
      if (customId.startsWith('bet_opt_')) {
        const rest = customId.replace('bet_opt_', '');
        const cut = rest.lastIndexOf('_');
        const bId = rest.slice(0, cut);
        const optIdx = parseInt(rest.slice(cut + 1));

        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.reply({ content: '❌ 賭局已失效。', flags: MessageFlags.Ephemeral });
        const d = doc.data();
        if (d.isSettled) return interaction.reply({ content: '🛑 該賭局已結算完畢！', flags: MessageFlags.Ephemeral });
        if (Date.now() >= d.deadline) return interaction.reply({ content: '🛑 該賭局已截止下注！', flags: MessageFlags.Ephemeral });
        if (isNaN(optIdx) || !d.options[optIdx]) return interaction.reply({ content: '❌ 選項無效。', flags: MessageFlags.Ephemeral });

        const already = d.options[optIdx].bets?.[interaction.user.id]?.amount || 0;
        const modal = new ModalBuilder()
          .setCustomId(`modal_bet_amount_${bId}_${optIdx}`)
          .setTitle(`下注 - ${d.options[optIdx].name}`.substring(0, 45));
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('bet_amount')
              .setLabel(already ? `加碼金額（已下 ${formatMeso(already)}）` : '下注金額（最低 100w）')
              .setPlaceholder('100w、500w、1e 都可以')
              .setValue('100w')
              .setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('bet_pity_')) {
        const bId = customId.replace('bet_pity_', '');
        const modal = new ModalBuilder().setCustomId(`modal_pity_donate_${bId}`).setTitle('🩹 暴死同情救濟慰問');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('input_pity_amount').setLabel(getRandomPityQuote().substring(0, 44)).setPlaceholder('填寫救濟金額 (隨意自訂，例: 10w、100w)').setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('bet_settle_') || customId.startsWith('bet_del_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

      // 8. 名片管理
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
        const r = await fetchProfileFast(interaction.user.id);
        if (!r.ok) return interaction.reply({ content: DB_SLOW_MSG, flags: MessageFlags.Ephemeral });
        const profile = r.data;
        if (!profile.mainIgn && !(profile.subs || []).length) {
          return interaction.reply({ content: '❌ 您尚未登記任何角色，請先完成報到！', flags: MessageFlags.Ephemeral });
        }
        return await interaction.showModal(buildBatchLevelModal(interaction.user.id, profile));
      }

      // 週二名冊廣播：直接開批次表單，不用再跑一次報到流程
      if (customId === 'btn_batch_level_self') {
        const r = await fetchProfileFast(interaction.user.id);
        if (!r.ok) return interaction.reply({ content: DB_SLOW_MSG, flags: MessageFlags.Ephemeral });
        const profile = r.data;
        if (!profile.mainIgn && !(profile.subs || []).length) {
          return interaction.reply({ content: '📜 您還沒有名冊資料，請先用 `/名冊` 完成報到！', flags: MessageFlags.Ephemeral });
        }
        return await interaction.showModal(buildBatchLevelModal(interaction.user.id, profile));
      }

      if (customId === 'share_roster') {
        await interaction.deferUpdate();
        const embed = await generateJobEmbed('ALL_JOBS_LIST');
        return await replyShareResult(interaction, await sharePanelSnapshot(interaction, [embed]));
      }

      // ── 📤 分享面板：貼出當下狀態的快照，不帶按鈕 ──
      if (customId === 'share_card' || customId === 'share_raid') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await fetchProfile(interaction.user.id);
        if (!r.ok) return await interaction.editReply(DB_SLOW_MSG);
        if (!r.exists) return await interaction.editReply('📜 您還沒有名冊資料，沒有東西可以分享。');
        const name = r.data.nickname || r.data.mainIgn;
        const payload = customId === 'share_card'
          ? buildMyCardPayload(r.data)
          : buildRaidPayload(r.data, name, { readonly: true });
        const okFlag = await sharePanelSnapshot(interaction, payload.embeds);
        return await interaction.editReply(okFlag
          ? '📤 已把你的面板公開貼到這個頻道了。'
          : '❌ 分享失敗，機器人可能沒有在這個頻道發言的權限。');
      }

      if (customId === 'share_raid_all' || customId === 'refresh_raid_all') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferUpdate();
        const payload = await buildRaidAdminOverview();
        if (customId === 'refresh_raid_all') {
          await interaction.editReply(payload);
          return await interaction.followUp({ content: `🔄 已重新讀取（${tpeClock()}）`, flags: MessageFlags.Ephemeral });
        }
        return await replyShareResult(interaction, await sharePanelSnapshot(interaction, payload.embeds));
      }

      if (customId.startsWith('share_party_') || customId.startsWith('share_bet_')
        || customId.startsWith('share_map_') || customId.startsWith('share_rot_')) {
        await interaction.deferUpdate();
        const kind = customId.split('_')[1];
        const id = customId.replace(`share_${kind}_`, '');
        const COLL = { party: 'party_trainings', bet: 'active_bets', map: 'map_shares', rot: 'map_rotations' };
        const doc = await db.collection(COLL[kind]).doc(id).get().catch(() => null);
        if (!doc?.exists) {
          return await interaction.followUp({ content: '❌ 這個面板的資料已經不存在了。', flags: MessageFlags.Ephemeral });
        }
        const d = doc.data();
        const embed = kind === 'party' ? createPartyEmbed(d)
          : kind === 'bet' ? createMultiBetEmbed(d)
          : kind === 'map' ? createMapEmbed(d)
          : buildRotationEmbed(d);
        const jumpUrl = (d.channelId && d.messageId && interaction.guildId)
          ? `https://discord.com/channels/${interaction.guildId}/${d.channelId}/${d.messageId}`
          : null;
        const okFlag = await sharePanelSnapshot(interaction, [embed], {
          jumpUrl, hint: jumpUrl ? '要操作請點原面板' : null
        });
        return await replyShareResult(interaction, okFlag);
      }

      // ── 🗺️ /地圖 選單：兩個子項目各自跳表單 ──
      if (customId === 'map_menu_share') {
        const modal = new ModalBuilder().setCustomId('modal_map_share_new').setTitle('放圖交接');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('ms_map').setLabel('地圖名稱')
              .setPlaceholder('例如：忘卻6、蛋龍').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('ms_chan').setLabel('頻道號碼')
              .setPlaceholder('例如：12').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('ms_leave').setLabel('預計多久離開')
              .setPlaceholder('例如：10分鐘後、21:30').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('ms_note').setLabel('備註說明（選填）')
              .setStyle(TextInputStyle.Paragraph).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      if (customId === 'map_menu_queue') {
        const modal = new ModalBuilder().setCustomId('modal_map_queue_new').setTitle('開一張排隊表');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('mq_map').setLabel('地圖名稱')
              .setPlaceholder('例如：忘卻6、蛋龍').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('mq_chan').setLabel('頻道（還沒決定就留空）')
              .setStyle(TextInputStyle.Short).setRequired(false)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('mq_start').setLabel('開始時間（留空＝現在）')
              .setPlaceholder('08:45　或　10/30 08:45').setStyle(TextInputStyle.Short).setRequired(false)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('mq_end').setLabel('結束時間，或直接填幾小時')
              .setPlaceholder('09:45　或　填 4 代表 4 小時　‧　留空＝48 小時').setStyle(TextInputStyle.Short).setRequired(false)),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('mq_buy').setLabel('買圖價格（留空＝免費團）')
              .setPlaceholder('例如 5000w').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return await interaction.showModal(modal);
      }

      // ── 📺 改頻道：有排班的人都能改（頻道常常臨時換） ──
      if (customId.startsWith('rot_chan_')) {
        const rotId = customId.replace('rot_chan_', '');
        const rot = await fetchRotFast(rotId);
        if (!rot) return interaction.reply({ content: '❌ 讀不到這張排班表，請按 🔄 即時更新後再試。', flags: MessageFlags.Ephemeral });

        const modal = new ModalBuilder().setCustomId(`modal_rot_chan_${rotId}`).setTitle('變更頻道');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_new_chan').setLabel('新的頻道號碼')
              .setValue(String(rot.channelNum || '')).setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_chan_reason').setLabel('原因（選填，會一起公告）')
              .setPlaceholder('例如：原頻被卡位、太多人').setStyle(TextInputStyle.Short).setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }

      // ── ✏️ 修改內容：只有開表者與管理員 ──
      if (customId.startsWith('rot_edit_')) {
        const rotId = customId.replace('rot_edit_', '');
        const rot = await fetchRotFast(rotId);
        if (!rot) return interaction.reply({ content: '❌ 讀不到這張排班表，請按 🔄 即時更新後再試。', flags: MessageFlags.Ephemeral });
        if (rot.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 只有開表的人或管理員可以修改內容。頻道的話你可以按 📺 改頻道。', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder().setCustomId(`modal_rot_edit_${rotId}`).setTitle('修改排班內容');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_e_map').setLabel('地圖名稱')
              .setValue(String(rot.mapName || '')).setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_e_note').setLabel('備註')
              .setValue(String(rot.note || '')).setStyle(TextInputStyle.Paragraph).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_e_buy').setLabel('買圖價格（留空或 0 ＝ 免費團）')
              .setValue(rot.buyPrice > 0 ? String(rot.buyPrice) : '')
              .setPlaceholder('例如 5000w').setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_e_split').setLabel('分攤方式：均攤 或 時間')
              .setValue(rotSplitLabel(rot.splitMode)).setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_e_share').setLabel('團練（可多人同時段）：開 或 關')
              .setValue(rot.allowShare ? '開' : '關').setStyle(TextInputStyle.Short).setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }

      // ── 🗓️ 熱門地圖排隊：有收費的結算 ──
      if (customId.startsWith('rot_closepay_')) {
        const rotId = customId.replace('rot_closepay_', '');
        const modal = new ModalBuilder().setCustomId(`modal_rot_settle_${rotId}`).setTitle('結束並結算');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_sell_price')
              .setLabel('賣出價格（沒賣掉就留空）')
              .setPlaceholder('例如 3000w、1.2e')
              .setStyle(TextInputStyle.Short).setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rot_split_mode')
              .setLabel('分攤方式：填「均攤」或「時間」')
              .setPlaceholder('均攤 = 每人一樣多　‧　時間 = 依佔的時段比例')
              .setStyle(TextInputStyle.Short).setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }

      if (customId.startsWith('rot_profit_')) {
        await interaction.deferUpdate();
        const share = customId.startsWith('rot_profit_share_');
        const rotId = customId.replace(share ? 'rot_profit_share_' : 'rot_profit_keep_', '');
        const ref = db.collection('map_rotations').doc(rotId);
        const doc = await ref.get().catch(() => null);
        if (!doc?.exists) return await interaction.followUp({ content: '❌ 這張排班表已經不存在了。', flags: MessageFlags.Ephemeral });
        const rot = doc.data();
        if (rot.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return await interaction.followUp({ content: '❌ 只有開表的人可以決定。', flags: MessageFlags.Ephemeral });
        }
        await ref.update({ isClosed: true, settled: true, shareProfit: share });
        return await rotPostSettlement(interaction, rotId, { ...rot, isClosed: true, settled: true }, share);
      }

      if (customId.startsWith('rot_refresh_') || customId.startsWith('rot_close_')) {
        await interaction.deferUpdate();
        const closing = customId.startsWith('rot_close_');
        const rotId = customId.replace(closing ? 'rot_close_' : 'rot_refresh_', '');
        const ref = db.collection('map_rotations').doc(rotId);
        const doc = await ref.get().catch(() => null);
        if (!doc?.exists) {
          return await interaction.followUp({ content: '❌ 這張排班表已經不存在了。', flags: MessageFlags.Ephemeral });
        }
        let rot = doc.data();

        if (closing) {
          const canClose = rot.creatorId === interaction.user.id
            || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
          if (!canClose) {
            return await interaction.followUp({ content: '❌ 只有開表的人或管理員可以結束排班。', flags: MessageFlags.Ephemeral });
          }
          await ref.update({ isClosed: true });
          rot = { ...rot, isClosed: true };
        }

        await interaction.editReply({
          embeds: [buildRotationEmbed(rot)],
          components: buildRotationComponents(rotId, rot)
        });
        return await interaction.followUp({
          content: closing ? '🚪 排班已結束，表格保留在頻道上。' : `🔄 已重新讀取（${tpeClock()}）`,
          flags: MessageFlags.Ephemeral
        });
      }

      // ── 🔄 即時更新：一律強制重讀資料庫，不吃任何快取 ──
      if (customId === 'refresh_card') {
        await interaction.deferUpdate();
        const r = await fetchProfile(interaction.user.id);
        if (!r.ok) return await interaction.followUp({ content: DB_SLOW_MSG, flags: MessageFlags.Ephemeral });
        if (!r.exists) return await interaction.followUp({ content: '📜 您還沒有名冊資料，請先完成報到。', flags: MessageFlags.Ephemeral });
        await interaction.editReply(buildMyCardPayload(r.data));
        return await interaction.followUp({ content: `🔄 已重新讀取（${tpeClock()}）`, flags: MessageFlags.Ephemeral });
      }

      if (customId.startsWith('party_refresh_')) {
        await interaction.deferUpdate();
        const pId = customId.replace('party_refresh_', '');
        const doc = await db.collection('party_trainings').doc(pId).get().catch(() => null);
        if (!doc?.exists) return await interaction.followUp({ content: '❌ 這個團已經不存在了。', flags: MessageFlags.Ephemeral });
        const pData = doc.data();
        const isFull = (pData.members || []).length >= pData.maxCount;
        await interaction.editReply({ embeds: [createPartyEmbed(pData)], components: createPartyComponents(pId, pData.isClosed, isFull) });
        return await interaction.followUp({ content: `🔄 已重新讀取（${tpeClock()}）`, flags: MessageFlags.Ephemeral });
      }

      if (customId.startsWith('bet_refresh_')) {
        await interaction.deferUpdate();
        const bId = customId.replace('bet_refresh_', '');
        const doc = await db.collection('active_bets').doc(bId).get().catch(() => null);
        if (!doc?.exists) return await interaction.followUp({ content: '❌ 這個賭局已經不存在了。', flags: MessageFlags.Ephemeral });
        const d = doc.data();
        await interaction.editReply({ embeds: [createMultiBetEmbed(d)], components: createMultiBetComponents(bId, d.options, d.isSettled) });
        return await interaction.followUp({ content: `🔄 已重新讀取（${tpeClock()}）`, flags: MessageFlags.Ephemeral });
      }

      if (customId.startsWith('map_refresh_')) {
        await interaction.deferUpdate();
        const mapId = customId.replace('map_refresh_', '');
        const doc = await db.collection('map_shares').doc(mapId).get().catch(() => null);
        if (!doc?.exists) return await interaction.followUp({ content: '❌ 這則放圖已經不存在了。', flags: MessageFlags.Ephemeral });
        const mapData = doc.data();
        await interaction.editReply({ embeds: [createMapEmbed(mapData)], components: createMapComponents(mapId, mapData) });
        return await interaction.followUp({ content: `🔄 已重新讀取（${tpeClock()}）`, flags: MessageFlags.Ephemeral });
      }

      // 突襲王進度：誰按誰看自己的，廣播上的按鈕也走同一條路
      if (customId === 'card_btn_raid' || customId === 'btn_raid_self' || customId === 'refresh_raid') {
        if (customId === 'refresh_raid') await interaction.deferUpdate();
        else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const r = await fetchProfile(interaction.user.id);   // 不吃快取，強制重讀
        if (!r.ok) return await interaction.editReply(DB_SLOW_MSG);
        const profile = r.data;
        if (!profile.mainIgn && !(profile.subs || []).length) {
          return await interaction.editReply('📜 您還沒有名冊資料，請先用 \`/名冊\` 完成報到！');
        }
        return await interaction.editReply(buildRaidPayload(
          profile, profile.nickname || profile.mainIgn,
          { isAdmin: isSuperAdmin(interaction.user.id, interaction.memberPermissions) }
        ));
      }

      if (customId === 'raid_btn_update') {
        const r = await fetchProfileFast(interaction.user.id);
        if (!r.ok) return interaction.reply({ content: DB_SLOW_MSG, flags: MessageFlags.Ephemeral });
        const profile = r.data;
        if (!getRaidState(profile).length) {
          return interaction.reply({ content: '❌ 名冊裡沒有角色，無法更新。', flags: MessageFlags.Ephemeral });
        }
        return await interaction.showModal(buildRaidModal(interaction.user.id, profile));
      }

      if (customId === 'raid_btn_reset') {
        await interaction.deferUpdate();
        const profile = await fetchUserDocSafe(interaction.user.id);
        const rows = getRaidState(profile);
        if (!rows.length) {
          return await interaction.followUp({ content: '❌ 名冊裡沒有角色。', flags: MessageFlags.Ephemeral });
        }
        rows.forEach(c => { c.used = 0; });
        await saveRaidState(interaction.user.id, rows);
        const merged = { ...profile, raid: { weekKey: raidWeekKey(), chars: raidCharsMap(rows) } };
        return await interaction.editReply(buildRaidPayload(
          merged, profile.nickname || profile.mainIgn,
          { isAdmin: isSuperAdmin(interaction.user.id, interaction.memberPermissions) }
        ));
      }

      if (customId === 'raid_btn_admin_all') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return await interaction.editReply(await buildRaidAdminOverview());
      }

      // 成員名冊（從名片面板點進來，公開發到頻道讓大家都看得到）
      if (customId === 'card_btn_roster') {
        // 預設私密。要給大家看就按面板上的 📤 分享面板。
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const embed = await generateJobEmbed('ALL_JOBS_LIST');
        const isAdmin = isSuperAdmin(interaction.user.id, interaction.memberPermissions);
        const components = [buildJobQueryMenu(isAdmin)];
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('share_roster').setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
        ));
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

      // 成員自助切換退休狀態
      if (customId === 'card_btn_retire') {
        await interaction.deferUpdate();
        const prof = await fetchUserDocSafe(interaction.user.id);
        if (!prof.mainIgn) {
          return await interaction.followUp({ content: '❌ 您尚未建立名冊資料。', flags: MessageFlags.Ephemeral });
        }
        const nowRetired = !prof.isRetired;
        await db.collection('member_profiles').doc(interaction.user.id).set(
          { userId: interaction.user.id, isRetired: nowRetired }, { merge: true }
        );
        invalidateProfile(interaction.user.id);
        const merged = { ...prof, isRetired: nowRetired };
        await syncMemberRoles(interaction.guild, interaction.user.id, merged);
        await interaction.editReply(buildMyCardPayload(merged));
        return await interaction.followUp({
          content: nowRetired
            ? '🚪 已幫你加上 **退休** 身分組。原本的職業身分組與名冊紀錄都保留著，名冊上會標示「已退休」，之後就不會有人約你打王了。'
            : '🔄 歡迎回鍋！退休身分組已移除，其他身分組本來就沒動過。',
          flags: MessageFlags.Ephemeral
        });
      }

      if (customId === 'card_btn_delete_char') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const profile = await fetchUserDocSafe(interaction.user.id);
        const chars = (profile.subs || []).map((s, i) => ({ ign: s.ign, job: s.job, lv: s.level, idx: i }));

        if (!chars.length) return interaction.editReply('💡 您目前沒有可刪除的分身角色！');

        userChoiceMap.set(`target_del_user_${interaction.user.id}`, interaction.user.id);
        const selectOptions = chars.slice(0, 25).map(c =>
          new StringSelectMenuOptionBuilder().setLabel(`🗑️ 刪除：${c.ign} (${c.job} Lv.${c.lv})`.substring(0, 100)).setValue(`del_char_${interaction.user.id}_${c.idx}_${c.ign}`)
        );
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_delete').setPlaceholder('⚠️ 請選擇欲刪除的分身角色').addOptions(selectOptions)
        );
        return await interaction.editReply({ content: '👉 **請選擇要從名冊中刪除的分身角色：**', components: [row] });
      }

      if (customId.startsWith('btn_confirm_delete_profile_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 僅超級管理員可使用！');
        }
        const targetUid = customId.replace('btn_confirm_delete_profile_', '');
        const profile = await fetchUserDocSafe(targetUid);
        const mainIgn = profile.mainIgn || '(未知)';
        const subCount = (profile.subs || []).length;

        await db.collection('member_profiles').doc(targetUid).delete();
        invalidateProfile(targetUid);
        const stillHere = await clearMemberRoles(interaction.guild, targetUid);

        return await interaction.editReply(
          `🗑️ 已刪除 <@${targetUid}> 的整筆名冊（本尊【**${mainIgn}**】＋ ${subCount} 隻分身）。\n`
          + (stillHere ? '本人還在群內，身分組已清空並標為未認證。' : '本人已不在群內，只清掉資料庫紀錄。')
        );
      }

      if (customId.startsWith('btn_confirm_delete_char_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
        invalidateProfile(targetUid);

        await syncMemberRoles(interaction.guild, targetUid, { ...profile, subs: newSubs });
        return await interaction.editReply(`🗑️ 角色【**${ign}**】已成功自名冊與資料庫中徹底刪除，無效身分組已同步清理！`);
      }

      if (customId === 'admin_roster_add_btn') {
        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('admin_select_user_to_add_char').setPlaceholder('👥 選擇要為哪位成員新增角色').setMinValues(1).setMaxValues(1)
        );
        return await interaction.reply({ content: '👉 **【管理員代添角色】請先選擇目標成員：**', components: [rowUser], flags: MessageFlags.Ephemeral });
      }

      if (customId === 'admin_roster_update_btn') {
        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('admin_select_user_to_update_lvl').setPlaceholder('👥 選擇要為哪位成員調整等級').setMinValues(1).setMaxValues(1)
        );
        return await interaction.reply({ content: '👉 **【管理員代更等級】請先選擇目標成員：**', components: [rowUser], flags: MessageFlags.Ephemeral });
      }

      if (customId === 'admin_roster_delete_btn') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        const rowUser = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId('admin_select_user_to_delete_char').setPlaceholder('👥 方式一：選擇群內成員').setMinValues(1).setMaxValues(1)
        );
        const rowBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('admin_del_by_ign_btn').setLabel('🔎 方式二：用角色名稱搜尋').setStyle(ButtonStyle.Primary)
        );
        return await interaction.reply({
          content: '👉 **【管理員代刪角色】兩種方式都可以：**\n'
            + '‧ **方式一**：從群內成員挑人，再挑他的分身\n'
            + '‧ **方式二**：直接打角色名稱搜尋 —— **已經退群的人也找得到**',
          components: [rowUser, rowBtn],
          flags: MessageFlags.Ephemeral
        });
      }

      if (customId === 'admin_del_by_ign_btn') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        const modal = new ModalBuilder().setCustomId('modal_del_search_ign').setTitle('用角色名稱搜尋');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('del_search_ign')
              .setLabel('角色名稱（可只打一部分）')
              .setPlaceholder('例如：沁霜　‧　打「霜」也找得到')
              .setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      // 【修復】放圖：我要圖 (預約)
      if (customId.startsWith('map_take_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const mapId = customId.replace('map_take_', '');
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.editReply('❌ 放圖資訊已失效。');
        const mapData = mapDoc.data();

        if (mapData.isFinished) return interaction.editReply('✅ 此地圖已完成交接囉！');
        if (mapData.creatorId === interaction.user.id) return interaction.editReply('💡 這是您自己放的圖，不需要預約！');
        if (mapData.takerId && mapData.takerId !== interaction.user.id) {
          return interaction.editReply(`⚠️ 已被 <@${mapData.takerId}> 搶先預約了，晚一步！`);
        }

        await db.collection('map_shares').doc(mapId).update({ takerId: interaction.user.id });
        await refreshMapMessage(mapId, { ...mapData, takerId: interaction.user.id }, interaction);

        const owner = await client.users.fetch(mapData.creatorId).catch(() => null);
        if (owner) {
          const prev = await fetchUserDocSafe(interaction.user.id);
          const who = prev.nickname || prev.mainIgn || interaction.user.displayName;
          await owner.send(`🔔 **【放圖預約通知】** 冒險家 <@${interaction.user.id}>（\`${who}\`）預約了您在 **${mapData.mapName} 第 ${mapData.channelNum} 頻道** 的圖，離開前請記得交接！`).catch(() => {});
        }
        return await interaction.editReply(`✋ 已成功預約【**${mapData.mapName}** 第 ${mapData.channelNum} 頻道】，放圖者已收到私訊通知！`);
      }

      // 【修復】放圖：已交接完成
      if (customId.startsWith('map_done_')) {
        const mapId = customId.replace('map_done_', '');
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.reply({ content: '❌ 放圖資訊已失效。', flags: MessageFlags.Ephemeral });
        const mapData = mapDoc.data();

        if (mapData.creatorId !== interaction.user.id && mapData.takerId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 只有放圖者、預約者或管理員可標記交接完成！', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder().setCustomId(`modal_map_done_${mapId}`).setTitle('交接完成 - 補充說明');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('map_done_note').setLabel('交接備註 (選填)').setPlaceholder('例如：已順利交接、對方沒出現').setStyle(TextInputStyle.Short).setRequired(false)
          )
        );
        return await interaction.showModal(modal);
      }

      // 【修復】管理員代管控制台：四個操作按鈕
      if (customId === 'admin_panel_add' || customId === 'admin_panel_lvl' || customId === 'admin_panel_del' || customId === 'admin_panel_retire') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        const targetUid = userChoiceMap.get(`admin_panel_target_${interaction.user.id}`);
        if (!targetUid) return interaction.reply({ content: '❌ 操作已逾時，請重新執行 `/管理員功能 模式:代管控制台`。', flags: MessageFlags.Ephemeral });

        if (customId === 'admin_panel_add') {
          userChoiceMap.set(`target_add_user_${interaction.user.id}`, targetUid);
          return await interaction.showModal(buildAddCharModal(targetUid));
        }

        if (customId === 'admin_panel_lvl') {
          const r = await fetchProfileFast(targetUid);
          if (!r.ok) return interaction.reply({ content: DB_SLOW_MSG, flags: MessageFlags.Ephemeral });
          const prof = r.data;
          if (!prof.mainIgn && !(prof.subs || []).length) {
            return interaction.reply({ content: `❌ 成員 <@${targetUid}> 尚未登記任何角色！`, flags: MessageFlags.Ephemeral });
          }
          return await interaction.showModal(buildBatchLevelModal(targetUid, prof));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (customId === 'admin_panel_retire') {
          const profile = await fetchUserDocSafe(targetUid);
          const nowRetired = !profile.isRetired;
          await db.collection('member_profiles').doc(targetUid).set({ userId: targetUid, isRetired: nowRetired }, { merge: true });
          invalidateProfile(targetUid);
          await syncMemberRoles(interaction.guild, targetUid, { ...profile, isRetired: nowRetired });
          return await interaction.editReply(nowRetired
            ? `🚪 已幫 <@${targetUid}> 加上【退休】身分組。原本的職業身分組與名冊紀錄都保留著，名冊上只會多標示「已退休」。`
            : `🔄 已解除 <@${targetUid}> 的退休標記，其他身分組本來就沒動過。`);
        }

        const row = await buildCharSelectRowForUser(targetUid, interaction.user.id);
        if (!row) return await interaction.editReply(`❌ 成員 <@${targetUid}> 沒有可刪除的分身角色！`);
        return await interaction.editReply({
          content: `👉 **【代刪角色】請選擇 <@${targetUid}> 要刪除的分身：**`,
          components: [row]
        });
      }

      if (customId.startsWith('map_cancel_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const mapId = customId.replace('map_cancel_', '');
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.editReply('❌ 放圖資訊已失效。');
        const mapData = mapDoc.data();

        if (mapData.takerId !== interaction.user.id && mapData.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 您無權取消此預約！');
        }
        await db.collection('map_shares').doc(mapId).update({ takerId: null });
        await refreshMapMessage(mapId, { ...mapData, takerId: null }, interaction);
        return await interaction.editReply('✅ 已成功取消預約！');
      }
    }

    // ----------------------------------------
    // [C] 下拉選單處理
    // ----------------------------------------
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      const customId = interaction.customId;

      // 快速登記：選到哪隻就幫那隻加次數，加完直接刷新同一個面板
      if (customId === 'raid_sel_plus7') {
        await interaction.deferUpdate();
        const step = RAID_FREE_CAP;
        const profile = await fetchUserDocSafe(interaction.user.id);
        const rows = getRaidState(profile);
        const target = rows.find(c => c.ign === interaction.values[0]);
        if (!target) {
          return await interaction.followUp({ content: '❌ 這隻角色已經不在名冊裡了，請重新開啟面板。', flags: MessageFlags.Ephemeral });
        }
        const from = target.used;
        target.used = Math.min(target.used + step, target.cap);   // 加到上限就停住
        if (target.used === from) {
          return await interaction.followUp({ content: `💡 **${target.ign}** 本週已經打滿 ${target.cap} 次了。`, flags: MessageFlags.Ephemeral });
        }
        await saveRaidState(interaction.user.id, rows);
        const merged = { ...profile, raid: { weekKey: raidWeekKey(), chars: raidCharsMap(rows) } };
        await interaction.editReply(buildRaidPayload(
          merged, profile.nickname || profile.mainIgn,
          { isAdmin: isSuperAdmin(interaction.user.id, interaction.memberPermissions) }
        ));
        return await interaction.followUp({
          content: `⚔️ **${target.ign}** 記上了：\`${from} ➔ ${target.used} / ${target.cap} 次\``
            + (target.used >= target.cap ? '　✅ 這隻打滿了！' : `　還差 ${target.cap - target.used} 次`),
          flags: MessageFlags.Ephemeral
        });
      }

      // 熱門地圖排隊：取消自己的時段
      if (customId.startsWith('rot_drop_')) {
        await interaction.deferUpdate();
        const rotId = customId.replace('rot_drop_', '');
        const ref = db.collection('map_rotations').doc(rotId);
        const doc = await ref.get().catch(() => null);
        if (!doc?.exists) {
          return await interaction.followUp({ content: '❌ 這張排班表已經不存在了。', flags: MessageFlags.Ephemeral });
        }
        const rot = doc.data();
        const idx = parseInt(interaction.values[0]);
        const occupants = rotSlotUsers(rot, idx);
        if (!occupants.length) {
          return await interaction.followUp({ content: '💡 這個時段已經是空的了。', flags: MessageFlags.Ephemeral });
        }

        const isOwner = rotHasUser(rot, idx, interaction.user.id);
        const canForce = rot.creatorId === interaction.user.id
          || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
        if (!isOwner && !canForce) {
          return await interaction.followUp({
            content: `❌ 這格是 ${occupants.map(u => `<@${u.userId}>`).join('、')} 排的，只有本人、開表的人或管理員可以取消。`,
            flags: MessageFlags.Ephemeral
          });
        }

        // 團練時一格有多人：本人只退自己，開表者／管理員代取消才整格清空
        const slot = occupants[0];
        const remain = isOwner ? occupants.filter(u => u.userId !== interaction.user.id) : [];
        const slots = rotSetSlot(rot.slots, idx, remain);
        await ref.update({ slots });   // colors 保留不動，之後再排回來還是同一個顏色

        const merged = { ...rot, slots };
        cacheRot(rotId, merged);
        await interaction.editReply({
          embeds: [buildRotationEmbed(merged)],
          components: buildRotationComponents(rotId, merged)
        });
        return await interaction.followUp({
          content: remain.length
            ? `🗑️ 已退出 ${rotDayLabel(rotSlotMs(rot, idx))} ${rotSlotLabel(rot, idx)}，這格還有 ${remain.map(u => `<@${u.userId}>`).join('、')}。`
            : `🗑️ 已清空 ${rotDayLabel(rotSlotMs(rot, idx))} ${rotSlotLabel(rot, idx)}`
              + (isOwner ? '' : `（原本是 ${occupants.map(u => `<@${u.userId}>`).join('、')}，已代為取消）`),
          flags: MessageFlags.Ephemeral
        });
      }

      // 熱門地圖排隊：認領時段。沒開團練時一格只能一人，先搶先贏；開了團練則可併團。
      if (customId.startsWith('rot_take_') || customId.startsWith('rot_support_')) {
        await interaction.deferUpdate();
        const asSupport = customId.startsWith('rot_support_');
        const rotId = customId.replace(asSupport ? 'rot_support_' : 'rot_take_', '');
        const ref = db.collection('map_rotations').doc(rotId);
        const doc = await ref.get().catch(() => null);
        if (!doc?.exists) {
          return await interaction.followUp({ content: '❌ 這張排班表已經不存在了。', flags: MessageFlags.Ephemeral });
        }
        const rot = doc.data();
        if (rot.isClosed) {
          return await interaction.followUp({ content: '🚪 這張排班表已經結束了。', flags: MessageFlags.Ephemeral });
        }

        const idx = parseInt(interaction.values[0]);
        if (!Number.isFinite(idx) || idx < 0 || idx >= rot.slotCount) {
          return await interaction.followUp({ content: '❌ 這個時段不存在。', flags: MessageFlags.Ephemeral });
        }
        if (idx < rotCurrentIndex(rot)) {
          return await interaction.followUp({ content: '⌛ 這個時段已經過去了，請按 🔄 即時更新看最新的表。', flags: MessageFlags.Ephemeral });
        }
        const current = rotSlotUsers(rot, idx);
        if (rotHasUser(rot, idx, interaction.user.id)) {
          return await interaction.followUp({ content: '💡 你已經在這個時段了。', flags: MessageFlags.Ephemeral });
        }
        if (current.length && !rot.allowShare) {
          return await interaction.followUp({
            content: `😅 慢了一步，${rotSlotLabel(rot, idx)} 已經被 <@${current[0].userId}> 接走了。請按 🔄 即時更新。`,
            flags: MessageFlags.Ephemeral
          });
        }
        if (current.length && current.length >= ROT_MAX_PER_SLOT) {
          return await interaction.followUp({
            content: `😅 ${rotSlotLabel(rot, idx)} 已經有 ${current.length} 個人，滿了。`,
            flags: MessageFlags.Ephemeral
          });
        }

        const prof = (await fetchProfile(interaction.user.id)).data;
        const ign = prof.mainIgn || interaction.member?.displayName || interaction.user.username;
        const me = { userId: interaction.user.id, ign };
        if (asSupport) me.support = true;            // 外援不分攤費用
        const slots = rotSetSlot(rot.slots, idx, [...current, me]);
        const colors = rotAssignColor(rot, interaction.user.id);
        await ref.update({ slots, colors });

        const merged = { ...rot, slots, colors };
        cacheRot(rotId, merged);
        await interaction.editReply({
          embeds: [buildRotationEmbed(merged)],
          components: buildRotationComponents(rotId, merged)
        });
        const mates = current.map(u => `<@${u.userId}>`).join('、');
        const payers = [...current.filter(u => !u.support), ...(asSupport ? [] : [me])].length;
        return await interaction.followUp({
          content: `✅ ${rotDayLabel(rotSlotMs(rot, idx))} ${rotSlotLabel(rot, idx)} 登記完成，到點機器人會 tag 你。`
            + (asSupport ? '\n🆘 你是**外援**，這段**不跟你收費**，謝謝幫忙顧圖！' : '')
            + (mates ? `\n🤝 這格還有 ${mates}${payers > 1 ? `，費用由 ${payers} 位付費者均分` : ''}。` : '')
            + '\n要反悔的話用下面的「❌ 取消時段」選單。',
          flags: MessageFlags.Ephemeral
        });
      }

      // 管理員從全體總覽挑一個人看明細（唯讀，不給操作鈕免得改到別人的）
      if (customId === 'admin_raid_pick_user') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const targetUid = interaction.values[0];
        const profile = await fetchUserDocSafe(targetUid);
        if (!profile.mainIgn && !(profile.subs || []).length) {
          return await interaction.editReply(`📜 <@${targetUid}> 還沒有名冊資料。`);
        }
        return await interaction.editReply({
          content: `👥 <@${targetUid}> 的本週突襲進度：`,
          ...buildRaidPayload(profile, profile.nickname || profile.mainIgn, { readonly: true })
        });
      }

      // 1. 從揪團清單調出面板
      if (customId === 'select_view_party_panel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = interaction.values[0].replace('view_party_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 該揪團已結束或不存在。');
        const pData = doc.data();

        const isFull = (pData.members || []).length >= pData.maxCount;

        return await interaction.editReply({
          embeds: [createPartyEmbed(pData)],
          components: createPartyComponents(pId, pData.isClosed, isFull)
        });
      }

      // 2. 隊員複選隊伍 Buff
      if (customId.startsWith('party_member_buff_multiselect_')) {
        const pId = customId.replace('party_member_buff_multiselect_', '');
        const selectedBuffs = interaction.values;

        userChoiceMap.set(`temp_selected_buffs_${interaction.user.id}`, selectedBuffs);

        const modal = new ModalBuilder()
          .setCustomId(`modal_party_member_buff_levels_${pId}`)
          .setTitle('設定已選 Buff 技能等級');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('input_buff_levels')
              .setLabel(`已選技能：${selectedBuffs.join('、')}`)
              .setValue(selectedBuffs.map(b => `${b}滿`).join('、'))
              .setPlaceholder('範例：眼滿、火滿、速20、祈禱滿')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
        return await interaction.showModal(modal);
      }

      // 4. 報到精靈職業與擁有者
      if (customId === 'wiz_select_job') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新點擊報到！', flags: MessageFlags.Ephemeral });
        const selectedJob = interaction.values[0];
        if (session.step === 'MAIN') session.main.job = selectedJob;
        else if (session.currentSub) session.currentSub.job = selectedJob;
        return await interaction.update(buildWizardConfigCard(interaction.user.id));
      }

      // 7-A. 隊長加人 步驟 2：列出該成員名下所有角色，讓隊長挑要上哪幾隻
      if (customId.startsWith('party_pick_user_')) {
        await interaction.deferUpdate();
        const pId = customId.replace('party_pick_user_', '');
        const uid = interaction.values[0];
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply({ content: '❌ 揪團不存在。', components: [] });
        const pData = doc.data();
        if (!isPartyLeader(pData, interaction)) {
          return interaction.editReply({ content: '❌ 只有隊長或管理員可以直接加人！', components: [] });
        }
        if (pData.isClosed) return interaction.editReply({ content: '🔒 此揪團已關閉招募！', components: [] });

        const prof = await fetchUserDocSafe(uid);
        const chars = listCharacters(prof);
        if (!chars.length) {
          return interaction.editReply({
            content: `❌ <@${uid}> 名冊裡還沒有任何角色，請先請他用 \`/名冊\` 完成報到，才能被加進隊伍。`,
            components: []
          });
        }

        const joined = new Set((pData.members || [])
          .filter(m => m.userId === uid)
          .map(m => (m.ign || '').toLowerCase()));

        const options = chars.slice(0, 25).map(c =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${c.isMain ? '👑 本尊' : '⚔️ 分身'}：${c.ign}`.substring(0, 100))
            .setDescription(`${c.job} Lv.${c.level}${joined.has(c.ign.toLowerCase()) ? '　(已在隊上)' : ''}`.substring(0, 100))
            .setValue(c.isMain ? 'main' : `sub_${c.idx}`)
        );

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`party_pick_char_${pId}_${uid}`)
            .setPlaceholder('⚔️ 選擇他要上的角色（可複選）')
            .setMinValues(1).setMaxValues(options.length)
            .addOptions(options)
        );
        return await interaction.editReply({
          content: `👉 **【隊長加人 · 第 2 步】<@${uid}> 名下共 ${chars.length} 隻角色，請挑這次要上的：**`,
          components: [row]
        });
      }

      // 7-A2. 隊長加人 步驟 3：把選定的角色加進隊伍
      if (customId.startsWith('party_pick_char_')) {
        await interaction.deferUpdate();
        const rest = customId.replace('party_pick_char_', '');
        const cut = rest.lastIndexOf('_');
        const pId = rest.slice(0, cut);
        const uid = rest.slice(cut + 1);

        const ref = db.collection('party_trainings').doc(pId);
        const doc = await ref.get();
        if (!doc.exists) return interaction.editReply({ content: '❌ 揪團不存在。', components: [] });
        const pData = doc.data();
        if (!isPartyLeader(pData, interaction)) {
          return interaction.editReply({ content: '❌ 只有隊長或管理員可以直接加人！', components: [] });
        }
        if (pData.isClosed) return interaction.editReply({ content: '🔒 此揪團已關閉招募！', components: [] });

        const prof = await fetchUserDocSafe(uid);
        const chars = listCharacters(prof);
        const members = pData.members || [];
        const added = [], dup = [];
        let full = false;

        for (const val of interaction.values) {
          const c = val === 'main'
            ? chars.find(x => x.isMain)
            : chars.find(x => !x.isMain && String(x.idx) === val.replace('sub_', ''));
          if (!c) continue;
          if (members.some(m => m.userId === uid && (m.ign || '').toLowerCase() === c.ign.toLowerCase())) {
            dup.push(c.ign); continue;
          }
          if (members.length >= pData.maxCount) { full = true; break; }
          members.push({ userId: uid, ign: c.ign, job: c.job, level: c.level, buffs: {} });
          added.push(c);
        }

        await ref.update({ members });
        await refreshPartyMessage(pId, { ...pData, members }, members.length >= pData.maxCount, interaction);

        if (added.length) {
          const u = await client.users.fetch(uid).catch(() => null);
          if (u) {
            const list = added.map(c => `\`${c.ign}\`（${c.job} Lv.${c.level}）`).join('、');
            await u.send(`📣 **【已被加入隊伍】** 隊長 <@${interaction.user.id}> 把你的 ${list} 加進了 **【${pData.target}】**（${pData.date} ${pData.startTime}），記得準時到！`).catch(() => {});
          }
        }

        let msg = added.length
          ? `✅ 已把 <@${uid}> 的 ${added.map(c => `\`${c.ign}\``).join('、')} 加進隊伍（已私訊通知本人）`
          : '⚠️ 沒有任何角色被加入。';
        if (dup.length) msg += `\n• 已在隊上，略過：${dup.map(x => '`' + x + '`').join('、')}`;
        if (full) msg += `\n• 隊伍已達上限 ${pData.maxCount} 人，其餘未加入。`;
        msg += `\n\n要再加別人的話，回到面板再按一次「👥 隊長加人」。`;
        return await interaction.editReply({ content: msg, components: [] });
      }

      // 7-B. 隊長踢人：執行移除
      if (customId.startsWith('party_kick_sel_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = customId.replace('party_kick_sel_', '');
        const ref = db.collection('party_trainings').doc(pId);
        const doc = await ref.get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();
        if (!isPartyLeader(pData, interaction)) return interaction.editReply('❌ 只有隊長或管理員可以踢人！');

        const members = pData.members || [];
        const idxs = interaction.values.map(v => parseInt(v)).filter(n => !isNaN(n)).sort((a, b) => b - a);
        const removed = [];
        idxs.forEach(i => { if (members[i]) removed.push(members.splice(i, 1)[0]); });

        await ref.update({ members });
        await refreshPartyMessage(pId, { ...pData, members }, members.length >= pData.maxCount, interaction);

        for (const r of removed) {
          if (!r.userId || r.userId === interaction.user.id) continue;
          const u = await client.users.fetch(r.userId).catch(() => null);
          if (u) {
            await u.send(`📢 **【已被移出隊伍】** 您的角色【**${r.ign}**】已被隊長 <@${interaction.user.id}> 從 **【${pData.target}】** 移除。若有疑問請直接聯繫隊長。`).catch(() => {});
          }
        }
        return await interaction.editReply(removed.length
          ? `🚫 已移除 ${removed.length} 位：${removed.map(r => '`' + r.ign + '`').join('、')}（已私訊通知）`
          : '⚠️ 沒有任何隊員被移除。');
      }

      // 8. 揪團退出指定角色
      if (customId === 'select_party_member_to_remove') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const parts = interaction.values[0].split('_');
        const pId = parts[1];
        const charIgn = parts.slice(2).join('_');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        pData.members = (pData.members || []).filter(m => !(m.userId === interaction.user.id && m.ign.toLowerCase() === charIgn.toLowerCase()));
        await db.collection('party_trainings').doc(pId).update({ members: pData.members });

        if (pData.channelId && pData.messageId) {
          const ch = await client.channels.fetch(pData.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(pData.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createPartyEmbed(pData)], components: createPartyComponents(pId, pData.isClosed, false) }).catch(() => {});
          }
        }
        return await interaction.editReply(`✅ 成功將角色【**${charIgn}**】從隊伍中退出！`);
      }

      // 9. 賭局下注與結算
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

        // 沒有「類型」了，改看勝方文字：含「過」且不含「不過」就當作點過
        const winName = d.options[winIdx].name;
        const isBookPassed = winName.includes('過') && !winName.includes('不過');

        let ansiReport = '```ansi\n';
        ansiReport += '\u001b[1;32m🏆 贏家【哪有賭狗天天輸？How to lose？】\u001b[0m\n';
        if (winnerList.length) {
          winnerList.forEach(w => ansiReport += `\u001b[32m[${w.ign} _ 下注 ${formatMeso(w.bet)} _ +${formatMeso(w.gain)} 楓幣]\u001b[0m\n`);
        } else {
          ansiReport += '\u001b[32m• 本局無人押中勝方\u001b[0m\n';
        }

        ansiReport += '\n\u001b[1;31m💀 輸家【賭狗賭狗，賭到最後一無所有】\u001b[0m\n';
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
        let tGuide = `🧾 **【最少交易轉帳清單】**\n` + (transfers.length ? transfers.map((t, i) => `${i + 1}. ➡️ **${t.from}** 交易給 **${t.to}**：\`${formatMeso(t.amount)} 楓幣\``).join('\n') : '• 本局無須進行跨玩家轉帳');

        await db.collection('active_bets').doc(bId).update({ isSettled: true });

        const embed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle(`🎉【競猜結算】${d.title}`)
          .setDescription(`🏆 **最終獲勝**：**【${d.options[winIdx].name}】**\n💰 **公開總彩池**：\`${formatMeso(totalPool)} 楓幣\`\n\n${ansiReport}\n${tGuide}`);

        if (d.channelId && d.messageId) {
          const ch = await client.channels.fetch(d.channelId).catch(() => null);
          if (ch) {
            const m = await ch.messages.fetch(d.messageId).catch(() => null);
            if (m) await m.edit({ embeds: [createMultiBetEmbed({ ...d, isSettled: true })], components: createMultiBetComponents(bId, d.options, true) }).catch(() => {});
          }
        }

        return await interaction.editReply({ embeds: [embed] });
      }

      // 10. 名片更新等級與刪除
      if (customId === 'select_char_to_delete') {
        const val = interaction.values[0];

        // 本尊沒了分身也留不住，所以刪本尊 = 刪掉整筆名冊，確認視窗要講清楚
        if (val.startsWith('del_main_')) {
          if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
            return interaction.reply({ content: '❌ 僅超級管理員可刪除本尊。', flags: MessageFlags.Ephemeral });
          }
          // Discord ID 是純數字，用正則切比 split('_') 穩 —— 角色名稱常含底線
          const m = val.match(/^del_main_(\d+)_(.*)$/s);
          if (!m) return interaction.reply({ content: '❌ 這個選項已失效，請重新搜尋。', flags: MessageFlags.Ephemeral });
          const uid = m[1];
          const mainIgn = m[2];
          const prof = await fetchUserDocSafe(uid);
          const subCount = (prof.subs || []).length;

          const embedMain = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(`⚠️ 這是本尊：【${mainIgn}】`)
            .setDescription(
              `持有人：<@${uid}>\n${PANEL_DIV}\n` +
              `刪除本尊等於**刪掉這個人的整筆名冊**，連同 **${subCount}** 隻分身一起消失：\n` +
              ((prof.subs || []).slice(0, 10).map(s => `‧ ${s.ign}（${s.job} Lv.${s.level}）`).join('\n') || '‧（沒有分身）') +
              (subCount > 10 ? `\n‧ …還有 ${subCount - 10} 隻` : '') +
              '\n\n**這個動作無法復原。** 本人若還在群內，身分組會一併清掉並標成未認證。'
            );
          const rowMain = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_confirm_delete_profile_${uid}`).setLabel('🗑️ 確定刪除整筆名冊').setStyle(ButtonStyle.Danger)
          );
          return await interaction.reply({ embeds: [embedMain], components: [rowMain], flags: MessageFlags.Ephemeral });
        }

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
          new ButtonBuilder().setCustomId(`btn_confirm_delete_char_${targetUid}_${charIdx}_${ign}`.substring(0, 100)).setLabel('🗑️ 確定刪除').setStyle(ButtonStyle.Danger)
        );
        return await interaction.reply({ embeds: [embedConfirm], components: [rowConfirm], flags: MessageFlags.Ephemeral });
      }

      // 11.【修復】成員名冊：按職業分類查詢
      if (customId === 'select_profile_job_view') {
        await interaction.deferUpdate();
        const targetJob = interaction.values[0];
        const embed = await generateJobEmbed(targetJob);
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

      // 12.【修復】管理員代管控制台：選定成員後顯示操作面板
      if (customId === 'admin_select_user_for_panel') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferUpdate();
        const targetUid = interaction.values[0];
        userChoiceMap.set(`admin_panel_target_${interaction.user.id}`, targetUid);

        const profile = await fetchUserDocSafe(targetUid);
        const subText = (profile.subs || []).map((s, i) => `${i + 1}. \`${s.ign}\` (${s.job} Lv.${s.level})`).join('\n') || '無分身角色';

        const embed = new EmbedBuilder()
          .setColor(0xF1C40F)
          .setTitle('👥【管理員代管控制台】')
          .setDescription(
            `🎯 **目標成員**：<@${targetUid}>\n` +
            `👑 **本尊**：${profile.mainIgn ? `\`${profile.mainIgn}\` (${profile.mainJob} Lv.${profile.mainLevel})` : '尚未建檔'}\n` +
            `🏷️ **綽號**：\`${profile.nickname || '未填'}\`\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⚔️ **分身角色**：\n${subText}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 請點擊下方按鈕對該成員執行代管操作。`
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('admin_panel_add').setLabel('➕ 代添角色').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('admin_panel_lvl').setLabel('🆙 代更等級').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('admin_panel_del').setLabel('🗑️ 代刪角色').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('admin_panel_retire').setLabel('🚪 標記/取消退休').setStyle(ButtonStyle.Secondary)
        );

        return await interaction.editReply({ content: '', embeds: [embed], components: [row] });
      }

      // 13.【修復】管理員代添角色：選定成員後直接開表單
      if (customId === 'admin_select_user_to_add_char') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        const targetUid = interaction.values[0];
        userChoiceMap.set(`target_add_user_${interaction.user.id}`, targetUid);
        return await interaction.showModal(buildAddCharModal(targetUid));
      }

      // 14.【修復】管理員代更等級：選定成員後列出其角色
      if (customId === 'admin_select_user_to_update_lvl') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        const targetUid = interaction.values[0];
        const r = await fetchProfileFast(targetUid);
        if (!r.ok) return interaction.reply({ content: DB_SLOW_MSG, flags: MessageFlags.Ephemeral });
        const prof = r.data;
        if (!prof.mainIgn && !(prof.subs || []).length) {
          return interaction.reply({ content: `❌ 成員 <@${targetUid}> 尚未登記任何角色！`, flags: MessageFlags.Ephemeral });
        }
        return await interaction.showModal(buildBatchLevelModal(targetUid, prof));
      }

      // 15.【修復】管理員代刪角色：選定成員後列出其分身
      if (customId === 'admin_select_user_to_delete_char') {
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.reply({ content: '❌ 僅超級管理員可使用！', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferUpdate();
        const targetUid = interaction.values[0];
        const row = await buildCharSelectRowForUser(targetUid, interaction.user.id);
        if (!row) return await interaction.editReply({ content: `❌ 成員 <@${targetUid}> 沒有可刪除的分身角色！`, components: [] });
        return await interaction.editReply({ content: `👉 **【代刪角色】請選擇 <@${targetUid}> 要刪除的分身：**`, components: [row] });
      }
    }

    // ----------------------------------------
    // [D] Modal 提交
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      // 4. 報到精靈提交
      if (customId === 'modal_wizard_step1_main') {
        const nickname = interaction.fields.getTextInputValue('wiz_nickname').trim();
        const ign = interaction.fields.getTextInputValue('wiz_main_ign').trim();
        const level = clampLevel(interaction.fields.getTextInputValue('wiz_main_level'), '1');

        const session = wizardSessionMap.get(interaction.user.id) || {
          userId: interaction.user.id, targetUserId: interaction.user.id, subs: []
        };

        session.step = 'MAIN';
        session.nickname = nickname;
        session.main = {
          ign, job: session.main?.job || '黑騎士', level
        };

        wizardSessionMap.set(interaction.user.id, session);
        return await interaction.reply({ ...buildWizardConfigCard(interaction.user.id), flags: MessageFlags.Ephemeral });
      }

      if (customId === 'modal_wizard_step_sub') {
        const session = wizardSessionMap.get(interaction.user.id);
        if (!session) return interaction.reply({ content: '❌ 報到已逾時，請重新登記！', flags: MessageFlags.Ephemeral });

        const ign = interaction.fields.getTextInputValue('wiz_sub_ign').trim();
        const level = clampLevel(interaction.fields.getTextInputValue('wiz_sub_level'), '120');
        const targetUid = session.targetUserId || interaction.user.id;

        session.step = 'SUB';
        session.currentSub = { ign, job: '主教', level };

        return await interaction.reply({ ...buildWizardConfigCard(interaction.user.id), flags: MessageFlags.Ephemeral });
      }

      // 6. 隊員報名提交 (本尊/分身快速報名)
      if (customId.startsWith('modal_party_reg_char_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = customId.replace('modal_party_reg_char_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();
        if (pData.isClosed) return interaction.editReply('🔒 此揪團已關閉招募！');

        const raw = interaction.fields.getTextInputValue('p_char_info').split(/[/\\|\s,，_-]+/);
        const ign = raw[0] || interaction.user.displayName, job = raw[1] || '冒險家', lv = raw[2] || '120';
        const rawBuffs = interaction.fields.getTextInputValue('p_buffs')?.trim();

        const buffs = parseBuffInput(rawBuffs);

        const members = (pData.members || []).filter(m => !(m.userId === interaction.user.id && m.ign.toLowerCase() === ign.toLowerCase()));
        members.push({ userId: interaction.user.id, ign, job, level: lv, buffs });

        const currentCount = members.length;
        if (currentCount > pData.maxCount) {
          return interaction.editReply('❌ 報名失敗：此隊伍達上限');
        }
        const isFull = currentCount >= pData.maxCount;

        await db.collection('party_trainings').doc(pId).update({ members });
        await refreshPartyMessage(pId, { ...pData, members }, isFull, interaction);
        return await interaction.editReply(`🎉 成功報名加入揪團！角色：\`${ign}\``);
      }

      // 7. 隊員設定已選 Buff 技能等級提交
      if (customId.startsWith('modal_party_member_buff_levels_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = customId.replace('modal_party_member_buff_levels_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        const targetIgn = userChoiceMap.get(`buff_charIgn_${interaction.user.id}`);
        const selectedBuffs = userChoiceMap.get(`temp_selected_buffs_${interaction.user.id}`) || [];
        const levelInput = interaction.fields.getTextInputValue('input_buff_levels').trim();

        const buffObj = {};
        const pairs = levelInput.split(/[,，、\s/|]+/);
        selectedBuffs.forEach(b => {
          const matchedPair = pairs.find(p => p.includes(b));
          if (matchedPair) {
            buffObj[b] = matchedPair.replace(b, '').replace(/[^0-9滿]/g, '') || '滿';
          } else {
            buffObj[b] = '滿';
          }
        });

        const members = pData.members || [];
        const memIdx = members.findIndex(m => m.userId === interaction.user.id && (!targetIgn || m.ign.toLowerCase() === targetIgn.toLowerCase()));

        if (memIdx === -1) {
          return interaction.editReply('❌ 找不到您的報名角色紀錄，請先重新報名加入！');
        }

        members[memIdx].buffs = buffObj;
        await db.collection('party_trainings').doc(pId).update({ members });

        await refreshPartyMessage(pId, { ...pData, members }, members.length >= pData.maxCount, interaction);

        userChoiceMap.delete(`temp_selected_buffs_${interaction.user.id}`);
        userChoiceMap.delete(`buff_charIgn_${interaction.user.id}`);
        return await interaction.editReply(`✅ 已成功更新您的角色【**${members[memIdx].ign}**】隊伍 Buff 設定！`);
      }

      // 8. 揪團自訂角色報名提交
      if (customId.startsWith('modal_party_custom_single_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const pId = customId.replace('modal_party_custom_single_', '');
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();
        if (pData.isClosed) return interaction.editReply('🔒 此揪團已關閉招募！');

        const ign = interaction.fields.getTextInputValue('c_ign').trim();
        const rawJob = interaction.fields.getTextInputValue('c_job').trim();
        const lv = clampLevel(interaction.fields.getTextInputValue('c_lv'), '120');
        const rawBuffs = interaction.fields.getTextInputValue('c_buffs')?.trim();

        let job = '黑騎士';
        for (const validJob of Object.keys(ROLES.JOBS)) {
          if (rawJob.includes(validJob)) { job = validJob; break; }
        }

        const buffs = parseBuffInput(rawBuffs);

        const members = (pData.members || []).filter(m => !(m.userId === interaction.user.id && m.ign.toLowerCase() === ign.toLowerCase()));
        members.push({ userId: interaction.user.id, ign, job, level: lv, buffs });

        const currentCount = members.length;
        if (currentCount > pData.maxCount) {
          return interaction.editReply('❌ 報名失敗：此隊伍達上限');
        }
        const isFull = currentCount >= pData.maxCount;

        await db.collection('party_trainings').doc(pId).update({ members });
        await refreshPartyMessage(pId, { ...pData, members }, isFull, interaction);
        return await interaction.editReply(`🎉 成功報名加入揪團！角色：\`${ign}\``);
      }

      // 9. 揪團修改提交 (同樣進行嚴格日期時間驗證)
      if (customId.startsWith('modal_party_edit_')) {
        const pId = customId.replace('modal_party_edit_', '');
        // 日期與時間合併成一格填寫，用空白切開
        const whenRaw = interaction.fields.getTextInputValue('e_when').trim();
        const [newDate, newTime] = whenRaw.split(/[\s　]+/);

        const startTimestamp = parseStrictPartyTimestamp(newDate, newTime);
        if (!startTimestamp) {
          return await interaction.reply({
            content: `❌ **開打時間格式錯誤！**\n`
              + '請照這個格式填，中間用一個空白隔開：`2026-09-15 20:00`\n'
              + '• 日期 `YYYY-MM-DD`　• 時間 24 小時制 `HH:mm`',
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const doc = await db.collection('party_trainings').doc(pId).get();
        if (!doc.exists) return interaction.editReply('❌ 揪團不存在。');
        const pData = doc.data();

        pData.kind = (interaction.fields.getTextInputValue('e_kind') || '').trim() || '組隊';
        pData.target = interaction.fields.getTextInputValue('e_target').trim();
        pData.date = newDate;
        pData.startTime = newTime;
        pData.startTimestamp = startTimestamp;
        pData.maxCount = Math.max(2, parseInt(interaction.fields.getTextInputValue('e_max')) || 6);
        pData.bindReq = interaction.fields.getTextInputValue('e_note')?.trim() || '無';
        pData.reminded30m = false; // 修改時間後重置提醒標記

        const isFull = (pData.members || []).length >= pData.maxCount;

        await db.collection('party_trainings').doc(pId).update(pData);
        await refreshPartyMessage(pId, pData, isFull, interaction);
        return await interaction.editReply('✅ 揪團資訊已成功更新！');
      }

      // 11. 賭局同情救濟
      if (customId.startsWith('modal_pity_donate_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const bId = customId.replace('modal_pity_donate_', '');
        const amt = parseMoneyInput(interaction.fields.getTextInputValue('input_pity_amount'));
        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局不存在。');
        const d = doc.data();

        if (amt <= 0) return interaction.editReply('❌ 金額無效！');
        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.nickname || prev.mainIgn || interaction.user.displayName;

        d.pityDonations = d.pityDonations || {};
        const newTotal = (d.pityDonations[interaction.user.id]?.amount || 0) + amt;
        d.pityDonations[interaction.user.id] = { ign, amount: newTotal };
        await db.collection('active_bets').doc(bId).update({ pityDonations: d.pityDonations });

        // 公開播報（原本是私密，改為公開讓大家看到善舉）
        if (d.channelId) {
          const ch = await client.channels.fetch(d.channelId).catch(() => null);
          if (ch && ch.isTextBased()) {
            let pool = 0;
            Object.values(d.pityDonations).forEach(x => pool += (x.amount || 0));
            const announce = new EmbedBuilder()
              .setColor(0x1ABC9C)
              .setTitle('🩹【同情抖內】人間自有真情在')
              .setDescription(
                `慈善家 <@${interaction.user.id}>（\`${ign}\`）為 **【${d.title}】** 的苦主抖內了 \`${formatMeso(amt)} 楓幣\`！\n` +
                `💬 ${getRandomPityQuote()}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🧧 目前救濟金總額：\`${formatMeso(pool)} 楓幣\`（結算時會列在慈善家名單）`
              );
            await ch.send({ embeds: [announce] }).catch(() => {});
          }
        }
        return await interaction.editReply(`🩹 已登記同情救濟 \`${formatMeso(amt)} 楓幣\`（累計 ${formatMeso(newTotal)}），已公開播報至頻道！`);
      }

      // 12. 名片更新等級
      // 12. 一次更新所有角色等級
      // ── /地圖 的兩張建立表單 ──
      if (customId === 'modal_map_share_new') {
        await interaction.deferReply();
        const mapName = interaction.fields.getTextInputValue('ms_map').trim();
        const channelNum = parseInt(String(interaction.fields.getTextInputValue('ms_chan')).replace(/[^0-9]/g, ''));
        if (!Number.isFinite(channelNum) || channelNum < 1) {
          return await interaction.editReply('❌ 頻道要填數字，例如 `12`。');
        }
        const leaveTime = interaction.fields.getTextInputValue('ms_leave').trim();
        const note = (interaction.fields.getTextInputValue('ms_note') || '').trim() || '無特殊備註';

        const mapRef = db.collection('map_shares').doc();
        const mapData = {
          id: mapRef.id, creatorId: interaction.user.id, mapName, channelNum, leaveTime, note,
          takerId: null, isFinished: false, createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        const msg = await interaction.editReply({
          embeds: [createMapEmbed(mapData)],
          components: createMapComponents(mapRef.id, mapData)
        });
        mapData.channelId = interaction.channelId;
        mapData.messageId = msg.id;
        await mapRef.set(mapData);
        return;
      }

      if (customId === 'modal_map_queue_new') {
        await interaction.deferReply();
        const slotMinutes = ROT_SLOT_MIN;   // 一格固定 60 分鐘
        const now = Date.now();

        const mapName = interaction.fields.getTextInputValue('mq_map').trim();
        const chanRaw = String(interaction.fields.getTextInputValue('mq_chan') || '').replace(/[^0-9]/g, '');
        const startRaw = (interaction.fields.getTextInputValue('mq_start') || '').trim();
        const endRaw = (interaction.fields.getTextInputValue('mq_end') || '').trim();
        const buyPrice = parseMoneyInput(interaction.fields.getTextInputValue('mq_buy'));

        let startMs;
        if (startRaw) {
          const parsed = rotParseWhen(startRaw, now);
          if (parsed === null) {
            return await interaction.editReply('❌ 看不懂開始時間。可以寫 `08:45`、`10/30 08:45` 或 `2026-10-30 08:45`。');
          }
          startMs = parsed;   // 照填的時間走，08:45 就是 08:45，不壓回整點
        } else {
          startMs = rotAlignStart(now, slotMinutes);
        }

        let spanHours;
        if (endRaw) {
          // 「結束時間或時數」一格兩用：純數字當小時數，有冒號就當時刻
          if (/^\d{1,3}(\.\d+)?$/.test(endRaw)) {
            spanHours = parseFloat(endRaw);
          } else {
            let endMs = rotParseWhen(endRaw, startMs);
            if (endMs === null) {
              return await interaction.editReply('❌ 看不懂結束時間。可以寫 `09:45`、`10/30 09:45`，或直接填數字代表幾小時。');
            }
            if (endMs <= startMs) endMs += 86400000;      // 跨夜
            spanHours = (endMs - startMs) / 3600000;
          }
          if (spanHours > ROT_MAX_SPAN_H) {
            return await interaction.editReply(`❌ 一張表最長只能 ${ROT_MAX_SPAN_H} 小時，你設定的是 ${spanHours.toFixed(1)} 小時。`);
          }
        } else {
          spanHours = ROT_SPAN_HOURS;
        }
        spanHours = Math.min(ROT_MAX_SPAN_H, Math.max(ROT_MIN_SPAN_H, spanHours));
        const slotCount = Math.max(1, Math.round((spanHours * 60) / slotMinutes));

        const ref = db.collection('map_rotations').doc();
        const rot = {
          id: ref.id,
          creatorId: interaction.user.id,
          creatorTag: interaction.member?.displayName || interaction.user.username,
          creatorAvatar: interaction.user.displayAvatarURL(),
          mapName,
          channelNum: parseInt(chanRaw) || 0,          // 0 = 還沒決定
          note: '無特殊備註',
          slotMinutes, startMs, slotCount, spanHours,
          buyPrice, splitMode: ROT_SPLIT_EVEN, allowShare: false, sellPrice: 0, settled: false,
          gapAsked: [],
          slots: {}, colors: {}, isClosed: false, notifiedIdx: -1, preNotified: [],
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const msg = await interaction.editReply({
          embeds: [buildRotationEmbed(rot)],
          components: buildRotationComponents(ref.id, rot)
        });
        rot.channelId = interaction.channelId;
        rot.messageId = msg.id;
        await ref.set(rot);
        cacheRot(ref.id, rot);
        return await interaction.followUp({
          content: '✅ 排隊表開好了。**備註、團練、分攤方式**請用面板上的 ✏️ 修改內容 設定。',
          flags: MessageFlags.Ephemeral
        });
      }

      if (customId.startsWith('modal_rot_chan_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rotId = customId.replace('modal_rot_chan_', '');
        const ref = db.collection('map_rotations').doc(rotId);
        const doc = await ref.get().catch(() => null);
        if (!doc?.exists) return interaction.editReply('❌ 這張排班表已經不存在了。');
        const rot = doc.data();

        // 權限在這裡才驗：跳表單前沒辦法安全地讀資料庫
        const hasSlot = Object.keys(rot.slots || {})
          .some(k => rotHasUser(rot, Number(k), interaction.user.id));
        const canEdit = hasSlot || rot.creatorId === interaction.user.id
          || isSuperAdmin(interaction.user.id, interaction.memberPermissions);
        if (!canEdit) return interaction.editReply('❌ 只有有排到班的人、開表者或管理員可以改頻道。');

        const newChan = parseInt(String(interaction.fields.getTextInputValue('rot_new_chan')).replace(/[^0-9]/g, ''));
        if (!Number.isFinite(newChan) || newChan < 1) return interaction.editReply('❌ 頻道要填數字。');
        if (newChan === rot.channelNum) return interaction.editReply(`💡 本來就是第 ${newChan} 頻道，沒有變動。`);

        const reason = (interaction.fields.getTextInputValue('rot_chan_reason') || '').trim();
        const oldChan = rot.channelNum;
        await ref.update({ channelNum: newChan });
        const merged = { ...rot, channelNum: newChan };
        cacheRot(rotId, merged);
        await refreshRotationMessage(rotId, merged, interaction);

        // 換頻道所有人都要知道，所以公開公告並 tag 有排班的人
        const who = [...new Set(Object.keys(rot.slots || {})
          .flatMap(k => rotSlotUsers(rot, Number(k)).map(u => u.userId)))]
          .filter(u => u !== interaction.user.id);
        try {
          const ch = interaction.channel;
          if (ch?.isTextBased()) {
            await ch.send({
              content: (who.length ? who.map(u => `<@${u}>`).join(' ') + '\n' : '')
                + (oldChan > 0
                    ? `📺 **【頻道變更】${rot.mapName}**　第 ${oldChan} 頻 ➔ **第 ${newChan} 頻**\n`
                    : `📺 **【頻道確定】${rot.mapName}**　➔ **第 ${newChan} 頻**\n`)
                + `由 <@${interaction.user.id}> 變更${reason ? `　‧　原因：${reason}` : ''}`
            });
          }
        } catch (e) { console.error('頻道變更公告失敗:', e.message); }

        return interaction.editReply(`✅ 已改成第 **${newChan}** 頻道，並公告給有排班的人。`);
      }

      if (customId.startsWith('modal_rot_edit_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rotId = customId.replace('modal_rot_edit_', '');
        const ref = db.collection('map_rotations').doc(rotId);
        const doc = await ref.get().catch(() => null);
        if (!doc?.exists) return interaction.editReply('❌ 這張排班表已經不存在了。');
        const rot = doc.data();
        if (rot.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 只有開表的人或管理員可以修改內容。');
        }
        if (rot.settled) return interaction.editReply('💡 這張表已經結算完畢，不能再改了。');

        const mapName = (interaction.fields.getTextInputValue('rot_e_map') || '').trim() || rot.mapName;
        const note = (interaction.fields.getTextInputValue('rot_e_note') || '').trim() || '無特殊備註';
        const buyPrice = parseMoneyInput(interaction.fields.getTextInputValue('rot_e_buy'));
        const splitRaw = (interaction.fields.getTextInputValue('rot_e_split') || '').trim();
        const splitMode = splitRaw
          ? (/時間|time|比例/i.test(splitRaw) ? ROT_SPLIT_TIME : ROT_SPLIT_EVEN)
          : (rot.splitMode || ROT_SPLIT_EVEN);

        const changes = [];
        if (mapName !== rot.mapName) changes.push(`地圖：${rot.mapName} ➔ ${mapName}`);
        if (note !== rot.note) changes.push('備註已更新');
        if (buyPrice !== (rot.buyPrice || 0)) {
          changes.push(`買圖：${rot.buyPrice > 0 ? formatMeso(rot.buyPrice) : '免費'} ➔ ${buyPrice > 0 ? formatMeso(buyPrice) : '免費'}`);
        }
        if (splitMode !== rot.splitMode) changes.push(`分攤方式：${rotSplitLabel(rot.splitMode)} ➔ ${rotSplitLabel(splitMode)}`);

        const shareRaw = (interaction.fields.getTextInputValue('rot_e_share') || '').trim();
        const allowShare = shareRaw ? /開|on|yes|是|true/i.test(shareRaw) : !!rot.allowShare;
        if (allowShare !== !!rot.allowShare) changes.push(`團練：${rot.allowShare ? '開' : '關'} ➔ ${allowShare ? '開' : '關'}`);

        if (!changes.length) return interaction.editReply('💡 沒有任何變動。');

        await ref.update({ mapName, note, buyPrice, splitMode, allowShare });
        const merged = { ...rot, mapName, note, buyPrice, splitMode, allowShare };
        cacheRot(rotId, merged);
        await refreshRotationMessage(rotId, merged, interaction);
        return interaction.editReply(`✅ 已更新：\n${changes.map(c => `‧ ${c}`).join('\n')}`);
      }

      if (customId.startsWith('modal_rot_settle_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rotId = customId.replace('modal_rot_settle_', '');
        const ref = db.collection('map_rotations').doc(rotId);
        const doc = await ref.get().catch(() => null);
        if (!doc?.exists) return interaction.editReply('❌ 這張排班表已經不存在了。');
        const rot = doc.data();

        if (rot.creatorId !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 只有開表的人或管理員可以結算。');
        }
        if (rot.settled) return interaction.editReply('💡 這張表已經結算過了。');

        const sellPrice = parseMoneyInput(interaction.fields.getTextInputValue('rot_sell_price'));
        const modeRaw = (interaction.fields.getTextInputValue('rot_split_mode') || '').trim();
        const splitMode = modeRaw
          ? (/時間|time|比例/i.test(modeRaw) ? ROT_SPLIT_TIME : ROT_SPLIT_EVEN)
          : (rot.splitMode || ROT_SPLIT_EVEN);

        const merged = { ...rot, sellPrice, splitMode };
        const net = (merged.buyPrice || 0) - sellPrice;

        // 賣得比買得貴 → 問開表者要不要把賺的分給大家
        if (net < 0) {
          await ref.update({ sellPrice, splitMode });
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rot_profit_share_${rotId}`).setLabel('💸 分給大家').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`rot_profit_keep_${rotId}`).setLabel('🙅 我自己留').setStyle(ButtonStyle.Secondary)
          );
          return await interaction.editReply({
            content: `💹 這趟**轉手賺了 ${formatMeso(-net)}**（買 ${formatMeso(merged.buyPrice)}、賣 ${formatMeso(sellPrice)}）。\n`
              + '要把賺的分給有打的人嗎？選完才會公開結算。',
            components: [row]
          });
        }

        await ref.update({ sellPrice, splitMode, isClosed: true, settled: true, shareProfit: true });
        return await rotPostSettlement(interaction, rotId, { ...merged, isClosed: true, settled: true }, true);
      }

      if (customId === 'modal_del_search_ign') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 僅超級管理員可使用！');
        }
        const kw = interaction.fields.getTextInputValue('del_search_ign');
        const hits = await searchCharactersByIgn(kw);
        if (!hits.length) {
          return interaction.editReply(`🔍 名冊裡找不到含有「**${kw}**」的角色。`);
        }

        const shown = hits.slice(0, 25);
        const options = shown.map(h => new StringSelectMenuOptionBuilder()
          .setLabel(`${h.isMain ? '👑 本尊' : '⚔️ 分身'}：${h.ign} (${h.job} Lv.${h.lv})`.substring(0, 100))
          .setDescription(`持有人：${h.nickname || h.uid}${h.isMain ? `　連同 ${h.subCount} 隻分身` : ''}`.substring(0, 100))
          .setValue(h.isMain
            ? `del_main_${h.uid}_${h.ign}`.substring(0, 100)
            : `del_char_${h.uid}_${h.idx}_${h.ign}`.substring(0, 100)));

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_char_to_delete')
            .setPlaceholder('⚠️ 選擇要刪除的角色').addOptions(options)
        );
        return await interaction.editReply({
          content: `🔍 找到 **${hits.length}** 筆含有「**${kw}**」的角色`
            + (hits.length > shown.length ? `（只列前 ${shown.length} 筆，請打更完整的名稱）` : '')
            + '：',
          components: [row]
        });
      }

      if (customId.startsWith('modal_raid_batch_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const targetUid = customId.replace('modal_raid_batch_', '');
        if (targetUid !== interaction.user.id && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 只能更新自己的突襲次數！');
        }

        const profile = await fetchUserDocSafe(targetUid);
        const current = getRaidState(profile);
        if (!current.length) return interaction.editReply('❌ 找不到名冊資料，請先完成報到。');

        const { rows, bad } = parseRaidBatch(interaction.fields.getTextInputValue('raid_rows'));
        if (!rows.length) {
          return interaction.editReply('❌ 沒有讀到任何一行有效資料。格式是每行一隻：\`角色=已用/上限\`');
        }

        const byKey = new Map(current.map(c => [c.ign.toLowerCase(), c]));
        const changed = [], unknown = [];
        for (const r of rows) {
          const hit = byKey.get(r.ign.toLowerCase());
          if (!hit) { unknown.push(r.ign); continue; }
          // 上限只有 7（免費）與 14（吃卷）兩種，填超過 7 就當作吃了突襲卷
          const cap = r.cap === null ? hit.cap : (r.cap > RAID_FREE_CAP ? RAID_SCROLL_CAP : RAID_FREE_CAP);
          const used = Math.min(Math.max(r.used, 0), cap);
          if (used === hit.used && cap === hit.cap) continue;
          changed.push(`• **${hit.ign}**：\`${hit.used}/${hit.cap}\` ➔ \`${used}/${cap}\``);
          hit.used = used; hit.cap = cap;
        }

        if (!changed.length) {
          let msg = '💡 本週突襲次數沒有變動。';
          if (unknown.length) msg += `\n⚠️ 名冊裡找不到這些角色：${unknown.map(x => '\`' + x + '\`').join('、')}`;
          if (bad.length) msg += `\n⚠️ 這幾行看不懂：${bad.slice(0, 5).map(x => '\`' + x + '\`').join('、')}`;
          return interaction.editReply(msg);
        }

        await saveRaidState(targetUid, current);
        const merged = { ...profile, raid: { weekKey: raidWeekKey(), chars: raidCharsMap(current) } };

        let note = `⚔️ 已更新 **${changed.length}** 隻角色的突襲進度：\n${changed.slice(0, 12).join('\n')}`;
        if (changed.length > 12) note += `\n…其餘 ${changed.length - 12} 隻`;
        if (unknown.length) note += `\n⚠️ 名冊裡找不到：${unknown.map(x => '\`' + x + '\`').join('、')}`;
        if (bad.length) note += `\n⚠️ 這幾行看不懂：${bad.slice(0, 5).map(x => '\`' + x + '\`').join('、')}`;

        return interaction.editReply({
          content: note.slice(0, 1900),
          ...buildRaidPayload(merged, profile.nickname || profile.mainIgn,
            { isAdmin: isSuperAdmin(interaction.user.id, interaction.memberPermissions) })
        });
      }

      if (customId.startsWith('modal_batch_level_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const targetUid = customId.replace('modal_batch_level_', '');
        const isSelf = targetUid === interaction.user.id;
        if (!isSelf && !isSuperAdmin(interaction.user.id, interaction.memberPermissions)) {
          return interaction.editReply('❌ 只能更新自己的角色等級！');
        }

        const profile = await fetchUserDocSafe(targetUid);
        if (!profile.mainIgn && !(profile.subs || []).length) {
          return interaction.editReply('❌ 找不到名冊資料，請先完成報到。');
        }

        const { rows, bad } = parseBatchLevels(interaction.fields.getTextInputValue('batch_levels'));
        if (!rows.length) {
          return interaction.editReply('❌ 沒有讀到任何一行有效資料。格式是每行一隻：`角色名=等級`');
        }

        const subs = (profile.subs || []).map(x => ({ ...x }));
        const prevMainLevel = profile.mainLevel;
        let mainNewLevel = null;
        const changed = [], same = [], unknown = [];

        for (const r of rows) {
          const key = r.ign.toLowerCase();
          if (profile.mainIgn && profile.mainIgn.toLowerCase() === key) {
            if (String(profile.mainLevel) === r.level) { same.push(r.ign); continue; }
            changed.push({ ign: profile.mainIgn, from: profile.mainLevel, to: r.level, isMain: true });
            mainNewLevel = r.level;
            continue;
          }
          const hit = subs.findIndex(x => (x.ign || '').toLowerCase() === key);
          if (hit === -1) { unknown.push(r.ign); continue; }
          if (String(subs[hit].level) === r.level) { same.push(subs[hit].ign); continue; }
          changed.push({ ign: subs[hit].ign, from: subs[hit].level, to: r.level, isMain: false });
          subs[hit].level = r.level;
        }

        if (!changed.length) {
          let msg = '💡 沒有任何等級變動。';
          if (unknown.length) msg += `\n⚠️ 名冊裡找不到這些角色：${unknown.map(x => '`' + x + '`').join('、')}`;
          if (bad.length) msg += `\n⚠️ 這幾行看不懂：${bad.slice(0, 5).map(x => '`' + x + '`').join('、')}`;
          return interaction.editReply(msg);
        }

        // 照原本的建檔方式寫回：里程碑、身分組、暱稱全部照舊
        const payload = { userId: targetUid, subs: dedupeSubs(subs, profile.mainIgn) };
        if (mainNewLevel !== null) {
          payload.mainLevel = mainNewLevel;
          if (mainNewLevel === '199' && String(prevMainLevel) !== '199') {
            payload.reach199At = admin.firestore.FieldValue.serverTimestamp();
          } else if (mainNewLevel !== '199') {
            payload.reach199At = null;
          }
        }
        await db.collection('member_profiles').doc(targetUid).set(payload, { merge: true });
        invalidateProfile(targetUid);

        const merged = { ...profile, ...payload, subs };
        await syncMemberRoles(interaction.guild, targetUid, merged);

        if (mainNewLevel !== null) {
          const member = await interaction.guild.members.fetch(targetUid).catch(() => null);
          if (member) {
            const nick = `${profile.nickname || ''}[${mainNewLevel}_${profile.mainJob}]`.substring(0, 32);
            await member.setNickname(nick).catch(() => {});
          }
          const targetUser = await client.users.fetch(targetUid).catch(() => null);
          if (targetUser) {
            const milestone = await checkLevelMilestone(
              interaction.guild, targetUser, prevMainLevel, mainNewLevel, profile.mainIgn, profile.mainJob
            );
            if (milestone) await interaction.followUp({ embeds: [milestone], flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        }

        const lines = changed.map(c =>
          `${c.isMain ? '👑' : '⚔️'} **${c.ign}**　Lv.${c.from} ➔ **Lv.${c.to}**`
        ).join('\n');
        const resultEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle(`🆙 已更新 ${changed.length} 隻角色的等級`)
          .setDescription(
            lines +
            (same.length ? `\n━━━━━━━━━━━━━━━━━━━━\n⏸️ 未變動 ${same.length} 隻` : '') +
            (unknown.length ? `\n⚠️ 名冊裡找不到：${unknown.map(x => '`' + x + '`').join('、')}` : '') +
            (bad.length ? `\n⚠️ 看不懂的行：${bad.slice(0, 5).map(x => '`' + x + '`').join('、')}` : '')
          )
          .setFooter({ text: mainNewLevel !== null ? '本尊等級有變動，暱稱與身分組已同步' : '身分組已同步' });

        return await interaction.editReply({ embeds: [resultEmbed] });
      }

      // 發起賭局
      if (customId === 'modal_bet_create') {
        await interaction.deferReply();
        if (!db) return interaction.editReply('❌ 資料庫未連線');

        const again = await getActiveBetDoc();
        if (again) return interaction.editReply('⚠️ 就在剛剛已經有人開局了，請等這局結算後再發起！');

        const title = interaction.fields.getTextInputValue('bet_title').trim();
        const options = parseBetOptions(interaction.fields.getTextInputValue('bet_options'));
        const deadline = parseDeadline(interaction.fields.getTextInputValue('bet_deadline').trim());
        const seedMoney = parseMoneyInput(interaction.fields.getTextInputValue('bet_seed'));

        if (options.length < BET_MIN_OPTIONS) {
          return interaction.editReply(`❌ 至少要有 ${BET_MIN_OPTIONS} 個選項，每行填一個。目前只讀到 ${options.length} 個。`);
        }
        if (!deadline) {
          return interaction.editReply('❌ 截止時間格式無效！可以填 `15m`、`1h`、`21:30`（台北時間）。');
        }

        const bRef = db.collection('active_bets').doc();
        const bData = {
          id: bRef.id,
          creatorId: interaction.user.id,
          creatorName: interaction.user.username,
          title, options, deadline, seedMoney,
          pityDonations: {}, isSettled: false, isPaused: false, promptCount: 0
        };
        const msg = await interaction.editReply({
          embeds: [createMultiBetEmbed(bData)],
          components: createMultiBetComponents(bRef.id, options)
        });
        bData.channelId = interaction.channelId;
        bData.messageId = msg.id;
        await bRef.set(bData);
        return;
      }

      // 下注金額
      if (customId.startsWith('modal_bet_amount_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const rest = customId.replace('modal_bet_amount_', '');
        const cut = rest.lastIndexOf('_');
        const bId = rest.slice(0, cut);
        const optIdx = parseInt(rest.slice(cut + 1));
        const amt = parseMoneyInput(interaction.fields.getTextInputValue('bet_amount'));

        const doc = await db.collection('active_bets').doc(bId).get();
        if (!doc.exists) return interaction.editReply('❌ 賭局已失效。');
        const d = doc.data();
        if (d.isSettled) return interaction.editReply('🛑 該賭局已結算完畢！');
        if (Date.now() >= d.deadline) return interaction.editReply('🛑 該賭局已截止下注！');
        if (isNaN(optIdx) || !d.options[optIdx]) return interaction.editReply('❌ 選項無效。');
        if (amt < 1000000) return interaction.editReply('❌ 最低下注 100 萬楓幣（可填 100w、500w、1e）。');

        const prev = await fetchUserDocSafe(interaction.user.id);
        const ign = prev.nickname || prev.mainIgn || interaction.user.displayName;
        const cur = d.options[optIdx].bets[interaction.user.id]?.amount || 0;
        d.options[optIdx].bets[interaction.user.id] = { ign, amount: cur + amt };
        d.options[optIdx].pool = (d.options[optIdx].pool || 0) + amt;

        await db.collection('active_bets').doc(bId).update({ options: d.options });
        await refreshBetMessage(bId, d, interaction);

        return await interaction.editReply(
          `✅ 已為 **${d.options[optIdx].name}** 下注 \`${formatMeso(amt)} 楓幣\`！（你在這個選項累計 ${formatMeso(cur + amt)}）`
        );
      }

      // 13. 名片新增分身 (含管理員代添)
      if (customId === 'modal_card_add_char') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const ign = interaction.fields.getTextInputValue('add_char_ign').trim();
        const rawJob = interaction.fields.getTextInputValue('add_char_job').trim();
        const level = clampLevel(interaction.fields.getTextInputValue('add_char_level'), '120');
        const targetUid = userChoiceMap.get(`target_add_user_${interaction.user.id}`) || interaction.user.id;

        let job = '黑騎士';
        for (const validJob of Object.keys(ROLES.JOBS)) {
          if (rawJob.includes(validJob)) { job = validJob; break; }
        }

        const profile = await fetchUserDocSafe(targetUid);
        const subs = profile.subs || [];
        if (subs.some(s => s.ign?.toLowerCase() === ign.toLowerCase()) || profile.mainIgn?.toLowerCase() === ign.toLowerCase()) {
          return await interaction.editReply(`⚠️ 角色【**${ign}**】已存在於該成員名冊中，無需重複新增！`);
        }
        subs.push({ ign, job, level, raw: `${ign}/${job}/${level}` });

        await db.collection('member_profiles').doc(targetUid).set({ userId: targetUid, subs }, { merge: true });
        invalidateProfile(targetUid);

        await syncMemberRoles(interaction.guild, targetUid, { ...profile, subs });
        userChoiceMap.delete(`target_add_user_${interaction.user.id}`);
        return await interaction.editReply(`🎉 成功為 <@${targetUid}> 新增分身角色【**${ign}**】(${job} Lv.${level})！對應副職身分組已自動加發！`);
      }

      // 14.【修復】放圖：交接完成備註
      if (customId.startsWith('modal_map_done_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const mapId = customId.replace('modal_map_done_', '');
        const note = interaction.fields.getTextInputValue('map_done_note')?.trim() || '無';
        const mapDoc = await db.collection('map_shares').doc(mapId).get();
        if (!mapDoc.exists) return interaction.editReply('❌ 放圖資訊已失效。');
        const mapData = mapDoc.data();

        await db.collection('map_shares').doc(mapId).update({ isFinished: true, finishNote: note });
        await refreshMapMessage(mapId, { ...mapData, isFinished: true, finishNote: note }, interaction);
        return await interaction.editReply('🤝 已標記為交接完成，感謝您的分享！');
      }
    }
  } catch (err) {
    console.error('互動處理錯誤:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ 處理超時或發生異常，請重試！' }).catch(() => {});
      } else if (interaction.isRepliable()) {
        await interaction.reply({ content: '❌ 處理失敗，請重試！', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    } catch {}
  }
});

// ==========================================
// 8. 共用輔助函式 (函式宣告會被提升，可於上方監聽器中使用)
// ==========================================

// 解析使用者輸入的 Buff 字串 -> { 眼: '滿', 速: '20' }
function parseBuffInput(rawBuffs) {
  const buffs = {};
  if (!rawBuffs) return buffs;
  rawBuffs.split(/[,，、\s/|]+/).forEach(it => {
    const item = it.trim();
    if (!item) return;
    const matchedBuff = STANDARD_PARTY_BUFFS.find(b => item.includes(b));
    if (matchedBuff) {
      buffs[matchedBuff] = item.replace(matchedBuff, '').replace(/[^0-9滿]/g, '') || '滿';
    } else {
      buffs[item.substring(0, 8)] = '滿';
    }
  });
  return buffs;
}

// 統一重繪揪團面板訊息
async function refreshPartyMessage(pId, pData, isFull, interaction = null) {
  if (!pData?.channelId || !pData?.messageId) return false;
  try {
    const ch = await client.channels.fetch(pData.channelId);
    if (!ch?.isTextBased()) throw new Error('頻道不存在或不是文字頻道');
    const m = await ch.messages.fetch(pData.messageId);
    await m.edit({
      embeds: [createPartyEmbed(pData)],
      components: createPartyComponents(pId, pData.isClosed, isFull)
    });
    return true;
  } catch (e) {
    console.error('重繪揪團面板失敗:', e.message);
    await warnRefreshFailed(interaction, '揪團');
    return false;
  }
}

// 統一重繪賭局面板訊息
async function refreshBetMessage(bId, betData, interaction = null) {
  if (!betData?.channelId || !betData?.messageId) return false;
  try {
    const ch = await client.channels.fetch(betData.channelId);
    if (!ch?.isTextBased()) throw new Error('頻道不存在或不是文字頻道');
    const m = await ch.messages.fetch(betData.messageId);
    await m.edit({
      embeds: [createMultiBetEmbed(betData)],
      components: createMultiBetComponents(bId, betData.options, betData.isSettled)
    });
    return true;
  } catch (e) {
    console.error('重繪賭局面板失敗:', e.message);
    await warnRefreshFailed(interaction, '賭局');
    return false;
  }
}

// 建立放圖面板 Embed
function createMapEmbed(mapData) {
  const embed = new EmbedBuilder()
    .setColor(mapData.isFinished ? 0x95A5A6 : (mapData.takerId ? 0xF1C40F : 0x57F287))
    .setTitle(`🗺️【熱門地圖交接/放圖】${mapData.mapName}`)
    .setDescription(
      `👑 放圖者: <@${mapData.creatorId}>\n` +
      `📍 頻道: \`第 ${mapData.channelNum} 頻道\`\n` +
      `⏳ 預計離開: \`${mapData.leaveTime}\`\n` +
      `備註: \`${mapData.note || '無特殊備註'}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `狀態：${mapData.isFinished ? '✅ **已交接完成**' : (mapData.takerId ? `🟡 **已被 <@${mapData.takerId}> 預約**` : '🟢 **開放預約中**')}`
    );
  if (mapData.isFinished && mapData.finishNote && mapData.finishNote !== '無') {
    embed.setFooter({ text: `交接備註：${mapData.finishNote}`.substring(0, 2048) });
  }
  return embed;
}

function createMapComponents(mapId, mapData) {
  if (mapData?.isFinished) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`map_take_${mapId}`).setLabel('✋ 我要圖 (立即預約)').setStyle(ButtonStyle.Success).setDisabled(!!mapData?.takerId),
      new ButtonBuilder().setCustomId(`map_cancel_${mapId}`).setLabel('❌ 取消預約').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`map_done_${mapId}`).setLabel('🤝 已交接完成').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`map_refresh_${mapId}`).setLabel('🔄 即時更新').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`share_map_${mapId}`).setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
    )
  ];
}

// 統一重繪放圖面板訊息
async function refreshMapMessage(mapId, mapData, interaction = null) {
  if (!mapData?.channelId || !mapData?.messageId) return false;
  try {
    const ch = await client.channels.fetch(mapData.channelId);
    if (!ch?.isTextBased()) throw new Error('頻道不存在或不是文字頻道');
    const m = await ch.messages.fetch(mapData.messageId);
    await m.edit({
      embeds: [createMapEmbed(mapData)],
      components: createMapComponents(mapId, mapData)
    });
    return true;
  } catch (e) {
    console.error('重繪放圖面板失敗:', e.message);
    await warnRefreshFailed(interaction, '放圖');
    return false;
  }
}

// ==========================================
// 等級批次更新：一張表單改完名下所有角色
// ==========================================

// 我的名片（含退休狀態與自助切換鈕）
function buildMyCardPayload(d) {
  const subList = (d.subs || []).map((x, i) => `${i + 1}. \`${x.ign}\` (${x.job} Lv.${x.level})`).join('\n') || '無';
  const isWarden = parseInt(d.mainLevel) >= 200;
  const retired = !!d.isRetired;

  const embed = new EmbedBuilder()
    .setColor(retired ? 0x95A5A6 : (isWarden ? 0xF1C40F : 0x3498DB))
    .setTitle(`🪪 冒險家名片 - ${d.nickname ? `[${d.nickname}] ` : ''}${d.mainIgn} ${isWarden ? '👑 [Lv.200 典獄長]' : ''}`)
    .addFields(
      { name: '👑 本尊角色', value: `${d.mainJob} (Lv.${d.mainLevel})`, inline: true },
      { name: '📌 目前狀態', value: retired ? '🚪 已退休' : '🟢 現役中', inline: true },
      { name: `⚔️ 分身角色 (${(d.subs || []).length} 隻)`, value: subList, inline: false }
    );
  if (retired) {
    embed.setFooter({ text: '退休只是個標記：職業身分組與名冊紀錄都保留著，想回鍋隨時點「🔄 我回來了」。' });
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_trigger_wizard_main').setLabel('📝 報到/更新').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('card_btn_update_level').setLabel('🆙 更新等級').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('card_btn_add_char').setLabel('➕ 新增分身').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('card_btn_delete_char').setLabel('🗑️ 刪除分身').setStyle(ButtonStyle.Danger)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('card_btn_raid').setLabel('⚔️ 突襲進度').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('card_btn_roster').setLabel('📋 成員名冊').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('card_btn_retire')
      .setLabel(retired ? '🔄 我回來了 (解除退休)' : '🚪 我要退休')
      .setStyle(retired ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('refresh_card').setLabel('🔄 即時更新').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('share_card').setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row1, row2] };
}

// 同一個遊戲 ID 只保留一筆：後填的覆蓋先填的，並排除與本尊同名的分身。
// 報到精靈每次都是往 subs 後面 push，沒有這道防線就會越積越多重複。
function dedupeSubs(subs, mainIgn) {
  const byIgn = new Map();
  const mainKey = (mainIgn || '').trim().toLowerCase();
  (subs || []).forEach(sub => {
    const ign = (sub?.ign || '').trim();
    if (!ign) return;
    const key = ign.toLowerCase();
    if (mainKey && key === mainKey) return; // 分身跟本尊同名，視為同一隻
    byIgn.set(key, {                        // Map.set 同鍵覆蓋 = 後者勝出
      ign,
      job: sub.job || '主教',
      level: clampLevel(sub.level, '120')   // 最後一道防線：分身寫入一律夾 1~200
    });
  });
  return Array.from(byIgn.values());
}

// 把名冊攤平成 [{ign, job, level, isMain, idx}]
function listCharacters(profile) {
  const out = [];
  if (profile.mainIgn) {
    out.push({ ign: profile.mainIgn, job: profile.mainJob || '冒險家', level: profile.mainLevel || '1', isMain: true, idx: -1 });
  }
  (profile.subs || []).forEach((sub, i) => {
    if (sub?.ign) out.push({ ign: sub.ign, job: sub.job || '冒險家', level: sub.level || '1', isMain: false, idx: i });
  });
  return out;
}

// 建立「一次改完」的表單，舊等級直接預填好
function buildBatchLevelModal(targetUid, profile) {
  const chars = listCharacters(profile);
  // Discord 單一欄位上限 4000 字，正常名冊遠遠用不到，仍做保險截斷
  let body = chars.map(c => `${c.ign}=${c.level}`).join('\n');
  if (body.length > 3900) body = body.slice(0, 3900);

  const modal = new ModalBuilder()
    .setCustomId(`modal_batch_level_${targetUid}`)
    .setTitle('一次更新所有角色等級');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('batch_levels')
        .setLabel('每行一隻，只改等級數字')
        .setValue(body)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
    )
  );
  return modal;
}

// 解析「角色名=等級」，容忍 = ＝ : ： 與空白分隔
function parseBatchLevels(raw) {
  const rows = [], bad = [];
  (raw || '').split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (!t) return;
    let m = t.match(/^(.*)[=＝:：]\s*(\d{1,3})$/);      // 角色名可能含符號，抓最後一個分隔號
    if (!m) m = t.match(/^(.+?)\s+(\d{1,3})$/);         // 也接受用空白分隔
    if (!m) { bad.push(t); return; }
    const ign = m[1].trim();
    const lv = Math.min(200, Math.max(1, parseInt(m[2])));
    if (!ign) { bad.push(t); return; }
    rows.push({ ign, level: String(lv) });
  });
  return { rows, bad };
}

// ===================== 突襲王進度 =====================
const RAID_FREE_CAP = 7;      // 每週免費進入次數
const RAID_SCROLL_CAP = 14;   // 吃了突襲卷：7（免費）+ 7（突襲）
const RAID_RESET_HOUR = 8;    // 每週二 08:00（台北）維護後重置

// 一週的界線 =（台北時間）週二 RAID_RESET_HOUR:00
function raidWeekRange(nowMs = Date.now()) {
  const tpe = new Date(nowMs + TPE_OFFSET_MS);
  const todayReset = tpeWallClockToMs(
    tpe.getUTCFullYear(), tpe.getUTCMonth() + 1, tpe.getUTCDate(), RAID_RESET_HOUR, 0
  );
  let back = (tpe.getUTCDay() - 2 + 7) % 7;        // 週二=0、週三=1 …… 週一=6
  if (back === 0 && nowMs < todayReset) back = 7;  // 還是週二但沒到 08:00 → 仍算上一週
  const startMs = todayReset - back * 86400000;    // 台灣無日光節約，直接減整天
  return { startMs, endMs: startMs + 7 * 86400000 };
}

function raidWeekKey(nowMs = Date.now()) {
  const d = new Date(raidWeekRange(nowMs).startMs + TPE_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function raidMd(ms) {
  const d = new Date(ms + TPE_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// 名冊 + 本週紀錄合成狀態。跨週的舊紀錄自動視為 0，所以不需要排程歸零，也永遠不會漏跑。
function getRaidState(profile, nowMs = Date.now()) {
  const stored = profile.raid || {};
  const chars = stored.weekKey === raidWeekKey(nowMs) ? (stored.chars || {}) : {};
  const seen = new Set();
  const out = [];
  listCharacters(profile).forEach(c => {
    // 舊資料可能有「分身與本尊同名」的殘留，同名只算一隻：
    // 不然次數會被重複計算，選單也會出現重複的 value 讓 Discord 退掉整個訊息。
    const key = (c.ign || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const rec = chars[c.ign] || {};
    const cap = (parseInt(rec.cap) || 0) > RAID_FREE_CAP ? RAID_SCROLL_CAP : RAID_FREE_CAP;
    const used = Math.min(Math.max(parseInt(rec.used) || 0, 0), cap);
    out.push({ ign: c.ign, job: c.job, level: c.level, isMain: c.isMain, used, cap });
  });
  return out;
}

// 三種狀態：❗還沒打 / 🔸打一半 / ✅打滿。rank 用來把沒打的排到最前面。
// 吃卷（上限 14）不另外標示，直接看分母。
function raidRowInfo(c) {
  if (c.used >= c.cap) return { icon: '✅', rank: 2 };
  if (c.used === 0) return { icon: '❗', rank: 0 };
  return { icon: '🔸', rank: 1 };
}

function raidSummary(rows) {
  return {
    used: rows.reduce((a, c) => a + c.used, 0),
    cap: rows.reduce((a, c) => a + c.cap, 0),
    untouched: rows.filter(c => c.used === 0).length,
    done: rows.filter(c => c.used >= c.cap).length,
    total: rows.length
  };
}

function raidCharsMap(rows) {
  const out = {};
  rows.forEach(c => { out[c.ign] = { used: c.used, cap: c.cap }; });
  return out;
}

// 用 update 整塊覆蓋 raid 欄位，改過名字的舊角色不會殘留
async function saveRaidState(targetUid, rows, nowMs = Date.now()) {
  if (!db) return;
  const raid = { weekKey: raidWeekKey(nowMs), chars: raidCharsMap(rows), updatedAt: Date.now() };
  const ref = db.collection('member_profiles').doc(targetUid);
  try { await ref.update({ raid }); }
  catch { await ref.set({ userId: targetUid, raid }, { merge: true }); }
  invalidateProfile(targetUid);
}

function buildRaidPayload(profile, displayName, opts = {}) {
  const nowMs = opts.nowMs || Date.now();
  const rows = getRaidState(profile, nowMs);
  const { startMs, endMs } = raidWeekRange(nowMs);

  if (!rows.length) {
    return {
      embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('⚔️ 突襲王進度')
        .setDescription('名冊裡還沒有角色，先用 \`/名冊\` 完成報到吧！')],
      components: []
    };
  }

  // 還沒打的排最前面，角色多的人一眼就看到該補哪隻
  const sorted = rows.map(c => ({ c, i: raidRowInfo(c) })).sort((a, b) => a.i.rank - b.i.rank);
  const lines = sorted.map(({ c, i }) =>
    `${i.icon} **${c.ign}**　${c.job} Lv.${c.level}　\`${c.used} / ${c.cap}\``
  );

  const s = raidSummary(rows);
  let desc = lines.join('\n');
  if (desc.length > 3400) desc = desc.slice(0, 3400) + '\n…（角色太多，先列到這裡）';
  desc += `\n${PANEL_DIV}\n`
    + `\`\`\`ansi\n${ansiBar(s.used, s.cap)}\n\`\`\`\n`
    + `總計 **${s.used} / ${s.cap} 次**　‧　`
    + (s.untouched ? `還有 **${s.untouched}** 隻沒打` : '每隻都開工了 👍')
    + `\n⏳ <t:${Math.floor(endMs / 1000)}:R>重置（週二 ${String(RAID_RESET_HOUR).padStart(2, '0')}:00）`;

  const embed = new EmbedBuilder()
    .setColor(s.untouched ? 0xE67E22 : (s.done === s.total ? 0x57F287 : 0x5865F2))
    .setTitle(`⚔️ 突襲王進度${displayName ? ` - ${displayName}` : ''}`)
    .setDescription(desc)
    .setFooter({ text: `本週 ${raidMd(startMs)} ~ ${raidMd(endMs)}` });

  const components = [];
  if (!opts.readonly) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('raid_btn_update').setLabel('📝 批次更新').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('raid_btn_reset').setLabel('🔄 重設本週').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('refresh_raid').setLabel('🔄 即時更新').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('share_raid').setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
    );
    if (opts.isAdmin) {
      row.addComponents(
        new ButtonBuilder().setCustomId('raid_btn_admin_all').setLabel('👥 全體進度').setStyle(ButtonStyle.Danger)
      );
    }
    components.push(row);

    // 快速登記：只列還沒打滿的角色（選單上限 25 個選項）
    const pending = sorted.filter(({ c }) => c.used < c.cap).slice(0, 25);
    if (pending.length) {
      const options = pending.map(({ c }) => {
        const to = Math.min(c.used + RAID_FREE_CAP, c.cap);
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${c.ign}（${c.used} ➔ ${to} / ${c.cap}）`.slice(0, 100))
          .setDescription(`${c.job} Lv.${c.level}`.slice(0, 100))
          .setValue(c.ign.slice(0, 100));
      });
      components.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('raid_sel_plus7')
          .setPlaceholder(`➕ 打完 ${RAID_FREE_CAP} 場 → 選角色記上`)
          .addOptions(options)
      ));
    }
  }
  return { embeds: [embed], components };
}

// 批次表單：已用次數與上限都預填好，把 7 改成 14 就等於註記吃了突襲卷
function buildRaidModal(targetUid, profile, nowMs = Date.now()) {
  const rows = getRaidState(profile, nowMs);
  let body = rows.map(c => `${c.ign}=${c.used}/${c.cap}`).join('\n');
  if (body.length > 3900) body = body.slice(0, 3900);

  const modal = new ModalBuilder()
    .setCustomId(`modal_raid_batch_${targetUid}`)
    .setTitle('更新本週突襲進入次數');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('raid_rows')
        .setLabel('每行一隻：角色=已用/上限')
        .setPlaceholder('例：沁霜=3/7　‧　吃了突襲卷就把 7 改成 14')
        .setValue(body)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
    )
  );
  return modal;
}

// 容忍「角色=3/7」「角色=3」「角色 3/7」「角色 3」，分隔號 = ＝ : ： / ／ 都接受
function parseRaidBatch(raw) {
  const rows = [], bad = [];
  (raw || '').split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (!t) return;
    let m = t.match(/^(.*)[=＝:：]\s*(\d{1,3})\s*[\/／]\s*(\d{1,3})$/);
    if (!m) m = t.match(/^(.+?)\s+(\d{1,3})\s*[\/／]\s*(\d{1,3})$/);
    if (m) { rows.push({ ign: m[1].trim(), used: parseInt(m[2]), cap: parseInt(m[3]) }); return; }
    m = t.match(/^(.*)[=＝:：]\s*(\d{1,3})$/);
    if (!m) m = t.match(/^(.+?)\s+(\d{1,3})$/);
    if (m) { rows.push({ ign: m[1].trim(), used: parseInt(m[2]), cap: null }); return; }
    bad.push(t);
  });
  return { rows: rows.filter(r => r.ign), bad };
}

// 管理員：全體進度總覽（退休者不列入，他們本來就沒在玩）
async function buildRaidAdminOverview(nowMs = Date.now()) {
  if (!db) {
    return { embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('👥【全體突襲王進度】').setDescription('❌ 資料庫未連線。')], components: [] };
  }
  const snap = await db.collection('member_profiles').get();
  const list = [];
  let retiredCount = 0;

  snap.forEach(doc => {
    const d = doc.data();
    if (!d.mainIgn && !(d.subs || []).length) return;
    if (d.isRetired) { retiredCount++; return; }
    const rows = getRaidState(d, nowMs);
    if (!rows.length) return;
    list.push({ uid: doc.id, ...raidSummary(rows) });
  });

  // 沒打的角色數多的排前面，同數再比完成率
  list.sort((a, b) => (b.untouched - a.untouched) || (a.used / a.cap - b.used / b.cap));

  const lines = list.map(m => {
    const icon = m.untouched ? '❗' : (m.done === m.total ? '✅' : '🔸');
    const tail = m.untouched ? `**${m.untouched}** 隻還沒打` : `${m.done}/${m.total} 隻打滿`;
    return `${icon} <@${m.uid}>　\`${m.used} / ${m.cap} 次\`　${tail}`;
  });

  let cut = 0;
  while (lines.join('\n').length > 3400 && lines.length) { lines.pop(); cut++; }
  let desc = lines.join('\n') || '目前沒有任何現役成員的名冊資料。';
  if (cut) desc += `\n…其餘 ${cut} 位未列出`;

  const t = list.reduce((a, m) => ({
    used: a.used + m.used, cap: a.cap + m.cap, untouched: a.untouched + m.untouched
  }), { used: 0, cap: 0, untouched: 0 });

  const { startMs, endMs } = raidWeekRange(nowMs);
  desc += '\n━━━━━━━━━━━━━━━━━━━━\n'
    + `現役成員 **${list.length}** 位　‧　全體 **${t.used} / ${t.cap} 次**　‧　還沒開工的角色 **${t.untouched}** 隻`
    + `\n⏳ 距離重置：<t:${Math.floor(endMs / 1000)}:R>`;

  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('👥【全體突襲王進度】')
    .setDescription(desc)
    .setFooter({ text: `本週 ${raidMd(startMs)} ~ ${raidMd(endMs)}　‧　已退休 ${retiredCount} 位不列入` });

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('refresh_raid_all').setLabel('🔄 即時更新').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('share_raid_all').setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
  );
  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId('admin_raid_pick_user')
      .setPlaceholder('🔍 看某一位成員的每隻角色明細').setMinValues(1).setMaxValues(1)
  );
  return { embeds: [embed], components: [btnRow, row] };
}

// ===================== 熱門地圖排隊（輪流接圖排班表） =====================
const ROT_SPAN_HOURS = 48;          // 預設涵蓋 48 小時，開表時可自訂
const ROT_MIN_SPAN_H = 1, ROT_MAX_SPAN_H = 48;    // 1 ~ 48 小時
const ROT_SPLIT_EVEN = 'even', ROT_SPLIT_TIME = 'time';
const ROT_MAX_PER_SLOT = 5;         // 團練時同一格最多幾個人
const ROT_SLOT_MIN = 30;            // 一格固定 30 分鐘（不開放自訂）
const ROT_DESC_BUDGET = 3200;       // 留給表格的字數，其餘讓給標題、狀態列與圖例
const ROT_MAX_DAYS = 3;             // 48 小時最多橫跨 3 個日曆天
const ROT_PICK_LIMIT = 25;          // Discord 下拉選單硬上限
const ROT_PRE_NOTIFY_MS = 30 * 60000;   // 輪到自己前 30 分鐘提醒一次
const ROT_COLORS = [31, 32, 33, 34, 35, 36];   // ANSI 前景色：紅 綠 黃 藍 洋紅 青
const ROT_WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
// 舊資料可能有別的時段長度，所以畫表的程式仍然一律讀 rot.slotMinutes，
// 不要寫死成 60，否則以前開的表會整個錯位。

// 把起點對齊到「台北午夜起算的整格」，這樣 20:00、21:00 這種漂亮的邊界才會出現
function rotAlignStart(nowMs, slotMinutes) {
  const t = tpeToday(nowMs);
  const midnight = tpeWallClockToMs(t.year, t.month, t.day, 0, 0);
  const slotMs = slotMinutes * 60000;
  return midnight + Math.floor((nowMs - midnight) / slotMs) * slotMs;
}

// 接受 "20:00"、"10/28 20:00"、"2026-10-28 20:00" 三種寫法，一律當台北時間。
// 只給時間而該時刻已過 → 視為明天的同一時刻（半夜開表說「08:00」指的是早上）。
function rotParseWhen(input, nowMs = Date.now(), assumeFuture = true) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const t = tpeToday(nowMs);

  let y = t.year, mo = t.month, d = t.day, hh = null, mi = 0;
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[\s　]+(\d{1,2}):(\d{2})$/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; hh = +m[4]; mi = +m[5]; }
  if (hh === null) {
    m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[\s　]+(\d{1,2}):(\d{2})$/);
    if (m) { mo = +m[1]; d = +m[2]; hh = +m[3]; mi = +m[4]; }
  }
  if (hh === null) {
    m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (m) { hh = +m[1]; mi = +m[2]; }
  }
  if (hh === null || hh > 23 || mi > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  let ms = tpeWallClockToMs(y, mo, d, hh, mi);
  // 只填了時間、而且那個時刻今天已經過了 → 算明天
  if (assumeFuture && /^\d{1,2}:\d{2}$/.test(raw) && ms <= nowMs) ms += 86400000;
  return ms;
}

// 跳表單前不能 defer（Discord 規定），但表單要預填現有內容就得先讀資料庫。
// 所以排班表也做一層快取：讀過就記著，寫入時更新，跳表單時直接拿。
const ROT_CACHE = new Map();
function cacheRot(id, data) { if (id && data) ROT_CACHE.set(id, { data, at: Date.now() }); }
async function fetchRotFast(id) {
  const hit = ROT_CACHE.get(id);
  if (hit && Date.now() - hit.at < 120000) return hit.data;
  if (!db) return null;
  try {
    const doc = await withTimeout(db.collection('map_rotations').doc(id).get(), 2200);
    if (!doc?.exists) return null;
    cacheRot(id, doc.data());
    return doc.data();
  } catch (e) {
    console.error('讀取排班表失敗:', e.message);
    return hit?.data || null;
  }
}

// 一律透過這個取時段長度：萬一舊資料缺了這個欄位，整張表會變成空白卻不報錯
function rotSlotLen(rot) { return (parseInt(rot?.slotMinutes) || ROT_SLOT_MIN); }
// 提前開表時頻道常常還沒決定，所以 0 要顯示成「頻道未定」而不是「第 0 頻道」
function rotChanLabel(rot) {
  return rot?.channelNum > 0 ? `第 ${rot.channelNum} 頻道` : '頻道未定';
}
function rotSlotMs(rot, idx) { return rot.startMs + idx * rotSlotLen(rot) * 60000; }
// 起始時間不一定落在整點（例如 08:45 開始），行事曆的橫列要跟著位移，
// 否則格子算出來的索引會是小數，整張表就空了。
function rotDayOffsetMs(rot) {
  const slotMs = rotSlotLen(rot) * 60000;
  return ((rot.startMs - tpeMidnight(rot.startMs)) % slotMs + slotMs) % slotMs;
}
function rotCurrentIndex(rot, nowMs = Date.now()) {
  return Math.floor((nowMs - rot.startMs) / (rotSlotLen(rot) * 60000));
}
// 一格可以站多個人（團練）。舊資料存成 { userId, ign }，新資料存成 { users: [...] }，
// 全部讀取一律走這裡攤平成陣列，呼叫端不用管是哪種格式。
function rotSlotUsers(rot, idx) {
  const raw = (rot.slots || {})[String(idx)];
  if (!raw) return [];
  if (Array.isArray(raw.users)) return raw.users.filter(u => u?.userId);
  return raw.userId ? [{ userId: raw.userId, ign: raw.ign }] : [];
}
function rotSlotOf(rot, idx) { return rotSlotUsers(rot, idx)[0] || null; }
function rotHasUser(rot, idx, uid) { return rotSlotUsers(rot, idx).some(u => u.userId === uid); }
function rotSetSlot(slots, idx, users) {
  const next = { ...(slots || {}) };
  if (!users.length) delete next[String(idx)];
  else next[String(idx)] = { users };
  return next;
}
function rotTimeLabel(ms) {
  const d = new Date(ms + TPE_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function rotDayLabel(ms) {
  const d = new Date(ms + TPE_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${ROT_WEEKDAY[d.getUTCDay()]})`;
}
function rotSlotLabel(rot, idx) {
  const a = rotSlotMs(rot, idx), b = a + rotSlotLen(rot) * 60000;
  return `${rotTimeLabel(a)} ~ ${rotTimeLabel(b)}`;
}

// 這張表裡出現過的人依「第一次出現的順序」配色，有人取消也不會整排跳色
// 配色在「第一次認領」時就鎖定並存進文件。
// 若改成每次依現有順序重算，有人取消整排顏色就會跟著跳掉，看起來像換了一批人。
function rotAssignColor(rot, userId) {
  const colors = { ...(rot.colors || {}) };
  if (colors[userId]) return colors;
  const used = new Set(Object.values(colors).map(Number));
  colors[userId] = ROT_COLORS.find(c => !used.has(c)) || ROT_COLORS[Object.keys(colors).length % ROT_COLORS.length];
  return colors;
}
function rotColorMap(rot) {
  return new Map(Object.entries(rot.colors || {}).map(([k, v]) => [k, Number(v)]));
}

function rotEmptyIndexes(rot, nowMs = Date.now()) {
  const from = Math.max(0, rotCurrentIndex(rot, nowMs));
  const out = [];
  for (let i = from; i < rot.slotCount; i++) if (!rotSlotUsers(rot, i).length) out.push(i);
  return out;
}

// 可以登記的格子：空的都能排；開了團練的話，未滿的格子也能併進去
function rotPickableIndexes(rot, userId, nowMs = Date.now()) {
  const from = Math.max(0, rotCurrentIndex(rot, nowMs));
  const out = [];
  for (let i = from; i < rot.slotCount; i++) {
    const users = rotSlotUsers(rot, i);
    if (users.some(u => u.userId === userId)) continue;      // 自己已經在裡面
    if (!users.length) { out.push({ idx: i, n: 0 }); continue; }
    if (rot.allowShare && users.length < ROT_MAX_PER_SLOT) out.push({ idx: i, n: users.length });
  }
  return out;
}
// 等寬字體裡中文字佔兩格。不照這個算，整張行事曆的欄位會歪掉。
function dispWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    // 中日韓文字、全形符號與 emoji 在等寬字體都佔兩格
    const cp = ch.codePointAt(0);
    const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦　-〿]/.test(ch)
      || (cp >= 0x2600 && cp <= 0x27BF)
      || (cp >= 0x1F000 && cp <= 0x1FAFF);
    w += wide ? 2 : 1;
  }
  return w;
}
function padCell(str, width) {
  return String(str) + ' '.repeat(Math.max(0, width - dispWidth(str)));
}
// 格子裡放得下的識別字：中文取一個字，英數取兩個字，寬度都是 2
function rotTag(ign) {
  const chars = [...String(ign || '?')];
  if (!chars.length) return '??';
  return dispWidth(chars[0]) === 2 ? chars[0] : padCell(chars.slice(0, 2).join(''), 2);
}
function tpeMidnight(ms) {
  const t = tpeToday(ms);
  return tpeWallClockToMs(t.year, t.month, t.day, 0, 0);
}

// 把排班表畫成行事曆：直欄是日期、橫列是時段，格子用顏色區分是誰。
// 預設把每一列都畫出來；只有在內容會撐破 embed 的 4096 字上限時才退讓。
function rotRenderGrid(rot, nowMs = Date.now()) {
  const slotMs = rotSlotLen(rot) * 60000;
  const rowsPerDay = Math.round(1440 / rotSlotLen(rot));
  const endMs = rot.startMs + rot.slotCount * slotMs;
  const colors = rotColorMap(rot);
  const curIdx = rotCurrentIndex(rot, nowMs);

  const days = [];
  for (let d = tpeMidnight(rot.startMs); d < endMs; d += 86400000) days.push(d);
  const hiddenDays = Math.max(0, days.length - ROT_MAX_DAYS);
  if (hiddenDays) days.length = ROT_MAX_DAYS;

  const TIME_W = 7, CELL_W = 6;
  let head = padCell('', TIME_W), head2 = padCell('', TIME_W);
  days.forEach(d => {
    const [date, wk] = rotDayLabel(d).split(' ');
    head += padCell(date, CELL_W);
    head2 += padCell(wk || '', CELL_W);
  });

  const offset = rotDayOffsetMs(rot);
  const rows = [];
  for (let r = 0; r < rowsPerDay; r++) {
    const cells = days.map(d => {
      const idx = Math.round((d + offset + r * slotMs - rot.startMs) / slotMs);
      if (idx < 0 || idx >= rot.slotCount) return { kind: 'out' };
      const users = rotSlotUsers(rot, idx);
      if (!users.length) return { kind: 'free', idx, now: idx === curIdx };
      const payers = users.filter(u => !u.support);
      return {
        kind: 'busy', idx, s: payers[0] || users[0], n: users.length,
        allSupport: payers.length === 0,
        past: idx < curIdx, now: idx === curIdx
      };
    });
    rows.push({ r, time: rotTimeLabel(tpeMidnight(rot.startMs) + offset + r * slotMs), cells });
  }

  // 同一列若連續幾格顏色相同，色碼只送一次 —— ANSI escape 也算進 4096 字裡，
  // 一格一組色碼的話 15 分鐘切法直接爆掉。
  const renderRow = (row) => {
    let line = (row.cells.some(c => c.now) ? '\u001b[1;37m▶\u001b[0m' : ' ') + padCell(row.time, TIME_W - 1);
    let cur = null;
    row.cells.forEach(c => {
      let col, text;
      if (c.kind === 'out') { col = 30; text = padCell('·', CELL_W); }
      else if (c.kind === 'free') { col = 30; text = padCell('░░', CELL_W); }
      else {
        col = c.past ? 30 : (colors.get(c.s.userId) || 37);
        // 團練的格子標 +N；整格都是外援就標 🆘，一眼看出這段不用收錢
        text = padCell(
          c.allSupport ? '██🆘' : (c.n > 1 ? `██+${c.n}` : '██' + rotTag(c.s.ign)),
          CELL_W
        );
      }
      if (col !== cur) { line += `\u001b[${col}m`; cur = col; }
      line += text;
    });
    return line + '\u001b[0m\n';
  };

  const emptyRow = (row) => row.cells.every(c => c.kind !== 'busy' && !c.now);

  const render = (collapse, maxRows) => {
    let t = '```ansi\n' + `\u001b[1;30m${head}\u001b[0m\n`;
    if (head2.trim()) t += `\u001b[30m${head2}\u001b[0m\n`;
    let i = 0, lines = 0, skipped = 0;
    while (i < rows.length) {
      if (lines >= maxRows) { skipped += rows.length - i; break; }
      if (collapse && emptyRow(rows[i])) {
        let j = i;
        while (j < rows.length && emptyRow(rows[j])) j++;
        if (j - i >= 2) {
          t += `\u001b[30m${padCell('  ⋯', TIME_W)}（${j - i} 列全空）\u001b[0m\n`;
          i = j; lines++; continue;
        }
      }
      t += renderRow(rows[i]); i++; lines++;
    }
    t += '```';
    if (skipped) t += `\n*…還有 ${skipped} 列放不下，用下拉選單一樣排得到*`;
    if (hiddenDays) t += `\n*…後面還有 ${hiddenDays} 天沒畫出來*`;
    return t;
  };

  // 圖例：顏色只有六種，光看色塊認不出人，一定要有對照表
  const seen = [];
  for (let i = 0; i < rot.slotCount; i++) {
    rotSlotUsers(rot, i).forEach(u => {
      if (!seen.some(x => x.userId === u.userId)) seen.push(u);
    });
  }
  const legend = seen.length
    ? '\n```ansi\n' + seen.map(s =>
        `\u001b[${colors.get(s.userId) || 37}m██ ${rotTag(s.ign)}\u001b[0m = ${s.ign}${s.support ? ' 🆘外援' : ''}`).join('\n') + '\n```'
    : '';

  // 先試「全部畫出來」，裝不下才依序退讓。ROT_DESC_BUDGET 留給標題、狀態列與圖例。
  const budget = ROT_DESC_BUDGET - legend.length;
  let table = render(false, 999);
  if (table.length > budget) table = render(true, 999);
  if (table.length > budget) table = render(true, 60);
  if (table.length > budget) table = render(true, 30);

  return { table, legend };
}

// 把一筆金額依「均攤」或「按時間攤」分給參與者，並處理整數進位的零頭。
// 零頭全丟給最後一個人，這樣每個人的數字相加一定等於總額，對帳不會差一塊錢。
function rotSplitAmount(total, rows, mode) {
  const n = rows.length;
  if (!n) return [];
  const totalSlots = rows.reduce((a, r) => a + r.slots, 0) || 1;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const out = rows.map(r => {
    const raw = mode === ROT_SPLIT_TIME ? abs * (r.slots / totalSlots) : abs / n;
    return { ...r, amount: Math.floor(raw) };
  });
  const used = out.reduce((a, r) => a + r.amount, 0);
  out[out.length - 1].amount += (abs - used);        // 零頭
  return out.map(r => ({ ...r, amount: r.amount * sign }));
}

// 誰算「有打的人」：只算已經開始的時段。提前收工時，還沒輪到的人不用付錢。
function rotParticipants(rot, nowMs = Date.now()) {
  const byUser = new Map();
  for (let i = 0; i < rot.slotCount; i++) {
    if (rotSlotMs(rot, i) > nowMs) break;            // 格子照時間遞增
    const all = rotSlotUsers(rot, i);
    if (!all.length) continue;
    // 外援只是來幫忙顧圖，不分攤費用 —— 這一格的錢由付費的人平分
    const users = all.filter(u => !u.support);
    if (!users.length) continue;                     // 整格都是外援 → 這格不計費
    const share = 1 / users.length;
    users.forEach(u => {
      const hit = byUser.get(u.userId) || { userId: u.userId, ign: u.ign, slots: 0, raw: 0, shared: 0 };
      hit.slots += share;                            // 算錢用的權重
      hit.raw += 1;                                  // 實際站了幾格（顯示用）
      if (users.length > 1) hit.shared += 1;         // 其中幾格是團練
      hit.ign = u.ign;
      byUser.set(u.userId, hit);
    });
  }
  return [...byUser.values()].sort((a, b) => b.slots - a.slots || a.ign.localeCompare(b.ign));
}

function rotSplitLabel(mode) { return mode === ROT_SPLIT_TIME ? '按時間攤' : '均攤'; }

// 外援：有來顧圖但不分攤費用的人
function rotSupporters(rot, nowMs = Date.now()) {
  const byUser = new Map();
  for (let i = 0; i < rot.slotCount; i++) {
    if (rotSlotMs(rot, i) > nowMs) break;
    rotSlotUsers(rot, i).forEach(u => {
      if (!u.support) return;
      const hit = byUser.get(u.userId) || { userId: u.userId, ign: u.ign, slots: 0 };
      hit.slots++; hit.ign = u.ign;
      byUser.set(u.userId, hit);
    });
  }
  return [...byUser.values()].sort((a, b) => b.slots - a.slots);
}

// 產生接圖結算報告。shareProfit 只有在「賣價 > 買價」時才有意義。
function buildRotationSettlement(rot, nowMs = Date.now(), shareProfit = true) {
  const parts = rotParticipants(rot, nowMs);
  const net = (rot.buyPrice || 0) - (rot.sellPrice || 0);
  const profit = net < 0;
  const header = `💰【接圖結算】${rot.mapName}　‧　${rotChanLabel(rot)}`;
  const endAll = rotSlotMs(rot, rot.slotCount);
  const early = nowMs < endAll;
  const earlyNote = early
    ? `⏱️ **提前結算**（原訂 <t:${Math.floor(endAll / 1000)}:f> 結束，還沒輪到的人不計費）\n`
    : '';

  if (!parts.length) {
    return {
      embed: new EmbedBuilder().setColor(0x95A5A6).setTitle(header)
        .setDescription(`${earlyNote}這張表沒有任何人排到已開始的時段，沒有費用要分攤。`),
      mentions: []
    };
  }

  const priceLine = rot.sellPrice > 0
    ? `買圖 ${formatMeso(rot.buyPrice)} − 賣出 ${formatMeso(rot.sellPrice)} = `
      + (profit ? `**轉手賺 ${formatMeso(-net)}**` : `**淨成本 ${formatMeso(net)}**`)
    : `買圖 **${formatMeso(rot.buyPrice)}**（沒有賣出）`;

  if (profit && !shareProfit) {
    return {
      embed: new EmbedBuilder().setColor(0x57F287).setTitle(header)
        .setDescription(
          `${priceLine}\n${earlyNote}${PANEL_DIV}\n`
          + `這趟是賺的，<@${rot.creatorId}> 決定不分攤 —— **大家都不用付錢**。\n`
          + `參與者：${parts.map(p => `<@${p.userId}>`).join('、')}`
        ),
      mentions: []
    };
  }

  const rowsWithAmt = rotSplitAmount(net, parts, rot.splitMode);
  const totalSlots = parts.reduce((a, p) => a + p.slots, 0) || 1;
  // 下限 6 是「參與者」三個字的寬度，不留這個下限表頭會跟時段欄黏在一起
  const nameW = Math.min(14, Math.max(6, ...rowsWithAmt.map(r => dispWidth(r.ign))));
  const fmtSlots = (x) => (Math.round(x * 100) / 100).toString();
  const byTime = rot.splitMode === ROT_SPLIT_TIME;

  let body = '\u001b[1;36m ' + padCell('參與者', nameW + 2) + padCell('時段', 13)
    + (profit ? '應領' : '應付') + '\u001b[0m\n';
  rowsWithAmt.forEach(r => {
    const pct = (r.slots / totalSlots * 100).toFixed(1);
    body += ` ${padCell(r.ign, nameW + 2)}${padCell(`${fmtSlots(r.slots)} 格 ${pct}%`, 13)}`
      + `\u001b[${profit ? 32 : 33}m${formatMeso(Math.abs(r.amount))}\u001b[0m`
      + (r.userId === rot.creatorId ? ' \u001b[30m(墊付人)\u001b[0m' : '') + '\n';
  });

  // ── 明細：把每一步算式攤開，才不會有人覺得數字是憑空生出來的 ──
  const abs = Math.abs(net);
  const steps = [];
  steps.push(rot.sellPrice > 0
    ? `${profit ? '轉手利潤' : '淨成本'} ＝ 買 ${formatMeso(rot.buyPrice)} − 賣 ${formatMeso(rot.sellPrice)} ＝ **${formatMeso(abs)}**`
    : `淨成本 ＝ 買圖 **${formatMeso(rot.buyPrice)}**（沒有賣出）`);
  const sharedCount = parts.reduce((a, p) => a + (p.shared || 0), 0);
  steps.push(byTime
    ? `計費時段合計 ＝ **${fmtSlots(totalSlots)} 格**`
      + (sharedCount ? `（團練格一格算 1÷人數，全場有 ${sharedCount} 人次是團練）` : '')
    : `分攤人數 ＝ **${parts.length} 人**`);

  const detail = rowsWithAmt.map(r => {
    const mine = byTime
      ? `${fmtSlots(r.slots)} 格 ÷ ${fmtSlots(totalSlots)} 格 × ${formatMeso(abs)}`
      : `${formatMeso(abs)} ÷ ${parts.length} 人`;
    const sharedTag = r.shared ? `（站 ${r.raw} 格，其中 ${r.shared} 格團練）` : '';
    return `‧ ${r.ign}：${mine} ＝ **${formatMeso(Math.abs(r.amount))}**${sharedTag}`;
  });

  const exact = rowsWithAmt.reduce((a, r) => a + Math.abs(r.amount), 0);
  if (exact !== abs) detail.push(`‧ 進位零頭 ${Math.abs(abs - exact)} 已併入最後一位`);

  const ownerRow = rowsWithAmt.find(r => r.userId === rot.creatorId);
  const collect = abs - (ownerRow ? Math.abs(ownerRow.amount) : 0);
  const table = '```ansi\n' + body + '```';
  const action = profit
    ? `<@${rot.creatorId}> 請把上面的金額**發給**每一位（自己那份留著），共需發出 **${formatMeso(collect)}**。`
    : `請把上面的金額**匯給** <@${rot.creatorId}>。他自己那份不用匯，實際可收回 **${formatMeso(collect)}**。`;

  const sup = rotSupporters(rot, nowMs);
  const supLine = sup.length
    ? `\n🆘 **外援（不分攤）**：${sup.map(x => `<@${x.userId}>（${x.slots} 格）`).join('、')} —— 謝謝幫忙顧圖！`
    : '';

  let desc = `${priceLine}\n分攤方式：**${rotSplitLabel(rot.splitMode)}**　‧　`
    + `${byTime ? `共 ${fmtSlots(totalSlots)} 格` : ''}${byTime ? ' ‧ ' : ''}${parts.length} 人\n`
    + `${earlyNote}${PANEL_DIV}\n${table}\n`
    + `📐 **怎麼算出來的**\n${steps.map(x => `‧ ${x}`).join('\n')}\n${detail.join('\n')}${supLine}\n\n${action}`;
  if (desc.length > 4000) desc = desc.slice(0, 3990) + '\n…（明細太長已截斷）';

  const embed = new EmbedBuilder()
    .setColor(profit ? 0x57F287 : 0xF1C40F)
    .setTitle(header)
    .setDescription(desc)
    .setFooter({ text: `結算於 ${rotDayLabel(nowMs)} ${tpeClock(nowMs)}　‧　只計入已開始的時段` });

  return { embed, mentions: parts.filter(p => p.userId !== rot.creatorId).map(p => p.userId) };
}

function buildRotationEmbed(rot, nowMs = Date.now()) {
  const curIdx = rotCurrentIndex(rot, nowMs);
  const colors = rotColorMap(rot);
  const { table, legend } = rotRenderGrid(rot, nowMs);

  const curUsers = curIdx >= 0 && curIdx < rot.slotCount ? rotSlotUsers(rot, curIdx) : [];
  const cur = curUsers[0] || null;
  let nextIdx = -1;
  for (let i = Math.max(0, curIdx) + 1; i < rot.slotCount; i++) { if (rotSlotUsers(rot, i).length) { nextIdx = i; break; } }
  const nxtUsers = nextIdx >= 0 ? rotSlotUsers(rot, nextIdx) : [];
  const nxt = nxtUsers[0] || null;

  const emptyCount = rotEmptyIndexes(rot, nowMs).length;
  const taken = rot.slotCount - Math.max(0, curIdx) - emptyCount;

  let status;
  if (rot.isClosed) status = '🔴 **已結束排班**';
  else if (curIdx >= rot.slotCount) status = '🔴 **排班時間已過**';
  else if (cur) status = `🟢 現在：${curUsers.map(u => `<@${u.userId}>（\`${u.ign}\`）`).join('、')}`
    + (curUsers.length > 1 ? '　🤝 團練中' : '');
  else status = '⚪ 現在這格**沒人接**，歡迎直接上';
  if (!rot.isClosed && nxt) {
    status += `\n⏭️ 下一棒：${nxtUsers.map(u => `<@${u.userId}>`).join('、')}　<t:${Math.floor(rotSlotMs(rot, nextIdx) / 1000)}:t> 交接`;
  }

  const endAll = rotSlotMs(rot, rot.slotCount);
  const range = `🕒 <t:${Math.floor(rot.startMs / 1000)}:f> ~ <t:${Math.floor(endAll / 1000)}:t>`
    + `　（共 ${Math.round((endAll - rot.startMs) / 3600000 * 10) / 10} 小時）\n`;

  const shareLine = rot.allowShare ? '🤝 **團練模式**：同一時段可以多人一起登記，該格費用由這些人均分\n' : '';
  const supportHint = rot.buyPrice > 0 ? '🆘 找外援幫忙顧圖的話，請他用「我來當外援」登記，不會跟他收錢\n' : '';
  const pending = [];
  if (!(rot.channelNum > 0)) pending.push('頻道');
  if (!(rot.buyPrice > 0)) pending.push('買圖價格');
  const todo = (pending.length && !rot.isClosed)
    ? `⚠️ 尚未填：**${pending.join('、')}**（頻道用 📺 改頻道，價格用 ✏️ 修改內容）\n`
    : '';

  const money = rot.buyPrice > 0
    ? `💰 買圖 ${formatMeso(rot.buyPrice)}　‧　${rotSplitLabel(rot.splitMode)}　‧　墊付：<@${rot.creatorId}>\n`
    : '';

  const embed = new EmbedBuilder()
    .setColor(rot.isClosed ? 0x95A5A6 : (cur ? 0x57F287 : 0xF1C40F))
    .setTitle(`🗓️【輪流接圖】${rot.mapName}　‧　${rotChanLabel(rot)}`)
    .setDescription(
      `📌 ${rot.note || '無特殊備註'}\n${range}${money}${shareLine}${supportHint}${todo}` +
      `${PANEL_DIV}\n${status}\n\n${table}${legend}`
    )
    .setFooter({ text: `一格 ${rotSlotLen(rot)} 分鐘　‧　已排 ${taken} 格　‧　還空 ${emptyCount} 格　‧　· 表示不在排班範圍` });

  if (rot.creatorTag) {
    embed.setAuthor({ name: `發起人：${rot.creatorTag}`, iconURL: rot.creatorAvatar || undefined });
  }
  return embed;
}

function buildRotationComponents(rotId, rot, nowMs = Date.now()) {
  if (rot.isClosed || rotCurrentIndex(rot, nowMs) >= rot.slotCount) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`share_rot_${rotId}`).setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary)
    );
    // 排班時間過了但還沒結帳 → 結算按鈕一定要留著，否則收費團永遠結不了帳
    if (rot.buyPrice > 0 && !rot.settled) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`rot_closepay_${rotId}`).setLabel('💰 結算').setStyle(ButtonStyle.Danger)
      );
    }
    return [row];
  }

  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rot_refresh_${rotId}`).setLabel('🔄 即時更新').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rot_chan_${rotId}`).setLabel('📺 改頻道').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rot_edit_${rotId}`).setLabel('✏️ 修改內容').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`share_rot_${rotId}`).setLabel('📤 分享面板').setStyle(ButtonStyle.Secondary),
    // 有收費的團按下去要先跳表單問賣價，而跳表單前不能 defer，
    // 所以用兩種 customId 讓處理器在「還沒讀資料庫」前就知道要走哪條路。
    rot.buyPrice > 0
      ? new ButtonBuilder().setCustomId(`rot_closepay_${rotId}`).setLabel('💰 結算（可提前）').setStyle(ButtonStyle.Danger)
      : new ButtonBuilder().setCustomId(`rot_close_${rotId}`).setLabel('🚪 結束排班').setStyle(ButtonStyle.Danger)
  )];

  const pickable = rotPickableIndexes(rot, null, nowMs).slice(0, ROT_PICK_LIMIT);
  if (pickable.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`rot_take_${rotId}`)
        .setPlaceholder(rot.allowShare ? '✋ 我要接這段 — 空的或併團都可以' : '✋ 我要接這段 — 選一個空的時段')
        .addOptions(pickable.map(p => new StringSelectMenuOptionBuilder()
          .setLabel((p.n ? `${rotSlotLabel(rot, p.idx)}　🤝 併團(${p.n}人)` : rotSlotLabel(rot, p.idx)).slice(0, 100))
          .setDescription((p.n
            ? `${rotDayLabel(rotSlotMs(rot, p.idx))}　已有：${rotSlotUsers(rot, p.idx).map(u => u.ign).join('、')}`
            : rotDayLabel(rotSlotMs(rot, p.idx))).slice(0, 100))
          .setValue(String(p.idx))))
    ));
  }

  if (pickable.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`rot_support_${rotId}`)
        .setPlaceholder('🆘 我來當外援 — 幫忙顧圖，不分攤費用')
        .addOptions(pickable.map(p => new StringSelectMenuOptionBuilder()
          .setLabel((p.n ? `${rotSlotLabel(rot, p.idx)}　🤝 併(${p.n}人)` : rotSlotLabel(rot, p.idx)).slice(0, 100))
          .setDescription(`${rotDayLabel(rotSlotMs(rot, p.idx))}　登記為外援，這段不跟你收錢`.slice(0, 100))
          .setValue(String(p.idx))))
    ));
  }

  // 取消自己的時段。認領選單只列空格子，沒有這個選單就沒有地方反悔。
  const mine = rotAllTakenIndexes(rot, nowMs).slice(0, ROT_PICK_LIMIT);
  if (mine.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`rot_drop_${rotId}`)
        .setPlaceholder('❌ 取消時段 — 只能取消自己排的')
        .addOptions(mine.map(i => new StringSelectMenuOptionBuilder()
          .setLabel(rotSlotLabel(rot, i).slice(0, 100))
          .setDescription(`${rotDayLabel(rotSlotMs(rot, i))}　${rotSlotUsers(rot, i).map(u => u.ign).join('、')}`.slice(0, 100))
          .setValue(String(i))))
    ));
  }
  return rows;
}

// 面板是公開的、所有人共用一份，所以選單不能只列某個人的時段。
// 這裡列出所有「已被認領且還沒過去」的時段，按下去時才驗證是不是本人。
function rotAllTakenIndexes(rot, nowMs = Date.now()) {
  const from = Math.max(0, rotCurrentIndex(rot, nowMs));
  const out = [];
  for (let i = from; i < rot.slotCount; i++) if (rotSlotUsers(rot, i).length) out.push(i);
  return out;
}

// 公開貼出結算報告，並把排班面板一起更新成已結束
async function rotPostSettlement(interaction, rotId, rot, shareProfit) {
  const { embed, mentions } = buildRotationSettlement(rot, Date.now(), shareProfit);
  await refreshRotationMessage(rotId, rot, interaction);

  try {
    const ch = interaction.channel;
    if (!ch?.isTextBased()) throw new Error('這裡不能發訊息');
    await ch.send({
      content: mentions.length ? mentions.map(u => `<@${u}>`).join(' ') : undefined,
      embeds: [embed]
    });
  } catch (e) {
    console.error('張貼接圖結算失敗:', e.message);
    const msg = '⚠️ 結算算好了但貼不出去（機器人可能沒有發言權限）。下面是結算內容：';
    if (interaction.deferred || interaction.replied) {
      return await interaction.followUp({ content: msg, embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    return await interaction.reply({ content: msg, embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const done = '✅ 已結算並公開貼到頻道。';
  if (interaction.deferred || interaction.replied) {
    return await interaction.editReply({ content: done, components: [], embeds: [] }).catch(async () => {
      await interaction.followUp({ content: done, flags: MessageFlags.Ephemeral });
    });
  }
  return await interaction.reply({ content: done, flags: MessageFlags.Ephemeral });
}

async function refreshRotationMessage(rotId, rot, interaction = null) {
  if (!rot?.channelId || !rot?.messageId) return false;
  try {
    const ch = await client.channels.fetch(rot.channelId);
    if (!ch?.isTextBased()) throw new Error('頻道不存在或不是文字頻道');
    const m = await ch.messages.fetch(rot.messageId);
    await m.edit({ embeds: [buildRotationEmbed(rot)], components: buildRotationComponents(rotId, rot) });
    return true;
  } catch (e) {
    console.error('重繪排班表失敗:', e.message);
    await warnRefreshFailed(interaction, '熱門地圖排隊');
    return false;
  }
}

// 判斷是不是這團的隊長（或管理員）
function isPartyLeader(pData, interaction) {
  return pData.creatorId === interaction.user.id ||
         isSuperAdmin(interaction.user.id, interaction.memberPermissions);
}

// 隊長設定「這團需要哪些 Buff」的 icon 點選面板
function buildReqBuffPanel(pId, reqBuffs) {
  const on = new Set(reqBuffs || []);
  const rows = [];
  for (let i = 0; i < STANDARD_PARTY_BUFFS.length; i += 4) {
    const row = new ActionRowBuilder();
    STANDARD_PARTY_BUFFS.slice(i, i + 4).forEach((b, k) => {
      const idx = i + k;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`party_bt_${pId}_${idx}`)
          .setLabel(`${buffIcon(b)} ${b}`)
          .setStyle(on.has(b) ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    });
    rows.push(row);
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`party_bt_done_${pId}`).setLabel('✅ 設定完成').setStyle(ButtonStyle.Primary)
  ));
  const picked = (reqBuffs || []).map(b => `${buffIcon(b)}${b}`).join('　') || '（尚未設定，代表不限）';
  return {
    content: '🎯 **【設定這團需要哪些 Buff】**\n點一下加入需求、再點一下取消。\n\n目前需求：' + picked,
    components: rows
  };
}

// 建立「新增分身」表單 (本人與管理員代添共用)
function buildAddCharModal(targetUid) {
  const modal = new ModalBuilder()
    .setCustomId('modal_card_add_char')
    .setTitle('名片管理 - 新增分身角色');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_ign').setLabel('角色遊戲 ID (必填)').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_job').setLabel('職業 (例如: 黑騎士、主教、鏢賊)').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('add_char_level').setLabel('等級 (必填)').setValue('120').setStyle(TextInputStyle.Short).setRequired(true))
  );
  return modal;
}

// 用角色名稱反查名冊。直接掃 Firestore，所以**已經退群的人也找得到** ——
// 原本只能從群內成員挑，退群的人留下的角色就永遠清不掉。
async function searchCharactersByIgn(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw || !db) return [];
  const snap = await db.collection('member_profiles').get();
  const hits = [];

  snap.forEach(doc => {
    const d = doc.data();
    if (d.mainIgn && d.mainIgn.toLowerCase().includes(kw)) {
      hits.push({
        uid: doc.id, ign: d.mainIgn, job: d.mainJob || '冒險家', lv: d.mainLevel || '1',
        isMain: true, idx: -1, nickname: d.nickname, subCount: (d.subs || []).length
      });
    }
    (d.subs || []).forEach((s, i) => {
      if (s?.ign && s.ign.toLowerCase().includes(kw)) {
        hits.push({
          uid: doc.id, ign: s.ign, job: s.job || '冒險家', lv: s.level || '1',
          isMain: false, idx: i, nickname: d.nickname
        });
      }
    });
  });

  // 完全相符的排前面，免得打「霜」要在一堆模糊結果裡找「沁霜」
  return hits.sort((a, b) => {
    const ea = a.ign.toLowerCase() === kw ? 0 : 1;
    const eb = b.ign.toLowerCase() === kw ? 0 : 1;
    return ea - eb || a.ign.localeCompare(b.ign);
  });
}

// 整筆名冊被刪掉時，把身分組收回來。回傳這個人是否還在群內。
async function clearMemberRoles(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  const strip = [...Object.values(ROLES.JOBS), ROLES.VERIFIED, ROLES.WARDEN_200, ROLES.RETIRED]
    .filter(Boolean)
    .filter(id => member.roles.cache.has(id));
  if (strip.length) await member.roles.remove(strip).catch(() => {});
  if (ROLES.UNVERIFIED) await member.roles.add(ROLES.UNVERIFIED).catch(() => {});
  return true;
}

// 為指定成員建立「要刪除哪隻分身」的下拉選單（等級更新已改為批次表單）
async function buildCharSelectRowForUser(targetUid, operatorId) {
  const profile = await fetchUserDocSafe(targetUid);
  const chars = (profile.subs || [])
    .map((sub, i) => ({ ign: sub?.ign, job: sub?.job, lv: sub?.level, idx: i }))
    .filter(c => c.ign);

  if (!chars.length) return null;
  userChoiceMap.set(`target_del_user_${operatorId}`, targetUid);

  const options = chars.slice(0, 25).map(c =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`⚔️ 分身：${c.ign} (${c.job} Lv.${c.lv})`.substring(0, 100))
      .setValue(`del_char_${targetUid}_${c.idx}_${c.ign}`.substring(0, 100))
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_char_to_delete')
      .setPlaceholder('⚠️ 請選擇欲刪除的分身角色')
      .addOptions(options)
  );
}

// ==========================================
// 9. 啟動登入 (務必保留在檔案最末)
// ==========================================
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ 致命錯誤：找不到環境變數 DISCORD_TOKEN，機器人無法登入！請至 Render → Environment 設定。');
} else {
  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Discord 登入失敗:', err.message);
  });
}
