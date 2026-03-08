const db = require('../../schemas/db');
const { searchAnimeAniList, getAnimeByAniListId } = require('../../utils/API-services');
const scheduler = require('../../functions/notificationScheduler');
const { embed } = require('../../functions/ui');

module.exports = {
    disabled: false,
    devOnly: true,
    name: 'rolenotification',
    description: 'Manage role-based anime notifications',
    aliases: ['rolenoti', 'rn'],
    async execute(message) {
        try {
            const args = message.content.split(/\s+/).slice(1);
            const sub = args[0]?.toLowerCase();
            
            if (!['add', 'remove', 'list'].includes(sub)) {
                return message.reply('Usage: `!rolenotification <add|remove|list> <role> [anime]`');
            }

            const guildId = message.guild.id;

            if (sub === 'add') {
                const roleMatch = message.content.match(/<@&(\d+)>/);
                if (!roleMatch) return message.reply('Usage: `!rolenotification add <@role> <anime title/ID>`');
                
                const roleId = roleMatch[1];
                const role = await message.guild.roles.fetch(roleId).catch(() => null);
                if (!role) return message.reply('Role not found.');

                const animeQuery = args.slice(2).join(' ');
                if (!animeQuery) return message.reply('Provide an anime title or ID.');

                const data = /^\d+$/.test(animeQuery) ? await getAnimeByAniListId(animeQuery) : await searchAnimeAniList(animeQuery);
                const anime = Array.isArray(data) ? data[0] : data;

                if (!anime) return message.reply({ embeds: [embed({ title: 'Not Found', desc: 'Anime not found.', color: 'Red' })] });

                const title = anime.title.english || anime.title.romaji;

                const { rowCount } = await db.query('SELECT 1 FROM role_notifications WHERE role_id = $1 AND anime_title = $2', [roleId, title]);
                if (rowCount) return message.reply('This role is already subscribed to this anime.');

                const airDate = anime.nextAiringEpisode?.airingAt * 1000 || null;
                await db.query('INSERT INTO role_notifications (role_id, guild_id, anime_title) VALUES ($1, $2, $3)', [roleId, guildId, title]);

                if (airDate) {
                    await db.query('INSERT INTO schedules (anime_id, anime_title, next_airing_at) VALUES ($1, $2, $3) ON CONFLICT (anime_id) DO UPDATE SET next_airing_at = EXCLUDED.next_airing_at, anime_title = EXCLUDED.anime_title', [anime.id, title, airDate]);
                    scheduler.schedule({ anime_id: anime.id, anime_title: title, next_airing_at: airDate });
                }
                
                return message.reply({ embeds: [embed({ title: 'Role Notification Added', desc: `${role} will be notified when **${title}** episodes release!`, color: 'Green' })] });
            }

            if (sub === 'remove') {
                const roleMatch = message.content.match(/<@&(\d+)>/);
                if (!roleMatch) return message.reply('Usage: `!rolenotification remove <@role> <anime title>`');
                
                const roleId = roleMatch[1];
                const role = await message.guild.roles.fetch(roleId).catch(() => null);
                if (!role) return message.reply('Role not found.');

                const query = args.slice(2).join(' ').toLowerCase();
                if (!query) return message.reply('Provide the anime title.');

                const { rows } = await db.query('SELECT * FROM role_notifications WHERE role_id = $1 AND guild_id = $2', [roleId, guildId]);
                const match = rows.find(r => r.anime_title.toLowerCase().includes(query));

                if (!match) return message.reply({ embeds: [embed({ title: 'Not Found', desc: 'No matching anime for this role.', color: 'Yellow' })] });

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
                
                return message.reply({ embeds: [embed({ title: 'Removed', desc: `${role} will no longer be notified about **${match.anime_title}**.`, color: 'Green' })] });
            }

            if (sub === 'list') {
                const roleMatch = message.content.match(/<@&(\d+)>/);
                const roleId = roleMatch ? roleMatch[1] : null;

                const query = roleId 
                    ? 'SELECT * FROM role_notifications WHERE guild_id = $1 AND role_id = $2 ORDER BY id DESC'
                    : 'SELECT * FROM role_notifications WHERE guild_id = $1 ORDER BY id DESC';
                const params = roleId ? [guildId, roleId] : [guildId];

                const { rows } = await db.query(query, params);
                
                if (!rows.length) return message.reply({ embeds: [embed({ title: 'No Notifications', desc: roleId ? `No anime notifications set for that role.` : 'No role notifications set in this server.', color: 'Yellow' })] });

                const list = rows.map((r, i) => `${i + 1}. <@&${r.role_id}> → **${r.anime_title}**`).join('\n');
                
                return message.reply({ embeds: [embed({ title: 'Server Role Notifications', desc: list, color: '#0099ff' })] });
            }
        } catch (error) {
            console.error('Error in rolenotification command:', error);
            return message.reply('An error occurred while executing this command. Please try again later.').catch(() => {});
        }
    }
};
