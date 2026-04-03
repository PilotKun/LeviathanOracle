const axios = require('axios');
const redis = require('../schemas/redis');
const config = require('../../config.json');

const JIKAN = 'https://api.jikan.moe/v4';
const ANILIST = 'https://graphql.anilist.co';
const ANIMESCHEDULE = 'https://animeschedule.net/api/v3';
const SCHEDULE_KEY = config.apitokens.animeschedule;

const TTL = { search: 1800, details: 21600, schedule: 900, profile: 3600 };

async function cached(key, ttl, fetcher) {
  if (redis.client) {
    const hit = await redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit);
  }
  const data = await fetcher();
  if (redis.client && data != null) await redis.set(key, JSON.stringify(data), { EX: ttl }).catch(() => null);
  return data;
}

async function jikanGet(path, params = {}) {
  const { data } = await axios.get(`${JIKAN}/${path}`, { params, timeout: 5000 });
  return data.data;
}

async function anilistPost(query, variables) {
  const { data: { data } } = await axios.post(ANILIST, { query, variables }, { timeout: 5000 });
  return data;
}

async function scheduleRequest(type) {
  const { data } = await axios.get(`${ANIMESCHEDULE}/timetables/${type}`, {
    headers: { Authorization: `Bearer ${SCHEDULE_KEY}` }, timeout: 5000
  });
  return data || [];
}

async function withFallback(primary, fallback) {
  try { return await primary(); } catch (err) {
    if (fallback) try { return await fallback(); } catch { /* both failed */ }
    throw err;
  }
}

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
    _anilistId: a.id, _source: 'anilist'
  };
}

// --- Anime (Jikan-format, for search/details commands) ---

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

// --- Anime (AniList-format, for watchlist/notification systems) ---

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

// --- Manga (Jikan-format with AniList fallback) ---

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

// --- Schedule (AnimeSchedule primary, AniList fallback for next episode) ---

const getSchedule = (type) => cached(
  `svc:schedule:${type}`, TTL.schedule,
  () => scheduleRequest(type).catch(() => [])
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
      const match = list.find(a => targets.includes(normalize(a.title))) ||
        list.find(a => targets.some(t => t.length > 3 && (normalize(a.title).includes(t) || t.includes(normalize(a.title)))));
      if (match) return { title: match.title, episodeDate: match.episodeDate, episodeNumber: match.episodeNumber };
    }
  } catch { /* fall through to AniList */ }

  for (const t of titles.filter(Boolean)) {
    try {
      const res = await anilistPost(
        `query($s:String){Media(search:$s,type:ANIME,status:RELEASING){nextAiringEpisode{airingAt episode}title{romaji english}}}`,
        { s: t }
      );
      if (res.Media?.nextAiringEpisode) {
        return {
          title: res.Media.title.english || res.Media.title.romaji,
          episodeDate: new Date(res.Media.nextAiringEpisode.airingAt * 1000).toISOString(),
          episodeNumber: res.Media.nextAiringEpisode.episode
        };
      }
    } catch { continue; }
  }
  return null;
}

// --- User Profiles ---

const getMALUser = (username) => cached(
  `svc:mal:user:${username.toLowerCase()}`, TTL.profile,
  () => jikanGet(`users/${username}`)
);

const getMALUserStats = (username) => cached(
  `svc:mal:stats:${username.toLowerCase()}`, TTL.profile,
  () => jikanGet(`users/${username}/statistics`)
);

const getMALUserFavorites = (username) => cached(
  `svc:mal:favs:${username.toLowerCase()}`, TTL.profile,
  () => jikanGet(`users/${username}/favorites`)
);

const getAniListUser = (username) => cached(
  `svc:anilist:user:${username.toLowerCase()}`, TTL.profile,
  () => anilistPost(`query($u:String){User(name:$u){${USER_FIELDS}}}`, { u: username }).then(d => d.User)
);

module.exports = {
  searchAnime, getAnimeDetails,
  getAnimeByAniListId, getAnimeByMalId, searchAnimeAniList,
  searchManga, getMangaDetails,
  getSchedule, getDailySchedule, getNextEpisode,
  getMALUser, getMALUserStats, getMALUserFavorites, getAniListUser,
};