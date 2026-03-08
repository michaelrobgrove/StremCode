/**
 * StremCodes - Stremio Protocol Builders v2.0
 */

import { resolveImdb } from './cinemeta.js';
import { getOrBuildIndex } from './index-builder.js';

const PAGE_SIZE = 100;

export function buildDefaultManifest(origin) {
  return {
    id: 'community.stremcodes.ldp',
    version: '2.1.1',
    name: 'StremCodes',
    description: 'Connect your Xtream Codes IPTV subscription to Stremio. Streams movies and series directly from your own provider. Credentials are AES-256 encrypted and never stored. Configure with your provider credentials to get started.',
    logo: 'https://vault.managedservers.click/api/public/dl/-3vBXLi2?inline=true',
    types: ['movie', 'series'],
    catalogs: [],
    resources: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
      configurationURL: origin + '/configure',
    },
    stremioAddonsConfig: {
      issuer: 'https://stremio-addons.net',
      signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..QQoYm2esFtBVRyKfJMy9yg.j3iqkkjc19DFAzOeSCBDzBfCZDf-OizkE8EMtPAvrUWHRY69gqw11n1J849r_KC4H-SU2kXXtdot9Z7Qe4WrVVKEnT-RFILyzn7w1xXf4PcO3aK-knse1q-U3CgxNkMu.HeZMqwUnF2IC5efdjp-fCw',
    },
  };
}

