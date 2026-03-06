/**
 * TMDB Index Builder
 *
 * Fetches full XC library, builds TMDB->streamId maps, stores in KV.
 * KV key: sha256(creds) hash — no credentials, no PII stored.
 * TTL: 6 hours so daily library changes propagate automatically.
 */

const INDEX_TTL_SECS = 6 * 60 * 60;
const INDEX_TTL_MS   = INDEX_TTL_SECS * 1000;

export async function getOrBuildIndex(client, hash, kv) {
  // Try KV first
  let cached = null;
  try { cached = await kv.get('idx:' + hash, { type: 'json' }); } catch {}

  if (cached && (Date.now() - cached.builtAt) < INDEX_TTL_MS) {
    return {
      vodIndex:    new Map(Object.entries(cached.vod)),
      seriesIndex: new Map(Object.entries(cached.series)),
      fresh: false,
    };
  }

  // Build fresh — fetch VOD and series in parallel (60s timeout each)
  console.log('[index] building for hash', hash);
  const [vods, series] = await Promise.allSettled([
    client.getVodStreams(),
    client.getSeriesList(),
  ]);

  const vodIndex    = new Map();
  const seriesIndex = new Map();

  if (vods.status === 'fulfilled' && Array.isArray(vods.value)) {
    for (const s of vods.value) {
      const tid = s.tmdb ? String(s.tmdb).trim() : '';
      if (tid && tid !== '0' && !vodIndex.has(tid)) {
        vodIndex.set(tid, {
          id:   s.stream_id,
          ext:  s.container_extension || 'mkv',
          name: cleanName(s.name),
        });
      }
    }
    console.log('[index] vod:', vodIndex.size, '/', vods.value.length, 'had tmdb');
  } else {
    console.log('[index] vod fetch failed:', vods.reason && vods.reason.message);
  }

  if (series.status === 'fulfilled' && Array.isArray(series.value)) {
    for (const s of series.value) {
      const tid = s.tmdb ? String(s.tmdb).trim() : '';
      if (tid && tid !== '0' && !seriesIndex.has(tid)) {
        seriesIndex.set(tid, String(s.series_id));
      }
    }
    console.log('[index] series:', seriesIndex.size, '/', series.value.length, 'had tmdb');
  } else {
    console.log('[index] series fetch failed:', series.reason && series.reason.message);
  }

  // Persist to KV (don't block — fire and forget)
  const payload = {
    builtAt: Date.now(),
    vod:    Object.fromEntries(vodIndex),
    series: Object.fromEntries(seriesIndex),
  };
  kv.put('idx:' + hash, JSON.stringify(payload), { expirationTtl: INDEX_TTL_SECS + 3600 })
    .catch(e => console.log('[index] KV write failed:', e && e.message));

  return { vodIndex, seriesIndex, fresh: true };
}

function cleanName(n) {
  if (!n) return '';
  return n
    .replace(/\b(4K|1080p|720p|480p|HDR|SDR|HEVC|x265|x264|AAC|AC3|BluRay|WEBRip|REPACK)\b/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
