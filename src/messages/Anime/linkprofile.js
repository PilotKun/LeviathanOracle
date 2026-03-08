const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');
const { verifyMALUser, verifyAniListUser } = require('../../utils/API-services');

module.exports = {
  disabled: false,
  devOnly: true,
  name: 'linkprofile',
  description: 'Link your MAL or AniList account',
  aliases: ['link'],

  async execute(message) {
    try {
      const args = message.content.split(' ').slice(1);
      const platform = args[0]?.toLowerCase();
      const username = args.slice(1).join(' ');

      if (!platform || !['mal', 'anilist'].includes(platform)) {
        return message.reply('Usage: `!linkprofile <mal|anilist> <username>`');
      }

      if (!username) {
        return message.reply(`Please provide your ${platform === 'mal' ? 'MyAnimeList' : 'AniList'} username.`);
      }

      const discordId = message.author.id;
      const updateField = platform === 'mal' ? 'mal_username' : 'anilist_username';

      const verify = platform === 'mal' ? await verifyMALUser(username) : await verifyAniListUser(username);
      if (!verify.valid) {
        return message.reply({ embeds: [embed({ title: 'Not Found', desc: `No ${platform.toUpperCase()} account found with username **${username}**. Please check the spelling.`, color: 0xFF0000 })] });
      }

      const checkResult = await db.query(
        `SELECT user_id FROM user_profiles WHERE LOWER(${updateField}) = LOWER($1)`,
        [username]
      );

      if (checkResult.rows.length > 0 && checkResult.rows[0].user_id !== discordId) {
        return message.reply({ embeds: [embed({ title: 'Already Claimed', desc: `This ${platform.toUpperCase()} account is already linked to another user.`, color: 0xFF0000 })] });
      }

      await db.query(
        `INSERT INTO user_profiles (user_id, ${updateField}) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET ${updateField} = EXCLUDED.${updateField}`,
        [discordId, verify.username]
      );

      message.reply({ embeds: [embed({ title: 'Account Linked', desc: `${platform === 'mal' ? 'MyAnimeList' : 'AniList'} account linked: **${verify.username}**`, color: 0x00FF00 })] });
    } catch (error) {
      console.error('Error in linkprofile command:', error);
      return message.reply('An error occurred while executing this command. Please try again later.').catch(() => {});
    }
  },
};
