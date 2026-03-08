const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { fetchRSSFeedWithRetries, filterEnglishAnimeItems } = require('../../utils/nyaaRSS');
const { embed } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nyaa')
    .setDescription('Search for English-translated anime on Nyaa')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addStringOption(o => o.setName('query').setDescription('Search term').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const query = interaction.options.getString('query');

    try {
      const url = `https://nyaa.si/?page=rss&f=0&c=0_0&q=${encodeURIComponent(query)}`;
      const items = filterEnglishAnimeItems((await fetchRSSFeedWithRetries(url)).items);

      if (!items.length) return interaction.editReply(`No results found for "${query}".`);

      const fields = items.slice(0, 10).map((item, i) => ({ name: `${i + 1}. ${item.title}`, value: item.link }));
      await interaction.editReply({ embeds: [embed({ title: `Results: ${query}`, fields, color: 0x0099ff })] });
    } catch (e) {
      console.error(e);
      const err = { content: 'Search failed.', flags: MessageFlags.Ephemeral };
      interaction.replied || interaction.deferred ? await interaction.editReply(err) : await interaction.reply(err);
    }
  }
};
