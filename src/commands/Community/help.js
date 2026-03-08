const { SlashCommandBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { embed, ui } = require('../../functions/ui');

const HELP_PAGES = {
    help_about: () => embed.v2({
        color: 0x0099ff,
        desc:
            '# LeviathanOracle\n\n' +
            'A powerful Discord bot built to manage your anime experience. Link profiles, track watchlists, and search for your favorite series with ease.\n\n' +
            '### Core Features\n' +
            '• **Anime Watchlist** - Track what you are watching.\n' +
            '• **Profile Linking** - Sync with MyAnimeList & AniList.\n' +
            '• **Search** - Get details for any anime or manga.\n' +
            '• **Schedule** - Stay updated with upcoming episodes.\n\n' +
            '### Credits\n' +
            '• **Developers:** [Pilot_kun](https://github.com/PilotKun) & [Niko](https://github.com/nikovaxx)'
    }),

    help_commands: () => embed.v2({
        color: 0x2ecc71,
        desc:
            '## Slash Commands\n\n' +
            '### Watchlist\n' +
            '• `/watchlist add <title>` - Add to your list\n' +
            '• `/watchlist remove <title>` - Remove from list\n' +
            '• `/watchlist view` - View your watchlist\n' +
            '• `/watchlist export/import` - Manage your data\n\n' +
            '### Profiles\n' +
            '• `/linkprofile <mal|anilist> <user>` - Link account\n' +
            '• `/linkedprofile` - View your linked accounts\n' +
            '• `/search-profile-mal <user>` - View MAL profile\n' +
            '• `/search-profile-anilist <user>` - View AniList profile\n\n' +
            '### Anime & Manga\n' +
            '• `/search-anime <title>` - Search anime details\n' +
            '• `/search-manga <title>` - Search manga details\n' +
            '• `/upcoming <filter>` - Browse episode schedule\n' +
            '• `/nyaa <query>` - Search Nyaa torrents\n\n' +
            '### System\n' +
            '• `/ping` - Check bot latency\n' +
            '• `/preference` - Bot & notification settings\n' +
            '• `/rolenotification` - Manage role-based alerts\n' +
            '• `/report` - Submit a bug report'
    }),

    help_prefix: () => embed.v2({
        color: 0xe74c3c,
        desc:
            '## Prefix Commands\n' +
            '*Default Prefix:* `!`\n\n' +
            '• `!upcoming <day> [type]` - View schedule (alias: `!schedule`)\n' +
            '• `!nyaa <query>` - Search Nyaa (alias: `!torrent`)\n' +
            '• `!linkprofile <mal|anilist> <user>` - Link account (alias: `!link`)\n' +
            '• `!linkedprofile` - View linked accounts (alias: `!linked`, `!myprofiles`)\n' +
            '• `!ping` - Check latency (alias: `!p`)\n' +
            '• `!preference <type> [value]` - Settings (alias: `!pref`, `!settings`)\n' +
            '• `!rolenotification <add|remove|list>` - Role alerts (alias: `!rolenoti`, `!rn`)'
    })
};

module.exports = {
    disabled: false,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays information about the bot and its commands.'),

    async execute(interaction) {
        const buttonRow = ui.row([
            { id: 'help_about', label: 'About', style: ButtonStyle.Primary },
            { id: 'help_commands', label: 'Slash Commands', style: ButtonStyle.Success },
            { id: 'help_prefix', label: 'Prefix Commands', style: ButtonStyle.Danger }
        ]);

        await interaction.deferReply();

        const response = await interaction.editReply({
            components: [HELP_PAGES['help_about'](), buttonRow],
            flags: MessageFlags.IsComponentsV2
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300_000
        });

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: 'Use the command yourself to interact!', ephemeral: true });
            }

            await i.update({
                components: [HELP_PAGES[i.customId](), buttonRow],
                flags: MessageFlags.IsComponentsV2
            });
        });

        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => {});
        });
    },
};