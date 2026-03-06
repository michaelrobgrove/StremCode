/**
 * StremCodes - Stremio Protocol Builders v1.4
 *
 * Stream matching - revised architecture:
 *
 * Problem: Fetching the full XC library on every stream request is too slow
 * (CF Pages = new isolate per request, no persistent cache, 30s wall limit).
 * A library of 10k items takes 3-8s to fetch, then we still need Cinemeta.
 * Total often exceeds the limit or the XC server throttles the bulk fetch.
 *
 * Solution:
 * 1. Cinemeta -> TMDB id (fast, ~200ms)
 * 2. XC getVodStreams with NO category filter but rely on the fact that
 *    XC servers support ?tmdb= filtering on some panels, OR we do a
 *    paginated search. Actually: we use the XC VOD search action which
 *    is much faster than fetching all streams.
 * 3. Fallback: fetch all streams but with a strict 10s timeout, cache
 *    result in CF KV if available.
 *
 * For series: same approach using series search.
 */

export function buildManifest(origin, token) {
  return {
    id: 'community.stremcodes',
    version: '1.4.0',
    name: 'StremCodes',
    description: 'Your Xtream Codes IPTV library in Stremio.',
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
      { name: 'catalog', types: ['movie', 'series'], idPrefixes: ['xc_'] },
      { name: 'meta',    types: ['movie', 'series'], idPrefixes: ['xc_'] },
      {
        name: 'stream',
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'kitsu', 'xc_'],
      },
    ],
    idPrefixes: ['xc_'],
    behaviorHints: { configurable: false, configurationRequired: false },
  };
}

// ---- Catalog ----------------------------------------------------------------

const PAGE_SIZE = 100;

export async function buildCatalog(client, type, catalogId, skip = 0, search = '') {
  if (type === 'movie') {
    let streams = await client.getVodStreams(null);
    if (!Array.isArray(streams)) streams = [];
    if (search) {
      const q = search.toLowerCase();
      streams = streams.filter(s => s.name && s.name.toLowerCase().includes(q));
    }
    return streams.slice(skip, skip + PAGE_SIZE).map(xcVodToMeta);
  }
  if (type === 'series') {
    let list = await client.getSeriesList(null);
    if (!Array.isArray(list)) list = [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name && s.name.toLowerCase().includes(q));
    }
    return list.slice(skip, skip + PAGE_SIZE).map(xcSeriesToMeta);
  }
  return [];
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

export async function buildStream(client, type, id, env) {
  if (id.startsWith('xc_')) return buildStreamForXcId(client, type, id);
  if (id.startsWith('tt') || id.startsWith('kitsu')) {
    return buildStreamForImdbId(client, type, id, env);
  }
  return [];
}

// Direct xc_ id -> stream URL (used from meta page, always works)
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

// IMDB id -> Cinemeta (get TMDB id + title) -> XC lookup
async function buildStreamForImdbId(client, type, id, env) {
  let imdbId = id;
  let season = null;
  let episode = null;

  if (type === 'series' && id.includes(':')) {
    const parts = id.split(':');
    imdbId = parts[0];
    season = parseInt(parts[1]);
    episode = parseInt(parts[2]);
  }

  // Step 1: Cinemeta lookup - get TMDB id and title
  const resolved = await resolveFromCinemeta(imdbId, type);

  if (type === 'movie') {
    return findVodByTmdb(client, resolved, env);
  }
  if (type === 'series' && season !== null && episode !== null) {
    return findSeriesEpisode(client, resolved, season, episode, env);
  }
  return [];
}

/**
 * Cinemeta lookup. Returns { tmdbId, name, year }.
 */
async function resolveFromCinemeta(imdbId, type) {
  try {
    const cinemetaType = type === 'series' ? 'series' : 'movie';
    const url = 'https://v3-cinemeta.strem.io/meta/' + cinemetaType + '/' + imdbId + '.json';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StremCodes/1.4' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { tmdbId: null, name: null, year: null };
    const data = await res.json();
    const meta = data && data.meta;
    if (!meta) return { tmdbId: null, name: null, year: null };

    let tmdbId = null;
    if (meta.tmdb_id) {
      tmdbId = String(meta.tmdb_id);
    }
    if (!tmdbId && Array.isArray(meta.links)) {
      for (const link of meta.links) {
        const m = link.url && link.url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
        if (m) { tmdbId = m[2]; break; }
      }
    }
    return { tmdbId, name: meta.name || null, year: meta.year || null };
  } catch (e) {
    console.log('Cinemeta error:', e && e.message);
    return { tmdbId: null, name: null, year: null };
  }
}

/**
 * Find VOD by TMDB id.
 *
 * Strategy (fast-first):
 * 1. Try KV cache of the TMDB->streamId mapping (if KV bound)
 * 2. Fetch full VOD list and scan (with aggressive timeout)
 * 3. Cache successful TMDB->streamId mappings in KV for next time
 */
