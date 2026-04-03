const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily-schedule')
    .setDescription('Configure automatic daily anime schedule posting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('enable').setDescription('Enable posting').addChannelOption(o => o.setName('channel').setDescription('Target channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand(s => s.setName('disable').setDescription('Disable posting'))
    .addSubcommand(s => s.setName('status').setDescription('View current settings')),

  userPermissions: ['ManageGuild'],

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'Servers only.', flags: MessageFlags.Ephemeral });
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = interaction.guild.id;

    const actions = {
      enable: async () => {
        const channel = interaction.options.getChannel('channel');
        await updateDb(guildId, channel.id, true);
        return { title: 'Daily Schedule Enabled', desc: `Posting in <#${channel.id}> daily.`, color: 0x00FF00 };
      },
      disable: async () => {
        await updateDb(guildId, null, false);
        return { title: 'Daily Schedule Disabled', desc: 'Posting has been disabled.', color: 0xFF0000 };
      },
      status: async () => {
        const { rows: [cfg] } = await db.query('SELECT daily_schedule_channel_id as cid, daily_schedule_enabled as enabled FROM guild_settings WHERE guild_id = $1', [guildId]);
        const isActive = cfg?.enabled === 'true' || cfg?.enabled === true;
        return {
          title: 'Daily Schedule Status',
          desc: isActive ? `**Enabled** — posting in <#${cfg.cid}> daily.` : 'Currently **disabled**.',
          color: isActive ? 0x0099ff : 0x808080
        };
      }
    };

    try {
      const result = await actions[interaction.options.getSubcommand()]();
      interaction.editReply({ embeds: [embed(result)] });
    } catch (e) {
      console.error(e);
      interaction.editReply('Failed to update schedule settings.');
    }
  }
};

async function updateDb(guildId, channelId, enabled) {
  return db.query(
    `INSERT INTO guild_settings (guild_id, daily_schedule_channel_id, daily_schedule_enabled, updated_at) 
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (guild_id) DO UPDATE SET daily_schedule_channel_id = $2, daily_schedule_enabled = $3, updated_at = CURRENT_TIMESTAMP`,
    [guildId, channelId, String(enabled)]
  );
}
