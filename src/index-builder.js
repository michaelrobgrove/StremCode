/**
 * Index reader + auto-refresher.
 * Index is built client-side during setup, stored in KV.
 * If index is older than 12 hours, a background refresh is triggered
 * via the built-in proxy — user never needs to redo setup.
 */

const INDEX_TTL_MS   = 12 * 60 * 60 * 1000; // 12 hours
const INDEX_KV_TTL_S = 25 * 60 * 60;         // 25 hours KV expiry (buffer)
const PROXY_URL      = 'https://xcprox.managedservers.click';

export async function getOrBuildIndex(client, hash, kv) {
  if (!kv) {
    console.log('[index] KV not configured');
    return { vodIndex: new Map(), seriesIndex: new Map() };
  }

  let cached = null;
  try {
    cached = await kv.get('idx:' + hash, { type: 'json' });
  } catch (e) {
    console.log('[index] KV read error:', e && e.message);
  }

  if (cached) {
    const age = Date.now() - (cached.builtAt || 0);
    const vodIndex    = new Map(Object.entries(cached.vod    || {}));
    const seriesIndex = new Map(Object.entries(cached.series || {}));
    console.log('[index] KV hit — vod:', vodIndex.size, 'series:', seriesIndex.size, 'age:', Math.round(age/60000) + 'min');

    // If stale, trigger background refresh (don't await — return cached immediately)
    if (age > INDEX_TTL_MS) {
      console.log('[index] stale, triggering background refresh');
      refreshIndex(client, hash, cached.proxyUrl || PROXY_URL, kv).catch(e =>
        console.log('[index] background refresh error:', e && e.message)
      );
    }

    return { vodIndex, seriesIndex };
  }

  // No index at all — try to build synchronously so this request gets streams
  console.log('[index] no index found for hash', hash, '— building now');
  try {
    await refreshIndex(client, hash, PROXY_URL, kv);
    const fresh = await kv.get('idx:' + hash, { type: 'json' });
    if (fresh) {
      return {
        vodIndex:    new Map(Object.entries(fresh.vod    || {})),
        seriesIndex: new Map(Object.entries(fresh.series || {})),
      };
    }
  } catch (e) {
    console.log('[index] sync build failed:', e && e.message);
  }

  return { vodIndex: new Map(), seriesIndex: new Map() };
}

async function refreshIndex(client, hash, proxyUrl, kv) {
  const proxy = proxyUrl || PROXY_URL;
  const server   = client.server;
  const username = client.username;
  const password = client.password;
  const base = server + '/player_api.php?username=' + encodeURIComponent(username) +
               '&password=' + encodeURIComponent(password);

  console.log('[index] fetching VOD + series via proxy:', proxy);

  const [vodsRaw, seriesRaw] = await Promise.all([
    xcFetch(proxy, base + '&action=get_vod_streams', 90000),
    xcFetch(proxy, base + '&action=get_series',      90000),
  ]);

  const vods   = Array.isArray(vodsRaw)   ? vodsRaw   : [];
  const series = Array.isArray(seriesRaw) ? seriesRaw : [];

  // Priority: EN > NF > AMZ/A+ > D+ > MAX > others > 4K copies last
  function pri(name) {
    const n = (name || '').toUpperCase();
    if (n.startsWith('EN ') || n.startsWith('EN-') || !n.includes(' - ')) return 0;
    if (n.startsWith('NF'))  return 1;
    if (n.startsWith('AMZ') || n.startsWith('A+')) return 2;
    if (n.startsWith('D+'))  return 3;
    if (n.startsWith('MAX') || n.startsWith('HBO')) return 4;
    if (n.startsWith('4K-')) return 8;
    return 5;
  }

  const vod = {}, vodP = {}, ser = {}, serP = {};

  for (const s of vods) {
    const tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (!tid || tid === '0') continue;
    const p = pri(s.name);
    if (!(tid in vod) || p < vodP[tid]) {
      vod[tid]  = { id: s.stream_id, ext: s.container_extension || 'mkv', name: s.name || '' };
      vodP[tid] = p;
    }
  }
  for (const s of series) {
    const tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (!tid || tid === '0') continue;
    const p = pri(s.name);
    if (!(tid in ser) || p < serP[tid]) {
      ser[tid]  = String(s.series_id);
      serP[tid] = p;
    }
  }

  const payload = { builtAt: Date.now(), proxyUrl: proxy, vod, series: ser };
  await kv.put('idx:' + hash, JSON.stringify(payload), { expirationTtl: INDEX_KV_TTL_S });
  console.log('[index] refreshed — vod:', Object.keys(vod).length, 'series:', Object.keys(ser).length);
}

async function xcFetch(proxyUrl, xcUrl, ms) {
  const r = await fetch(proxyUrl + '/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: xcUrl }),
    signal: AbortSignal.timeout(ms || 30000),
  });
  if (!r.ok) throw new Error('Proxy HTTP ' + r.status);
  return r.json();
}
