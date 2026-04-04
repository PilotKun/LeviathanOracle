const { SlashCommandBuilder, ButtonStyle, MessageFlags, InteractionContextType } = require('discord.js');
const { getDailySchedule, getAnimeScheduleByAniListId } = require('../../utils/API-services');
const { embed, ui } = require('../../functions/ui');
const db = require('../../schemas/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('upcoming')
    .setDescription('View upcoming anime episodes')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addStringOption(o => o
      .setName('filter')
      .setDescription('Filter the schedule')
      .setRequired(true)
      .addChoices(
        { name: 'Tomorrow', value: 'tomorrow' },
        { name: 'This Week', value: 'week' },
        { name: 'Watchlist', value: 'watchlist' }
      )),

  async execute(interaction) {
    const filter = interaction.options.getString('filter');

    try {
      const msg = await interaction.deferReply({ fetchReply: true });
      let data = [];
      let header = '';

      if (filter === 'tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(tomorrow);
        
        data = await getDailySchedule(dayName) || [];
        header = `Schedule: **${dayName}** (Tomorrow)`;
      } 
      
      else if (filter === 'week') {
        const day = await promptForDay(interaction, msg);
        if (!day) return;

        const type = await promptForType(interaction, msg, day);
        if (!type) return;

        data = await getDailySchedule(day, type) || [];
        header = `Schedule: **${day}** (${type})`;
      } 
      
      else if (filter === 'watchlist') {
        data = await fetchWatchlistData(interaction.user.id);
        header = `Upcoming episodes for your watchlist:`;
      }

      if (!data.length) {
        return interaction.editReply({ content: 'No upcoming episodes found.', components: [] });
      }

      await createPaginator(interaction, msg, data, header);
      t.end(`${filter} rendered`, { count: data.length });

    } catch (e) {
      t.error('Command Error', e);
      const payload = { content: 'Error fetching schedule.', flags: MessageFlags.Ephemeral };
      interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);
    }
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWatchlistData(userId, t) {
  const { rows } = await db.query('SELECT anime_title, anime_id FROM watchlists WHERE user_id = $1', [userId]);
  if (!rows.length) return [];

  // Fetch all schedules in parallel for better performance
  const results = await Promise.all(rows.map(async (entry) => {
    if (!entry.anime_id) return null;
    const schedule = await getAnimeScheduleByAniListId(entry.anime_id);
    
    if (schedule?.episodeDate && new Date(schedule.episodeDate) > new Date()) {
      return { ...schedule, _fallbackTitle: entry.anime_title };
    }
    return null;
  }));

  return results.filter(Boolean).sort((a, b) => new Date(a.episodeDate) - new Date(b.episodeDate));
}

async function promptForDay(interaction, msg) {
  const days = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const rows = [
    ui.row(days.slice(0, 4).map(d => ({ id: d, label: d, style: ButtonStyle.Primary }))),
    ui.row(days.slice(4).map(d => ({ id: d, label: d, style: ButtonStyle.Primary })))
  ];

  await interaction.editReply({ content: 'Select a day:', components: rows });
  const click = await msg.awaitMessageComponent({ time: 30000 }).catch(() => null);
  if (!click) { await interaction.editReply({ content: 'Timed out.', components: [] }); return null; }
  return click; // Note: This returns the interaction object to update it in the next step
}

async function promptForType(interaction, msg, dayInteraction) {
  const types = ['Sub', 'Dub', 'Raw'];
  const row = ui.row(types.map(ty => ({ id: ty, label: ty, style: ButtonStyle.Secondary })));

  await dayInteraction.update({ content: `Day: **${dayInteraction.customId}**. Select type:`, components: [row] });
  const click = await msg.awaitMessageComponent({ time: 30000 }).catch(() => null);
  if (!click) { await interaction.editReply({ content: 'Timed out.', components: [] }); return null; }
  return click.customId;
}

async function createPaginator(interaction, msg, data, headerText) {
  let page = 1;
  const total = Math.ceil(data.length / 10);

  const getPage = (p) => ({
    content: headerText,
    embeds: [embed({
      title: 'Upcoming Anime',
      fields: data.slice((p - 1) * 10, p * 10).map(a => ({
        name: a.english || a.route || a.title || a._fallbackTitle || 'Unknown',
        value: a.episodeDate 
          ? `**Ep ${a.episodeNumber ?? '?'}** — <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f> (<t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:R>)`
          : 'Date TBA',
      })),
      footer: `Page ${p}/${total} • ${data.length} total`,
    })],
    components: total > 1 ? [ui.pagination(p, total)] : [],
  });

  await (interaction.replied ? interaction.editReply(getPage(page)) : interaction.editReply(getPage(page)));

  if (total <= 1) return;

  const col = msg.createMessageComponentCollector({ time: 120_000 });
  col.on('collect', i => {
    page += i.customId === 'prev' ? -1 : 1;
    i.update(getPage(page));
  });
  col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
}
