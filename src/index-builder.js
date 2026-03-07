/**
 * Index reader — fetches pre-built TMDB index from KV.
 * Index is built client-side in the browser during setup (user's IP).
 * CF worker only reads — never contacts XC server for index.
 */

export async function getOrBuildIndex(client, hash, kv) {
  if (!kv) {
    console.log('[index] KV not configured');
    return { vodIndex: new Map(), seriesIndex: new Map() };
  }

  try {
    const cached = await kv.get('idx:' + hash, { type: 'json' });
    if (cached) {
      const vodIndex    = new Map(Object.entries(cached.vod    || {}));
      const seriesIndex = new Map(Object.entries(cached.series || {}));
      console.log('[index] KV hit — vod:', vodIndex.size, 'series:', seriesIndex.size);
      return { vodIndex, seriesIndex };
    }
  } catch (e) {
    console.log('[index] KV read error:', e && e.message);
  }

  // Index not found — user needs to re-run setup
  console.log('[index] no index found for hash', hash, '— user must re-run setup');
  return { vodIndex: new Map(), seriesIndex: new Map() };
}
