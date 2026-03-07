/**
 * StremCodes Worker v2.1 — LowDefPirate
 *
 * Key change from v2.0:
 * Index building moved to CLIENT SIDE (browser) to avoid CF IP blocks.
 * Browser fetches XC library from user's own IP, builds TMDB map,
 * POSTs it here. CF only stores and looks up — never contacts XC for index.
 *
 * CF only contacts XC for:
 * - Individual episode info (getSeriesInfo) — small, not blocked
 * - Credential validation on install (getPlayerInfo) — optional, small
 *
 * Storage (KV):
 * - 'idx:<hash>'  → TMDB index (sent from browser, TTL 24h)
 * - 'cm:<imdbId>' → Cinemeta TMDB resolution (30 day TTL)
 */

import { encryptCredentials, decryptCredentials, credHash } from './crypto.js';
import { XtreamClient } from './xtream.js';
import { buildManifest, buildCatalog, buildMeta, buildStream } from './stremio.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (parts.length === 0) return serveUI();
      if (parts[0] === 'health')  return json({ status: 'ok', version: '2.1.0' });
      if (parts[0] === 'install') return handleInstall(request, url, env);
      if (parts[0] === 'index')   return handleIndexUpload(request, env);
      if (parts.length >= 2)      return handleAddon(parts[0], parts.slice(1), url, env, ctx);
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Worker error:', err && err.message);
      return json({ error: 'Internal server error' }, 500);
    }
  }
};

// ---- POST /install ----------------------------------------------------------
// Receives {server, username, password} — encrypts into token, returns addon URL
// No XC contact from CF — validation was done client-side in browser

async function handleInstall(request, url, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { server, username, password } = body || {};
  if (!server || !username || !password) return json({ error: 'Missing parameters' }, 400);

  const secret = env.ENCRYPTION_SECRET || 'stremcodes-dev-secret-change-me';
  const token = await encryptCredentials({ server, username, password }, secret);
  const hash = await credHash(server, username, password);
  const addonUrl   = url.origin + '/' + token + '/manifest.json';
  const stremioUrl = 'stremio://' + url.host + '/' + token + '/manifest.json';

  return json({ token, hash, addonUrl, stremioUrl });
}

// ---- POST /index ------------------------------------------------------------
// Receives {hash, vod: {...}, series: {...}} from browser after client-side build
// Stores in KV under the hash — no credentials ever stored

async function handleIndexUpload(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { hash, vod, series } = body || {};
  if (!hash || typeof vod !== 'object' || typeof series !== 'object') {
    return json({ error: 'Missing hash, vod, or series' }, 400);
  }

  if (!env.INDEX_CACHE) return json({ error: 'KV not configured' }, 500);

  const payload = {
    builtAt: Date.now(),
    vod,
    series,
  };

  try {
    await env.INDEX_CACHE.put('idx:' + hash, JSON.stringify(payload), {
      expirationTtl: 25 * 60 * 60, // 25 hours
    });
    console.log('[index] stored for hash', hash, '- vod entries:', Object.keys(vod).length, 'series:', Object.keys(series).length);
    return json({ ok: true, vodEntries: Object.keys(vod).length, seriesEntries: Object.keys(series).length });
  } catch (e) {
    console.error('[index] KV write failed:', e && e.message);
    return json({ error: 'KV write failed' }, 500);
  }
}

// ---- /:token/... ------------------------------------------------------------

