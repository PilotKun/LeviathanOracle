const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set-levelrole')
    .setDescription('Manage bot command role requirements')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('set').setDescription('Set the role').addRoleOption(o => o.setName('role').setDescription('Role required').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove requirement'))
    .addSubcommand(s => s.setName('status').setDescription('View current setting')),

  userPermissions: ['ManageGuild'],

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'Servers only.', flags: MessageFlags.Ephemeral });
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = interaction.guild.id;

    const actions = {
      set: async () => {
        const role = interaction.options.getRole('role');
        await updateDb(guildId, role.id);
        return { title: 'Level Role Set', desc: `Required: <@&${role.id}>`, color: 0x00FF00 };
      },
      remove: async () => {
        await updateDb(guildId, null);
        return { title: 'Level Role Removed', desc: 'Requirement cleared.', color: 0xFF0000 };
      },
      status: async () => {
        const { rows } = await db.query('SELECT level_role_id FROM guild_settings WHERE guild_id = $1', [guildId]);
        const id = rows[0]?.level_role_id;
        return { 
          title: 'Level Role Status', 
          desc: id ? `Required: <@&${id}>` : 'No role requirement set.', 
          color: id ? 0x0099ff : 0x808080 
        };
      }
    };

    try {
      const result = await actions[interaction.options.getSubcommand()]();
      interaction.editReply({ embeds: [embed(result)] });
    } catch (e) {
      console.error(e);
      interaction.editReply('Failed to update settings.');
    }
  }
};

async function updateDb(guildId, roleId) {
  return db.query(
    `INSERT INTO guild_settings (guild_id, level_role_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (guild_id) DO UPDATE SET level_role_id = $2, updated_at = CURRENT_TIMESTAMP`,
    [guildId, roleId]
  );
}
