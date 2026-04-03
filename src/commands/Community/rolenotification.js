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
    .addSubcommand(s => s.setName('add').setDescription('Add notification').addRoleOption(o => o.setName('role').setRequired(true).setDescription('Role')).addStringOption(o => o.setName('anime').setRequired(true).setAutocomplete(true).setDescription('Anime')))
    .addSubcommand(s => s.setName('remove').setDescription('Remove notification').addRoleOption(o => o.setName('role').setRequired(true).setDescription('Role')).addStringOption(o => o.setName('anime').setRequired(true).setDescription('Anime title')))
    .addSubcommand(s => s.setName('list').setDescription('List notifications').addRoleOption(o => o.setName('role').setDescription('Filter by role'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(), gid = interaction.guild.id;
    const role = interaction.options.getRole('role'), input = interaction.options.getString('anime');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const actions = {
      add: async () => {
        const res = await (/^\d+$/.test(input) ? getAnimeByAniListId(input) : searchAnimeAniList(input));
        const a = Array.isArray(res) ? res[0] : res;
        if (!a) return 'Anime not found.';

        const title = a.title.english || a.title.romaji, air = a.nextAiringEpisode?.airingAt * 1000;
        const { rowCount } = await db.query('SELECT 1 FROM role_notifications WHERE role_id = $1 AND anime_title = $2', [role.id, title]);
        if (rowCount) return 'Already subscribed.';

        await db.query('INSERT INTO role_notifications (role_id, guild_id, anime_title) VALUES ($1, $2, $3)', [role.id, gid, title]);
        if (air) {
          await db.query('INSERT INTO schedules (anime_id, anime_title, next_airing_at) VALUES ($1, $2, $3) ON CONFLICT (anime_id) DO UPDATE SET next_airing_at = $3', [a.id, title, air]);
          scheduler.schedule({ anime_id: a.id, anime_title: title, next_airing_at: air });
        }
        return { title: 'Added', desc: `${role} → **${title}**`, color: 'Green' };
      },

      remove: async () => {
        const { rows } = await db.query('SELECT * FROM role_notifications WHERE role_id = $1 AND guild_id = $2', [role.id, gid]);
        const match = rows.find(r => r.anime_title.toLowerCase().includes(input.toLowerCase()));
        if (!match) return 'No notification found.';

        await db.query('DELETE FROM role_notifications WHERE id = $1', [match.id]);
        
        // Cleanup if no one else is watching this anime
        const { rowCount: watchers } = await db.query('SELECT 1 FROM role_notifications WHERE anime_title = $1 UNION SELECT 1 FROM watchlists WHERE anime_title = $1', [match.anime_title]);
        if (!watchers) {
          const { rows: s } = await db.query('DELETE FROM schedules WHERE anime_title = $1 RETURNING anime_id', [match.anime_title]);
          if (s[0]) scheduler.cancel(s[0].anime_id);
        }
        return { title: 'Removed', desc: `Stopped tracking **${match.anime_title}**`, color: 'Green' };
      },

      list: async () => {
        const { rows } = await db.query(`SELECT * FROM role_notifications WHERE guild_id = $1 ${role ? 'AND role_id = $2' : ''} ORDER BY id DESC`, role ? [gid, role.id] : [gid]);
        if (!rows.length) return 'No notifications found.';
        return { title: role ? `Roles: ${role.name}` : 'Notifications', desc: rows.map((r, i) => `${i + 1}. <@&${r.role_id}> → **${r.anime_title}**`).join('\n'), color: 0x0099ff };
      }
    };

    try {
      const res = await actions[sub]();
      interaction.editReply(typeof res === 'string' ? res : { embeds: [embed(res)] });
    } catch (e) {
      console.error(e);
      interaction.editReply('Command error.');
    }
  },

  async autocomplete(interaction) {
    const val = interaction.options.getFocused();
    if (!val) return interaction.respond([]);
    const res = await searchAnimeAniList(val) || [];
    const ranked = bestMatch(val, res, a => [a.title?.english, a.title?.romaji]).slice(0, 25);
    interaction.respond(ranked.map(a => ({ name: (a.title.english || a.title.romaji).slice(0, 100), value: String(a.id) })));
  }
};
