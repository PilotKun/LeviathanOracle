const { SlashCommandBuilder, ButtonStyle, MessageFlags, InteractionContextType } = require('discord.js');
const { getSchedule } = require('../../utils/API-services');
const { embed, ui } = require('../../functions/ui');
const { fuzzyScore } = require('../../utils/fuzzy');
const db = require('../../schemas/db');

async function getDailySchedule(day, airType = 'all') {
  const list = await getSchedule(airType);
  return (list || []).filter(a =>
    new Date(a.episodeDate).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() === day.toLowerCase()
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('upcoming')
    .setDescription('Upcoming anime episodes')
    .addStringOption(option =>
      option
        .setName('filter')
        .setDescription('Filter by: tomorrow, week, or watchlist')
        .setRequired(true)
        .addChoices(
          { name: 'Tomorrow', value: 'tomorrow' },
          { name: 'This Week', value: 'week' },
          { name: 'Watchlist', value: 'watchlist' }
        )
    ),

  async execute(interaction) {
    const filter = interaction.options.getString('filter');

    try {
      const msg = await interaction.deferReply();

      if (filter === 'tomorrow') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayName = tomorrow.toLocaleDateString('en-US', { weekday: 'long' });

        const data = await getDailySchedule(dayName);
        
        if (!data?.length) {
          await interaction.editReply({ content: 'No episodes found for tomorrow.' });
          return;
        }

        let page = 1, total = Math.ceil(data.length / 10);
        const getPage = () => ({
          content: `Schedule: **${dayName}** (Tomorrow)`,
          embeds: [embed({ 
            title: 'Upcoming Anime', 
            fields: data.slice((page - 1) * 10, page * 10).map(a => ({ name: a.english || a.title, value: `**Ep ${a.episodeNumber}** - <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f>` })),
            footer: `Page ${page}/${total}` 
          })],
          components: [ui.pagination(page, total)]
        });

        await interaction.editReply(getPage());
        const col = msg.createMessageComponentCollector({ time: 120000 });
        col.on('collect', i => { page += i.customId === 'prev' ? -1 : 1; i.update(getPage()); });
        col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
        return;
      } else if (filter === 'week') {
        // Retain the current functionality for week
        const days = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const rows = [
          ui.row(days.slice(0, 4).map(d => ({ id: d, label: d, style: ButtonStyle.Primary }))), 
          ui.row(days.slice(4).map(d => ({ id: d, label: d, style: ButtonStyle.Primary })))
        ];

        await interaction.editReply({ content: 'Select a day:', components: rows });
        const dClick = await msg.awaitMessageComponent({ time: 30000 }).catch(() => null);
        if (!dClick) return interaction.editReply({ content: 'Timed out.', components: [] });

        await dClick.update({ content: `Day: **${dClick.customId}**. Type:`, components: [ui.row(['Sub', 'Dub', 'Raw'].map(t => ({ id: t, label: t, style: ButtonStyle.Secondary })))] });
        const tClick = await msg.awaitMessageComponent({ time: 30000 }).catch(() => null);
        if (!tClick) return interaction.editReply({ content: 'Timed out.', components: [] });

        const data = await getDailySchedule(dClick.customId, tClick.customId);
        if (!data?.length) return tClick.update({ content: 'No episodes found.', components: [] });

        let page = 1, total = Math.ceil(data.length / 10);
        const getPage = () => ({
          content: `Schedule: **${dClick.customId}** (${tClick.customId})`,
          embeds: [embed({ 
            title: 'Upcoming Anime', 
            fields: data.slice((page - 1) * 10, page * 10).map(a => ({ name: a.english || a.title, value: `**Ep ${a.episodeNumber}** - <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f>` })),
            footer: `Page ${page}/${total}` 
          })],
          components: [ui.pagination(page, total)]
        });

        await tClick.update(getPage());
        const col = msg.createMessageComponentCollector({ time: 120000 });
        col.on('collect', i => { page += i.customId === 'prev' ? -1 : 1; i.update(getPage()); });
        col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
      } else if (filter === 'watchlist') {
        const userId = interaction.user.id;
        const { rows: watchlist } = await db.query('SELECT anime_title FROM watchlists WHERE user_id = $1', [userId]);
        if (!watchlist?.length) {
          return interaction.editReply({ content: 'Your watchlist is empty.' });
        }

        const titles = watchlist.map(r => r.anime_title);
        const list = await getSchedule('sub');
        const filtered = (list || []).filter(a => {
          const schedTitles = [a.english, a.title, a.romaji].filter(Boolean);
          return titles.some(wt => schedTitles.some(st => fuzzyScore(wt, st) >= 0.8));
        });
        if (!filtered?.length) {
          return interaction.editReply({ content: 'No upcoming episodes found for your watchlist.' });
        }

        let page = 1, total = Math.ceil(filtered.length / 10);
        const getPage = () => ({
          content: 'Anime from your watchlist:',
          embeds: [embed({
            title: 'Your Watchlist',
            fields: filtered.slice((page - 1) * 10, page * 10).map(a => ({
              name: a.english || a.title,
              value: `**Ep ${a.episodeNumber}** - <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f>`
            })),
            footer: `Page ${page}/${total}`
          })],
          components: [ui.pagination(page, total)]
        });

        await interaction.editReply(getPage());
        const col = msg.createMessageComponentCollector({ time: 120000 });
        col.on('collect', i => { page += i.customId === 'prev' ? -1 : 1; i.update(getPage()); });
        col.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
      }
    } catch (e) {
      console.error(e);
      const err = { content: 'Error fetching schedule.', flags: MessageFlags.Ephemeral };
      interaction.deferred ? interaction.editReply(err) : interaction.reply(err);
    }
  }
};