async function handleAddon(token, path, url, env, ctx) {
  const secret = env.ENCRYPTION_SECRET || 'stremcodes-dev-secret-change-me';
  let creds;
  try { creds = await decryptCredentials(token, secret); }
  catch { return json({ error: 'Invalid token' }, 401); }

  const { server, username, password } = creds;
  const client = new XtreamClient(server, username, password);
  const route = path[0];

  if (route === 'manifest.json') {
    return json(buildManifest(url.origin, token));
  }

  if (route === 'catalog') {
    const type   = path[1];
    const skip   = parseInt(url.searchParams.get('skip') || '0');
    const search = url.searchParams.get('search') || '';
    try {
      const metas = await buildCatalog(client, type, skip, search);
      return json({ metas }, { 'Cache-Control': 'public, max-age=300' });
    } catch (e) {
      console.error('catalog error:', e && e.message);
      return json({ metas: [] });
    }
  }

  if (route === 'meta') {
    const type = path[1];
    const id   = (path[2] || '').replace('.json', '');
    try {
      const meta = await buildMeta(client, type, id);
      if (!meta) return json({ meta: null }, 404);
      return json({ meta }, { 'Cache-Control': 'public, max-age=600' });
    } catch (e) {
      console.error('meta error:', e && e.message);
      return json({ meta: null });
    }
  }

  if (route === 'stream') {
    const type = path[1];
    const id   = (path[2] || '').replace('.json', '');
    try {
      const hash = await credHash(server, username, password);
      const streams = await buildStream(client, type, id, hash, env.INDEX_CACHE);
      return json({ streams }, { 'Cache-Control': 'public, max-age=120' });
    } catch (e) {
      console.error('stream error:', e && e.message);
      return json({ streams: [] });
    }
  }

  return json({ error: 'Not found' }, 404);
}

// ---- Helpers ----------------------------------------------------------------

function json(data, statusOrHeaders, extra) {
  let status = 200, addH = {};
  if (typeof statusOrHeaders === 'number') { status = statusOrHeaders; addH = extra || {}; }
  else if (typeof statusOrHeaders === 'object') { addH = statusOrHeaders; }
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...addH } });
}

