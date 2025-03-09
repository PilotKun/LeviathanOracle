import 'dotenv/config';
import pkg, {ActivityType} from 'discord.js';
import fs from 'fs';
import db from './database/db.js';
import { fetchAnimeDetails } from './utils/anilist.js';

const { Client, GatewayIntentBits, Collection } = pkg;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.commands = new Collection();
const commandFiles = fs.readdirSync('./LeviathanOracle-stream/src/commands').filter(file => file.endsWith('.js')); // Change the readdirSync. In my case I seemed to have errors so I changed the path to avoid that.

for (const file of commandFiles) {
  const commandModule = await import(`./commands/${file}`);
  const command = commandModule.default; // Access the default export
  client.commands.set(command.data.name, command);
}

// Function to check for new anime episodes
async function checkForNewReleases() {
  console.log('Checking for new releases...');
  db.all(`SELECT DISTINCT user_id, anime_title FROM watchlists`, async (err, rows) => {
    if (err) {
      console.error('DB Select Error:', err);
      return;
    }

    console.log(`Found ${rows.length} watchlist entries to check.`);

    for (const row of rows) {
      try {
        if (row.anime_title) {
          console.log(`Fetching details for anime: ${row.anime_title}`);
          const animeDetails = await fetchAnimeDetails(row.anime_title);

          if (animeDetails.nextAiringEpisode) {
            const episodeNumber = animeDetails.nextAiringEpisode.episode;
            const airingTimestamp = animeDetails.nextAiringEpisode.airingAt * 1000; // Convert to milliseconds
            const currentTime = Date.now();
            const episodeAiredToday = new Date(airingTimestamp).toDateString() === new Date().toDateString();

            // Check if the episode has already aired by comparing the current time to the airing time
            // Only notify if the episode aired today
            if (currentTime >= airingTimestamp && episodeAiredToday) {
              console.log(`New episode of ${animeDetails.title.romaji} (Episode ${episodeNumber}) has been released!`);
              console.log(`Airing time: ${new Date(airingTimestamp).toISOString()}, Current time: ${new Date(currentTime).toISOString()}`);
              
              const user = await client.users.fetch(row.user_id);

              const embed = {
                color: 0x0099ff,
                title: `New Episode of ${animeDetails.title.romaji} Released!`,
                description: `Episode ${episodeNumber} is now available!`,
                timestamp: new Date(airingTimestamp),
                thumbnail: {
                  url: animeDetails.coverImage.large
                },
                image: {
                  url: animeDetails.coverImage.large
                },
                footer: {
                  text: 'Episode just released!'
                }
              };

              user.send({ embeds: [embed] }).then(() => {
                console.log(`Successfully sent notification to user ${row.user_id} for ${animeDetails.title.romaji}`);
              }).catch(error => {
                console.error(`Failed to send notification to user ${row.user_id}:`, error);
              });
            } else {
              console.log(`No new episodes for ${row.anime_title} yet. Next episode (#${episodeNumber}) airs at ${new Date(airingTimestamp).toISOString()}`);
            }
          } else {
            console.log(`No scheduled episodes for ${row.anime_title}`);
          }
        }
      } catch (error) {
        console.error(`Error processing watchlist entry for ${row.anime_title}:`, error);
      }
    }
  });
}

client.once('ready', () => {
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'Sea of Knowledge',
      type: ActivityType.Listening,
    }],
  });

  console.log(`Logged in as ${client.user.tag}!`);
  
  // Check for new releases every 30 minutes
  setInterval(checkForNewReleases, 1800000); // 30 minutes interval
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    const command = client.commands.get(interaction.commandName.toLowerCase());

    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
