const axios = require('axios');
const redis  = require('../schemas/redis');
const config = require('../../config.json');
const tracer = require('./tracer');

const JIKAN         = 'https://api.jikan.moe/v4';
const ANILIST       = 'https://graphql.anilist.co';
const ANIMESCHEDULE = 'https://animeschedule.net/api/v3';
const SCHEDULE_KEY  = config.apitokens.animeschedule;

const TTL = { search: 1800, details: 21600, schedule: 900, profile: 3600 };

// ── Cache wrapper ─────────────────────────────────────────────────────────────

async function cached(key, ttl, fetcher) {
  if (redis.client) {
    try {
      const hit = await redis.get(key);
      if (hit) {
        tracer.debug('API: Cache', `HIT ${key}`);
        return JSON.parse(hit);
      }
    } catch (e) {
      tracer.warn('API: Cache', `Redis GET failed for ${key}`, e);
    }
  }

  const data = await fetcher();

  if (redis.client && data != null) {
    redis.set(key, JSON.stringify(data), { EX: ttl }).catch(e =>
      tracer.warn('API: Cache', `Redis SET failed for ${key}`, e)
    );
  }

  return data;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function jikanGet(path, params = {}) {
  const t = tracer.start('API: Jikan', { path, params });
  try {
    const { data } = await axios.get(`${JIKAN}/${path}`, { params, timeout: 5000 });
    t.end('API: Jikan', 'jikanGet request successful');
    return data.data;
  } catch (e) {
    t.error('API: Jikan', 'jikanGet request failed', e);
    throw e;
  }
}

async function anilistPost(query, variables) {
  const t = tracer.start('API: AniList', { variables });
  try {
    const { data: { data } } = await axios.post(ANILIST, { query, variables }, { timeout: 5000 });
    t.end('API: AniList', 'anilistPost request successful');
    return data;
  } catch (e) {
    t.error('API: AniList', 'anilistPost request failed', e);
    throw e;
  }
}

async function scheduleRequest(type) {
  const t = tracer.start('API: AnimeSchedule', { type });
  try {
    const { data } = await axios.get(`${ANIMESCHEDULE}/timetables/${type}`, {
      headers: { Authorization: `Bearer ${SCHEDULE_KEY}` },
      timeout: 5000,
    });
    t.end('API: AnimeSchedule', 'scheduleRequest request successful');
    return data || [];
  } catch (e) {
    t.error('API: AnimeSchedule', 'scheduleRequest request failed', e);
    throw e;
  }
}

async function withFallback(primary, fallback) {
  try {
    return await primary();
  } catch (err) {
    tracer.warn('API: withFallback', 'Primary failed, trying fallback', err?.message);
    if (fallback) {
      try { return await fallback(); } catch (err2) {
        tracer.error('API: withFallback', 'Fallback also failed', err2);
      }
    }
    throw err;
  }
}

// ── Field fragments ───────────────────────────────────────────────────────────

const MEDIA_FIELDS = `id idMal title { romaji english native } status
  nextAiringEpisode { airingAt timeUntilAiring episode }
  coverImage { large }`;

const USER_FIELDS = `id name about avatar { large }
  statistics { anime { count meanScore minutesWatched } manga { count chaptersRead volumesRead } }
  favourites {
    anime { nodes { id title { romaji english } averageScore coverImage { large } } }
    manga { nodes { id title { romaji english } averageScore coverImage { large } } }
  }`;

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function anilistToJikan(a, type = 'anime') {
  return {
    mal_id: a.idMal, title: a.title?.romaji, title_english: a.title?.english,
    title_japanese: a.title?.native, status: a.status,
    url: `https://anilist.co/${type}/${a.id}`,
    images: { jpg: { large_image_url: a.coverImage?.large } },
    score: a.averageScore ? a.averageScore / 10 : null,
    episodes: a.episodes, volumes: a.volumes,
    synopsis: a.description?.replace(/<[^>]*>/g, ''),
    _anilistId: a.id, _source: 'anilist',
  };
}

// ── Anime (Jikan-format) ──────────────────────────────────────────────────────

const searchAnime = (query, limit = 10) => cached(
  `svc:anime:search:${query.toLowerCase()}:${limit}`, TTL.search,
  () => withFallback(
    () => jikanGet('anime', { q: query, limit }),
    () => anilistPost(
      `query($s:String,$l:Int){Page(perPage:$l){media(search:$s,type:ANIME){${MEDIA_FIELDS} averageScore episodes description}}}`,
      { s: query, l: limit }
    ).then(d => (d.Page?.media || []).map(a => anilistToJikan(a)))
  )
);

const getAnimeDetails = (malId) => cached(
  `svc:anime:details:${malId}`, TTL.details,
  () => withFallback(
    () => jikanGet(`anime/${malId}/full`),
    () => anilistPost(
      `query($id:Int){Media(idMal:$id,type:ANIME){${MEDIA_FIELDS} averageScore episodes description genres}}`,
      { id: parseInt(malId) }
    ).then(d => d.Media ? anilistToJikan(d.Media) : null)
  )
);

// ── Anime (AniList-format, for watchlist/notifications) ───────────────────────

const getAnimeByAniListId = (id) => cached(
  `svc:anime:anilist:${id}`, TTL.details,
  () => anilistPost(`query($id:Int){Media(id:$id,type:ANIME){${MEDIA_FIELDS}}}`, { id: parseInt(id) })
    .then(d => d.Media)
);

const getAnimeByMalId = (malId) => cached(
  `svc:anime:mal:${malId}`, TTL.details,
  () => anilistPost(`query($m:Int){Media(idMal:$m,type:ANIME){${MEDIA_FIELDS}}}`, { m: parseInt(malId) })
    .then(d => d.Media)
);

const searchAnimeAniList = (search, limit = 10) => cached(
  `svc:anime:anilist:search:${search.toLowerCase()}`, TTL.search,
  () => anilistPost(
    `query($s:String,$l:Int){Page(perPage:$l){media(search:$s,type:ANIME){${MEDIA_FIELDS}}}}`,
    { s: search, l: limit }
  ).then(d => d.Page?.media || [])
);

// ── AnimeSchedule /anime endpoint (by AniList ID) ─────────────────────────────
// Returns a single show's schedule entry from AnimeSchedule.
// Cached with a short TTL since episode dates change frequently.

const getAnimeScheduleByAniListId = (anilistId) => cached(
  `svc:animeschedule:anime:${anilistId}`, TTL.schedule,
  async () => {
    const t = tracer.start('API: AnimeSchedule: getAnimeScheduleByAniListId', { anilistId });
    try {
      const { data } = await axios.get(`${ANIMESCHEDULE}/anime`, {
        headers: { Authorization: `Bearer ${SCHEDULE_KEY}` },
        params: { anilistId },
        timeout: 5000,
      });
      // API returns an array; take the first match
      const result = Array.isArray(data) ? data[0] ?? null : null;
      t.end('API: AnimeSchedule', 'getAnimeScheduleByAniListId request successful', { found: !!result });
      return result;
    } catch (e) {
      t.error('API: AnimeSchedule', 'getAnimeScheduleByAniListId request failed', e);
      return null;
    }
  }
);

// ── Manga (Jikan-format) ──────────────────────────────────────────────────────

const searchManga = (query, limit = 10) => cached(
  `svc:manga:search:${query.toLowerCase()}:${limit}`, TTL.search,
  () => withFallback(
    () => jikanGet('manga', { q: query, limit }),
    () => anilistPost(
      `query($s:String,$l:Int){Page(perPage:$l){media(search:$s,type:MANGA){id idMal title{romaji english native} coverImage{large} status averageScore volumes description}}}`,
      { s: query, l: limit }
    ).then(d => (d.Page?.media || []).map(m => anilistToJikan(m, 'manga')))
  )
);

const getMangaDetails = (malId) => cached(
  `svc:manga:details:${malId}`, TTL.details,
  () => withFallback(
    () => jikanGet(`manga/${malId}/full`),
    () => anilistPost(
      `query($id:Int){Media(idMal:$id,type:MANGA){id idMal title{romaji english native} description volumes chapters status averageScore coverImage{large}}}`,
      { id: parseInt(malId) }
    ).then(d => d.Media ? anilistToJikan(d.Media, 'manga') : null)
  )
);

// ── Schedule (AnimeSchedule timetables) ───────────────────────────────────────

const getSchedule = (type) => cached(
  `svc:schedule:${type}`, TTL.schedule,
  () => scheduleRequest(type).catch((err) => {
    tracer.warn('API: Schedule', `Failed to fetch ${type} timetable, returning []`, err);
    return [];
  })
);

async function getDailySchedule(day, airType = 'all') {
  const list = await getSchedule(airType);
  return (list || []).filter(a =>
    new Date(a.episodeDate).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() === day.toLowerCase()
  );
}

async function getNextEpisode(titles) {
  const targets = titles.filter(Boolean).map(normalize);

  try {
    const list = await getSchedule('sub');
    if (list?.length) {
      const match =
        list.find(a => targets.includes(normalize(a.title))) ||
        list.find(a => targets.some(t => t.length > 3 && (normalize(a.title).includes(t) || t.includes(normalize(a.title)))));
      if (match) return { title: match.title, episodeDate: match.episodeDate, episodeNumber: match.episodeNumber };
    }
  } catch {
    tracer.warn('API: Schedule', 'AnimeSchedule lookup failed, falling back to AniList');
  }

  for (const title of titles.filter(Boolean)) {
    try {
      const res = await anilistPost(
        `query($s:String){Media(search:$s,type:ANIME,status:RELEASING){nextAiringEpisode{airingAt episode}title{romaji english}}}`,
        { s: title }
      );
      if (res.Media?.nextAiringEpisode) {
        return {
          title:         res.Media.title.english || res.Media.title.romaji,
          episodeDate:   new Date(res.Media.nextAiringEpisode.airingAt * 1000).toISOString(),
          episodeNumber: res.Media.nextAiringEpisode.episode,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ── User Profiles ─────────────────────────────────────────────────────────────

const getMALUser = (username, options = {}) => {
  const key = `svc:mal:user:${username.toLowerCase()}`;
  const fetcher = () => jikanGet(`users/${username}`);
  return options.fresh ? fetcher() : cached(key, TTL.profile, fetcher);
};

const getMALUserStats = (username) => cached(
  `svc:mal:stats:${username.toLowerCase()}`, TTL.profile,
  () => jikanGet(`users/${username}/statistics`)
);

const getMALUserFavorites = (username) => cached(
  `svc:mal:favs:${username.toLowerCase()}`, TTL.profile,
  () => jikanGet(`users/${username}/favorites`)
);

const getAniListUser = (username, options = {}) => {
  const key = `svc:anilist:user:${username.toLowerCase()}`;
  const fetcher = () => anilistPost(`query($u:String){User(name:$u){${USER_FIELDS}}}`, { u: username }).then(d => d.User);
  return options.fresh ? fetcher() : cached(key, TTL.profile, fetcher);
};

module.exports = {
  searchAnime, getAnimeDetails,
  getAnimeByAniListId, getAnimeByMalId, searchAnimeAniList,
  getAnimeScheduleByAniListId,
  searchManga, getMangaDetails,
  getSchedule, getDailySchedule, getNextEpisode,
  getMALUser, getMALUserStats, getMALUserFavorites, getAniListUser,
};