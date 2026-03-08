const { getDailySchedule } = require('../../utils/API-services');
const { embed, ui } = require('../../functions/ui');

module.exports = {
  disabled: false,
  devOnly: true,
  name: 'upcoming',
  aliases: ['schedule'],

  async execute(message) {
    try {
      const [dayInput, typeInput] = message.content.split(/\s+/).slice(1);
      const day = dayInput?.toLowerCase();
      const airType = typeInput?.toLowerCase() || 'sub';

      const days = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
      if (!days.includes(day)) return message.reply(`Usage: \`!upcoming <day> [type]\`\n**Days:** ${days.join(', ')}`);

      const animeData = await getDailySchedule(day, airType);
      if (!animeData?.length) return message.reply(`No episodes found for **${day}** (${airType}).`);

      let page = 1;
      const total = Math.ceil(animeData.length / 10);

      const getPageContent = (p) => {
        const start = (p - 1) * 10;
        const fields = animeData.slice(start, start + 10).map(a => ({
          name: a.english || a.title,
          value: `**Ep ${a.episodeNumber}** - <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f>`
        }));

        return {
          embeds: [embed({
            title: `Upcoming Anime (${day.toUpperCase()})`,
            fields,
            footer: `Page ${p}/${total} • ${airType.toUpperCase()}`
          })],
          components: total > 1 ? [ui.pagination(p, total)] : []
        };
      };

      const sentMessage = await message.reply(getPageContent(page));
      if (total <= 1) return;

      // Collector for buttons
      const filter = (i) => i.user.id === message.author.id;
      const collector = sentMessage.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async (i) => {
        i.customId === 'prev' ? page-- : page++;
        await i.update(getPageContent(page));
      });

      collector.on('end', () => {
        sentMessage.edit({ components: [] }).catch(() => null);
      });
    } catch (error) {
      console.error('Error in upcoming command:', error);
      return message.reply('An error occurred while executing this command. Please try again later.').catch(() => {});
    }
  },
};