function serveUI() {
  return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

// ---- UI ---------------------------------------------------------------------
// The install page does ALL the heavy lifting client-side:
// 1. Validates credentials directly against XC server (browser -> XC, no CF involved)
// 2. Fetches full VOD + series library (browser -> XC, user's home IP)
// 3. Builds TMDB index map in browser
// 4. POSTs index to /index (browser -> CF KV)
// 5. POSTs credentials to /install (browser -> CF, returns encrypted token)

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>StremCodes — LowDefPirate</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap" rel="stylesheet"/>
  <style>
    :root{--bg:#0e0e0e;--bg2:#161616;--surface:#1e1e1e;--border:#2e2e2e;--border2:#3a3a3a;--purple:#8b5cf6;--purple2:#a78bfa;--purple-dim:rgba(139,92,246,.12);--lime:#a3e635;--lime2:#bef264;--lime-dim:rgba(163,230,53,.1);--text:#f0f0f0;--muted:#666;--muted2:#888;--red:#ef4444;--yellow:#eab308;--mono:'Space Mono',monospace;--sans:'Barlow',sans-serif;--cond:'Barlow Condensed',sans-serif}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--sans);overflow-x:hidden}
    body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(163,230,53,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,.02) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
    .wrap{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column}
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0 2rem;height:52px;background:rgba(14,14,14,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
    .brand{display:flex;align-items:center;gap:.6rem}
    .dot{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 8px var(--lime);animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .brand-text{font-family:var(--cond);font-weight:700;font-size:1.15rem;letter-spacing:.08em;text-transform:uppercase}
    .brand-text .def{color:var(--muted2)}.brand-text .pi{color:var(--lime)}
    .topbar-tag{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}
    header{padding:4rem 2rem 2rem;max-width:620px;margin:0 auto;width:100%}
    .eyebrow{display:flex;align-items:center;gap:.6rem;margin-bottom:1rem}
    .eyebrow-line{width:28px;height:2px;background:var(--lime)}
    .eyebrow-text{font-family:var(--mono);font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;color:var(--lime)}
    h1{font-family:var(--cond);font-weight:800;font-size:3.5rem;line-height:.95;text-transform:uppercase;margin-bottom:1rem}
    h1 .l1{color:var(--text);display:block}h1 .l2{color:transparent;-webkit-text-stroke:1px var(--purple2);display:block}
    .sub{font-size:.88rem;color:var(--muted2);line-height:1.6;margin-bottom:2.5rem;max-width:420px}
    main{flex:1;padding:0 2rem 4rem;max-width:620px;margin:0 auto;width:100%}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1.75rem;margin-bottom:1rem;position:relative}
    .card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--purple),transparent);border-radius:4px 0 0 4px}
    .card-hdr{display:flex;align-items:center;gap:.75rem;margin-bottom:1.5rem}
    .card-num{font-family:var(--mono);font-size:.6rem;color:var(--purple2);letter-spacing:.1em;background:var(--purple-dim);border:1px solid rgba(139,92,246,.2);padding:.2rem .5rem;border-radius:2px}
    .card-num.lime{color:var(--lime);background:var(--lime-dim);border-color:rgba(163,230,53,.2)}
    .card-title{font-family:var(--cond);font-weight:700;font-size:.85rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted2)}
    .field{margin-bottom:1.1rem}
    label{display:block;font-family:var(--mono);font-size:.62rem;font-weight:700;color:var(--muted);margin-bottom:.45rem;letter-spacing:.14em;text-transform:uppercase}
    input{width:100%;background:var(--bg2);border:1px solid var(--border2);border-radius:3px;color:var(--text);font-family:var(--mono);font-size:.82rem;padding:.7rem .9rem;outline:none;transition:border-color .15s;-webkit-appearance:none}
    input::placeholder{color:var(--muted)}input:focus{border-color:var(--purple);box-shadow:0 0 0 3px rgba(139,92,246,.1)}
    .hint{font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-top:.35rem}
    .btn{display:inline-flex;align-items:center;justify-content:center;font-family:var(--cond);font-weight:700;font-size:.9rem;letter-spacing:.12em;text-transform:uppercase;border:none;border-radius:3px;cursor:pointer;transition:all .15s;padding:.75rem 1.5rem;white-space:nowrap}
    .btn-primary{background:var(--purple);color:#fff}.btn-primary:hover:not(:disabled){background:var(--purple2)}
    .btn-primary:disabled{opacity:.4;cursor:not-allowed}
    .btn-lime{background:var(--lime);color:#0e0e0e}.btn-lime:hover{background:var(--lime2)}
    .btn-ghost{background:transparent;color:var(--muted2);border:1px solid var(--border2)}.btn-ghost:hover{border-color:var(--purple);color:var(--purple2)}
    .btn-full{width:100%}
    .progress-wrap{margin-top:1rem;display:none}
    .progress-label{font-family:var(--mono);font-size:.62rem;color:var(--muted2);margin-bottom:.5rem;display:flex;justify-content:space-between}
    .progress-bar{height:3px;background:var(--border);border-radius:2px;overflow:hidden}
    .progress-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--lime));width:0%;transition:width .3s}
    .status{display:flex;align-items:flex-start;gap:.65rem;padding:.8rem 1rem;border-radius:3px;font-size:.78rem;font-family:var(--mono);margin-top:1rem}
    .status.loading{background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.2);color:var(--purple2)}
    .status.ok{background:rgba(163,230,53,.07);border:1px solid rgba(163,230,53,.2);color:var(--lime)}
    .status.fail{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);color:#f87171}
    .result-card{display:none}.result-card.visible{display:block}
    .info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.6rem;margin-bottom:1.25rem}
    .info-item{background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:.75rem .9rem}
    .info-label{font-family:var(--mono);font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:.3rem}
    .info-value{font-family:var(--cond);font-weight:700;font-size:1rem;color:var(--text)}
    .info-value.green{color:var(--lime)}.info-value.red{color:var(--red)}.info-value.yellow{color:var(--yellow)}
    .url-box{background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:.75rem 3.5rem .75rem .9rem;margin-bottom:.75rem;position:relative}
    .url-label{font-family:var(--mono);font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:.3rem}
    .url-value{font-family:var(--mono);font-size:.72rem;color:var(--purple2);word-break:break-all;line-height:1.5}
    .copy-btn{position:absolute;top:.6rem;right:.6rem;background:var(--purple-dim);border:1px solid rgba(139,92,246,.25);border-radius:2px;color:var(--purple2);cursor:pointer;font-size:.6rem;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:.25rem .6rem;transition:all .15s}
    .copy-btn.copied{color:var(--lime);background:var(--lime-dim)}
    .btn-row{display:flex;gap:.6rem;flex-wrap:wrap}.btn-row .btn-lime{flex:1}
    .divider{height:1px;background:var(--border);margin:1.5rem 0}
    .steps .step{display:flex;align-items:flex-start;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--border)}
    .steps .step:last-child{border-bottom:none}
    .step-num{width:22px;height:22px;border-radius:2px;background:var(--lime-dim);border:1px solid rgba(163,230,53,.25);color:var(--lime);font-family:var(--mono);font-size:.62rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700}
    .step-text{font-size:.82rem;color:var(--muted2);line-height:1.55}.step-text strong{color:var(--text)}
    .sec-note{margin-top:1.25rem;padding:.9rem 1rem;background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.15);border-radius:3px;display:flex;gap:.65rem}
    .sec-text{font-family:var(--mono);font-size:.68rem;color:var(--muted2);line-height:1.65}.sec-text strong{color:var(--purple2)}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner{width:14px;height:14px;border:2px solid rgba(167,139,250,.2);border-top-color:var(--purple2);border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0}
    footer{padding:2rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:1.5rem}
    .footer-brand{font-family:var(--cond);font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
    .footer-brand span{color:var(--lime)}
    .footer-links a{font-family:var(--mono);font-size:.62rem;color:var(--muted);text-decoration:none;text-transform:uppercase;transition:color .15s}
    .footer-links a:hover{color:var(--purple2)}
  </style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand"><div class="dot"></div><div class="brand-text">Low<span class="def">Def</span><span class="pi">Pirate</span></div></div>
    <div class="topbar-tag">StremCodes // XC Bridge</div>
  </div>
  <header>
    <div class="eyebrow"><div class="eyebrow-line"></div><div class="eyebrow-text">Xtream Codes · Stremio Addon</div></div>
    <h1><span class="l1">Strem</span><span class="l2">Codes</span></h1>
    <p class="sub">Connect your XC provider to Stremio. Credentials never stored. Library index built from your device.</p>
  </header>
  <main>
    <div class="card">
      <div class="card-hdr"><span class="card-num">01</span><span class="card-title">Connect Your Provider</span></div>
      <div class="field"><label>Server URL</label><input id="inp-server" type="url" placeholder="http://your-provider.com:8080"/><div class="hint">Full URL — no trailing slash</div></div>
      <div class="field"><label>Username</label><input id="inp-user" type="text" placeholder="your_username" autocomplete="off"/></div>
      <div class="field"><label>Password</label><input id="inp-pass" type="password" placeholder="your_password" autocomplete="off"/></div>
      <div class="field"><label>Proxy URL</label><input id="inp-proxy" type="url" placeholder="http://yourserver.com:6767"/><div class="hint">Your xc-proxy address — needed to bypass provider IP restrictions</div></div>
      <button class="btn btn-primary btn-full" id="setup-btn" onclick="doSetup()">Connect &amp; Build Index</button>
      <div id="status-box" style="display:none"></div>
      <div class="progress-wrap" id="prog-wrap">
        <div class="progress-label"><span id="prog-text">Working...</span><span id="prog-pct">0%</span></div>
        <div class="progress-bar"><div class="progress-fill" id="prog-fill"></div></div>
      </div>
    </div>
    <div class="card result-card" id="result-card">
      <div class="card-hdr"><span class="card-num lime">02</span><span class="card-title">Ready to Install</span></div>
      <div class="info-grid" id="info-grid"></div>
      <div class="url-box" id="url-box" style="display:none">
        <div class="url-label">Addon URL</div>
        <div class="url-value" id="url-text"></div>
        <button class="copy-btn" id="copy-btn" onclick="copyUrl()">Copy</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-lime" onclick="openStremio()">Install in Stremio</button>
        <button class="btn btn-ghost" onclick="copyUrl()">Copy URL</button>
      </div>
      <div class="divider"></div>
      <div class="card-hdr" style="margin-bottom:1rem"><span class="card-num">?</span><span class="card-title">Notes</span></div>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text">Your library index was built <strong>from your device</strong> via your proxy — provider never sees Cloudflare IPs.</div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Streams appear on <strong>any Stremio title page</strong> via TMDB matching.</div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Index expires after <strong>24 hours</strong>. Re-run setup to refresh when library changes.</div></div>
        <div class="step"><div class="step-num">4</div><div class="step-text">Browse full library under <strong>Discover &rarr; XC Movies / XC Series</strong>.</div></div>
      </div>
      <div class="sec-note"><div style="font-size:.9rem;flex-shrink:0">🔒</div><div class="sec-text">Credentials are <strong>AES-256-GCM encrypted</strong> in the addon URL — never stored. Index stored as <strong>anonymous hash only</strong> — no usernames, no server URLs, no PII.</div></div>
    </div>
  </main>
  <footer>
    <div class="footer-brand">Low<span>Def</span>Pirate</div>
    <div class="footer-links"><a href="https://lowdefpirate.link" target="_blank">lowdefpirate.link</a></div>
  </footer>
</div>
<script>
var installData = null;

async function doSetup() {
  var server = document.getElementById('inp-server').value.trim().replace(/\/+$/, '');
  var username = document.getElementById('inp-user').value.trim();
  var password = document.getElementById('inp-pass').value;
  var proxy = document.getElementById('inp-proxy').value.trim().replace(/\/+$/, '');
  var btn = document.getElementById('setup-btn');

  if (!server || !username || !password) { showStatus('fail', 'Please fill in server, username and password.'); return; }
  if (!server.startsWith('http')) { showStatus('fail', 'Server URL must start with http:// or https://'); return; }
  if (!proxy) { showStatus('fail', 'Please enter your proxy URL (e.g. http://yourserver.com:6767)'); return; }

  btn.disabled = true;
  btn.textContent = 'Working...';
  showStatus('loading', 'Validating credentials...');
  setProgress(true, 'Validating credentials...', 5);

  var base = server + '/player_api.php?username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);

  // Step 1: Validate via proxy
  var acct;
  try {
    var r = await xcFetch(proxy, base + '&action=get_server_info', 12000);
    var d = await r.json();
    if (!d || !d.user_info) throw new Error('Server did not return user info — check credentials');
    if (d.user_info.auth == 0) throw new Error('Wrong username or password');
    acct = d.user_info;
  } catch(e) {
    showStatus('fail', e.message || 'Could not reach server');
    btn.disabled = false; btn.textContent = 'Connect & Build Index';
    setProgress(false);
    return;
  }

  showStatus('loading', 'Fetching library...');
  setProgress(true, 'Fetching VOD + Series...', 15);

  // Step 2: Fetch full library via proxy
  var vods = [], series = [];
  try {
    var results = await Promise.all([
      xcFetch(proxy, base + '&action=get_vod_streams', 90000),
      xcFetch(proxy, base + '&action=get_series', 90000)
    ]);
    setProgress(true, 'Parsing...', 60);
    vods = await results[0].json();
    series = await results[1].json();
    if (!Array.isArray(vods)) vods = [];
    if (!Array.isArray(series)) series = [];
  } catch(e) {
    showStatus('fail', 'Failed to fetch library: ' + e.message);
    btn.disabled = false; btn.textContent = 'Connect & Build Index';
    setProgress(false);
    return;
  }

  setProgress(true, 'Building TMDB index...', 75);

  // Step 3: Build TMDB index
  var vodIndex = {}, seriesIndex = {};
  for (var i = 0; i < vods.length; i++) {
    var s = vods[i];
    var tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (tid && tid !== '0' && !vodIndex[tid]) {
      vodIndex[tid] = { id: s.stream_id, ext: s.container_extension || 'mkv', name: s.name || '' };
    }
  }
  for (var i = 0; i < series.length; i++) {
    var s = series[i];
    var tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (tid && tid !== '0' && !seriesIndex[tid]) {
      seriesIndex[tid] = String(s.series_id);
    }
  }

  setProgress(true, 'Saving index...', 85);

  // Step 4: Compute hash and upload index to CF KV
  var hash = await credHash(server, username, password);
  try {
    var r = await fetch('/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hash, vod: vodIndex, series: seriesIndex })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Index upload failed');
  } catch(e) {
    showStatus('fail', 'Failed to save index: ' + e.message);
    btn.disabled = false; btn.textContent = 'Connect & Build Index';
    setProgress(false);
    return;
  }

  setProgress(true, 'Generating addon URL...', 95);

  // Step 5: Get encrypted token
  try {
    var r = await fetch('/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: server, username: username, password: password })
    });
    installData = await r.json();
    if (installData.error) throw new Error(installData.error);
  } catch(e) {
    showStatus('fail', 'Failed to generate addon URL: ' + e.message);
    btn.disabled = false; btn.textContent = 'Connect & Build Index';
    setProgress(false);
    return;
  }

  setProgress(true, 'Done!', 100);
  var vc = Object.keys(vodIndex).length;
  var sc = Object.keys(seriesIndex).length;
  showStatus('ok', 'Indexed ' + vc.toLocaleString() + ' movies and ' + sc.toLocaleString() + ' series');
  showResult(acct, installData, vc, sc);
  setTimeout(function() { setProgress(false); }, 800);
}

