import 'dotenv/config';
import pkg, { ActivityType } from 'discord.js';
import fs from 'fs';
import db from './database/db.js';
import { fetchAnimeDetailsById } from './utils/anilist.js';

const { Client, GatewayIntentBits, Collection } = pkg;

// Global error handlers to prevent bot from crashing
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.commands = new Collection();
let commandFiles = [];
try {
  commandFiles = fs.readdirSync('src/commands').filter(file => file.endsWith('.js')); // Change the readdirSync. In my case I seemed to have errors so I changed the path to avoid that.
} catch (err) {
  console.error('Error reading command files:', err);
}

(async () => {
  for (const file of commandFiles) {
    try {
      const commandModule = await import(`./commands/${file}`);
      const command = commandModule.default;
      client.commands.set(command.data.name, command);
    } catch (err) {
      console.error(`Failed to load command ${file}:`, err);
    }
  }
})();

// --- Scheduler State ---
const scheduledTimeouts = new Map(); // key: watchlist id, value: timeout

// --- Helper: Send Notification ---
async function sendNotification(row, animeDetails, client) {
  const utcAiringTime = new Date(row.next_airing_at).toUTCString();
  const episodeNumber = animeDetails.nextAiringEpisode
    ? animeDetails.nextAiringEpisode.episode - 1
    : 'Latest';
  const embed = {
    color: 0x0099ff,
    title: `New Episode of ${animeDetails.title.english || animeDetails.title.romaji} Released!`,
    description: `Episode ${episodeNumber} is now available!\nAired at: ${utcAiringTime} UTC. Remember that the episode might take some time depending on what platform you are watching.`,
    timestamp: new Date(row.next_airing_at),
    thumbnail: { url: animeDetails.coverImage.large },
    footer: { text: 'Episode just released!' },
  };
  try {
    const user = await client.users.fetch(row.user_id);
    const channel = await user.createDM();
    await channel.send({ embeds: [embed] });
    console.log(`Notification sent to ${row.user_id} (DM) for ${animeDetails.title.english || animeDetails.title.romaji}`);
  } catch (e) {
    console.error('Failed to send notification:', e);
  }
}

// --- Scheduler: Schedule a notification ---
function scheduleNotification(row, client) {
  const delay = row.next_airing_at - Date.now();
  if (delay <= 0) {
    console.log(`Skipping schedule for anime ${row.anime_id}: Already passed, fallback polling will handle`);
    return;
  }
  if (scheduledTimeouts.has(row.id)) {
    console.log(`Clearing existing timeout for watchlist ID ${row.id}`);
    clearTimeout(scheduledTimeouts.get(row.id));
  }
  console.log(`Scheduling notification for anime ${row.anime_id}, watchlist ID ${row.id} in ${Math.floor(delay/1000/60)} minutes`);
  const timeout = setTimeout(async () => {
    try {
      const animeDetails = await fetchAnimeDetailsById(row.anime_id);
      await sendNotification(row, animeDetails, client);
      // Update next airing in DB
      if (
        animeDetails.nextAiringEpisode &&
        animeDetails.nextAiringEpisode.airingAt * 1000 !== row.next_airing_at &&
        animeDetails.nextAiringEpisode.airingAt * 1000 > Date.now()
      ) {
        db.run(
          `UPDATE watchlists SET next_airing_at = ? WHERE id = ?`,
          [animeDetails.nextAiringEpisode.airingAt * 1000, row.id]
        );
        // Reschedule
        row.next_airing_at = animeDetails.nextAiringEpisode.airingAt * 1000;
        scheduleNotification(row, client);
      }
    } catch (e) {
      console.error('Error in scheduled notification:', e);
    }
  }, delay);
  scheduledTimeouts.set(row.id, timeout);
  console.log(`Successfully scheduled notification for watchlist ID ${row.id}`);
}

