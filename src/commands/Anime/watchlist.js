const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, InteractionContextType } = require('discord.js');
const db = require('../../schemas/db');
const converters = require('../../utils/watchlist-converters');
const { searchAnimeAniList, getAnimeByAniListId, getAnimeByMalId } = require('../../utils/API-services');
const { bestMatch } = require('../../utils/fuzzy');
const scheduler = require('../../functions/notificationScheduler');
const { embed } = require('../../functions/ui');
const axios = require('axios');

const reply = (i, title, desc, color) => i.editReply({ embeds: [embed({ title, desc, color })] });

async function insertAnime(userId, username, anime, fallback) {
  const title = anime?.title?.english || anime?.title?.romaji || fallback;
  if (!title) return false;

  const { rowCount } = await db.query('SELECT 1 FROM watchlists WHERE user_id = $1 AND anime_title = $2', [userId, title]);
  if (rowCount) return false;

  await db.query('INSERT INTO watchlists (user_id, discord_username, anime_title, anime_id) VALUES ($1, $2, $3, $4)', [userId, username, title, anime?.id || null]);
  
  const air = anime?.nextAiringEpisode?.airingAt * 1000;
  if (air) {
    await db.query('INSERT INTO schedules (anime_id, anime_title, next_airing_at) VALUES ($1, $2, $3) ON CONFLICT (anime_id) DO UPDATE SET next_airing_at = EXCLUDED.next_airing_at', [anime.id, title, air]);
    scheduler.schedule({ anime_id: anime.id, anime_title: title, next_airing_at: air });
  }
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Manage your anime watchlist')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand(s => s.setName('add').setDescription('Add anime').addStringOption(o => o.setName('title').setRequired(true).setAutocomplete(true).setDescription('Anime title')))
    .addSubcommand(s => s.setName('remove').setDescription('Remove anime').addStringOption(o => o.setName('title').setRequired(true).setDescription('Anime title')))
    .addSubcommand(s => s.setName('view').setDescription('View a watchlist').addUserOption(o => o.setName('user').setDescription('Target user')))
    .addSubcommand(s => s.setName('export').setDescription('Export list').addStringOption(o => o.setName('format').setRequired(true).addChoices({ name: 'MAL (XML)', value: 'mal' }, { name: 'AniList (JSON)', value: 'anilist' }).setDescription('Format')))
    .addSubcommand(s => s.setName('import').setDescription('Import list').addStringOption(o => o.setName('format').setRequired(true).addChoices({ name: 'MAL (XML)', value: 'mal' }, { name: 'AniList (JSON)', value: 'anilist' }).setDescription('Format')).addAttachmentOption(o => o.setName('file').setRequired(true).setDescription('Exported file'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(), { id: uid, username: unm } = interaction.user;
    const input = interaction.options.getString('title');

    const actions = {
      add: async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const data = /^\d+$/.test(input) ? await getAnimeByAniListId(input) : await searchAnimeAniList(input);
        const a = Array.isArray(data) ? data[0] : data;
        if (!a) return reply(interaction, 'Not Found', 'Anime not found.', 'Red');
        
        return (await insertAnime(uid, unm, a)) 
          ? reply(interaction, 'Added', `**${a.title.english || a.title.romaji}** added!`, 'Green')
          : reply(interaction, 'Duplicate', 'Already in your list.', 'Yellow');
      },
      remove: async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { rows } = await db.query('SELECT * FROM watchlists WHERE user_id = $1', [uid]);
        const match = bestMatch(input.toLowerCase(), rows, r => [r.anime_title])[0];
        if (!match) return reply(interaction, 'Not Found', 'No match found.', 'Yellow');

        await db.query('DELETE FROM watchlists WHERE id = $1', [match.id]);
        const { rowCount: total } = await db.query('SELECT 1 FROM watchlists WHERE anime_title = $1 UNION SELECT 1 FROM role_notifications WHERE anime_title = $1', [match.anime_title]);
        if (!total) {
          const { rows: s } = await db.query('DELETE FROM schedules WHERE anime_title = $1 RETURNING anime_id', [match.anime_title]);
          if (s[0]) scheduler.cancel(s[0].anime_id); // Safety fix: Added [0]
        }
        return reply(interaction, 'Removed', `**${match.anime_title}** removed.`, 'Green');
      },
      view: async () => {
        const target = interaction.options.getUser('user') || interaction.user;
        const isSelf = target.id === uid;
        await interaction.deferReply({ flags: isSelf ? MessageFlags.Ephemeral : 0 });

        if (!isSelf) {
          const { rows } = await db.query('SELECT watchlist_visibility FROM user_preferences WHERE user_id = $1', [target.id]);
          if ((rows[0]?.watchlist_visibility || 'private') === 'private') return reply(interaction, 'Private', 'This watchlist is private.', 'Yellow'); // Safety fix: Added ?.
        }
        const { rows: items } = await db.query('SELECT anime_title FROM watchlists WHERE user_id = $1', [target.id]);
        return reply(interaction, `${target.username}'s Watchlist`, items.map((r, i) => `${i + 1}. **${r.anime_title}**`).join('\n') || 'Empty.');
      },
      export: async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const format = interaction.options.getString('format');
        const { rows } = await db.query('SELECT anime_title, anime_id FROM watchlists WHERE user_id = $1', [uid]);
        
        if (!rows.length) return reply(interaction, 'Empty', 'Nothing to export.', 'Yellow');

        const content = format === 'mal' ? converters.toMalXML(rows) : converters.toAniListJSON(rows);
        return interaction.editReply({ 
          files: [new AttachmentBuilder(Buffer.from(content), { name: `watchlist-${format}.${format === 'mal' ? 'xml' : 'json'}` })] 
        });
      },
      import: async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const format = interaction.options.getString('format'), file = interaction.options.getAttachment('file');
        const { data: raw } = await axios.get(file.url, { responseType: 'text' });
        
        const entries = converters.parseImport(format, raw);
        if (!entries) return reply(interaction, 'Error', 'Invalid file format.', 'Red');

        let imp = 0, skp = 0;
        for (const e of entries) {
          const anime = e.type === 'mal' ? await getAnimeByMalId(e.id) : await getAnimeByAniListId(e.id);
          (await insertAnime(uid, unm, anime, e.title || `Imported#${e.id}`)) ? imp++ : skp++;
        }
        return reply(interaction, 'Import Complete', `Imported: ${imp}\nSkipped: ${skp}`, 'Green');
      }
    };
    try { await actions[sub](); } 
    catch (e) { 
      console.error(e); 
      (interaction.deferred || interaction.replied) ? interaction.editReply('Error.') : interaction.reply({ content: 'Error.', flags: MessageFlags.Ephemeral }); 
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
