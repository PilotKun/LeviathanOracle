const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');
const { getDailySchedule } = require('../../utils/API-services');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily-schedule')
    .setDescription('Configure automatic daily anime schedule posting')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('enable')
      .setDescription('Enable automatic daily schedule posting')
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Channel to post the schedule in')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)))
    .addSubcommand(s => s.setName('disable').setDescription('Disable automatic daily schedule posting'))
    .addSubcommand(s => s.setName('status').setDescription('View current daily schedule settings'))
    .addSubcommand(s => s.setName('preview').setDescription("Preview today's schedule")),

  async execute(interaction) {
    const { guild, options } = interaction;
    if (!guild) return interaction.reply({ content: 'Servers only.', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sub = options.getSubcommand();

    try {
      let response;

      switch (sub) {
        case 'enable':
          const channel = options.getChannel('channel');
          await updateSettings(guild.id, { daily_schedule_channel_id: channel.id, daily_schedule_enabled: true });
          response = {
            title: '✅ Daily Schedule Enabled',
            desc: `Posting in <#${channel.id}> daily at **05:00 UTC**.`,
            color: 0x00FF00,
          };
          break;

        case 'disable':
          await updateSettings(guild.id, { daily_schedule_enabled: false });
          response = { title: '🔕 Daily Schedule Disabled', color: 0xFF4444 };
          break;

        case 'status':
          const cfg = await getSettings(guild.id);
          const active = isEnabledValue(cfg?.enabled);
          response = {
            title: 'Daily Schedule Status',
            desc: active ? `**Enabled** in <#${cfg.cid}>.` : 'Currently **disabled**.',
            color: active ? 0x0099ff : 0x808080,
          };
          break;

        case 'preview':
          const previewEmbed = await buildDailyEmbed();
          return interaction.editReply({ 
            embeds: [previewEmbed || embed({ title: 'No Schedule', desc: 'Nothing airing today.', color: 0x808080 })] 
          });
      }

      await interaction.editReply({ embeds: [embed(response)] });
    } catch (err) {
      t.error('Command failed', err);
      await interaction.editReply({ content: 'An error occurred while updating settings.' });
    }
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function updateSettings(guildId, { daily_schedule_channel_id: cid, daily_schedule_enabled: enabled }) {
  const enabledValue = enabled ? 'true' : 'false';
  const query = `
    INSERT INTO guild_settings (guild_id, daily_schedule_channel_id, daily_schedule_enabled, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (guild_id) DO UPDATE SET 
      daily_schedule_channel_id = COALESCE($2, guild_settings.daily_schedule_channel_id),
      daily_schedule_enabled = $3,
      updated_at = CURRENT_TIMESTAMP`;
  return db.query(query, [guildId, cid, enabledValue]);
}

function isEnabledValue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

async function getSettings(guildId) {
  const { rows } = await db.query(
    'SELECT daily_schedule_channel_id AS cid, daily_schedule_enabled AS enabled FROM guild_settings WHERE guild_id = $1',
    [guildId]
  );
  return rows[0];
}

async function buildDailyEmbed() {
  try {
    const todayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
    const todayData = await getDailySchedule(todayName, 'all') || [];
    todayData.sort((a, b) => new Date(a.episodeDate) - new Date(b.episodeDate));

    if (!todayData.length) return null;

    return embed({
      title: `📅 ${todayName}'s Anime Schedule`,
      desc: `**${todayData.length}** shows airing today`,
      fields: todayData.slice(0, 25).map(a => ({
        name: a.english || a.title || 'Unknown Title',
        value: `Ep ${a.episodeNumber ?? '?'} — <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:t>`,
      })),
      color: '#0099ff',
      footer: todayData.length > 25 ? `+${todayData.length - 25} more...` : null,
    });
  } catch (err) {
    console.log('buildDailyEmbed', 'Failed to fetch schedule', err);
    return null;
  }
}

module.exports.buildDailyEmbed = buildDailyEmbed;