// --- Fallback Polling ---
async function fallbackPoll(client, lastPollTime) {
  console.log(`Starting fallback poll, checking for episodes aired since ${new Date(lastPollTime).toISOString()}`);
  db.all(`SELECT * FROM watchlists`, async (err, rows) => {
    if (err) return console.error('DB Select Error:', err);
    console.log(`Retrieved ${rows.length} watchlist entries to check`);
    let processedCount = 0;
    for (const row of rows) {
      if (row.next_airing_at && row.next_airing_at > lastPollTime && row.next_airing_at <= Date.now()) {
        console.log(`Processing watchlist ID ${row.id} for anime ${row.anime_id}`);
        try {
          const animeDetails = await fetchAnimeDetailsById(row.anime_id);
          await sendNotification(row, animeDetails, client);
          // Update next airing in DB
          if (
            animeDetails.nextAiringEpisode &&
            animeDetails.nextAiringEpisode.airingAt * 1000 !== row.next_airing_at &&
            animeDetails.nextAiringEpisode.airingAt * 1000 > Date.now()
          ) {
            db.run(
              `UPDATE watchlists SET next_airing_at = ? WHERE id = ?`,
              [animeDetails.nextAiringEpisode.airingAt * 1000, row.id]
            );
            row.next_airing_at = animeDetails.nextAiringEpisode.airingAt * 1000;
            scheduleNotification(row, client);
          }
          console.log(`Successfully processed notification for anime ${row.anime_id}`);
        } catch (e) {
          console.error(`Error in fallback poll notification for anime ${row.anime_id}:`, e);
        }
      }
      processedCount++;
    }
    console.log(`Fallback poll completed. Processed ${processedCount} entries`);
  });
}

// --- Restore last poll timestamp ---
function getLastPollTimestamp(cb) {
  console.log('Retrieving last poll timestamp from database');
  db.get(`SELECT value FROM bot_state WHERE key = 'last_poll'`, (err, row) => {
    if (err) {
      console.error('Error retrieving last poll timestamp:', err);
      cb(0);
    } else if (!row) {
      console.log('No previous poll timestamp found, using default value 0');
      cb(0);
    } else {
      console.log(`Retrieved last poll timestamp: ${new Date(Number(row.value)).toISOString()}`);
      cb(Number(row.value));
    }
  });
}

function setLastPollTimestamp(ts) {
  console.log(`Updating last poll timestamp to ${new Date(ts).toISOString()}`);
  db.run(`INSERT OR REPLACE INTO bot_state (key, value) VALUES ('last_poll', ?)`, [String(ts)], (err) => {
    if (err) {
      console.error('Error updating last poll timestamp:', err);
    } else {
      console.log('Successfully updated last poll timestamp');
    }
  });
}

client.once('ready', () => {
  try {
    client.user.setPresence({
      status: 'online',
      activities: [{
        name: 'Your Notifications',
        type: ActivityType.Watching,
      }],
    });
    console.log(`Logged in as ${client.user.tag}!`);

    // --- Rehydrate all scheduled notifications on startup ---
    console.log('Starting to rehydrate scheduled notifications');
    db.all(`SELECT * FROM watchlists`, (err, rows) => {
      if (err) return console.error('DB Select Error during rehydration:', err);
      console.log(`Found ${rows.length} watchlist entries to rehydrate`);
      let scheduledCount = 0;
      for (const row of rows) {
        if (row.next_airing_at && row.next_airing_at > Date.now()) {
          scheduleNotification(row, client);
          scheduledCount++;
        }
      }
      console.log(`Rehydration complete. Scheduled ${scheduledCount} notifications`);
    });

    // --- Fallback polling every hour ---
    console.log('Initializing hourly fallback polling system');
    getLastPollTimestamp((lastPoll) => {
      console.log('Starting initial fallback poll');
      fallbackPoll(client, lastPoll);
      setLastPollTimestamp(Date.now());
      console.log('Setting up hourly interval for fallback polling');
      setInterval(() => {
        console.log('Running hourly fallback poll check');
        getLastPollTimestamp((lastPoll2) => {
          fallbackPoll(client, lastPoll2);
          setLastPollTimestamp(Date.now());
        });
      }, 3600000);
    });
  } catch (err) {
    console.error('Error in ready event:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    const command = client.commands.get(interaction.commandName.toLowerCase());

    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error('Command execution error:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
      } else {
        await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Failed to login:', err);
});

export { scheduleNotification };
