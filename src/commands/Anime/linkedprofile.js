const { SlashCommandBuilder, ButtonStyle, MessageFlags, InteractionContextType } = require('discord.js');
const { getMALUser, getMALUserStats, getAniListUser } = require('../../utils/API-services');
const db = require('../../schemas/db');
const { embed, ui } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('linkedprofile')
    .setDescription('View your linked profile(s)')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),

  async execute(interaction) {
    try {
      const { rows } = await db.query('SELECT * FROM user_profiles WHERE user_id = $1', [interaction.user.id]);
      if (!rows.length) return interaction.reply({ content: 'No profiles linked.', flags: MessageFlags.Ephemeral });

      const { mal_username: mal, anilist_username: ani } = rows[0];

      const fetchers = {
        mal: async () => {
          const [u, s] = await Promise.all([getMALUser(mal), getMALUserStats(mal)]);
          if (!u) return 'Failed to fetch MAL profile.';
          return embed({
            title: `${u.username}'s MAL`, url: u.url, thumbnail: u.images.jpg.image_url, color: 0x2e51a2,
            fields: [
              { name: 'Anime', value: `Entries: ${s.anime.total_entries}\nScore: ${s.anime.mean_score}\nDays: ${s.anime.days_watched}`, inline: true },
              { name: 'Manga', value: `Entries: ${s.manga.total_entries}\nScore: ${s.manga.mean_score}`, inline: true }
            ]
          });
        },
        ani: async () => {
          const u = await getAniListUser(ani);
          if (!u) return 'Failed to fetch AniList.';
          return embed({
            title: `${u.name}'s AniList`, url: `https://anilist.co/user/${u.name}`, thumbnail: u.avatar.large, color: 0x02a9ff,
            fields: [
              { name: 'Anime', value: `Count: ${u.statistics.anime.count}\nScore: ${u.statistics.anime.meanScore}\nDays: ${(u.statistics.anime.minutesWatched / 1440).toFixed(1)}`, inline: true },
              { name: 'Manga', value: `Count: ${u.statistics.manga.count}\nChapters: ${u.statistics.manga.chaptersRead}`, inline: true }
            ]
          });
        }
      };

      // Handle dual-profile selection
      if (mal && ani) {
        const row = ui.row([
          { id: 'mal', label: 'MyAnimeList', style: ButtonStyle.Primary },
          { id: 'ani', label: 'AniList', style: ButtonStyle.Primary }
        ]);

        const msg = await interaction.reply({ content: 'Choose a profile:', components: [row], flags: MessageFlags.Ephemeral, fetchReply: true });
        
        const i = await msg.awaitMessageComponent({ 
          filter: (i) => i.user.id === interaction.user.id, 
          time: 30000 
        }).catch(() => null);

        if (!i) return interaction.editReply({ content: 'Timed out.', components: [] });
        
        const res = await fetchers[i.customId]();
        return i.update({ content: typeof res === 'string' ? res : null, embeds: typeof res === 'object' ? [res] : [], components: [] });
      }

      // Handle single profile
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await fetchers[mal ? 'mal' : 'ani']();
      return interaction.editReply({ 
        embeds: typeof res === 'object' ? [res] : [], 
        content: typeof res === 'string' ? res : null 
      });

    } catch (error) {
      console.error('Error:', error);
      const err = { content: 'An error occurred. Try again later.', flags: MessageFlags.Ephemeral };
      interaction.deferred || interaction.replied ? await interaction.editReply(err) : await interaction.reply(err);
    }
  }
};
