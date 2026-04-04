/**
* Responsibilities:
*  1. On startup: catch any episodes that aired while bot was offline (catchMissed).
*  2. Schedule in-memory setTimeout timers for all future episodes in the DB.
*  3. Every 8 hours: refresh next_airing_at from AniList for all tracked anime.
*  4. Every day at 05:00 UTC: post the daily schedule to configured guild channels.
**/

const cron = require('node-cron');
const db   = require('../schemas/db');
const { embed } = require('./ui');
const { getAnimeByAniListId, getDailySchedule } = require('../utils/API-services');
const tracer = require('../utils/tracer');

let bot = null;
const jobs    = new Map();
const inFlight = new Set();

let cronRunning = false;

// ── Initialize ────────────────────────────────────────────────────────────────

async function initialize(client) {
  bot = client;
  const t = tracer.start('SCHEDULER: Initialize');

  await catchMissed();

  // Load all future schedules into memory timers
  try {
    const { rows } = await db.query(
      'SELECT * FROM schedules WHERE next_airing_at > $1',
      [Date.now()]
    );
    rows.forEach(schedule);
    t.info('SCHEDULER: Initialize', `Loaded ${rows.length} future schedule(s) into memory`);
  } catch (e) {
    t.error('SCHEDULER: Initialize', 'Failed to load schedules from DB', e);
  }

  // Every 8 hours: refresh from AniList + catch any misses
  cron.schedule('0 */8 * * *', async () => {
    if (cronRunning) {
      tracer.warn('SCHEDULER: Cron', 'Previous run still in progress — skipping');
      return;
    }
    cronRunning = true;
    try {
      await catchMissed();
      await updateSchedules();
    } finally {
      cronRunning = false;
    }
  });

  // Every day at 05:00 UTC: post daily schedule
  cron.schedule('0 5 * * *', postDailySchedule);
  t.end('SCHEDULER: Cron', 'Daily Scheduler ready');
}

// ── Core: send a notification ─────────────────────────────────────────────────

