const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');
const { verifyMALUser, verifyAniListUser } = require('../../utils/API-services');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('linkprofile')
    .setDescription('Link your MAL or AniList account')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand(s => s.setName('mal').setDescription('Link MAL').addStringOption(o => o.setName('username').setRequired(true).setDescription('MAL username')))
    .addSubcommand(s => s.setName('anilist').setDescription('Link AniList').addStringOption(o => o.setName('username').setRequired(true).setDescription('AniList username'))),

  async execute(interaction) {
    const type = interaction.options.getSubcommand(), name = interaction.options.getString('username');
    const field = `${type}_username`;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const verify = type === 'mal' ? await verifyMALUser(name) : await verifyAniListUser(name);
      if (!verify.valid)
        return interaction.editReply({ embeds: [embed({ title: 'Not Found', desc: `No ${type.toUpperCase()} account found with username **${name}**. Please check the spelling.`, color: 0xFF0000 })] });

      const { rows } = await db.query(`SELECT user_id FROM user_profiles WHERE LOWER(${field}) = LOWER($1)`, [name]);
      if (rows[0] && rows[0].user_id !== interaction.user.id)
        return interaction.editReply({ embeds: [embed({ title: 'Already Claimed', desc: `This ${type.toUpperCase()} account is already linked to another user.`, color: 0xFF0000 })] });

      await db.query(`INSERT INTO user_profiles (user_id, ${field}) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET ${field} = EXCLUDED.${field}`, [interaction.user.id, verify.username]);

      interaction.editReply({ embeds: [embed({ title: 'Success', desc: `Linked ${type.toUpperCase()}: **${verify.username}**`, color: 0x00FF00 })] });
    } catch (e) {
      console.error(e);
      interaction.editReply({ content: 'Error linking profile.' });
    }
  }
};
