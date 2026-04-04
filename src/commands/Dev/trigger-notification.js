const { SlashCommandBuilder, MessageFlags, InteractionContextType, time } = require('discord.js');
const db = require('../../schemas/db');
const scheduler = require('../../functions/notificationScheduler');
const { getAnimeByAniListId } = require('../../utils/API-services');
const tracer = require('../../utils/tracer');

/**
 * Updates the database and triggers the scheduler.
 */
async function scheduleTestNotification(animeId, title, delaySeconds) {
    const nextAiringAt = Date.now() + (delaySeconds * 1000);

    const query = `
        INSERT INTO schedules (anime_id, anime_title, next_airing_at, sent_at)
        VALUES ($1, $2, $3, NULL)
        ON CONFLICT (anime_id) DO UPDATE SET
            anime_title = EXCLUDED.anime_title,
            next_airing_at = EXCLUDED.next_airing_at,
            sent_at = NULL
    `;

    await db.query(query, [animeId, title, nextAiringAt]);
    
    scheduler.schedule({ 
        anime_id: animeId, 
        anime_title: title, 
        next_airing_at: nextAiringAt 
    });

    return nextAiringAt;
}

module.exports = {
    devOnly: true,
    data: new SlashCommandBuilder()
        .setName('trigger-notification')
        .setDescription('Developer command to trigger a notification for testing purposes')
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addIntegerOption(opt => opt
            .setName('anime_id')
            .setDescription('AniList anime ID')
            .setRequired(true)
            .setMinValue(1))
        .addIntegerOption(opt => opt
            .setName('delay_seconds')
            .setDescription('Seconds until trigger (Default: 5)')
            .setMinValue(1)
            .setMaxValue(3600)),

    async execute(interaction) {
        const animeId = interaction.options.getInteger('anime_id');
        const delaySeconds = interaction.options.getInteger('delay_seconds') ?? 5;
        
        const t = tracer.start('dev:trigger-notification', { userId: interaction.user.id, animeId });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const anime = await getAnimeByAniListId(animeId);
            
            if (!anime) {
                t.warn('Anime not found');
                return interaction.editReply(`❌ Anime with ID **${animeId}** not found on AniList.`);
            }

            const title = anime.title?.english ?? anime.title?.romaji ?? `Anime #${animeId}`;
            const triggerTimestamp = await scheduleTestNotification(animeId, title, delaySeconds);

            t.end('Success', { title, delaySeconds });

            return interaction.editReply(
                `✅ Scheduled test for **${title}**\n` +
                `• **ID:** ${animeId}\n` +
                `• **Triggers in:** ${delaySeconds}s\n` +
                `• **Exact Time:** ${time(Math.floor(triggerTimestamp / 1000), 'F')}`
            );

        } catch (error) {
            t.error('Execution failed', error);
            return interaction.editReply('❌ An error occurred while queuing the notification.');
        }
    }
};
