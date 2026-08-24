client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot 上線：${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    // 1. 強制清空全域指令快取 (徹底根除重複顯示問題)
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
    console.log('🧹 已清空舊版全域指令快取');

    // 2. 僅註冊伺服器專屬指令 (即時生效)
    for (const guild of client.guilds.cache.values()) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: commands }
      );
      console.log(`✅ 已為伺服器 [${guild.name}] 即時註冊單一指令清單！`);
    }
  } catch (e) {
    console.error('❌ 指令註冊失敗:', e);
  }

  // -------------------------------------------------------------
  // 背景自動化排程 (Cron Schedule)
  // -------------------------------------------------------------
  cron.schedule('0 0 8 1 * *', async () => {
    if (!db) return;
    try {
      const snap = await db.collection('member_profiles').get();
      const regUids = new Set();
      snap.forEach(d => regUids.add(d.data().userId));
      for (const guild of client.guilds.cache.values()) {
        const members = await guild.members.fetch().catch(() => null);
        if (members) {
          for (const m of members.values()) {
            if (!m.user.bot && !regUids.has(m.id)) {
              await m.roles.add(ROLES.UNVERIFIED).catch(() => {});
              await m.send(`📢 **【公會每月例行提醒】** 請前往 <#${WELCOME_REGISTER_CHANNEL_ID}> 或輸入 \`/角色報到\` 登記名冊！`).catch(() => {});
            }
          }
        }
      }
    } catch (e) { console.error('每月稽核異常:', e.message); }
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
