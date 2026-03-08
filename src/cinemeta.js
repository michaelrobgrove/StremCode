/**
 * Cinemeta + TMDB resolver
 * Converts IMDB id -> TMDB id.
 *
 * Strategy:
 * 1. KV cache (30 day TTL — IMDB->TMDB mapping never changes)
 * 2. Cinemeta API (fast, usually has tmdb_id)
 * 3. TMDB /find API fallback (for titles Cinemeta doesn't index well)
 */

export async function resolveImdb(imdbId, type, kv) {
  // KV cache first — this mapping is permanent
  if (kv) {
    try {
      const cached = await kv.get('cm:' + imdbId, { type: 'json' });
      if (cached) return cached;
    } catch {}
  }

  let tmdbId = null;
  let name = null;
  let year = null;

  // Step 1: Try Cinemeta
  try {
    const t = type === 'series' ? 'series' : 'movie';
    const res = await fetch('https://v3-cinemeta.strem.io/meta/' + t + '/' + imdbId + '.json', {
      headers: { 'User-Agent': 'StremCodes/2.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      const meta = data && data.meta;
      if (meta) {
        name = meta.name || null;
        year = meta.year || null;
        if (meta.tmdb_id) {
          tmdbId = String(meta.tmdb_id);
        } else if (Array.isArray(meta.links)) {
          for (const link of meta.links) {
            const m = link.url && link.url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
            if (m) { tmdbId = m[2]; break; }
          }
        }
      }
    }
  } catch (e) {
    console.log('Cinemeta error for', imdbId, ':', e.message);
  }

  // Step 2: TMDB /find fallback if Cinemeta had no tmdb_id
  if (!tmdbId) {
    tmdbId = await tmdbFindByImdb(imdbId, type);
  }

  // Even if no TMDB id, return name so fuzzy search can still work
  const result = { tmdbId: tmdbId || null, name, year };

  if (!tmdbId) {
    console.log('No TMDB id for', imdbId, '— will rely on fuzzy title match, name:', name);
    // Still cache name-only result (shorter TTL since TMDB might get indexed later)
    if (kv && name) {
      kv.put('cm:' + imdbId, JSON.stringify(result), { expirationTtl: 7 * 24 * 3600 }).catch(() => {});
    }
    return result;
  }

  // Cache in KV — permanent mapping
  if (kv) {
    kv.put('cm:' + imdbId, JSON.stringify(result), { expirationTtl: 30 * 24 * 3600 }).catch(() => {});
  }

  return result;
}

/**
 * TMDB /find — resolves IMDB id directly.
 * Uses a widely shared public demo key that works for basic lookups.
 */
async function tmdbFindByImdb(imdbId, type) {
  try {
    const url = 'https://api.themoviedb.org/3/find/' + imdbId +
      '?external_source=imdb_id&api_key=4ef0d7355d9ffb5151e987764708ce96';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StremCodes/2.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = type === 'series'
      ? (data.tv_results || data.tv_season_results || [])
      : (data.movie_results || []);
    if (results.length > 0) {
      console.log('TMDB /find resolved', imdbId, '->', results[0].id);
      return String(results[0].id);
    }
    return null;
  } catch {
    return null;
  }
}
