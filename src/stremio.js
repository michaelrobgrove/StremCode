/**
 * StremCodes - Stremio Protocol Builders v1.3
 *
 * Stream matching strategy:
 * 1. Build a TMDB-keyed index of the XC library (cached in memory per worker instance)
 * 2. IMDB -> TMDB via Cinemeta, then instant O(1) index lookup
 * 3. Fuzzy title fallback only when TMDB id unavailable
 */

export function buildManifest(origin, token) {
  return {
    id: 'community.stremcodes',
    version: '1.3.0',
    name: 'StremCodes',
    description: 'Your Xtream Codes IPTV library in Stremio. Streams appear on every matching title.',
    logo: `${origin}/logo.png`,
    background: `${origin}/bg.png`,
    types: ['movie', 'series'],
    catalogs: [
      {
        type: 'movie',
        id: 'xc_vod_all',
        name: 'XC Movies',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
      {
        type: 'series',
        id: 'xc_series_all',
        name: 'XC Series',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
    ],
    resources: [
      {
        name: 'catalog',
        types: ['movie', 'series'],
        idPrefixes: ['xc_'],
      },
      {
        name: 'meta',
        types: ['movie', 'series'],
        idPrefixes: ['xc_'],
      },
      {
        name: 'stream',
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'kitsu', 'xc_'],
      },
    ],
    idPrefixes: ['xc_'],
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
  };
}

// In-memory cache (per CF worker instance, 5 min TTL)
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

// ---- Catalog ----------------------------------------------------------------

const PAGE_SIZE = 100;

export async function buildCatalog(client, type, catalogId, skip = 0, search = '') {
  if (type === 'movie') {
    const streams = await getCachedVodStreams(client);
    let results = streams;
    if (search) {
      const q = search.toLowerCase();
      results = streams.filter(s => s.name && s.name.toLowerCase().includes(q));
    }
    return results.slice(skip, skip + PAGE_SIZE).map(xcVodToMeta);
  }
  if (type === 'series') {
    const list = await getCachedSeriesList(client);
    let results = list;
    if (search) {
      const q = search.toLowerCase();
      results = list.filter(s => s.name && s.name.toLowerCase().includes(q));
    }
    return results.slice(skip, skip + PAGE_SIZE).map(xcSeriesToMeta);
  }
  return [];
}

// ---- Cached library fetchers ------------------------------------------------

async function getCachedVodStreams(client) {
  const key = `vod:${client.server}:${client.username}`;
  let data = cacheGet(key);
  if (!data) {
    data = await client.getVodStreams();
    if (!Array.isArray(data)) data = [];
    cacheSet(key, data);
  }
  return data;
}

async function getCachedSeriesList(client) {
  const key = `series:${client.server}:${client.username}`;
  let data = cacheGet(key);
  if (!data) {
    data = await client.getSeriesList();
    if (!Array.isArray(data)) data = [];
    cacheSet(key, data);
  }
  return data;
}

// Build TMDB->stream[] index once, cache it
async function getVodTmdbIndex(client) {
  const key = `vod_idx:${client.server}:${client.username}`;
  let index = cacheGet(key);
  if (!index) {
    const streams = await getCachedVodStreams(client);
    index = new Map();
    for (const s of streams) {
      const tid = s.tmdb ? String(s.tmdb).trim() : '';
      if (tid && tid !== '0') {
        if (!index.has(tid)) index.set(tid, []);
        index.get(tid).push(s);
      }
    }
    cacheSet(key, index);
  }
  return index;
}

async function getSeriesTmdbIndex(client) {
  const key = `series_idx:${client.server}:${client.username}`;
  let index = cacheGet(key);
  if (!index) {
    const list = await getCachedSeriesList(client);
    index = new Map();
    for (const s of list) {
      const tid = s.tmdb ? String(s.tmdb).trim() : '';
      if (tid && tid !== '0') {
        if (!index.has(tid)) index.set(tid, []);
        index.get(tid).push(s);
      }
    }
    cacheSet(key, index);
  }
  return index;
}

// ---- Meta -------------------------------------------------------------------

export async function buildMeta(client, type, id) {
  if (type === 'movie') {
    const vodId = id.replace('xc_vod_', '');
    let info;
    try { info = await client.getVodInfo(vodId); } catch { return null; }
    if (!info || !info.movie_data) return null;
    return xcVodInfoToFullMeta(id, info);
  }
  if (type === 'series') {
    const seriesId = id.replace('xc_series_', '');
    let info;
    try { info = await client.getSeriesInfo(seriesId); } catch { return null; }
    if (!info || !info.info) return null;
    return xcSeriesInfoToFullMeta(id, info);
  }
  return null;
}

// ---- Streams ----------------------------------------------------------------

export async function buildStream(client, type, id) {
  if (id.startsWith('xc_')) return buildStreamForXcId(client, type, id);
  if (id.startsWith('tt') || id.startsWith('kitsu')) return buildStreamForImdbId(client, type, id);
  return [];
}

async function buildStreamForXcId(client, type, id) {
  if (type === 'movie') {
    const vodId = id.replace('xc_vod_', '');
    let ext = 'mkv';
    try {
      const info = await client.getVodInfo(vodId);
      if (info && info.movie_data && info.movie_data.container_extension) {
        ext = info.movie_data.container_extension;
      }
    } catch {}
    return [{
      url: client.getVodStreamUrl(vodId, ext),
      name: 'StremCodes',
      description: 'LowDefPirate XC · ' + ext.toUpperCase(),
      behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' },
    }];
  }
  if (type === 'series') {
    const ep = id.replace('xc_ep_', '');
    const parts = ep.split('_');
    const streamId = parts[0];
    const ext = parts[1] || 'mkv';
    return [{
      url: client.getSeriesStreamUrl(streamId, ext),
      name: 'StremCodes',
      description: 'LowDefPirate XC · ' + ext.toUpperCase(),
      behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' },
    }];
  }
  return [];
}

async function buildStreamForImdbId(client, type, id) {
  let imdbId = id;
  let season = null;
  let episode = null;

  if (type === 'series' && id.includes(':')) {
    const parts = id.split(':');
    imdbId = parts[0];
    season = parseInt(parts[1]);
    episode = parseInt(parts[2]);
  }

  const resolved = await resolveFromCinemeta(imdbId, type);

  if (type === 'movie') {
    return matchVodStream(client, resolved);
  }
  if (type === 'series' && season !== null && episode !== null) {
    return matchSeriesStream(client, resolved, season, episode);
  }
  return [];
}

async function resolveFromCinemeta(imdbId, type) {
  try {
    const cinemetaType = type === 'series' ? 'series' : 'movie';
    const res = await fetch(
      'https://v3-cinemeta.strem.io/meta/' + cinemetaType + '/' + imdbId + '.json',
      { headers: { 'User-Agent': 'StremCodes/1.3' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { tmdbId: null, name: null, year: null };
    const data = await res.json();
    const meta = data && data.meta;
    if (!meta) return { tmdbId: null, name: null, year: null };

    let tmdbId = null;
    if (meta.tmdb_id) tmdbId = String(meta.tmdb_id);
    if (!tmdbId && Array.isArray(meta.links)) {
      for (const link of meta.links) {
        const m = link.url && link.url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
        if (m) { tmdbId = m[2]; break; }
      }
    }
    return { tmdbId, name: meta.name || null, year: meta.year || null };
  } catch {
    return { tmdbId: null, name: null, year: null };
  }
}

async function matchVodStream(client, resolved) {
  const { tmdbId, name, year } = resolved;

  if (tmdbId) {
    const index = await getVodTmdbIndex(client);
    const matches = index.get(tmdbId);
    if (matches && matches.length > 0) {
      return matches.map(function(s) {
        const ext = s.container_extension || 'mkv';
        return {
          url: client.getVodStreamUrl(s.stream_id, ext),
          name: 'StremCodes',
          description: cleanName(s.name) + ' · ' + ext.toUpperCase(),
          behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' },
        };
      });
    }
  }

  // Fuzzy fallback
  if (name) {
    const streams = await getCachedVodStreams(client);
    return fuzzyMatchVod(streams, client, name, year);
  }
  return [];
}

async function matchSeriesStream(client, resolved, season, episode) {
  const { tmdbId, name } = resolved;
  let bestMatch = null;

  if (tmdbId) {
    const index = await getSeriesTmdbIndex(client);
    const matches = index.get(tmdbId);
    if (matches && matches.length > 0) bestMatch = matches[0];
  }

  if (!bestMatch && name) {
    const list = await getCachedSeriesList(client);
    const needle = normalizeTitle(name);
    let best = null, bestScore = 0;
    for (const s of list) {
      if (!s.name) continue;
      const score = titleSimilarity(normalizeTitle(s.name), needle);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (bestScore > 0.5) bestMatch = best;
  }

  if (!bestMatch) return [];

  let info;
  try { info = await client.getSeriesInfo(bestMatch.series_id); } catch { return []; }

  const eps = info && info.episodes || {};
  const seasonEps = eps[String(season)] || eps[String(season).padStart(2, '0')] || [];
  if (!Array.isArray(seasonEps)) return [];

  const ep = seasonEps.find(function(e) { return parseInt(e.episode_num) === episode; });
  if (!ep) return [];

  const ext = ep.container_extension || 'mkv';
  const s2 = String(season).padStart(2, '0');
  const e2 = String(episode).padStart(2, '0');
  return [{
    url: client.getSeriesStreamUrl(ep.id, ext),
    name: 'StremCodes',
    description: 'S' + s2 + 'E' + e2 + ' · ' + ext.toUpperCase(),
    behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' },
  }];
}

function fuzzyMatchVod(streams, client, titleName, titleYear) {
  const needle = normalizeTitle(titleName);
  const candidates = [];
  for (const s of streams) {
    if (!s.name) continue;
    const hay = normalizeTitle(s.name);
    if (hay === needle || hay.includes(needle) || needle.includes(hay)) {
      if (titleYear && s.year && String(s.year) !== String(titleYear)) continue;
      candidates.push({ s, score: titleSimilarity(hay, needle) });
    }
  }
  candidates.sort(function(a, b) { return b.score - a.score; });
  return candidates.slice(0, 3).map(function(item) {
    const ext = item.s.container_extension || 'mkv';
    return {
      url: client.getVodStreamUrl(item.s.stream_id, ext),
      name: 'StremCodes',
      description: cleanName(item.s.name) + ' · ' + ext.toUpperCase(),
      behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' },
    };
  });
}

// ---- XC -> Stremio converters -----------------------------------------------

function xcVodToMeta(stream) {
  return {
    id: 'xc_vod_' + stream.stream_id,
    type: 'movie',
    name: cleanName(stream.name),
    poster: stream.stream_icon || null,
    posterShape: 'poster',
    genres: stream.category_name ? [stream.category_name] : undefined,
    description: stream.plot || undefined,
    year: stream.year ? parseInt(stream.year) : undefined,
    imdbRating: stream.rating ? parseFloat(stream.rating) : undefined,
  };
}

function xcSeriesToMeta(series) {
  return {
    id: 'xc_series_' + series.series_id,
    type: 'series',
    name: cleanName(series.name),
    poster: series.cover || null,
    posterShape: 'poster',
    genres: series.category_name ? [series.category_name] : undefined,
    description: series.plot || undefined,
    year: series.releaseDate ? parseInt(series.releaseDate) : undefined,
    imdbRating: series.rating ? parseFloat(series.rating) : undefined,
  };
}

function xcVodInfoToFullMeta(id, info) {
  const d = info.movie_data;
  const i = info.info || {};
  return {
    id: id, type: 'movie',
    name: cleanName(d.name || i.name),
    poster: i.movie_image || d.stream_icon || null,
    background: (i.backdrop_path && i.backdrop_path[0]) || null,
    posterShape: 'poster',
    description: i.plot || d.plot || null,
    year: i.releasedate ? parseInt(i.releasedate) : undefined,
    imdbRating: i.rating ? parseFloat(i.rating) : undefined,
    runtime: i.duration || null,
    genres: i.genre ? i.genre.split(', ') : undefined,
    director: i.director ? [i.director] : undefined,
    cast: i.cast ? i.cast.split(',').map(function(s) { return s.trim(); }) : undefined,
    trailerStreams: i.youtube_trailer ? [{ title: 'Trailer', ytId: i.youtube_trailer }] : undefined,
    links: i.tmdb_id ? [{ name: 'TMDB', category: 'TMDB', url: 'https://www.themoviedb.org/movie/' + i.tmdb_id }] : undefined,
  };
}

function xcSeriesInfoToFullMeta(id, info) {
  const i = info.info || {};
  const eps = info.episodes || {};
  const videos = [];
  for (const seasonNum of Object.keys(eps)) {
    const episodes = eps[seasonNum];
    if (!Array.isArray(episodes)) continue;
    for (const ep of episodes) {
      const ext = ep.container_extension || 'mkv';
      videos.push({
        id: 'xc_ep_' + ep.id + '_' + ext,
        title: ep.title || ('S' + seasonNum + 'E' + ep.episode_num),
        season: parseInt(seasonNum),
        episode: parseInt(ep.episode_num),
        thumbnail: (ep.info && ep.info.movie_image) || null,
        overview: (ep.info && ep.info.plot) || null,
        released: (ep.info && ep.info.releasedate) ? new Date(ep.info.releasedate).toISOString() : undefined,
      });
    }
  }
  videos.sort(function(a, b) { return a.season !== b.season ? a.season - b.season : a.episode - b.episode; });
  return {
    id: id, type: 'series',
    name: cleanName(i.name),
    poster: i.cover || null,
    background: (i.backdrop_path && i.backdrop_path[0]) || null,
    posterShape: 'poster',
    description: i.plot || null,
    year: i.releaseDate ? parseInt(i.releaseDate) : undefined,
    imdbRating: i.rating ? parseFloat(i.rating) : undefined,
    genres: i.genre ? i.genre.split(', ') : undefined,
    cast: i.cast ? i.cast.split(',').map(function(s) { return s.trim(); }) : undefined,
    director: i.director ? [i.director] : undefined,
    videos: videos,
  };
}

// ---- Helpers ----------------------------------------------------------------

function cleanName(name) {
  if (!name) return 'Unknown';
  return name
    .replace(/\b(4K|1080p|720p|480p|HDR|SDR|HEVC|x265|x264|AAC|AC3|BluRay|WEBRip|REPACK)\b/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeTitle(name) {
  return cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    for (let j = 0; j <= n; j++) {
      dp[i][j] = i === 0 ? j : j === 0 ? i : 0;
    }
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
