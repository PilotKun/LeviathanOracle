const cron = require('node-cron');
const db = require('../schemas/db');
const { embed } = require('./ui');
const { getAnimeByAniListId, getDailySchedule } = require('../utils/API-services');

let bot = null;
const jobs = new Map(), inFlight = new Set();
let cronRunning = false;

// Unified state poll/update
const poll = async (ts) => {
  if (!ts) return (await db.query("SELECT value FROM bot_state WHERE key = 'last_poll'")).rows[0]?.value || 0;
  await db.query("INSERT INTO bot_state (key, value) VALUES ('last_poll', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(ts)]);
};

async function initialize(client) {
  bot = client;
  await catchMissed();
  
  const { rows } = await db.query('SELECT * FROM schedules WHERE next_airing_at > $1', [Date.now()]);
  rows.forEach(schedule);

  cron.schedule('0 */8 * * *', async () => {
    if (cronRunning) return;
    cronRunning = true;
    try { await catchMissed(); await updateSchedules(); await poll(Date.now()); } finally { cronRunning = false; }
  });
  cron.schedule('0 8 * * *', postDailySchedule);
  await poll(Date.now());
}

async function catchMissed() {
  const { rows } = await db.query('SELECT * FROM schedules WHERE next_airing_at > $1 AND next_airing_at <= $2', [await poll(), Date.now()]);
  for (const row of rows) {
    await send(row);
    await new Promise(r => setTimeout(r, 1000));
  }
}

function schedule(entry) {
  if (!entry.next_airing_at || entry.next_airing_at <= Date.now()) return;
  cancel(entry.anime_id);
  jobs.set(entry.anime_id, setTimeout(() => send(entry), entry.next_airing_at - Date.now()));
}

async function send(entry) {
  if (inFlight.has(entry.anime_id)) return;
  inFlight.add(entry.anime_id);
  try {
    const a = await getAnimeByAniListId(entry.anime_id);
    if (!a) return;

    const e = embed({
      title: `New Episode: ${a.title.english || a.title.romaji}`,
      desc: `Episode ${a.nextAiringEpisode?.episode - 1 || 'Latest'} is out!\nAired: ${new Date(entry.next_airing_at).toUTCString()}`,
      thumbnail: a.coverImage?.large, color: '#0099ff'
    });

    // Notify individual users
    const { rows: users } = await db.query('SELECT DISTINCT user_id FROM watchlists WHERE anime_title = $1', [entry.anime_title]);
    for (const { user_id } of users) {
      const { rows: p } = await db.query('SELECT notification_type FROM user_preferences WHERE user_id = $1', [user_id]);
      if (p[0]?.notification_type === 'guild') {
        const g = bot.guilds.cache.find(g => g.members.cache.has(user_id));
        const { rows: s } = await db.query('SELECT notification_channel_id FROM guild_settings WHERE guild_id = $1', [g?.id]);
        if (s[0]?.notification_channel_id) (await bot.channels.fetch(s[0].notification_channel_id))?.send({ content: `<@${user_id}>`, embeds: [e] }).catch(() => {});
      } else {
        (await bot.users.fetch(user_id).catch(() => null))?.send({ embeds: [e] }).catch(() => {});
      }
    }

    // Notify roles
    const { rows: roles } = await db.query('SELECT role_id, guild_id FROM role_notifications WHERE anime_title = $1', [entry.anime_title]);
    for (const { role_id, guild_id } of roles) {
      const { rows: s } = await db.query('SELECT notification_channel_id FROM guild_settings WHERE guild_id = $1', [guild_id]);
      if (s[0]?.notification_channel_id) (await bot.channels.fetch(s[0].notification_channel_id))?.send({ content: `<@&${role_id}>`, embeds: [e] }).catch(() => {});
    }

    if (a.nextAiringEpisode?.airingAt) {
      const next = a.nextAiringEpisode.airingAt * 1000;
      await db.query('UPDATE schedules SET next_airing_at = $1 WHERE anime_id = $2', [next, entry.anime_id]);
      schedule({ ...entry, next_airing_at: next });
    }
  } finally { inFlight.delete(entry.anime_id); jobs.delete(entry.anime_id); }
}

async function updateSchedules() {
  const { rows } = await db.query('SELECT * FROM schedules WHERE next_airing_at IS NOT NULL');
  for (const row of rows) {
    const next = (await getAnimeByAniListId(row.anime_id))?.nextAiringEpisode?.airingAt * 1000;
    if (next && next !== row.next_airing_at) {
      await db.query('UPDATE schedules SET next_airing_at = $1 WHERE anime_id = $2', [next, row.anime_id]);
      schedule({ ...row, next_airing_at: next });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

function cancel(id) { clearTimeout(jobs.get(id)); jobs.delete(id); }

async function postDailySchedule() {
  const { rows: gs } = await db.query("SELECT guild_id, daily_schedule_channel_id FROM guild_settings WHERE daily_schedule_enabled IN ('true', '1', 1)");
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const data = await getDailySchedule(today, 'all');
  if (!gs.length || !data?.length) return;

  const e = embed({
    title: `📅 ${today}'s Anime Schedule`,
    desc: `**${data.length}** anime airing today`,
    fields: data.slice(0, 25).map(a => ({ name: a.english || a.title, value: `**Ep ${a.episodeNumber}** - <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f>` })),
    color: '#0099ff', footer: data.length > 25 ? `Showing 25 of ${data.length}` : ''
  });

  for (const { daily_schedule_channel_id: cid } of gs) {
    (await bot.channels.fetch(cid).catch(() => null))?.send({ embeds: [e] }).catch(() => {});
  }
}

module.exports = { initialize, schedule, cancel };
