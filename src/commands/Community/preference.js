const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('preference')
    .setDescription('Manage your bot preferences')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand(s => s.setName('notification').setDescription('Set notification delivery').addStringOption(o => o.setName('type').setDescription('Notification type').setRequired(true).addChoices({ name: 'DM', value: 'dm' }, { name: 'Server', value: 'server' })))
    .addSubcommand(s => s.setName('watchlist').setDescription('Set watchlist visibility').addStringOption(o => o.setName('visibility').setDescription('Visibility setting').setRequired(true).addChoices({ name: 'Private', value: 'private' }, { name: 'Public', value: 'public' })))
    .addSubcommand(s => s.setName('view').setDescription('View current preferences')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(), uid = interaction.user.id;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (sub === 'view') {
        const { rows: [p] } = await db.query('SELECT * FROM user_preferences WHERE user_id = $1', [uid]);
        const res = p || { notification_type: 'dm', watchlist_visibility: 'private' };
        return interaction.editReply({ embeds: [embed({ title: 'Preferences', color: 0x0099ff, fields: [
          { name: 'Notifications', value: res.notification_type === 'dm' ? '📩 DM' : '🔔 Server', inline: true },
          { name: 'Watchlist', value: res.watchlist_visibility === 'private' ? '🔒 Private' : '🌐 Public', inline: true }
        ]})]});
      }

      const val = interaction.options.getString(sub === 'notification' ? 'type' : 'visibility');

      if (val === 'server' && !interaction.guild)
        return interaction.editReply({ embeds: [embed({ title: 'Error', desc: 'Server notifications can only be set from within a server.', color: 0xFF0000 })] });

      const field = sub === 'notification' ? 'notification_type' : 'watchlist_visibility';
      
      await db.query(`INSERT INTO user_preferences (user_id, ${field}) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET ${field} = EXCLUDED.${field}, updated_at = CURRENT_TIMESTAMP`, [uid, val]);

      interaction.editReply({ embeds: [embed({ 
        title: 'Updated', color: 0x00FF00,
        desc: `Your **${sub}** is now **${val}**. ${val === 'server' ? '\n⚠️ Requires `/setchannel` setup.' : ''}` 
      })]});
    } catch (e) {
      console.error(e);
      interaction.editReply({ content: 'Update failed.' });
    }
  }
};
