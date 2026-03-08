const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily-schedule')
    .setDescription('Configure automatic daily anime schedule posting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('enable')
      .setDescription('Enable daily schedule posting')
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Channel to post the daily schedule in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)))
    .addSubcommand(s => s.setName('disable').setDescription('Disable daily schedule posting'))
    .addSubcommand(s => s.setName('status').setDescription('View current daily schedule settings')),

  userPermissions: ['ManageGuild'],

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (sub === 'enable') {
        const channel = interaction.options.getChannel('channel');

        await db.query(
          `INSERT INTO guild_settings (guild_id, daily_schedule_channel_id, daily_schedule_enabled)
           VALUES ($1, $2, $3)
           ON CONFLICT (guild_id) DO UPDATE
           SET daily_schedule_channel_id = EXCLUDED.daily_schedule_channel_id,
               daily_schedule_enabled = EXCLUDED.daily_schedule_enabled,
               updated_at = CURRENT_TIMESTAMP`,
          [guildId, channel.id, 'true']
        );

        return interaction.editReply({ embeds: [embed({
          title: 'Daily Schedule Enabled',
          desc: `Daily anime schedule will be posted in <#${channel.id}> every day.`,
          color: 0x00FF00
        })] });
      }

      if (sub === 'disable') {
        await db.query(
          `INSERT INTO guild_settings (guild_id, daily_schedule_enabled)
           VALUES ($1, $2)
           ON CONFLICT (guild_id) DO UPDATE
           SET daily_schedule_enabled = EXCLUDED.daily_schedule_enabled,
               updated_at = CURRENT_TIMESTAMP`,
          [guildId, 'false']
        );

        return interaction.editReply({ embeds: [embed({
          title: 'Daily Schedule Disabled',
          desc: 'Daily anime schedule posting has been disabled.',
          color: 0xFF0000
        })] });
      }

      if (sub === 'status') {
        const { rows: [settings] } = await db.query('SELECT * FROM guild_settings WHERE guild_id = $1', [guildId]);

        if (!settings?.daily_schedule_enabled || settings.daily_schedule_enabled !== 'true') {
          return interaction.editReply({ embeds: [embed({
            title: 'Daily Schedule Status',
            desc: 'Daily schedule posting is **disabled** for this server.',
            color: 0x808080
          })] });
        }

        return interaction.editReply({ embeds: [embed({
          title: 'Daily Schedule Status',
          desc: `**Enabled** — posting in <#${settings.daily_schedule_channel_id}> daily.`,
          color: 0x0099ff
        })] });
      }
    } catch (e) {
      console.error(e);
      interaction.editReply({ content: 'Failed to update daily schedule settings.' });
    }
  }
};
