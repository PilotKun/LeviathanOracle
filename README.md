# LeviathanOracle

A Discord bot built to manage anime watchlists, link user profiles from MyAnimeList and AniList, search for anime/manga details, and fetch English-translated anime from Nyaa. The idea for this bot was given by my friend [baku](https://github.com/maiorikizu) and brought to life by me [Pilot_kun](https://github.com/PilotKun).

New file structure and full code rewrite by [Niko](https://github.com/nikovaxx).

### Features

- Anime watchlist (add/remove/view) with scheduling support.
- Link and view profiles (MyAnimeList + AniList).
- Search anime/manga details (Jikan/MAL) and browse upcoming episodes.
- Nyaa RSS search for English-translated releases.
- Notification system upgrades: user preferences + role-based notifications.
- Built-in `/report` system.
- Unified database layer with SQLite3 as the default local database and optional PostgreSQL & MongoDB support.
- Optional Redis caching layer for better API performance.

[All commands & description can be found here](https://github.com/nikovaxx/LeviathanOracle-stream/blob/v3/Command%20List.md)

## Prerequisites

- Node.js v18 or higher
- SQLite3 (default local DB, created automatically on first run)
- PostgreSQL (optional)
- Redis (optional)
- Discord bot token
- AnimeSchedule API token

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/PilotKun/LeviathanOracle.git
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   - Create a json file `config.json`
   - SQLite3 is used by default. If you want PostgreSQL and/or MongoDb, enable them in your config. If you want caching enable redis in the config.
   - Copy `example-config.json` to `config.json`
   - Fill in your credentials
```json
{
  "bot": {
    "token": "DISCORD_TOKEN_HERE",  REQUIRED
    "id": "DISCORD_BOT_ID_HERE",  REQUIRED
    "admins": [   REQUIRED, at least ONE
      "DISCORD_ADMIN_ID_1_HERE",
      "DISCORD_ADMIN_ID_2_HERE"
    ],
    "ownerId": [
      "OWNER_DISCORD_ID_HERE",  REQUIRED
      "CO-OWNER_DISCORD_ID_HERE"
    ],
    "developerCommandsServerIds": [
      "DISCORD_DEVELOPER_COMMANDS_SERVER_ID_HERE"
    ],
    "reportChannelId": "REPORT_CHANNEL_ID_HERE"
  },
  "database": {
    "mongodbUrl": "MONGODB_URL_HERE",  Put valid mongodb url here if you have one
    "postgressql": {
      "enabled": false,  Set to true and put proper credentials if you have a server
      "config": {
        "host": "host",
        "port": 5432,
        "password": "password",
        "database": "database_name",
        "user": "username"
      }
    },
    "redis": {
      "enabled": false,  Set to true and put proper credentials if you have a server
      "config": {
        "host": "host",
        "port": 6379,
        "password": "password"
      }
    }
  },
  "apitokens": {
    "animeschedule": "ANIMESCHEDULE_API_TOKEN_HERE"  REQUIRED
  },
  "logging": {
    "guildJoinLogsId": "SERVER_JOIN_LOGS_CHANNEL_ID_HERE",
    "guildLeaveLogsId": "SERVER_LEAVE_LOGS_CHANNEL_ID_HERE",
    "commandLogsChannelId": "COMMAND_LOGS_CHANNEL_ID_HERE",
    "errorLogs": "ERROR_LOGS_WEBHOOK_URL_HERE"
  },
  "prefix": {
    "value": "!"
  }
}
```

4. **Setup database**
   - SQLite3 is the default database. Tables are created automatically on first run.
   - Ensure PostgreSQL and Redis are running and enabled in config if you are using them. Otherwise ignore this step.

5. **Start the bot**
   ```bash
   npm start
   ```
   OR
   ```bash
   node .\src\index.js
   ```
   - Commands are automatically registered on startup

## Development

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```
# Reference & Acknowledgements

- [AniList GraphQL API](https://docs.anilist.co/)  
- [Jikan API for MyAnimeList](https://jikan.moe/)  
- [Nyaa Torrent RSS](https://nyaa.si)

## License

MIT License - See LICENSE file for details
