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
    return { vodIndex: new Map(), seriesIndex: new Map(), vodNames: {}, serNames: {} };
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
    const vodNames    = cached.vodNames || {};
    const serNames    = cached.serNames || {};
    console.log('[index] KV hit — vod:', vodIndex.size, 'series:', seriesIndex.size, 'age:', Math.round(age/60000) + 'min');

    // If stale, trigger background refresh (don't await — return cached immediately)
    if (age > INDEX_TTL_MS) {
      console.log('[index] stale, triggering background refresh');
      // Pass stored apiBase so refresh doesn't need to re-probe
      const clientWithBase = cached.apiBase
        ? Object.assign({}, client, { apiBase: cached.apiBase })
        : client;
      refreshIndex(clientWithBase, hash, cached.proxyUrl || PROXY_URL, kv).catch(e =>
        console.log('[index] background refresh error:', e && e.message)
      );
    }

    return { vodIndex, seriesIndex, vodNames, serNames };
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
        vodNames:    fresh.vodNames || {},
        serNames:    fresh.serNames || {},
      };
    }
  } catch (e) {
    console.log('[index] sync build failed:', e && e.message);
  }

  return { vodIndex: new Map(), seriesIndex: new Map(), vodNames: {}, serNames: {} };
}

// Normalize a title to a fuzzy-matchable key: lowercase, strip punctuation/prefixes, keep words
function fuzzyKey(raw) {
  return (raw || '')
    .toLowerCase()
    // strip common provider prefixes like "EN |Disney+|", "4K-NF |", "EN - ", etc.
    .replace(/^[a-z0-9_+\-]{1,6}\s*[\|:]\s*/i, '')
    .replace(/^[a-z0-9_+\-]{1,6}\s*[\|:][^\|]+[\|:]\s*/i, '') // double prefix "EN |Disney+| "
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Probe player_api.php -> get.php -> get, return first working base URL
async function resolveApiBase(server, username, password, proxy) {
  const creds = '?username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
  const candidates = [
    server + '/player_api.php' + creds,
    server + '/get.php' + creds,
    server + '/get' + creds,
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      const r = await xcFetch(proxy, candidates[i] + '&action=get_server_info', 10000);
      const text = await r.text();
      try {
        const d = JSON.parse(text);
        if (d && d.user_info) {
          console.log('[api] resolved via', candidates[i].split('?')[0]);
          return candidates[i];
        }
      } catch(e) { /* not JSON, try next */ }
    } catch(e) {
      console.log('[api] probe failed for candidate', i, ':', e.message);
    }
  }
  return null;
}

async function refreshIndex(client, hash, proxyUrl, kv) {
  const proxy = proxyUrl || PROXY_URL;
  const server   = client.server;
  const username = client.username;
  const password = client.password;

  // Use previously detected apiBase, or probe fallback chain
  let apiBase = client.apiBase;
  if (!apiBase) {
    apiBase = await resolveApiBase(server, username, password, proxy);
    if (!apiBase) {
      console.log('[index] could not resolve API base — skipping refresh');
      return;
    }
  }
  const base = apiBase.replace(/&action=[^&]*/g, '');

  console.log('[index] fetching VOD + series via proxy:', proxy, 'base:', base.split('?')[0]);

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
      ser[tid]  = { id: String(s.series_id), name: s.name || '' };
      serP[tid] = p;
    }
  }

  // Build name-keyed fuzzy indexes (all entries, not just best — we want every title)
  const vodNames = {}, serNames = {};
  for (const s of vods) {
    const raw = (s.name || '').trim();
    if (!raw || !s.stream_id) continue;
    const key = fuzzyKey(raw);
    if (!vodNames[key] || pri(s.name) < pri(vodNames[key].name)) {
      vodNames[key] = { id: s.stream_id, ext: s.container_extension || 'mkv', name: raw };
    }
  }
  for (const s of series) {
    const raw = (s.name || '').trim();
    if (!raw || !s.series_id) continue;
    const key = fuzzyKey(raw);
    if (!serNames[key] || pri(s.name) < pri(serNames[key].name)) {
      serNames[key] = { id: String(s.series_id), name: raw };
    }
  }

  const payload = { builtAt: Date.now(), proxyUrl: proxy, apiBase: client.apiBase || null, vod, series: ser, vodNames, serNames };
  await kv.put('idx:' + hash, JSON.stringify(payload), { expirationTtl: INDEX_KV_TTL_S });
  console.log('[index] refreshed —',
    'vod TMDB:', Object.keys(vod).length, '/ vod fuzzy:', Object.keys(vodNames).length,
    '| series TMDB:', Object.keys(ser).length, '/ series fuzzy:', Object.keys(serNames).length
  );
  if (Object.keys(vod).length === 0 && Object.keys(vodNames).length > 0) {
    console.log('[index] ⚠ Provider has no TMDB IDs — fuzzy-only mode active');
  }
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
