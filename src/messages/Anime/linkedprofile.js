const { getMALUser, getMALUserStats, getAniListUser } = require('../../utils/API-services');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');

module.exports = {
  disabled: false,
  devOnly: true,
  name: 'linkedprofile',
  description: 'View your linked profile(s)',
  aliases: ['linked', 'myprofiles'],

  async execute(message) {
    try {
      const discordId = message.author.id;

      const result = await db.query(
        'SELECT * FROM user_profiles WHERE user_id = $1',
        [discordId]
      );

      if (result.rows.length === 0) {
        return message.reply('You have not linked any profiles yet. Use `!linkprofile <mal|anilist> <username>` to link.');
      }

      const row = result.rows[0];
      const malUsername = row.mal_username;
      const anilistUsername = row.anilist_username;

      if (malUsername && !anilistUsername) {
        const [userData, statsData] = await Promise.all([getMALUser(malUsername), getMALUserStats(malUsername)]);
        if (!userData) return message.reply('Failed to fetch MAL profile.');

        return message.reply({ embeds: [embed({
          title: `${userData.username}'s MyAnimeList Profile`,
          url: `https://myanimelist.net/profile/${userData.username}`,
          thumbnail: userData.images.jpg.image_url,
          fields: [
            { name: 'Anime Stats', value: `**Total Entries:** ${statsData.anime.total_entries || 'N/A'}\n**Mean Score:** ${statsData.anime.mean_score || 'N/A'}\n**Days Watched:** ${statsData.anime.days_watched || 'N/A'}`, inline: true },
            { name: 'Manga Stats', value: `**Total Entries:** ${statsData.manga.total_entries || 'N/A'}\n**Mean Score:** ${statsData.manga.mean_score || 'N/A'}\n**Days Read:** ${statsData.manga.days_read || 'N/A'}`, inline: true }
          ],
          color: 0x2e51a2
        })] });
      } else if (anilistUsername && !malUsername) {
        const userData = await getAniListUser(anilistUsername);
        if (!userData) return message.reply('Failed to fetch AniList profile.');
        
        const daysWatched = (userData.statistics.anime.minutesWatched / 1440).toFixed(1);
        return message.reply({ embeds: [embed({
          title: `${userData.name}'s AniList Profile`,
          url: `https://anilist.co/user/${userData.name}`,
          thumbnail: userData.avatar.large,
          fields: [
            { name: 'Anime Stats', value: `**Total Anime:** ${userData.statistics.anime.count}\n**Mean Score:** ${userData.statistics.anime.meanScore}\n**Days Watched:** ${daysWatched}`, inline: true },
            { name: 'Manga Stats', value: `**Total Manga:** ${userData.statistics.manga.count}\n**Chapters Read:** ${userData.statistics.manga.chaptersRead}\n**Volumes Read:** ${userData.statistics.manga.volumesRead}`, inline: true }
          ],
          color: 0x2e51a2
        })] });
      } else if (malUsername && anilistUsername) {
        return message.reply(`You have both profiles linked!\n**MyAnimeList:** ${malUsername}\n**AniList:** ${anilistUsername}\n\nUse \`!search-profile-mal ${malUsername}\` or \`!search-profile-anilist ${anilistUsername}\` to view them.`);
      }
    } catch (error) {
      console.error('Error in linkedprofile command:', error);
      return message.reply('An error occurred while executing this command. Please try again later.').catch(() => {});
    }
  },
};
