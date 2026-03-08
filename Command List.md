## Commands

### Slash Commands

| Command | Description |
|--------|-------------|
| `/watchlist add <title>` | Add anime to your watchlist (autocomplete supported) |
| `/watchlist remove <title>` | Remove anime from your watchlist |
| `/watchlist view` | View your watchlist |
| `/watchlist view <@User\|UserId>` | View others' public watchlists |
| `/watchlist export` | Export your current watchlist |
| `/watchlist import` | Import your current watchlist |
| `/linkprofile mal <username>` | Link your MyAnimeList account |
| `/linkprofile anilist <username>` | Link your AniList account |
| `/linkedprofile` | View your linked profile(s) |
| `/search-anime <anime>` | Search anime details (Jikan / MyAnimeList) |
| `/search-manga <manga>` | Search manga details (Jikan / MyAnimeList) |
| `/search-profile-mal <username>` | View a MyAnimeList profile |
| `/search-profile-anilist <username>` | View an AniList profile |
| `/upcoming` | Browse upcoming episodes (interactive day/type selection) |
| `/nyaa <query>` | Search Nyaa for English-translated anime releases |
| `/ping` | Check bot latency |
| `/preference notification <dm\|server>` | Set how you receive notifications |
| `/preference watchlist <private\|public>` | Set watchlist visibility |
| `/preference view` | View your current preferences |
| `/rolenotification add <role> <anime>` | Subscribe a role to an anime (Manage Roles required) |
| `/rolenotification remove <role> <anime>` | Unsubscribe a role from an anime |
| `/rolenotification list [role]` | List role-based notifications (optionally filter by role) |
| `/report` | Submit a bug report via modal to the configured report channel |

## $\color{hsl(0,100%,50%)}{\textsf{PREFIX COMMANDS ARE DISABLED TEMPORARILY!!}}$
### Prefix Commands

The default prefix is configurable in `config.json`.
Aliases can also be used for ease ouf use.

| Command | Description |
|--------|-------------|
| `!upcoming <day> [type]` | View upcoming episodes (alias: `!schedule`) |
| `!nyaa <query>` | Search Nyaa releases (alias: `!torrent`) |
| `!linkprofile <mal\|anilist> <username>` | Link MAL/AniList account (alias: `!link`) |
| `!linkedprofile` | View linked accounts (aliases: `!linked`, `!myprofiles`) |
| `!ping` | Check latency (alias: `!p`) |
| `!preference <notification\|watchlist\|view> [value]` | Manage preferences (aliases: `!pref`, `!settings`) |
| `!rolenotification <add\|remove\|list> <@role> [anime]` | Manage role notifications (aliases: `!rolenoti`, `!rn`) |
