require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');

// ==========================================
// 0. 環境變數設定 (請在 .env 或 Railway/Render 後台設定)
// ==========================================
// WELCOME_CHANNEL_ID : 新人進來時，機器人要在哪個頻道打招呼
// REVIEW_CHANNEL_ID  : 填完表單後，資料要送到哪個頻道給管理員看
// MEMBER_ROLE_ID     : 填完表單後要自動給予的身分組 (選填，留空就不給)
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID;
const REVIEW_CHANNEL_ID = process.env.REVIEW_CHANNEL_ID;
const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID;

// ==========================================
// 1. 喚醒伺服器設定 (Express)
// ==========================================
const app = express();
app.get('/', (req, res) => {
  res.send('Auto-Bot Server is Online!');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 網頁伺服器已啟動於 Port ${PORT}`);
});

// ==========================================
// 2. Firebase 初始化連線
// ==========================================
let db;
try {
  if (process.env.FIREBASE_CREDENTIALS) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    db = admin.firestore();
    console.log('✅ Firebase Firestore 連線成功');
  } else {
    console.log('⚠️ 未偵測到 FIREBASE_CREDENTIALS，跳過資料庫連線');
  }
} catch (error) {
  console.error('❌ Firebase 初始化失敗:', error.message);
}

// ==========================================
// 3. 定義要註冊的斜線指令
// ==========================================
const commands = [
  {
    name: '占卜',
    description: '抽取今天的幸運運勢，並自動記錄到資料庫！',
  },
  {
    name: '歷史占卜',
    description: '從資料庫查詢你最近的 5 次占卜紀錄',
  },
  {
    name: '入群申請',
    description: '填寫加入原因、職業、等級與遊玩時間（可重複填寫來更新資料）',
  },
  {
    name: '查詢資料',
    description: '查看自己（或指定成員）填寫的入群資料',
    options: [
      {
        name: '成員',
        description: '想查詢的成員，不填則查自己',
        type: 6, // USER
        required: false,
      },
    ],
  },
];

// ==========================================
// 4. 入群問卷：按鈕與 Modal 表單
// ==========================================
const APPLY_BUTTON_ID = 'open_apply_modal';
const APPLY_MODAL_ID = 'apply_modal';

// 產生「開始填寫」按鈕
function buildApplyButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(APPLY_BUTTON_ID)
      .setLabel('📝 開始填寫入群資料')
      .setStyle(ButtonStyle.Primary)
  );
}

// 產生問卷 Modal（Discord 一個 Modal 最多 5 個欄位）
function buildApplyModal() {
  const modal = new ModalBuilder()
    .setCustomId(APPLY_MODAL_ID)
    .setTitle('入群資料填寫');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('1. 你加入這個群的原因是？')
    .setPlaceholder('例：朋友推薦、想找人一起打副本、想認識同好…')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(true);

  const jobInput = new TextInputBuilder()
    .setCustomId('job')
    .setLabel('2. 你的職業是？')
    .setPlaceholder('例：戰士 / 法師 / 弓手')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setRequired(true);

  const levelInput = new TextInputBuilder()
    .setCustomId('level')
    .setLabel('3. 你的等級是？（請填數字）')
    .setPlaceholder('例：120')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10)
    .setRequired(true);

  const playtimeInput = new TextInputBuilder()
    .setCustomId('playtime')
    .setLabel('4. 你平常遊玩的時間？')
    .setPlaceholder('例：平日 20:00~24:00、假日全天')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(300)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(jobInput),
    new ActionRowBuilder().addComponents(levelInput),
    new ActionRowBuilder().addComponents(playtimeInput)
  );

  return modal;
}

// ==========================================
// 5. Discord 機器人核心邏輯
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // ⚠️ 需在 Developer Portal 開啟 SERVER MEMBERS INTENT
  ],
});

client.once('ready', async () => {
  console.log(`✅ 機器人已成功上線，登入身分：${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ 斜線指令註冊成功！');
  } catch (error) {
    console.error('❌ 註冊斜線指令失敗:', error);
  }
});