async function send(entry) {
  if (inFlight.has(entry.anime_id)) {
    tracer.warn('SCHEDULER: Send', 'Already in-flight, skipping', { anime_id: entry.anime_id });
    return;
  }

  // Secondary guard: if sent_at >= next_airing_at this episode was already sent
  try {
    const { rows } = await db.query(
      'SELECT sent_at, next_airing_at FROM schedules WHERE anime_id = $1',
      [entry.anime_id]
    );
    const row = rows[0];
    if (row && row.sent_at && parseInt(row.sent_at) >= parseInt(row.next_airing_at)) {
      tracer.warn('SCHEDULER: Send', 'Already sent for this airing slot — skipping', {
        anime_id: entry.anime_id,
        sent_at: row.sent_at,
        next_airing_at: row.next_airing_at,
      });
      return;
    }
  } catch (e) {
    tracer.error('SCHEDULER: Send', 'DB guard check failed', e);
  }

  inFlight.add(entry.anime_id);
  jobs.delete(entry.anime_id);

  const t = tracer.start('SCHEDULER: Send', { anime_id: entry.anime_id, title: entry.anime_title });

  try {
    await db.query(
      'UPDATE schedules SET sent_at = $1 WHERE anime_id = $2',
      [Date.now(), entry.anime_id]
    );
  } catch (e) {
    t.error('SCHEDULER: Notification History', 'Failed to write sent_at — proceeding anyway', e);
  }

  try {
    const a = await getAnimeByAniListId(entry.anime_id);
    if (!a) {
      t.warn('SCHEDULER: API Fetch', 'Anime not found on AniList', { anime_id: entry.anime_id });
      return;
    }

    const episodeNum = (a.nextAiringEpisode?.episode ?? 1) - 1 || 'latest';
    const airedDate = new Date(entry.next_airing_at).toUTCString();

    const e = embed({
      title: `New Episode of ${a.title?.english || a.title?.romaji} Released!`,
      desc: `**Episode ${episodeNum} is now available!**\nAired at: ${airedDate}. Remember that the episode might take some time depending on which platform you are watching on.`,
      thumbnail: a.coverImage?.large,
      color: '#0099ff',
      footer: 'Episode just released!'
    });

    // ── Notify individual watchlist users ────────────────────────────────────
    const { rows: users } = await db.query(
      'SELECT DISTINCT user_id FROM watchlists WHERE anime_id = $1',
      [entry.anime_id]
    );

    for (const { user_id } of users) {
      try {
        const user = await bot.users.fetch(user_id).catch((err) => {
          t.warn('SCHEDULER: DM Notifier', 'Failed to fetch user ${user_id}', err);
          return null;
        });
        if (user) {
          await user.send({ embeds: [e] });
        }
      } catch (err) {
        t.error('SCHEDULER: DM Notifier', `Failed to notify user ${user_id}`, err);
      }
    }

    // ── Notify role subscriptions ────────────────────────────────────────────
    const { rows: roles } = await db.query(
      'SELECT role_id, guild_id FROM role_notifications WHERE anime_id = $1',
      [entry.anime_id]
    );

    for (const { role_id, guild_id } of roles) {
      try {
        const { rows: gs } = await db.query(
          'SELECT daily_schedule_channel_id FROM guild_settings WHERE guild_id = $1',
          [guild_id]
        );
        const chanId = gs[0]?.daily_schedule_channel_id;
        if (chanId) {
          const chan = await bot.channels.fetch(chanId).catch((err) => {
            t.warn('SCHEDULER: Role Notifier', 'Failed to fetch channel ${chanId}', err);
            return null;
          });
          if (chan) {
            await chan.send({ content: `<@&${role_id}>`, embeds: [e] });
          }
        }
      } catch (err) {
        t.error('SCHEDULER: Role Notifier', `Failed to notify role ${role_id}`, err);
      }
    }

    // ── Schedule the NEXT episode ────────────────────────────────────────────
    const nextAiringAt = a.nextAiringEpisode?.airingAt
      ? a.nextAiringEpisode.airingAt * 1000
      : null;

    if (nextAiringAt && nextAiringAt > Date.now()) {
      await db.query(
        'UPDATE schedules SET next_airing_at = $1, sent_at = NULL WHERE anime_id = $2',
        [nextAiringAt, entry.anime_id]
      );
      schedule({ ...entry, next_airing_at: nextAiringAt });
      t.info('SCHEDULER: Role Notifier', 'SCHEDULER: Next episode scheduled', { nextAiringAt: new Date(nextAiringAt).toISOString() });
    } else {
      t.info('SCHEDULER: Role Notifier', 'No next episode from AniList; leaving schedule as-is');
    }

    t.end('SCHEDULER: Role Notifier', 'send complete');
  } catch (e) {
    t.error('SCHEDULER: Role Notifier', 'Unexpected error during send', e);
  } finally {
    inFlight.delete(entry.anime_id);
  }
}

// ── Schedule an in-memory timer ───────────────────────────────────────────────

function schedule(entry) {
  if (!entry.next_airing_at) return;
  const delay = entry.next_airing_at - Date.now();
  if (delay <= 0) return; // already past — catchMissed handles this

  cancel(entry.anime_id);
  const handle = setTimeout(() => send(entry), delay);
  jobs.set(entry.anime_id, handle);
  tracer.debug('SCHEDULER: In-Memory Timer', `Timer set for ${entry.anime_title}`, {
    anime_id: entry.anime_id,
    in_ms: delay,
    at: new Date(entry.next_airing_at).toISOString(),
  });
}

function cancel(id) {
  clearTimeout(jobs.get(id));
  jobs.delete(id);
}

// ── Catch episodes missed while offline ───────────────────────────────────────

async function catchMissed() {
  const t = tracer.start('SCHEDULER: Catch Missed Episodes');
  const now = Date.now();

  try {
    // Episodes where the airing time has passed BUT no sent_at record for this slot present
    const { rows } = await db.query(
      `SELECT * FROM schedules
       WHERE next_airing_at <= $1
         AND next_airing_at IS NOT NULL
         AND (sent_at IS NULL OR sent_at < next_airing_at)`,
      [now]
    );

    t.info(`Found ${rows.length} missed episode(s)`);

    for (const row of rows) {
      await send(row);
      await new Promise(r => setTimeout(r, 1500)); // small delay between sends
    }

    t.end('SCHEDULER: Catch Missed Episodes', 'catchMissed done');
  } catch (e) {
    t.error('SCHEDULER: Catch Missed Episodes', 'catchMissed failed', e);
  }
}

