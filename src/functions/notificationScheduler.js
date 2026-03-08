const cron = require('node-cron');
const db = require('../schemas/db');
const { embed } = require('./ui');
const { getAnimeByAniListId, getDailySchedule } = require('../utils/API-services');

let bot = null;
const jobs = new Map();
const inFlight = new Set();
let cronRunning = false;
const MAX_TIMEOUT = 2147483647;

async function poll(ts) {
  if (ts) {
    const { rowCount } = await db.query("SELECT 1 FROM bot_state WHERE key = $1", ['last_poll']);
    return rowCount
      ? db.query("UPDATE bot_state SET value = $1 WHERE key = $2", [String(ts), 'last_poll'])
      : db.query("INSERT INTO bot_state (key, value) VALUES ($1, $2)", ['last_poll', String(ts)]);
  }
  const { rows } = await db.query("SELECT value FROM bot_state WHERE key = $1", ['last_poll']);
  return rows[0]?.value || 0;
}

async function initialize(client) {
  bot = client;
  await catchMissed();

  const { rows } = await db.query('SELECT * FROM schedules WHERE next_airing_at > $1', [Date.now()]);
  rows.forEach(r => schedule(r));

  cron.schedule('0 */8 * * *', async () => {
    if (cronRunning) return;
    cronRunning = true;
    try {
      await catchMissed();
      await updateSchedules();
      await poll(Date.now());
    } finally {
      cronRunning = false;
    }
  });
  await poll(Date.now());

  cron.schedule('5 0 * * *', () => sendDailySchedules(), { timezone: 'UTC' });
}

async function catchMissed() {
  const last = await poll(), now = Date.now();
  const { rows } = await db.query('SELECT * FROM schedules WHERE next_airing_at > $1 AND next_airing_at <= $2', [last, now]);

  for (const row of rows) {
    await send(row);
    await new Promise(res => setTimeout(res, 1000));
  }
}

function schedule(entry) {
  if (!entry.next_airing_at || entry.next_airing_at <= Date.now()) return;
  if (jobs.has(entry.anime_id)) clearTimeout(jobs.get(entry.anime_id));
  const delay = entry.next_airing_at - Date.now();
  if (delay > MAX_TIMEOUT) {
    jobs.set(entry.anime_id, setTimeout(() => schedule(entry), MAX_TIMEOUT));
  } else {
    jobs.set(entry.anime_id, setTimeout(() => send(entry), delay));
  }
}

async function send(entry) {
  if (inFlight.has(entry.anime_id)) return;
  inFlight.add(entry.anime_id);
  try {
    const a = await getAnimeByAniListId(entry.anime_id);
    if (!a) return;

    const epNum = a.nextAiringEpisode?.episode - 1 || 'Latest';
    const airedDate = new Date(entry.next_airing_at).toUTCString();

    const e = embed({
      title: `New Episode of ${a.title.english || a.title.romaji} Released!`,
      desc: `Episode ${epNum} is now available!\nAired at: ${airedDate}. Remember that the episode might take some time depending on which platform you are watching on.`,
      thumbnail: a.coverImage?.large, color: '#0099ff',
      footer: 'Episode just released!'
    });

    const { rows: users } = await db.query('SELECT user_id FROM watchlists WHERE anime_title = $1', [entry.anime_title]);
    for (const user of users) {
      try {
        const { rows: p } = await db.query('SELECT notification_type FROM user_preferences WHERE user_id = $1', [user.user_id]);
        const notifType = p[0]?.notification_type || 'dm';
        if (notifType === 'dm') {
          const u = await bot.users.fetch(user.user_id).catch(() => null);
          if (u) await u.send({ embeds: [e] }).catch(() => null);
        } else {
          const g = bot.guilds.cache.find(g => g.members.cache.has(user.user_id));
          const { rows: s } = await db.query('SELECT notification_channel_id FROM guild_settings WHERE guild_id = $1', [g?.id]);
          if (s[0]?.notification_channel_id) (await bot.channels.fetch(s[0].notification_channel_id))?.send({ content: `<@${user.user_id}>`, embeds: [e] }).catch(() => null);
        }
      } catch {}
    }

    const { rows: roles } = await db.query('SELECT role_id, guild_id FROM role_notifications WHERE anime_title = $1', [entry.anime_title]);
    for (const role of roles) {
      try {
        const { rows: s } = await db.query('SELECT notification_channel_id FROM guild_settings WHERE guild_id = $1', [role.guild_id]);
        if (s[0]?.notification_channel_id) (await bot.channels.fetch(s[0].notification_channel_id))?.send({ content: `<@&${role.role_id}>`, embeds: [e] }).catch(() => null);
      } catch {}
    }

    jobs.delete(entry.anime_id);
    if (a.nextAiringEpisode?.airingAt) {
      const next = a.nextAiringEpisode.airingAt * 1000;
      await db.query('UPDATE schedules SET next_airing_at = $1 WHERE anime_id = $2', [next, entry.anime_id]);
      schedule({ ...entry, next_airing_at: next });
    }
  } catch (err) { console.error(`Error [schedule ${entry.anime_id}]:`, err.message); }
  finally {
    inFlight.delete(entry.anime_id);
  }
}

async function updateSchedules() {
  const { rows } = await db.query('SELECT * FROM schedules WHERE next_airing_at IS NOT NULL');
  for (const row of rows) {
    const a = await getAnimeByAniListId(row.anime_id);
    const next = a?.nextAiringEpisode?.airingAt * 1000;
    if (next && next !== row.next_airing_at) {
      await db.query('UPDATE schedules SET next_airing_at = $1 WHERE anime_id = $2', [next, row.anime_id]);
      schedule({ ...row, next_airing_at: next });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function sendDailySchedules() {
  if (!bot) return;
  try {
    const { rows: guilds } = await db.query("SELECT guild_id, daily_schedule_channel_id FROM guild_settings WHERE daily_schedule_enabled = $1 AND daily_schedule_channel_id IS NOT NULL", ['true']);
    if (!guilds.length) return;

    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const data = await getDailySchedule(dayName);
    if (!data?.length) return;

    const fields = data.map(a => ({
      name: a.english || a.title,
      value: `**Ep ${a.episodeNumber}** — <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f>`
    }));

    const e = embed({
      title: `📅 ${dayName}'s Anime Schedule`,
      fields,
      color: '#0099ff',
      footer: `${data.length} show${data.length !== 1 ? 's' : ''} airing today`
    });

    for (const g of guilds) {
      try {
        const ch = await bot.channels.fetch(g.daily_schedule_channel_id).catch(() => null);
        if (ch) await ch.send({ embeds: [e] });
      } catch {}
    }
  } catch (err) {
    console.error('Daily schedule error:', err.message);
  }
}

function cancel(animeId) {
  if (jobs.has(animeId)) {
    clearTimeout(jobs.get(animeId));
    jobs.delete(animeId);
  }
}

module.exports = { initialize, schedule, cancel };
