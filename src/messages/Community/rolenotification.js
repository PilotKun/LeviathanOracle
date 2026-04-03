const db = require('../../schemas/db');
const { searchAnimeAniList, getAnimeByAniListId } = require('../../utils/API-services');
const scheduler = require('../../functions/notificationScheduler');
const { embed } = require('../../functions/ui');

module.exports = {
    name: 'rolenotification',
    aliases: ['rolenoti', 'rn'],
    devOnly: true,
    async execute(message) {
        const [sub, ...args] = message.content.split(/\s+/).slice(1);
        const roleId = message.content.match(/<@&(\d+)>/)?.[1];
        const guildId = message.guild.id;

        const reply = (title, desc, color = 'Red') => message.reply({ embeds: [embed({ title, desc, color })] });

        const actions = {
            add: async () => {
                const query = args.slice(1).join(' ');
                if (!roleId || !query) return message.reply('Usage: `!rn add <@role> <anime>`');

                const data = /^\d+$/.test(query) ? await getAnimeByAniListId(query) : await searchAnimeAniList(query);
                const anime = Array.isArray(data) ? data[0] : data;
                if (!anime) return reply('Not Found', 'Anime not found.');

                const title = anime.title.english || anime.title.romaji;
                const { rowCount } = await db.query('SELECT 1 FROM role_notifications WHERE role_id = $1 AND anime_title = $2', [roleId, title]);
                if (rowCount) return reply('Duplicate', 'This role is already subscribed.');

                await db.query('INSERT INTO role_notifications (role_id, guild_id, anime_title) VALUES ($1, $2, $3)', [roleId, guildId, title]);

                const airDate = anime.nextAiringEpisode?.airingAt * 1000;
                if (airDate) {
                    await db.query('INSERT INTO schedules (anime_id, anime_title, next_airing_at) VALUES ($1, $2, $3) ON CONFLICT (anime_id) DO UPDATE SET next_airing_at = EXCLUDED.next_airing_at', [anime.id, title, airDate]);
                    scheduler.schedule({ anime_id: anime.id, anime_title: title, next_airing_at: airDate });
                }
                return reply('Added', `<@&${roleId}> will be notified for **${title}**!`, 'Green');
            },

            remove: async () => {
                const query = args.slice(1).join(' ').toLowerCase();
                if (!roleId || !query) return message.reply('Usage: `!rn remove <@role> <anime>`');

                const { rows } = await db.query('SELECT * FROM role_notifications WHERE role_id = $1 AND guild_id = $2', [roleId, guildId]);
                const match = rows.find(r => r.anime_title.toLowerCase().includes(query));
                if (!match) return reply('Not Found', 'No matching anime for this role.', 'Yellow');

                await db.query('DELETE FROM role_notifications WHERE id = $1', [match.id]);
                
                // Cleanup scheduler if no one else is watching
                const { rowCount: total } = await db.query('SELECT 1 FROM role_notifications WHERE anime_title = $1 UNION SELECT 1 FROM watchlists WHERE anime_title = $1', [match.anime_title]);
                if (!total) {
                    const { rows: s } = await db.query('DELETE FROM schedules WHERE anime_title = $1 RETURNING anime_id', [match.anime_title]);
                    if (s[0]) scheduler.cancel(s[0].anime_id);
                }
                return reply('Removed', `Notification for **${match.anime_title}** removed.`, 'Green');
            },

            list: async () => {
                const { rows } = await db.query(`SELECT * FROM role_notifications WHERE guild_id = $1 ${roleId ? 'AND role_id = $2' : ''} ORDER BY id DESC`, roleId ? [guildId, roleId] : [guildId]);
                if (!rows.length) return reply('Empty', 'No notifications found.', 'Yellow');

                const list = rows.map((r, i) => `${i + 1}. <@&${r.role_id}> → **${r.anime_title}**`).join('\n');
                return reply('Role Notifications', list, '#0099ff');
            }
        };

        if (!actions[sub]) return message.reply('Usage: `!rn <add|remove|list> <@role> [anime]`');
        try { await actions[sub](); } catch (e) { console.error(e); message.reply('Error updating notifications.'); }
    }
};
