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
  PermissionFlagsBits
} = require('discord.js');
const express = require('express');
const admin = require('firebase-admin');
const cron = require('node-cron');

// ==========================================
// 1. 喚醒伺服器設定 (Express 防休眠)
// ==========================================
const app = express();
app.get('/', (req, res) => {
  res.send('🍁 MapleStory Discord Bot Server is Online!');
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
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('✅ Firebase Firestore 連線成功');
  } else {
    console.log('⚠️ 未偵測到 FIREBASE_CREDENTIALS，將使用記憶體/本地資料處理');
  }
} catch (error) {
  console.error('❌ Firebase 初始化失敗:', error.message);
}

// 本地倒數活動快取 (若未接 Firebase 時作為備援)
let localCountdownEvents = [];

// ==========================================
// 3. 定義斜線指令清單 (Slash Commands)
// ==========================================
const commands = [
  {
    name: 'help',
    description: '🍁 顯示公會機器人的所有功能與指令說明'
  },
  {
    name: '骰子',
    description: '🎲 占卜今日大吉頻道與掉寶/過星運勢'
  },
  {
    name: 'boss',
    description: '⚔️ 查詢挑戰突襲王（Boss）的必備物資與門檻',
    options: [
      {
        name: '王名',
        description: '選擇要查詢的突襲王',
        type: 3, // STRING
        required: false,
        choices: [
          { name: '困史/困戴 (困難史烏 & 戴米安)', value: 'lotus_damien' },
          { name: '困露/困威 (困難露希妲 & 威爾)', value: 'lucid_will' },
          { name: '極限賽蓮 (Extreme Seren)', value: 'seren' },
          { name: '卡洛斯 (Kalos)', value: 'kalos' }
        ]
      }
    ]
  },
  {
    name: '發送驗證按鈕',
    description: '⚙️ 在此頻道發送新人填表驗證面板（僅管理員）',
    default_member_permissions: String(PermissionFlagsBits.Administrator)
  },
  {
    name: '廣播',
    description: '📢 管理活動倒數與廣播提醒（僅管理員）',
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      {
        name: '新增活動',
        description: '新增活動倒數',
        type: 1, // SUB_COMMAND
        options: [
          { name: '名稱', description: '活動名稱（例如：夏日冒險島）', type: 3, required: true },
          { name: '截止日期', description: '格式：YYYY-MM-DD（例如：2026-08-31）', type: 3, required: true }
        ]
      },
      {
        name: '活動清單',
        description: '查看目前正在倒數的活動清單',
        type: 1
      },
      {
        name: '刪除活動',
        description: '刪除指定的倒數活動',
        type: 1,
        options: [
          { name: '名稱', description: '欲刪除的活動名稱', type: 3, required: true }
        ]
      }
    ]
  }
];

// ==========================================
// 4. Discord 機器人核心邏輯
// ==========================================
// 需開啟 GuildMembers Intent 才能取得成員資訊並給予身分組
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

