import 'dotenv/config';
import { Client, GatewayIntentBits, Collection } from 'discord.js';
import fs from 'fs';
import db from './database/db.js';
import { fetchAnimeDetails } from './utils/anilist.js';
import { setInterval } from 'timers/promises';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.commands = new Collection();
const commandFiles = fs.readdirSync('./src/commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const commandModule = await import(`./commands/${file}`);
  const command = commandModule.default; // Access the default export
  client.commands.set(command.data.name, command);
}

// Function to check for new episodes
async function checkForNewEpisodes() {
  console.log('Checking for new episodes...');
  db.all(`SELECT DISTINCT user_id, anime_title FROM watchlists`, async (err, rows) => {
    if (err) {
      console.error('DB Select Error:', err);
      return;
    }

    console.log(`Found ${rows.length} watchlist entries to check.`);

    for (const row of rows) {
      try {
        console.log(`Fetching details for anime: ${row.anime_title}`);
        const animeDetails = await fetchAnimeDetails(row.anime_title);
        if (animeDetails.nextAiringEpisode && animeDetails.nextAiringEpisode.timeUntilAiring < 3600) { // Less than 1 hour
          console.log(`New episode of ${animeDetails.title.romaji} airing soon!`);
          const user = await client.users.fetch(row.user_id);
          user.send({
            embeds: [
              {
                color: 0x0099ff,
                title: `New Episode of ${animeDetails.title.romaji}`,
                description: `Episode ${animeDetails.nextAiringEpisode.episode} is airing soon!`,
                image: {
                  url: animeDetails.coverImage.large,
                },
              },
            ],
          });
        } else {
          console.log(`No new episodes for ${row.anime_title} within the next hour.`);
        }
      } catch (error) {
        console.error('Error fetching anime details:', error);
      }
    }
  });
}

client.once('ready', () => {
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'Sea of Knowledge',
      type: 'PLAYING'
    }],
  });

  console.log(`Logged in as ${client.user.tag}!`);
  setInterval(checkForNewEpisodes, 3600000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName.toLowerCase());

  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);