// 🚪 有新成員加入伺服器 → 請他填寫入群資料
client.on('guildMemberAdd', async (member) => {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`👋 歡迎 ${member.user.username} 加入 ${member.guild.name}！`)
    .setDescription(
      '在開始之前，麻煩先按下方按鈕填寫一份小問卷：\n\n' +
        '**1️⃣ 加入本群的原因**\n' +
        '**2️⃣ 你的職業與等級**\n' +
        '**3️⃣ 平常的遊玩時間**\n\n' +
        '填完之後就可以開始一起玩囉！'
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: '若不小心關掉了，隨時可以輸入 /入群申請 重新填寫' });

  const payload = { embeds: [embed], components: [buildApplyButtonRow()] };

  // 先嘗試發到歡迎頻道
  let sent = false;
  if (WELCOME_CHANNEL_ID) {
    try {
      const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        await channel.send({ content: `${member}`, ...payload });
        sent = true;
      }
    } catch (error) {
      console.error('❌ 無法發送到歡迎頻道:', error.message);
    }
  }

  // 歡迎頻道失敗的話，改用私訊
  if (!sent) {
    try {
      await member.send(payload);
    } catch (error) {
      console.error('❌ 無法私訊新成員（對方可能關閉私訊）:', error.message);
    }
  }
});

