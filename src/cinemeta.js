/**
 * StremCodes - Cinemeta resolver
 * Converts IMDB id -> TMDB id + title info.
 */
export async function resolveImdb(imdbId, type) {
  try {
    const t = type === 'series' ? 'series' : 'movie';
    const res = await fetch('https://v3-cinemeta.strem.io/meta/' + t + '/' + imdbId + '.json', {
      headers: { 'User-Agent': 'StremCodes/2.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data && data.meta;
    if (!meta) return null;

    let tmdbId = null;
    if (meta.tmdb_id) tmdbId = String(meta.tmdb_id);
    if (!tmdbId && Array.isArray(meta.links)) {
      for (const link of meta.links) {
        const m = link.url && link.url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
        if (m) { tmdbId = m[2]; break; }
      }
    }
    return { tmdbId, name: meta.name || null, year: meta.year || null };
  } catch (e) {
    console.log('Cinemeta error for', imdbId, ':', e.message);
    return null;
  }
}