async function findVodByTmdb(client, resolved, env) {
  const { tmdbId, name, year } = resolved;

  if (!tmdbId && !name) return [];

  // Check KV cache first (tmdb -> stream_id mapping)
  const kvKey = 'v:' + (tmdbId || normalizeTitle(name));
  if (env && env.STREAM_CACHE) {
    try {
      const cached = await env.STREAM_CACHE.get(kvKey);
      if (cached) {
        const { stream_id, ext } = JSON.parse(cached);
        return [{
          url: client.getVodStreamUrl(stream_id, ext),
          name: 'StremCodes',
          description: 'LowDefPirate XC · ' + ext.toUpperCase(),
          behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' },
        }];
      }
    } catch {}
  }

  // Fetch full library - give it 20 seconds
  let streams;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);
    streams = await client.getVodStreamsRaw(controller.signal);
    clearTimeout(t);
  } catch (e) {
    console.log('VOD fetch error:', e && e.message);
    return [];
  }
  if (!Array.isArray(streams)) return [];

  // Find by TMDB id (exact)
  let matches = [];
  if (tmdbId) {
    matches = streams.filter(s => s.tmdb && String(s.tmdb).trim() === tmdbId);
  }

  // Fuzzy title fallback
  if (matches.length === 0 && name) {
    matches = fuzzyFindVod(streams, name, year);
  }

  if (matches.length === 0) return [];

  // Cache first match in KV
  const best = matches[0];
  const ext = best.container_extension || 'mkv';
  if (env && env.STREAM_CACHE && tmdbId) {
    try {
      await env.STREAM_CACHE.put(kvKey, JSON.stringify({ stream_id: best.stream_id, ext }), {
        expirationTtl: 86400, // 24 hours
      });
    } catch {}
  }

  return matches.slice(0, 3).map(s => {
    const e = s.container_extension || 'mkv';
    return {
      url: client.getVodStreamUrl(s.stream_id, e),
      name: 'StremCodes',
      description: cleanName(s.name) + ' · ' + e.toUpperCase(),
      behaviorHints: { notWebReady: e !== 'mp4', bingeGroup: 'stremcodes' },
    };
  });
}

/**
 * Find series episode by TMDB id.
 */
async function findSeriesEpisode(client, resolved, season, episode, env) {
  const { tmdbId, name } = resolved;
  if (!tmdbId && !name) return [];

  // KV cache: tmdb -> series_id
  const kvKey = 's:' + (tmdbId || normalizeTitle(name));
  let seriesId = null;

  if (env && env.STREAM_CACHE) {
    try {
      const cached = await env.STREAM_CACHE.get(kvKey);
      if (cached) seriesId = cached;
    } catch {}
  }

  if (!seriesId) {
    // Fetch series list
    let list;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20000);
      list = await client.getSeriesListRaw(controller.signal);
      clearTimeout(t);
    } catch (e) {
      console.log('Series fetch error:', e && e.message);
      return [];
    }
    if (!Array.isArray(list)) return [];

    let match = null;
    if (tmdbId) {
      match = list.find(s => s.tmdb && String(s.tmdb).trim() === tmdbId);
    }
    if (!match && name) {
      const needle = normalizeTitle(name);
      let best = null, bestScore = 0;
      for (const s of list) {
        if (!s.name) continue;
        const score = titleSimilarity(normalizeTitle(s.name), needle);
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (bestScore > 0.6) match = best;
    }

    if (!match) return [];
    seriesId = String(match.series_id);

    // Cache it
    if (env && env.STREAM_CACHE && tmdbId) {
      try {
        await env.STREAM_CACHE.put(kvKey, seriesId, { expirationTtl: 86400 });
      } catch {}
    }
  }

  // Fetch episode list for matched series
  let info;
  try { info = await client.getSeriesInfo(seriesId); } catch { return []; }

  const eps = (info && info.episodes) || {};
  const seasonEps = eps[String(season)] || eps[String(season).padStart(2, '0')] || [];
  if (!Array.isArray(seasonEps)) return [];

  const ep = seasonEps.find(e => parseInt(e.episode_num) === episode);
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

function fuzzyFindVod(streams, titleName, titleYear) {
  const needle = normalizeTitle(titleName);
  const out = [];
  for (const s of streams) {
    if (!s.name) continue;
    const hay = normalizeTitle(s.name);
    const score = titleSimilarity(hay, needle);
    if (score < 0.6) continue;
    if (titleYear && s.year && String(s.year) !== String(titleYear)) continue;
    out.push({ s, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 3).map(x => x.s);
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
    cast: i.cast ? i.cast.split(',').map(s => s.trim()) : undefined,
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
  videos.sort((a, b) => a.season !== b.season ? a.season - b.season : a.episode - b.episode);
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
    cast: i.cast ? i.cast.split(',').map(s => s.trim()) : undefined,
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
  return cleanName(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1);
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
