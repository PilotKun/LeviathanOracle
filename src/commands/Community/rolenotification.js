const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const db = require('../../schemas/db');
const { searchAnimeAniList, getAnimeByAniListId } = require('../../utils/API-services');
const { bestMatch } = require('../../utils/fuzzy');
const scheduler = require('../../functions/notificationScheduler');
const { embed } = require('../../functions/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolenotification')
    .setDescription('Manage role-based anime notifications')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => s.setName('add').setDescription('Add notification').addRoleOption(o => o.setName('role').setDescription('Role to notify').setRequired(true)).addStringOption(o => o.setName('anime').setDescription('Anime to track').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove notification').addRoleOption(o => o.setName('role').setDescription('Role to remove from').setRequired(true)).addStringOption(o => o.setName('anime').setDescription('Anime to stop tracking').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List notifications').addRoleOption(o => o.setName('role').setDescription('Filter by role'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(), gid = interaction.guild.id;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (sub === 'add') {
        const role = interaction.options.getRole('role'), input = interaction.options.getString('anime');
        const res = await (/^\d+$/.test(input) ? getAnimeByAniListId(input) : searchAnimeAniList(input));
        const a = Array.isArray(res) ? res[0] : res;

        if (!a) return interaction.editReply('Anime not found.');
        const title = a.title.english || a.title.romaji, air = a.nextAiringEpisode?.airingAt * 1000 || null;

        const { rowCount } = await db.query('SELECT 1 FROM role_notifications WHERE role_id = $1 AND anime_title = $2', [role.id, title]);
        if (rowCount) return interaction.editReply('This role is already subscribed.');

        await db.query('INSERT INTO role_notifications (role_id, guild_id, anime_title) VALUES ($1, $2, $3)', [role.id, gid, title]);

        if (air) {
          await db.query('INSERT INTO schedules (anime_id, anime_title, next_airing_at) VALUES ($1, $2, $3) ON CONFLICT (anime_id) DO UPDATE SET next_airing_at = EXCLUDED.next_airing_at, anime_title = EXCLUDED.anime_title', [a.id, title, air]);
          scheduler.schedule({ anime_id: a.id, anime_title: title, next_airing_at: air });
        }
        return interaction.editReply({ embeds: [embed({ title: 'Added', desc: `${role} → **${title}**`, color: 'Green' })] });
      }

      if (sub === 'remove') {
        const role = interaction.options.getRole('role'), query = interaction.options.getString('anime').toLowerCase();
        const { rows } = await db.query('SELECT * FROM role_notifications WHERE role_id = $1 AND guild_id = $2 AND LOWER(anime_title) LIKE $3', [role.id, gid, `%${query}%`]);
        
        if (!rows.length) return interaction.editReply('No matching notification found.');
        const match = rows[0];
        await db.query('DELETE FROM role_notifications WHERE id = $1', [match.id]);

        const { rowCount: wc } = await db.query('SELECT 1 FROM watchlists WHERE anime_title = $1', [match.anime_title]);
        const { rowCount: rc } = await db.query('SELECT 1 FROM role_notifications WHERE anime_title = $1', [match.anime_title]);
        if (!wc && !rc) {
          const { rows: sched } = await db.query('SELECT anime_id FROM schedules WHERE anime_title = $1', [match.anime_title]);
          if (sched[0]) {
            await db.query('DELETE FROM schedules WHERE anime_id = $1', [sched[0].anime_id]);
            scheduler.cancel(sched[0].anime_id);
          }
        }
        return interaction.editReply({ embeds: [embed({ title: 'Removed', desc: `Stopped notifications for **${match.anime_title}**`, color: 'Green' })] });
      }

      const role = interaction.options.getRole('role');
      const { rows } = await db.query(`SELECT * FROM role_notifications WHERE guild_id = $1 ${role ? 'AND role_id = $2' : ''} ORDER BY id DESC`, role ? [gid, role.id] : [gid]);
      if (!rows.length) return interaction.editReply('No notifications found.');

      const list = rows.map((r, i) => `${i + 1}. <@&${r.role_id}> → **${r.anime_title}**`).join('\n');
      interaction.editReply({ embeds: [embed({ title: role ? `Notifications: ${role.name}` : 'Role Notifications', desc: list, color: 0x0099ff })] });

    } catch (e) {
      console.error(e);
      interaction.editReply('Command error.');
    }
  },

  async autocomplete(interaction) {
    const val = interaction.options.getFocused();
    if (!val) return interaction.respond([]);
    const res = await searchAnimeAniList(val);
    const results = res || [];
    const ranked = bestMatch(val, results, a => [a.title?.english, a.title?.romaji, a.title?.native]);
    const out = (ranked.length ? ranked : results)
      .slice(0, 25)
      .map(a => ({ name: (a.title.english || a.title.romaji).slice(0, 100), value: String(a.id) }));
    interaction.respond(out);
  }
};