// ── Refresh next_airing_at from AniList ──────────────────────────────────────

async function updateSchedules() {
  const t = tracer.start('SCHEDULER: Refresh Schedules');
  try {
    const { rows } = await db.query('SELECT * FROM schedules WHERE next_airing_at IS NOT NULL');
    t.info(`Refreshing ${rows.length} schedule(s) from AniList`);

    for (const row of rows) {
      try {
        const anime = await getAnimeByAniListId(row.anime_id);
        const nextAiringAt = anime?.nextAiringEpisode?.airingAt
          ? anime.nextAiringEpisode.airingAt * 1000
          : null;

        if (nextAiringAt && nextAiringAt !== parseInt(row.next_airing_at)) {
          await db.query(
            'UPDATE schedules SET next_airing_at = $1, sent_at = NULL WHERE anime_id = $2',
            [nextAiringAt, row.anime_id]
          );
          schedule({ ...row, next_airing_at: nextAiringAt });
          tracer.debug('SCHEDULER: Refresh Schedules', `Updated ${row.anime_title}`, {
            old: row.next_airing_at,
            new: nextAiringAt,
          });
        }
      } catch (err) {
        tracer.error('SCHEDULER: Refresh Schedules', `Failed to update ${row.anime_title}`, err);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    t.end('SCHEDULER: Refresh Schedules', 'Schedules update done');
  } catch (e) {
    t.error('SCHEDULER: Refresh Schedules', 'Failed to update schedules', e);
  }
}

// ── Daily schedule post ───────────────────────────────────────────────────────
// Posts today's airing anime to all guilds that have daily-schedule enabled.

async function postDailySchedule() {
  const t = tracer.start('SCHEDULER: Post Daily Schedule');
  try {
    const { rows: guilds } = await db.query(
      `SELECT guild_id, daily_schedule_channel_id
       FROM guild_settings
       WHERE daily_schedule_enabled IN ('true', '1', 1)`
    );

    if (!guilds.length) {
      t.info('No guilds have daily schedule enabled');
      return;
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    const todayData = await getDailySchedule(today, 'all').catch((err) => {
      t.warn('Failed to fetch daily schedule data', err);
      return [];
    });

    if (!todayData.length) {
      t.info('No episodes scheduled for today', { today });
      return;
    }

    todayData.sort((a, b) => new Date(a.episodeDate) - new Date(b.episodeDate));

    const e = embed({
      title: `📅 ${today}'s Anime Schedule`,
      desc:  `**${todayData.length}** anime airing today`,
      fields: todayData.slice(0, 25).map(a => ({
        name:  a.english || a.route || a.title || 'Unknown',
        value: `**Ep ${a.episodeNumber ?? '?'}** — <t:${Math.floor(new Date(a.episodeDate).getTime() / 1000)}:f>`,
      })),
      color:  '#0099ff',
      footer: todayData.length > 25 ? `Showing 25 of ${todayData.length}` : `${todayData.length} anime airing today`,
    });

    for (const { daily_schedule_channel_id: cid } of guilds) {
      if (!cid) continue;
      try {
        const chan = await bot.channels.fetch(cid).catch((err) => {
          tracer.warn('SCHEDULER: Post Daily Schedule', `Failed to fetch channel ${cid}`, err);
          return null;
        });
        if (!chan) continue;
        await chan.send({ embeds: [e] });
        tracer.debug('SCHEDULER: Post Daily Schedule', `Posted to channel ${cid}`);
      } catch (err) {
        tracer.error('SCHEDULER: Post Daily Schedule', `Failed to post to ${cid}`, err);
      }
    }

    t.end(`Posted to ${guilds.length} guild(s)`);
  } catch (e) {
    t.error('SCHEDULER: Post Daily Schedule', 'Failed to post daily schedule', e);
  }
}

module.exports = { initialize, schedule, cancel };