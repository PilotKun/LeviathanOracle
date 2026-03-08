const { SlashCommandBuilder, TextInputStyle, MessageFlags, InteractionContextType } = require('discord.js');
const { modal, embed } = require('../../functions/ui');
const { bot: { reportChannelId: chanId } } = require('../../../config.json');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a bug')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),

  async execute(interaction) {
    try {
      await interaction.showModal(modal({
        id: 'rep', title: 'Report Issue',
        inputs: [
          { id: 't', label: 'Title', style: TextInputStyle.Short, minLength: 5, required: true },
          { id: 'd', label: 'Description', style: TextInputStyle.Paragraph, minLength: 20, required: true },
          { id: 's', label: 'Steps', style: TextInputStyle.Paragraph, required: false }
        ]
      }));

      const i = await interaction.awaitModalSubmit({ filter: x => x.customId === 'rep', time: 300000 }).catch(() => null);
      if (!i) return;

      const chan = await interaction.client.channels.fetch(chanId).catch(() => null);
      if (!chan) return i.reply({ content: 'Report channel error.', flags: MessageFlags.Ephemeral });

      const [t, d, s] = ['t', 'd', 's'].map(f => i.fields.getTextInputValue(f));

      await chan.send({ embeds: [embed({
        title: '🔧 Bug Report', color: 0xff6b6b,
        fields: [
          { name: 'Title', value: t }, { name: 'Description', value: d }, { name: 'Steps', value: s || 'N/A' },
          { name: 'User', value: `${i.user.tag} (${i.user.id})`, inline: true },
          { name: 'Context', value: i.guild ? `${i.guild.name}` : 'DM', inline: true }
        ],
        footer: { text: `Sent: ${new Date().toLocaleString()}` }
      })]});

      await i.reply({ content: 'Report submitted!', flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error(e);
    }
  }
};