// 🌟 監聽所有互動（指令 / 按鈕 / 表單）
client.on('interactionCreate', async (interaction) => {
  try {
    // ---------- 按鈕：開啟問卷 ----------
    if (interaction.isButton() && interaction.customId === APPLY_BUTTON_ID) {
      return interaction.showModal(buildApplyModal());
    }

    // ---------- 表單送出：儲存問卷 ----------
    if (interaction.isModalSubmit() && interaction.customId === APPLY_MODAL_ID) {
      return handleApplyModalSubmit(interaction);
    }

    if (!interaction.isChatInputCommand()) return;

    // ---------- 指令：入群申請 ----------
    if (interaction.commandName === '入群申請') {
      return interaction.showModal(buildApplyModal());
    }

    // ---------- 指令：查詢資料 ----------
    if (interaction.commandName === '查詢資料') {
      return handleProfileQuery(interaction);
    }

    // ---------- 指令：占卜 ----------
    if (interaction.commandName === '占卜') {
      await interaction.deferReply();
      const fortunes = ['大吉🌟', '中吉✨', '小吉🍵', '吉💪', '末吉🍂', '凶👀', '大凶🛌'];
      const result = fortunes[Math.floor(Math.random() * fortunes.length)];

      if (db) {
        try {
          await db.collection('fortune_history').add({
            userId: interaction.user.id,
            username: interaction.user.username,
            fortune: result,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
          console.error('寫入占卜紀錄失敗:', error);
        }
      }

      return interaction.editReply(
        `🔮 來自星星的指引：${result}\n*(已自動為您存入歷史紀錄)*`
      );
    }

    // ---------- 指令：歷史占卜 ----------
    if (interaction.commandName === '歷史占卜') {
      if (!db) {
        return interaction.reply({
          content: '❌ 資料庫未連線，無法查詢紀錄。',
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.deferReply();

      const snapshot = await db
        .collection('fortune_history')
        .where('userId', '==', interaction.user.id)
        .get();

      if (snapshot.empty) {
        return interaction.editReply(
          '📜 你還沒有任何占卜紀錄喔！趕快先使用 `/占卜` 試試看吧！'
        );
      }

      const records = [];
      snapshot.forEach((doc) => records.push(doc.data()));
      records.sort((a, b) => {
        const timeA = a.timestamp ? a.timestamp.toMillis() : 0;
        const timeB = b.timestamp ? b.timestamp.toMillis() : 0;
        return timeB - timeA;
      });

      let historyText = `📜 ${interaction.user.username} 的最近 5 次占卜紀錄：\n\n`;
      records.slice(0, 5).forEach((data, index) => {
        const timeString = data.timestamp
          ? data.timestamp.toDate().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
          : '剛剛';
        historyText += `${index + 1}. [${timeString}] 抽到了 ${data.fortune}\n`;
      });

      return interaction.editReply(historyText);
    }
  } catch (error) {
    console.error('❌ 處理互動時發生錯誤:', error);
    // 盡量給使用者一個回覆，避免介面卡在「思考中」
    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply('❌ 發生錯誤，請稍後再試。');
        } else {
          await interaction.reply({
            content: '❌ 發生錯誤，請稍後再試。',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
});

// ==========================================
// 6. 問卷送出後的處理
// ==========================================
async function handleApplyModalSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const reason = interaction.fields.getTextInputValue('reason').trim();
  const job = interaction.fields.getTextInputValue('job').trim();
  const levelRaw = interaction.fields.getTextInputValue('level').trim();
  const playtime = interaction.fields.getTextInputValue('playtime').trim();

  // 等級檢查：只留數字
  const level = parseInt(levelRaw.replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(level)) {
    return interaction.editReply(
      '❌ 「等級」請填寫數字（例如 120）。請再輸入一次 `/入群申請` 重新填寫。'
    );
  }

  const profile = {
    userId: interaction.user.id,
    username: interaction.user.username,
    guildId: interaction.guildId || null,
    reason,
    job,
    level,
    playtime,
    updatedAt: db ? admin.firestore.FieldValue.serverTimestamp() : null,
  };

  // 寫入資料庫（以 userId 當文件 ID，重複填寫會直接更新）
  let saved = false;
  if (db) {
    try {
      await db
        .collection('member_profiles')
        .doc(interaction.user.id)
        .set(profile, { merge: true });
      saved = true;
    } catch (error) {
      console.error('❌ 寫入入群資料失敗:', error);
    }
  }

  // 送一份到管理員審核頻道
  if (REVIEW_CHANNEL_ID && interaction.guild) {
    try {
      const channel = await interaction.guild.channels.fetch(REVIEW_CHANNEL_ID);
      if (channel && channel.isTextBased()) {
        const reviewEmbed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('📥 新的入群資料')
          .setThumbnail(interaction.user.displayAvatarURL())
          .addFields(
            { name: '成員', value: `${interaction.user} (${interaction.user.tag})` },
            { name: '加入原因', value: reason },
            { name: '職業', value: job, inline: true },
            { name: '等級', value: String(level), inline: true },
            { name: '平常遊玩時間', value: playtime }
          )
          .setTimestamp();
        await channel.send({ embeds: [reviewEmbed] });
      }
    } catch (error) {
      console.error('❌ 無法發送到審核頻道:', error.message);
    }
  }

  // 自動給予身分組
  let roleGiven = false;
  if (MEMBER_ROLE_ID && interaction.member && interaction.member.roles) {
    try {
      await interaction.member.roles.add(MEMBER_ROLE_ID);
      roleGiven = true;
    } catch (error) {
      console.error('❌ 給予身分組失敗（請確認機器人身分組在該身分組之上）:', error.message);
    }
  }

  const lines = [
    '✅ 資料已送出，感謝填寫！',
    '',
    `**加入原因**：${reason}`,
    `**職業**：${job}`,
    `**等級**：${level}`,
    `**平常遊玩時間**：${playtime}`,
  ];
  if (!saved && db) lines.push('', '⚠️ 資料庫寫入失敗，管理員仍會收到你的資料。');
  if (!db) lines.push('', '⚠️ 目前未連線資料庫，資料只會送到管理員頻道。');
  if (roleGiven) lines.push('', '🎉 已自動為你加上成員身分組！');

  return interaction.editReply(lines.join('\n'));
}

// ==========================================
// 7. 查詢入群資料
// ==========================================
async function handleProfileQuery(interaction) {
  if (!db) {
    return interaction.reply({
      content: '❌ 資料庫未連線，無法查詢資料。',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getUser('成員') || interaction.user;
  const doc = await db.collection('member_profiles').doc(target.id).get();

  if (!doc.exists) {
    return interaction.editReply(
      target.id === interaction.user.id
        ? '📄 你還沒有填寫入群資料，請輸入 `/入群申請` 開始填寫。'
        : `📄 ${target.username} 還沒有填寫入群資料。`
    );
  }

  const data = doc.data();
  const updatedAt = data.updatedAt
    ? data.updatedAt.toDate().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    : '未知';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📄 ${target.username} 的入群資料`)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: '加入原因', value: data.reason || '—' },
      { name: '職業', value: data.job || '—', inline: true },
      { name: '等級', value: String(data.level ?? '—'), inline: true },
      { name: '平常遊玩時間', value: data.playtime || '—' }
    )
    .setFooter({ text: `最後更新：${updatedAt}` });

  return interaction.editReply({ embeds: [embed] });
}

client.login(process.env.DISCORD_TOKEN);