client.once('ready', async () => {
  console.log(`✅ 楓之谷機器人已成功上線，登入身分：${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ 楓之谷斜線指令全數註冊完成！');
  } catch (error) {
    console.error('❌ 註冊斜線指令失敗:', error);
  }

  // ==========================================
  // 5. 定時排程廣播 (node-cron)
  // ==========================================

  // 🔔 1. 每週一 20:00 發送例行維護與週重置提醒
  cron.schedule('0 20 * * 1', async () => {
    const channelId = process.env.BROADCAST_CHANNEL_ID;
    if (!channelId) return;

    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const weeklyEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('🔔 【公會例行提醒】明日維護與週重置通知')
          .setDescription('冒險家們請注意：\n\n1. **明日（週二）** 預計進行遊戲例行維護。\n2. **週三** 將重置所有週王進度與公會城每週任務。\n3. 請確認 **地下水怪** 與 **公會戰旗** 是否已全數完成！')
          .setTimestamp();

        await channel.send({ embeds: [weeklyEmbed] });
      }
    } catch (err) {
      console.error('每週提醒廣播失敗:', err);
    }
  }, { timezone: 'Asia/Taipei' });

  // ⏳ 2. 每日 10:00 自動計算活動倒數並廣播
  cron.schedule('0 10 * * *', async () => {
    const channelId = process.env.BROADCAST_CHANNEL_ID;
    if (!channelId) return;

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      let events = [];
      if (db) {
        const snapshot = await db.collection('countdown_events').get();
        snapshot.forEach(doc => events.push(doc.data()));
      } else {
        events = localCountdownEvents;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const ev of events) {
        const targetDate = new Date(ev.endDate);
        targetDate.setHours(0, 0, 0, 0);

        const diffTime = targetDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0) {
          const embed = new EmbedBuilder()
            .setColor('#FF5555')
            .setTitle('⏳ 【活動倒數提醒】')
            .setDescription(`距離 **${ev.name}** 結束還剩下 **${diffDays}** 天！\n📅 截止日期：\`${ev.endDate}\`\n請記得至活動商店兌換硬幣與未領取之獎勵！`)
            .setTimestamp();

          await channel.send({ embeds: [embed] });
        }
      }
    } catch (err) {
      console.error('活動倒數廣播發送失敗:', err);
    }
  }, { timezone: 'Asia/Taipei' });
});