export function buildManifest(origin, token) {
  return {
    id: 'community.stremcodes.ldp',
    version: '2.0.0',
    name: 'StremCodes',
    description: 'Your Xtream Codes IPTV library in Stremio — by LowDefPirate.',
    logo: 'https://vault.managedservers.click/api/public/dl/-3vBXLi2?inline=true',
    background: origin + '/bg.png',
    types: ['movie', 'series'],
    catalogs: [
      { type: 'movie',  id: 'xc_vod_all',    name: 'XC Movies',  extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
      { type: 'series', id: 'xc_series_all', name: 'XC Series', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    ],
    resources: [
      { name: 'catalog', types: ['movie', 'series'], idPrefixes: ['xc_'] },
      { name: 'meta',    types: ['movie', 'series'], idPrefixes: ['xc_'] },
      { name: 'stream',  types: ['movie', 'series'], idPrefixes: ['tt', 'kitsu', 'xc_'] },
    ],
    idPrefixes: ['xc_'],
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
      configurationURL: origin + '/configure',
    },
    stremioAddonsConfig: {
      issuer: 'https://stremio-addons.net',
      signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..QQoYm2esFtBVRyKfJMy9yg.j3iqkkjc19DFAzOeSCBDzBfCZDf-OizkE8EMtPAvrUWHRY69gqw11n1J849r_KC4H-SU2kXXtdot9Z7Qe4WrVVKEnT-RFILyzn7w1xXf4PcO3aK-knse1q-U3CgxNkMu.HeZMqwUnF2IC5efdjp-fCw',
    },
  };
}

export async function buildCatalog(client, type, skip, search) {
  skip = skip || 0; search = search || '';
  if (type === 'movie') {
    let s = await client.getVodStreams().catch(() => []);
    if (!Array.isArray(s)) s = [];
    if (search) { const q = search.toLowerCase(); s = s.filter(x => x.name && x.name.toLowerCase().includes(q)); }
    return s.slice(skip, skip + PAGE_SIZE).map(xcVodToMeta);
  }
  if (type === 'series') {
    let s = await client.getSeriesList().catch(() => []);
    if (!Array.isArray(s)) s = [];
    if (search) { const q = search.toLowerCase(); s = s.filter(x => x.name && x.name.toLowerCase().includes(q)); }
    return s.slice(skip, skip + PAGE_SIZE).map(xcSeriesToMeta);
  }
  return [];
}

export async function buildMeta(client, type, id) {
  if (type === 'movie') {
    const info = await client.getVodInfo(id.replace('xc_vod_', '')).catch(() => null);
    if (!info || !info.movie_data) return null;
    return xcVodInfoToFullMeta(id, info);
  }
  if (type === 'series') {
    const info = await client.getSeriesInfo(id.replace('xc_series_', '')).catch(() => null);
    if (!info || !info.info) return null;
    return xcSeriesInfoToFullMeta(id, info);
  }
  return null;
}

export async function buildStream(client, type, id, credHash, kv) {
  if (id.startsWith('xc_'))                          return buildStreamDirect(client, type, id);
  if (id.startsWith('tt') || id.startsWith('kitsu')) return buildStreamImdb(client, type, id, credHash, kv);
  return [];
}

async function buildStreamDirect(client, type, id) {
  if (type === 'movie') {
    const vodId = id.replace('xc_vod_', '');
    let ext = 'mkv';
    try { const i = await client.getVodInfo(vodId); if (i?.movie_data?.container_extension) ext = i.movie_data.container_extension; } catch {}
    return [{ url: client.vodUrl(vodId, ext), name: 'StremCodes', description: 'LowDefPirate · ' + ext.toUpperCase(), behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' } }];
  }
  if (type === 'series') {
    const p = id.replace('xc_ep_', '').split('_');
    const ext = p[1] || 'mkv';
    return [{ url: client.seriesUrl(p[0], ext), name: 'StremCodes', description: 'LowDefPirate · ' + ext.toUpperCase(), behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' } }];
  }
  return [];
}

async function buildStreamImdb(client, type, rawId, credHash, kv) {
  rawId = decodeURIComponent(rawId);
  let imdbId = rawId, season = null, episode = null;
  if (type === 'series' && rawId.includes(':')) {
    const p = rawId.split(':'); imdbId = p[0]; season = parseInt(p[1]); episode = parseInt(p[2]);
  }

  // Parallel: Cinemeta + index build
  const [resolved, { vodIndex, seriesIndex }] = await Promise.all([
    resolveImdb(imdbId, type, kv),
    getOrBuildIndex(client, credHash, kv),
  ]);

  const tmdbId = resolved && resolved.tmdbId;
  if (!tmdbId) { console.log('No TMDB id for', imdbId); return []; }

  if (type === 'movie') {
    const entry = vodIndex.get(tmdbId);
    if (!entry) { console.log('TMDB', tmdbId, 'not in VOD index'); return []; }
    return [{ url: client.vodUrl(entry.id, entry.ext), name: 'StremCodes', description: (entry.name || 'XC') + ' · ' + entry.ext.toUpperCase(), behaviorHints: { notWebReady: entry.ext !== 'mp4', bingeGroup: 'stremcodes' } }];
  }

  if (type === 'series' && season !== null) {
    const seriesId = seriesIndex.get(tmdbId);
    console.log('[series] tmdbId=' + tmdbId + ' seriesId=' + seriesId + ' season=' + season + ' ep=' + episode);
    if (!seriesId) { console.log('[series] TMDB ' + tmdbId + ' not in series index'); return []; }
    const info = await client.getSeriesInfo(seriesId).catch(e => { console.log('[series] getSeriesInfo failed:', e && e.message); return null; });
    console.log('[series] info keys:', info ? Object.keys(info).join(',') : 'null');
    if (!info?.episodes) { console.log('[series] no episodes in info'); return []; }
    const eps = info.episodes;
    const seasonKeys = Object.keys(eps);
    console.log('[series] season keys in response:', seasonKeys.join(','));
    const seasonEps = eps[String(season)] || eps[String(season).padStart(2, '0')] || [];
    console.log('[series] seasonEps count:', Array.isArray(seasonEps) ? seasonEps.length : 'not array');
    if (!Array.isArray(seasonEps)) return [];
    const ep = seasonEps.find(e => parseInt(e.episode_num) === episode);
    console.log('[series] episode found:', ep ? ep.id : 'NOT FOUND', 'looking for episode_num=' + episode);
    if (!ep) return [];
    const ext = ep.container_extension || 'mkv';
    return [{ url: client.seriesUrl(ep.id, ext), name: 'StremCodes', description: 'S' + String(season).padStart(2,'0') + 'E' + String(episode).padStart(2,'0') + ' · ' + ext.toUpperCase(), behaviorHints: { notWebReady: ext !== 'mp4', bingeGroup: 'stremcodes' } }];
  }
  return [];
}

function xcVodToMeta(s) { return { id: 'xc_vod_' + s.stream_id, type: 'movie', name: clean(s.name), poster: s.stream_icon || null, posterShape: 'poster', year: s.year ? parseInt(s.year) : undefined, imdbRating: s.rating ? parseFloat(s.rating) : undefined }; }
function xcSeriesToMeta(s) { return { id: 'xc_series_' + s.series_id, type: 'series', name: clean(s.name), poster: s.cover || null, posterShape: 'poster', year: s.releaseDate ? parseInt(s.releaseDate) : undefined, imdbRating: s.rating ? parseFloat(s.rating) : undefined }; }

function xcVodInfoToFullMeta(id, info) {
  const d = info.movie_data, i = info.info || {};
  return { id, type: 'movie', name: clean(d.name || i.name), poster: i.movie_image || d.stream_icon || null, background: (i.backdrop_path && i.backdrop_path[0]) || null, posterShape: 'poster', description: i.plot || d.plot || null, year: i.releasedate ? parseInt(i.releasedate) : undefined, imdbRating: i.rating ? parseFloat(i.rating) : undefined, runtime: i.duration || null, genres: i.genre ? i.genre.split(', ') : undefined, director: i.director ? [i.director] : undefined, cast: i.cast ? i.cast.split(',').map(s => s.trim()) : undefined, trailerStreams: i.youtube_trailer ? [{ title: 'Trailer', ytId: i.youtube_trailer }] : undefined };
}

function xcSeriesInfoToFullMeta(id, info) {
  const i = info.info || {}, eps = info.episodes || {}, videos = [];
  for (const [sn, episodes] of Object.entries(eps)) {
    if (!Array.isArray(episodes)) continue;
    for (const ep of episodes) {
      const ext = ep.container_extension || 'mkv';
      videos.push({ id: 'xc_ep_' + ep.id + '_' + ext, title: ep.title || ('S' + sn + 'E' + ep.episode_num), season: parseInt(sn), episode: parseInt(ep.episode_num), thumbnail: ep.info?.movie_image || null, overview: ep.info?.plot || null, released: ep.info?.releasedate ? new Date(ep.info.releasedate).toISOString() : undefined });
    }
  }
  videos.sort((a, b) => a.season !== b.season ? a.season - b.season : a.episode - b.episode);
  return { id, type: 'series', name: clean(i.name), poster: i.cover || null, background: (i.backdrop_path && i.backdrop_path[0]) || null, posterShape: 'poster', description: i.plot || null, year: i.releaseDate ? parseInt(i.releaseDate) : undefined, imdbRating: i.rating ? parseFloat(i.rating) : undefined, genres: i.genre ? i.genre.split(', ') : undefined, cast: i.cast ? i.cast.split(',').map(s => s.trim()) : undefined, director: i.director ? [i.director] : undefined, videos };
}

function clean(name) {
  if (!name) return 'Unknown';
  return name.replace(/\b(4K|1080p|720p|480p|HDR|SDR|HEVC|x265|x264|AAC|AC3|BluRay|WEBRip|REPACK)\b/gi, '').replace(/\[.*?\]/g, '').replace(/\s{2,}/g, ' ').trim();
}
