const { SlashCommandBuilder, ButtonStyle, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const { getMALUser, getMALUserStats, getMALUserFavorites, getAnimeDetails, getMangaDetails } = require('../../utils/API-services');
const { embed, ui } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search-profile-mal')
    .setDescription('Fetch MyAnimeList user profile')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addStringOption(opt => opt.setName('username').setDescription('MAL username').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getString('username');
    await interaction.deferReply();

    try {
      const [u, s] = await Promise.all([getMALUser(user), getMALUserStats(user)]);
      if (!u) return interaction.editReply({ content: 'User not found.', flags: MessageFlags.Ephemeral });

      const row = ui.row([
        { id: 'anime', label: 'Fav Anime', style: ButtonStyle.Primary },
        { id: 'manga', label: 'Fav Manga', style: ButtonStyle.Success }
      ]);

      const msg = await interaction.editReply({
        components: [row],
        embeds: [embed({
          title: `${u.username}'s Profile`, url: u.url, thumbnail: u.images.jpg.image_url, color: 0x2e51a2,
          fields: [
            { name: 'Anime', value: `Total: ${s.anime.total_entries}\nScore: ${s.anime.mean_score}`, inline: true },
            { name: 'Manga', value: `Total: ${s.manga.total_entries}\nScore: ${s.manga.mean_score}`, inline: true }
          ]
        })]
      });

      const col = msg.createMessageComponentCollector({ time: 60000 });
      col.on('collect', async i => {
        const favs = await getMALUserFavorites(user);
        const list = favs?.[i.customId] || [];
        if (!list.length) return i.reply({ content: `No favorites found.`, flags: MessageFlags.Ephemeral });

        const menu = new StringSelectMenuBuilder().setCustomId('sel').setPlaceholder(`Select ${i.customId}`)
          .addOptions(list.slice(0, 25).map(f => ({ label: f.title.slice(0, 100), value: String(f.mal_id) })));

        const reply = await i.update({ components: [new ActionRowBuilder().addComponents(menu)], fetchReply: true });
        const sel = await reply.awaitMessageComponent({ time: 30000 }).catch(() => null);
        if (!sel) return;

        const item = i.customId === 'anime'
          ? await getAnimeDetails(sel.values[0])
          : await getMangaDetails(sel.values[0]);
        if (!item) return sel.reply({ content: 'Failed to fetch details.', flags: MessageFlags.Ephemeral });

        sel.reply({ flags: MessageFlags.Ephemeral, embeds: [embed({
          title: item.title, url: item.url, image: item.images.jpg.image_url, color: 0x2e51a2,
          fields: [
            { name: 'Score', value: `${item.score || 'N/A'}`, inline: true },
            { name: i.customId === 'anime' ? 'Episodes' : 'Volumes', value: `${item.episodes || item.volumes || 'N/A'}`, inline: true }
          ]
        })]});
      });
    } catch (e) {
      console.error(e);
      const err = { content: 'User not found or API error.', flags: MessageFlags.Ephemeral };
      interaction.deferred ? await interaction.editReply(err) : await interaction.reply(err);
    }
  }
};
