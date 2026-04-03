const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');

module.exports = {
    devOnly: true,
    data: new SlashCommandBuilder()
        .setName('pull')
        .setDescription('Pull your watchlist data from MAL/Anilist and track for notifications.')
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),
}