// ==========================================
// 6. 互動事件監聽 (Commands, Buttons, Modals)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  // --------------------------------------------------
  // A. 處理斜線指令 (ChatInputCommand)
  // --------------------------------------------------
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // /help 指令
    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🍁 楓之谷公會小幫手 - 指令清單')
        .setDescription('歡迎使用公會專屬機器人，目前支援以下指令：')
        .addFields(
          { name: '`/help`', value: '查看所有指令說明。' },
          { name: '`/骰子`', value: '占卜今日大吉頻道與衝裝、掉寶運勢。' },
          { name: '`/boss [王名]`', value: '查詢打王必備消耗品、門檻與攻略連結。' },
          { name: '`/發送驗證按鈕` (管理員)', value: '在當前頻道建立新人入群審核按鈕。' },
          { name: '`/廣播 新增活動 / 活動清單 / 刪除活動` (管理員)', value: '動態管理每日活動倒數提醒。' }
        )
        .setFooter({ text: '祝各位冒險家漆黑天天掉，星力一路順！' });

      return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }

    // /骰子 指令
    if (commandName === '骰子') {
      const ch = Math.floor(Math.random() * 40) + 1;
      const fortunes = [
        '✨ 今日大吉！去打困史必掉漆黑飾品！',
        '⭐ 運勢上乘：強化裝備星力連過三顆！',
        '🍄 平平淡淡：刷怪掉寶核心爆滿的一天。',
        '⚠️ 宜謹慎：過星前記得先墊爆其他裝備！',
        '🔥 今日火氣旺：適合跟公會團挑戰新進度王！'
      ];
      const result = fortunes[Math.floor(Math.random() * fortunes.length)];

      const rollEmbed = new EmbedBuilder()
        .setColor('#00FFAA')
        .setTitle('🎲 冒險家今日占卜結果')
        .addFields(
          { name: '📍 今日幸運頻道', value: `**CH ${ch}**`, inline: true },
          { name: '🔮 運勢指引', value: result, inline: false }
        )
        .setFooter({ text: `占卜者：${interaction.user.displayName}` });

      return interaction.reply({ embeds: [rollEmbed] });
    }

    // /boss 指令
    if (commandName === 'boss') {
      const boss = interaction.options.getString('王名') || 'default';
      const bossInfo = {
        lotus_damien: {
          title: '⚔️ 困難 史烏 / 戴米安 (困史戴)',
          desc: '【必備物資】生肖爆擊秘藥、天堂氣息、實用主教祈禱\n【門檻提示】建議戰力 2500萬+ / ARC 滿足\n【重點提示】一階段雷射注意走位；戴米安落石時專心解烙印。'
        },
        lucid_will: {
          title: '⚔️ 困難 露希妲 / 威爾 (困露威)',
          desc: '【必備物資】高級秘藥組合、極限屬性重置、無敵藥水\n【門檻提示】建議戰力 5000萬+ / ARC 1.5倍滿增傷\n【重點提示】露希妲三階留全爆發；威爾二階請保持月光充足。'
        },
        seren: {
          title: '⚔️ 極限 賽蓮 (Extreme Seren)',
          desc: '【必備物資】頂級秘藥、公會暴擊技能、AUT 滿足減傷標準\n【重點提示】正午階段注意破盾時機，黎明階段嚴防被彈飛。'
        },
        kalos: {
          title: '⚔️ 監視者 卡洛斯 (Kalos)',
          desc: '【必備物資】頂級戰鬥藥水、拘束技能分配\n【重點提示】專人解無人機與陷阱，解除爆發時機聽指揮。'
        },
        default: {
          title: '⚔️ 突襲王通用備戰物資指南',
          desc: '1. **必備消耗品**：生肖秘藥、萬能療傷藥、天使祝福、天堂氣息\n2. **BUFF確認**：公會技能（暴擊/傷害/忽防）、主教祈禱、戰神萌獸\n3. **頻道導流**：詳細打王配團與各職業攻略，請至伺服器專屬攻略專區查看！'
        }
      };

      const selected = bossInfo[boss] || bossInfo.default;
      const bossEmbed = new EmbedBuilder()
        .setColor('#FF3366')
        .setTitle(selected.title)
        .setDescription(selected.desc)
        .setFooter({ text: '楓之谷公會戰備部' });

      return interaction.reply({ embeds: [bossEmbed] });
    }

    // /發送驗證按鈕 指令 (管理員)
    if (commandName === '發送驗證按鈕') {
      const verifyEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🍁 歡迎來到楓之谷公會 Discord！')
        .setDescription('為了讓公會成員更快認識你並開啟完整頻道權限，請點擊下方按鈕填寫入群表單。\n\n系統將在送出後**自動賦予公會身分組**並轉發自我介紹！');

      const btn = new ButtonBuilder()
        .setCustomId('btn_open_verify_modal')
        .setLabel('📝 填寫入群表單')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(btn);
      await interaction.channel.send({ embeds: [verifyEmbed], components: [row] });
      return interaction.reply({ content: '✅ 驗證面板已發送！', ephemeral: true });
    }

    // /廣播 指令 (管理員)
    if (commandName === '廣播') {
      const sub = interaction.options.getSubcommand();

      if (sub === '新增活動') {
        const name = interaction.options.getString('名稱');
        const endDate = interaction.options.getString('截止日期');

        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          return interaction.reply({ content: '❌ 日期格式錯誤，請使用 `YYYY-MM-DD`（例如：`2026-08-31`）', ephemeral: true });
        }

        if (db) {
          await db.collection('countdown_events').doc(name).set({ name, endDate });
        } else {
          localCountdownEvents.push({ name, endDate });
        }

        return interaction.reply({ content: `✅ 已成功新增活動倒數：**${name}**（截止日：\`${endDate}\`）`, ephemeral: true });
      }

      if (sub === '活動清單') {
        let list = [];
        if (db) {
          const snapshot = await db.collection('countdown_events').get();
          snapshot.forEach(doc => list.push(doc.data()));
        } else {
          list = localCountdownEvents;
        }

        if (list.length === 0) {
          return interaction.reply({ content: '目前沒有任何進行中的倒數活動。', ephemeral: true });
        }

        let desc = '';
        list.forEach((ev, idx) => {
          desc += `**${idx + 1}. ${ev.name}** - 截止日：\`${ev.endDate}\`\n`;
        });

        const listEmbed = new EmbedBuilder()
          .setColor('#00AAFF')
          .setTitle('📋 當前活動倒數清單')
          .setDescription(desc);

        return interaction.reply({ embeds: [listEmbed], ephemeral: true });
      }

      if (sub === '刪除活動') {
        const name = interaction.options.getString('名稱');
        if (db) {
          await db.collection('countdown_events').doc(name).delete();
        } else {
          localCountdownEvents = localCountdownEvents.filter(ev => ev.name !== name);
        }
        return interaction.reply({ content: `✅ 已刪除活動：**${name}**`, ephemeral: true });
      }
    }
  }

  // --------------------------------------------------
  // B. 點擊「填寫入群表單」按鈕 -> 彈出 Modal 表單
  // --------------------------------------------------
  if (interaction.isButton() && interaction.customId === 'btn_open_verify_modal') {
    const modal = new ModalBuilder()
      .setCustomId('modal_verify_form')
      .setTitle('🍁 楓之谷公會入群資料填寫');

    const reasonInput = new TextInputBuilder()
      .setCustomId('input_reason')
      .setLabel('1. 加入原因')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('例如：朋友介紹、找固定週王團、休閒交流...')
      .setRequired(true);

    const jobInput = new TextInputBuilder()
      .setCustomId('input_job')
      .setLabel('2. 遊戲主要職業')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例如：主教、夜使者、英雄...')
      .setRequired(true);

    const levelInput = new TextInputBuilder()
      .setCustomId('input_level')
      .setLabel('3. 角色等級')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例如：275 等')
      .setRequired(true);

    const timeInput = new TextInputBuilder()
      .setCustomId('input_time')
      .setLabel('4. 平常遊玩時段')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('例如：平日晚上 20:00~23:00、週末全天')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(jobInput),
      new ActionRowBuilder().addComponents(levelInput),
      new ActionRowBuilder().addComponents(timeInput)
    );

    return interaction.showModal(modal);
  }

  // --------------------------------------------------
  // C. 表單送出 (ModalSubmit) -> 自動發組與發布自介
  // --------------------------------------------------
  if (interaction.isModalSubmit() && interaction.customId === 'modal_verify_form') {
    const reason = interaction.fields.getTextInputValue('input_reason');
    const job = interaction.fields.getTextInputValue('input_job');
    const level = interaction.fields.getTextInputValue('input_level');
    const time = interaction.fields.getTextInputValue('input_time');

    const roleId = process.env.VERIFIED_ROLE_ID;
    const introChannelId = process.env.INTRO_CHANNEL_ID;

    // 1. 自動賦予公會身分組
    if (roleId) {
      try {
        await interaction.member.roles.add(roleId);
      } catch (err) {
        console.error('❌ 賦予身分組失敗（請確認 Bot 身分組階層是否高於該身分組）:', err);
      }
    }

    // 2. 建立新人名片 Embed
    const introEmbed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle(`🎉 歡迎新成員加入：${interaction.user.displayName}`)
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '🗡️ 職業', value: job, inline: true },
        { name: '📊 等級', value: level, inline: true },
        { name: '⏰ 遊玩時段', value: time, inline: false },
        { name: '💬 加入原因', value: reason, inline: false }
      )
      .setTimestamp();

    // 3. 發布至自我介紹頻道
    if (introChannelId) {
      try {
        const introChannel = await client.channels.fetch(introChannelId);
        if (introChannel && introChannel.isTextBased()) {
          await introChannel.send({ embeds: [introEmbed] });
        }
      } catch (err) {
        console.error('❌ 自我介紹轉發失敗:', err);
      }
    }

    // 4. 回覆該新人（僅本人可見）
    return interaction.reply({
      content: '✅ 驗證成功！已為您開通公會身分組權限，自我介紹已同步發布至頻道，歡迎加入！🍁',
      ephemeral: true
    });
  }
});

client.login(process.env.DISCORD_TOKEN);