function showResult(acct, inst, vc, sc) {
  var card = document.getElementById('result-card');
  var grid = document.getElementById('info-grid');
  var exp = '—', ec = '';
  if (acct.exp_date) {
    var d = new Date(parseInt(acct.exp_date) * 1000);
    var dl = Math.floor((d - new Date()) / 86400000);
    exp = d.toLocaleDateString();
    ec = dl < 0 ? 'red' : dl < 30 ? 'yellow' : 'green';
  }
  grid.innerHTML =
    infoItem('Username', esc(acct.username || '—'), '') +
    infoItem('Status', esc(acct.status || '—'), acct.status === 'Active' ? 'green' : 'red') +
    infoItem('Expires', exp, ec) +
    infoItem('Movies', vc.toLocaleString(), 'green') +
    infoItem('Series', sc.toLocaleString(), 'green') +
    infoItem('Connections', (acct.active_cons||0) + ' / ' + (acct.max_connections||'?'), '');
  document.getElementById('url-text').textContent = inst.addonUrl;
  document.getElementById('url-box').style.display = 'block';
  card.classList.add('visible');
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function infoItem(label, value, cls) {
  return '<div class="info-item"><div class="info-label">' + label + '</div><div class="info-value ' + cls + '">' + value + '</div></div>';
}

function openStremio() { if (installData) window.location.href = installData.stremioUrl; }

function copyUrl() {
  var text = document.getElementById('url-text').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).catch(function() {
    var t = document.createElement('textarea'); t.value = text;
    document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
  });
  var btn = document.getElementById('copy-btn');
  btn.textContent = 'Copied!'; btn.classList.add('copied');
  setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
}

function setProgress(show, text, pct) {
  document.getElementById('prog-wrap').style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('prog-text').textContent = text || '';
    document.getElementById('prog-pct').textContent = (pct || 0) + '%';
    document.getElementById('prog-fill').style.width = (pct || 0) + '%';
  }
}

function showStatus(type, msg) {
  var el = document.getElementById('status-box');
  el.style.display = 'flex'; el.className = 'status ' + type;
  el.innerHTML = type === 'loading'
    ? '<div class="spinner"></div><span>' + msg + '</span>'
    : '<span>' + (type === 'ok' ? '✓' : '✕') + '</span><span>' + msg + '</span>';
}

function xcFetch(proxy, xcUrl, ms) {
  return fetch(proxy + '/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: xcUrl }),
    signal: AbortSignal.timeout(ms || 30000)
  });
}

async function credHash(server, username, password) {
  var str = server + ':' + username + ':' + password;
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  var s = '';
  new Uint8Array(buf).forEach(function(b) { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, 24);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

['inp-server','inp-user','inp-pass','inp-proxy'].forEach(function(id) {
  document.getElementById(id).addEventListener('keydown', function(e) { if (e.key === 'Enter') doSetup(); });
});
</script>
</body>
</html>`;
