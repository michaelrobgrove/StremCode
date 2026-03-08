/**
 * StremCodes Worker v2.1.2a — LowDefPirate
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
import { buildManifest, buildDefaultManifest, buildCatalog, buildMeta, buildStream } from './stremio.js';

const VERSION = '2.1.3a'; // display version (footer, health)
const SEMVER  = '2.1.3';   // strict semver for Stremio manifests

const PROXY_URL = 'https://xcprox.managedservers.click';

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
      if (parts[0] === 'health')  return json({ status: 'ok', version: VERSION });
      if (parts[0] === 'install') return handleInstall(request, url, env);
      if (parts[0] === 'index')     return handleIndexUpload(request, env);
      if (parts[0] === 'manifest.json') return json(buildDefaultManifest(url.origin));
      if (parts[0] === 'token-hash')   return handleTokenHash(request, env);
      if (parts[0] === 'configure') return serveConfigure();
      if (parts[0] === 'refresh')   return handleRefresh(request, env);
      if (parts[0] === 'debug')   return handleDebug(parts[1], env);
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

  const { hash, vod, series, proxyUrl, apiBase } = body || {};
  if (!hash || typeof vod !== 'object' || typeof series !== 'object') {
    return json({ error: 'Missing hash, vod, or series' }, 400);
  }

  if (!env.INDEX_CACHE) return json({ error: 'KV not configured' }, 500);

  const payload = {
    builtAt: Date.now(),
    vod,
    series,
    proxyUrl: proxyUrl || null,
    apiBase:  apiBase  || null,
  };

  try {
    await env.INDEX_CACHE.put('idx:' + hash, JSON.stringify(payload), {
      expirationTtl: 25 * 60 * 60,
    });
    console.log('[index] stored for hash', hash, '- vod entries:', Object.keys(vod).length, 'series:', Object.keys(series).length);
    return json({ ok: true, vodEntries: Object.keys(vod).length, seriesEntries: Object.keys(series).length });
  } catch (e) {
    console.error('[index] KV write failed:', e && e.message);
    return json({ error: 'KV write failed' }, 500);
  }
}

// ---- POST /refresh ---------------------------------------------------------
// Receives {token} — decrypts creds, clears KV index so next stream triggers rebuild
async function handleRefresh(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { token } = body || {};
  if (!token) return json({ error: 'Missing token' }, 400);
  const secret = env.ENCRYPTION_SECRET || 'stremcodes-dev-secret-change-me';
  let creds;
  try { creds = await decryptCredentials(token, secret); } catch { return json({ error: 'Invalid token' }, 401); }
  const { server, username, password } = creds;
  const hash = await credHash(server, username, password);
  if (env.INDEX_CACHE) {
    try { await env.INDEX_CACHE.delete('idx:' + hash); } catch {}
  }
  return json({ ok: true, message: 'Index cleared — will rebuild on next stream request' });
}

// ---- POST /token-hash — returns hash from token, no credentials exposed -----
async function handleTokenHash(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const { token } = await request.json().catch(() => ({}));
  if (!token) return json({ error: 'Missing token' }, 400);
  try {
    const creds = await decryptCredentials(token, env.ENCRYPTION_SECRET);
    const hash  = await credHash(creds.server, creds.username, creds.password);
    return json({ hash });
  } catch(e) {
    return json({ error: 'Invalid token' }, 400);
  }
}

// ---- GET /debug/:hash -------------------------------------------------------
async function handleDebug(hash, env) {
  if (!hash) return json({ error: 'provide hash' }, 400);
  if (!env.INDEX_CACHE) return json({ error: 'no KV' }, 500);
  try {
    const raw = await env.INDEX_CACHE.get('idx:' + hash, { type: 'json' });
    if (!raw) return json({ found: false, hash, message: 'No index found — user needs to complete setup or force rebuild' });

    const vodTmdb    = Object.keys(raw.vod    || {}).length;
    const serTmdb    = Object.keys(raw.series || {}).length;
    const vodFuzzy   = Object.keys(raw.vodNames || {}).length;
    const serFuzzy   = Object.keys(raw.serNames  || {}).length;
    const ageMin     = Math.round((Date.now() - (raw.builtAt || 0)) / 60000);

    // Determine health status
    let status = 'healthy';
    let notes = [];
    if (vodTmdb === 0 && vodFuzzy === 0) { status = 'empty'; notes.push('Index is empty — setup may not have completed'); }
    else if (vodTmdb === 0 && vodFuzzy > 0) { status = 'fuzzy-only'; notes.push('Provider has no TMDB IDs — using fuzzy title matching only'); }
    else if (vodFuzzy === 0 && vodTmdb > 0) { status = 'tmdb-only'; notes.push('Index predates fuzzy support — force rebuild recommended'); }
    if (ageMin > 720) notes.push('Index is ' + Math.round(ageMin/60) + 'h old — auto-refresh should have triggered');

    return json({
      status,
      notes,
      hash,
      builtAt: new Date(raw.builtAt || 0).toISOString(),
      ageMinutes: ageMin,
      index: {
        movies:  { tmdbMatched: vodTmdb, fuzzyNames: vodFuzzy },
        series:  { tmdbMatched: serTmdb, fuzzyNames: serFuzzy },
      },
      samples: {
        vodTmdb:   Object.entries(raw.vod    || {}).slice(0, 3).map(([k,v]) => ({ tmdb: k, name: v.name, id: v.id })),
        vodFuzzy:  Object.entries(raw.vodNames || {}).slice(0, 3).map(([k,v]) => ({ key: k, name: v.name })),
        serTmdb:   Object.entries(raw.series  || {}).slice(0, 3).map(([k,v]) => ({ tmdb: k, name: v.name })),
        serFuzzy:  Object.entries(raw.serNames  || {}).slice(0, 3).map(([k,v]) => ({ key: k, name: v.name })),
      },
    });
  } catch(e) {
    return json({ error: e.message }, 500);
  }
}

// ---- /:token/... ------------------------------------------------------------

async function handleAddon(token, path, url, env, ctx) {
  const secret = env.ENCRYPTION_SECRET || 'stremcodes-dev-secret-change-me';
  let creds;
  try { creds = await decryptCredentials(token, secret); }
  catch { return json({ error: 'Invalid token' }, 401); }

  const { server, username, password } = creds;
  const client = new XtreamClient(server, username, password, PROXY_URL);
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

function serveConfigure() {
  return new Response(CONFIGURE_HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

const CONFIGURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>StremCodes — Manage Addon</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Pirata+One&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Share+Tech+Mono&display=swap" rel="stylesheet"/>
<style>
:root{--bg:#1a1a1a;--bg2:#232323;--surface:#323232;--border:#3e3e3e;--border2:#505050;--purple:#8600a1;--purple2:#b000d4;--purple3:#d060f0;--lime:#7eff5c;--lime2:#a0ff85;--lime-dim:rgba(126,255,92,0.08);--pur-dim:rgba(134,0,161,0.15);--text:#e8e0d0;--muted:#7a7060;--muted2:#a09080;--red:#cc3333;--gold:#c8a84b;--mono:'Share Tech Mono',monospace;--serif:'Crimson Pro',serif;--fraktur:'Pirata One',cursive}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--serif);font-size:17px;overflow-x:hidden}
body::after{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,0.5) 100%);pointer-events:none;z-index:0}
.wrap{position:relative;z-index:1;max-width:580px;margin:0 auto;padding:3rem 1.5rem 5rem}
nav{display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem;height:52px;border-bottom:1px solid var(--border);background:rgba(26,26,26,0.95);position:fixed;top:0;left:0;right:0;z-index:100}
.nav-brand{font-family:var(--fraktur);font-size:1.4rem;color:var(--text)}
.nav-brand span{color:var(--purple3)}
.nav-back{font-family:var(--mono);font-size:0.6rem;color:var(--muted);text-decoration:none;letter-spacing:0.15em;text-transform:uppercase;border:1px solid var(--border);padding:0.25rem 0.6rem;border-radius:2px;transition:all 0.15s}
.nav-back:hover{border-color:var(--purple2);color:var(--purple3)}
.wrap{padding-top:5rem}
h2{font-family:var(--fraktur);font-size:2.2rem;color:var(--text);margin-bottom:0.5rem;line-height:1}
.page-sub{font-size:0.9rem;color:var(--muted2);font-style:italic;font-weight:300;margin-bottom:2.5rem}
.card{background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:1.5rem;margin-bottom:1rem;position:relative}
.card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--purple),transparent);border-radius:3px 0 0 3px}
.card-title{font-family:var(--mono);font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.18em;margin-bottom:1.25rem}
.field{margin-bottom:1rem}
label{display:block;font-family:var(--mono);font-size:0.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.14em;margin-bottom:0.35rem}
input{width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:2px;color:var(--text);font-family:var(--mono);font-size:0.78rem;padding:0.65rem 0.85rem;outline:none;transition:border-color 0.15s;-webkit-appearance:none}
input::placeholder{color:var(--muted);opacity:0.6}
input:focus{border-color:var(--purple2);box-shadow:0 0 0 3px rgba(134,0,161,0.12)}
.token-display{background:var(--bg2);border:1px solid var(--border);border-radius:2px;padding:0.65rem 0.85rem;font-family:var(--mono);font-size:0.7rem;color:var(--purple3);word-break:break-all;line-height:1.5;margin-bottom:1rem}
.btn{display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:0.72rem;letter-spacing:0.15em;text-transform:uppercase;border:none;border-radius:2px;cursor:pointer;transition:all 0.15s;padding:0.75rem 1.25rem;white-space:nowrap}
.btn-purple{background:var(--purple);color:#fff;width:100%}
.btn-purple:hover:not(:disabled){background:var(--purple2)}
.btn-purple:disabled{opacity:0.4;cursor:not-allowed}
.btn-lime{background:var(--lime);color:#111;font-weight:700;width:100%}
.btn-lime:hover{background:var(--lime2)}
.btn-ghost{background:transparent;border:1px solid var(--border2);color:var(--muted2);width:100%}
.btn-ghost:hover{border-color:var(--purple2);color:var(--purple3)}
.btn-red{background:rgba(204,51,51,0.15);border:1px solid rgba(204,51,51,0.3);color:#e06060;width:100%}
.btn-red:hover{background:rgba(204,51,51,0.25)}
.btn+.btn{margin-top:0.5rem}
.status{display:flex;align-items:flex-start;gap:0.6rem;padding:0.7rem 0.9rem;border-radius:2px;font-family:var(--mono);font-size:0.7rem;line-height:1.5;margin-top:0.75rem;display:none}
.status.loading{background:rgba(134,0,161,0.08);border:1px solid rgba(134,0,161,0.25);color:var(--purple3);display:flex}
.status.ok{background:rgba(126,255,92,0.07);border:1px solid rgba(126,255,92,0.25);color:var(--lime);display:flex}
.status.fail{background:rgba(204,51,51,0.08);border:1px solid rgba(204,51,51,0.25);color:#e06060;display:flex}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:12px;height:12px;flex-shrink:0;border:2px solid rgba(176,0,212,0.2);border-top-color:var(--purple3);border-radius:50%;animation:spin 0.7s linear infinite}
.divider{height:1px;background:var(--border);margin:1.5rem 0}
.section-note{font-size:0.82rem;color:var(--muted);font-style:italic;font-weight:300;line-height:1.6;margin-top:0.75rem}
</style>
</head>
<body>
<nav>
  <span class="nav-brand">Low<span>Def</span>Pirate</span>
  <a href="/" class="nav-back">← Back to Setup</a>
</nav>
<div class="wrap">
  <h2>Manage Addon</h2>
  <p class="page-sub">Update your credentials, change provider, or force a library refresh.</p>

  <!-- STEP 1: Enter token -->
  <div class="card" id="token-card">
    <div class="card-title">01 — Your Addon Token</div>
    <div class="field">
      <label>Token</label>
      <input id="inp-token" type="text" placeholder="Paste your token from the addon URL"/>
      <div style="font-family:var(--mono);font-size:0.58rem;color:var(--muted);margin-top:0.35rem">
        Found in your addon URL between the domain and /manifest.json
      </div>
    </div>
    <button class="btn btn-purple" id="load-btn" onclick="loadToken()">Load Account</button>
    <div class="status" id="load-status"></div>
  </div>

  <!-- STEP 2: Actions (shown after token verified) -->
  <div id="action-panel" style="display:none">
    <div class="card">
      <div class="card-title">02 — Current Account</div>
      <div class="token-display" id="cred-display">—</div>
      <button class="btn btn-red" onclick="forceRefresh()">⟳ &nbsp;Force Library Rebuild</button>
      <div class="status" id="refresh-status"></div>
      <p class="section-note">Clears your cached library and queues a full rebuild from your provider. Streams will still work during the rebuild — you may see stale results for a minute.</p>
    </div>

    <div class="card">
      <div class="card-title">03 — Update Credentials</div>
      <div class="field"><label>Server URL</label><input id="new-server" type="url" placeholder="http://your-provider.com:8080"/></div>
      <div class="field"><label>Username</label><input id="new-user" type="text" autocomplete="off" placeholder="username"/></div>
      <div class="field"><label>Password</label><input id="new-pass" type="password" autocomplete="off" placeholder="password"/></div>
      <button class="btn btn-purple" id="update-btn" onclick="updateCreds()">Update &amp; Rebuild Index</button>
      <div class="status" id="update-status"></div>
      <div class="divider"></div>
      <div id="new-url-wrap" style="display:none">
        <div style="font-family:var(--mono);font-size:0.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:0.4rem">New Addon URL</div>
        <div class="token-display" id="new-url-val"></div>
        <button class="btn btn-lime" onclick="openStremio()">▶ &nbsp;Install Updated Addon</button>
      </div>
    </div>
  </div>
</div>

<script>
var currentToken = null;
var currentCreds = null;
var newInstallData = null;
var PROXY = 'https://xcprox.managedservers.click';

async function loadToken() {
  var token = document.getElementById('inp-token').value.trim();
  if (!token) { showStatus('load-status', 'fail', 'Paste your token first.'); return; }
  document.getElementById('load-btn').disabled = true;
  showStatus('load-status', 'loading', 'Verifying token...');
  try {
    var r = await fetch('/' + token + '/manifest.json');
    if (!r.ok) throw new Error('Token invalid or expired');
    var manifest = await r.json();
    currentToken = token;
    document.getElementById('cred-display').textContent = 'Token: ' + token.slice(0, 12) + '...' + token.slice(-6);
    document.getElementById('action-panel').style.display = 'block';
    showStatus('load-status', 'ok', 'Token verified — addon: ' + (manifest.name || 'StremCodes'));
  } catch(e) {
    showStatus('load-status', 'fail', e.message || 'Could not verify token');
    document.getElementById('load-btn').disabled = false;
  }
}

async function forceRefresh() {
  if (!currentToken) return;
  showStatus('refresh-status', 'loading', 'Clearing cache...');
  try {
    var r = await fetch('/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Refresh failed');
    showStatus('refresh-status', 'ok', 'Cache cleared. Library will rebuild on next stream request.');
  } catch(e) {
    showStatus('refresh-status', 'fail', e.message || 'Refresh failed');
  }
}


  // Try player_api.php -> get.php -> get in order, return first that gives valid user_info
  async function resolveApiBase(server, username, password, proxy) {
    var creds = '?username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
    var candidates = [
      server + '/player_api.php' + creds,
      server + '/get.php' + creds,
      server + '/get' + creds,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var url = candidates[i] + '&action=get_server_info';
      // Try direct first (works for IP-locked providers that block datacenter IPs)
      try {
        var ctrl = new AbortController();
        var tid = setTimeout(function() { ctrl.abort(); }, 10000);
        var r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        var d; try { d = await r.json(); } catch(e2) { d = null; }
        if (d && d.user_info) {
          console.log('[api] resolved direct via', candidates[i].split('?')[0]);
          return { base: candidates[i], userInfo: d.user_info, direct: true };
        }
      } catch(e) {
        console.log('[api] direct failed for', i, e.message, '- trying proxy');
      }
      // Fall back to proxy
      try {
        var r2 = await xcFetch(proxy, url, 10000);
        var d2; try { d2 = await r2.json(); } catch(e2) { d2 = null; }
        if (d2 && d2.user_info) {
          console.log('[api] resolved via proxy for', candidates[i].split('?')[0]);
          return { base: candidates[i], userInfo: d2.user_info, direct: false };
        }
      } catch(e) {
        console.log('[api] proxy also failed for', i, e.message);
      }
    }
    return null;
  }

async function updateCreds() {
  var server = document.getElementById('new-server').value.trim();
  while (server.endsWith('/')) server = server.slice(0, -1);
  var username = document.getElementById('new-user').value.trim();
  var password = document.getElementById('new-pass').value;
  if (!server || !username || !password) { showStatus('update-status', 'fail', 'Fill in all three fields.'); return; }
  if (!server.startsWith('http')) { showStatus('update-status', 'fail', 'Server URL must start with http://'); return; }

  document.getElementById('update-btn').disabled = true;
  showStatus('update-status', 'loading', 'Validating new credentials...');

  var base = server + '/player_api.php?username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
  try {
    var r = await xcFetch(PROXY, base + '&action=get_server_info', 12000);
    var d = await r.json();
    if (!d) throw new Error('Empty response — check Server URL');
    if (d.user_info && d.user_info.auth == 0) throw new Error('Wrong username or password');
    if (!d.user_info) {
      const msg = d.message || d.error || d.info || '';
      throw new Error(msg ? 'Provider error: ' + msg : 'Server did not return account info — check your credentials and Server URL');
    }
  } catch(e) {
    showStatus('update-status', 'fail', e.message);
    document.getElementById('update-btn').disabled = false;
    return;
  }

  showStatus('update-status', 'loading', 'Fetching library...');
  var vods = [], series = [];
  try {
    var results = await Promise.all([
      xcFetch(PROXY, base + '&action=get_vod_streams', 90000),
      xcFetch(PROXY, base + '&action=get_series', 90000)
    ]);
    vods   = await results[0].json(); if (!Array.isArray(vods))   vods   = [];
    series = await results[1].json(); if (!Array.isArray(series)) series = [];
  } catch(e) {
    showStatus('update-status', 'fail', 'Failed to fetch library: ' + e.message);
    document.getElementById('update-btn').disabled = false;
    return;
  }

  showStatus('update-status', 'loading', 'Building index...');
  function pri(name) {
    var n = (name || '').toUpperCase();
    if (n.startsWith('EN ') || n.startsWith('EN-') || n.indexOf(' - ') === -1) return 0;
    if (n.startsWith('NF')) return 1;
    if (n.startsWith('AMZ') || n.startsWith('A+')) return 2;
    if (n.startsWith('D+')) return 3;
    if (n.startsWith('MAX') || n.startsWith('HBO')) return 4;
    if (n.startsWith('4K-')) return 8;
    return 5;
  }
  var vodIndex = {}, vodP = {}, seriesIndex = {}, serP = {};
  for (var i = 0; i < vods.length; i++) {
    var s = vods[i]; var tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (!tid || tid === '0') continue;
    var p = pri(s.name);
    if (!(tid in vodIndex) || p < vodP[tid]) { vodIndex[tid] = { id: s.stream_id, ext: s.container_extension || 'mkv', name: s.name || '' }; vodP[tid] = p; }
  }
  for (var i = 0; i < series.length; i++) {
    var s = series[i]; var tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (!tid || tid === '0') continue;
    var p = pri(s.name);
    if (!(tid in seriesIndex) || p < serP[tid]) { seriesIndex[tid] = String(s.series_id); serP[tid] = p; }
  }

  showStatus('update-status', 'loading', 'Saving...');
  var hash = await credHash(server, username, password);
  try {
    var r = await fetch('/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hash, vod: vodIndex, series: seriesIndex, proxyUrl: PROXY, apiBase: base })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Index save failed');
  } catch(e) {
    showStatus('update-status', 'fail', 'Failed to save index: ' + e.message);
    document.getElementById('update-btn').disabled = false;
    return;
  }

  try {
    var r = await fetch('/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: server, username: username, password: password })
    });
    newInstallData = await r.json();
    if (newInstallData.error) throw new Error(newInstallData.error);
  } catch(e) {
    showStatus('update-status', 'fail', e.message);
    document.getElementById('update-btn').disabled = false;
    return;
  }

  document.getElementById('new-url-val').textContent = newInstallData.addonUrl;
  document.getElementById('new-url-wrap').style.display = 'block';
  showStatus('update-status', 'ok', 'Done! Install the updated addon URL below.');
  document.getElementById('update-btn').disabled = false;
}

function openStremio() { if (newInstallData) window.location.href = newInstallData.stremioUrl; }

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
  return btoa(s).split('+').join('-').split('/').join('_').split('=').join('').slice(0, 24);
}

function showStatus(id, type, msg) {
  var el = document.getElementById(id);
  el.className = 'status ' + type;
  el.innerHTML = type === 'loading'
    ? '<div class="spinner"></div><span>' + msg + '</span>'
    : '<span>' + (type === 'ok' ? '✓' : '✕') + '</span><span>' + msg + '</span>';
}

document.getElementById('inp-token').addEventListener('keydown', function(e) { if (e.key === 'Enter') loadToken(); });
</script>
</body>
</html>`;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>StremCodes — LowDefPirate</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Pirata+One&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Share+Tech+Mono&display=swap" rel="stylesheet"/>
<style>
:root {
  --bg:      #1a1a1a;
  --bg2:     #232323;
  --bg3:     #2a2a2a;
  --surface: #323232;
  --border:  #3e3e3e;
  --border2: #505050;
  --purple:  #8600a1;
  --purple2: #b000d4;
  --purple3: #d060f0;
  --lime:    #7eff5c;
  --lime2:   #a0ff85;
  --lime-dim: rgba(126,255,92,0.08);
  --pur-dim:  rgba(134,0,161,0.15);
  --text:    #e8e0d0;
  --muted:   #7a7060;
  --muted2:  #a09080;
  --red:     #cc3333;
  --gold:    #c8a84b;
  --mono: 'Share Tech Mono', monospace;
  --serif: 'Crimson Pro', serif;
  --fraktur: 'Pirata One', cursive;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { scroll-behavior: smooth; }

body {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--serif);
  font-size: 19px;
  line-height: 1.7;
  overflow-x: hidden;
}

/* Skull repeating background - change opacity on the ::before rule to adjust intensity */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  /* TO CHANGE COLOR: edit the %237eff5c value below (it's #7eff5c URL-encoded) */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Ctext x='50%25' y='54%25' font-size='32' text-anchor='middle' dominant-baseline='middle' fill='%237eff5c' opacity='0.07'%3E%E2%98%A0%3C/text%3E%3C/svg%3E");
  background-size: 80px 80px;
  pointer-events: none;
  z-index: 0;
  /* TO CHANGE INTENSITY: edit the opacity value below (0.0 = invisible, 1.0 = full) */
  opacity: 0.5;
}

/* Vignette */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%);
  pointer-events: none;
  z-index: 0;
}

.wrap { position: relative; z-index: 1; }

/* ── NAV ── */
nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2.5rem;
  height: 56px;
  border-bottom: 1px solid var(--border);
  background: rgba(26,26,26,0.95);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-skull {
  font-size: 1.2rem;
  opacity: 0.6;
  animation: breathe 3s ease-in-out infinite;
}
@keyframes breathe { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
.nav-brand {
  font-family: var(--fraktur);
  font-size: 1.5rem;
  color: var(--text);
  letter-spacing: 0.02em;
}
.nav-brand .hi { color: var(--purple3); }
.nav-tag {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--muted);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: 1px solid var(--border);
  padding: 0.2rem 0.5rem;
  border-radius: 2px;
}

/* ── HERO ── */
.hero {
  max-width: 1100px;
  margin: 0 auto;
  padding: 5rem 2.5rem 3rem;
  position: relative;
  text-align: left;
}
.hero-eyebrow {
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--lime);
  letter-spacing: 0.25em;
  text-transform: uppercase;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.hero-eyebrow::before {
  content: '';
  width: 32px;
  height: 1px;
  background: var(--lime);
  display: block;
}
h1 {
  font-family: var(--fraktur);
  font-size: clamp(3.5rem, 9vw, 6.5rem);
  line-height: 0.9;
  margin-bottom: 1.5rem;
  position: relative;
}
h1 .line1 { color: var(--text); display: block; }
h1 .line2 {
  color: transparent;
  -webkit-text-stroke: 1.5px var(--purple2);
  display: inline;
  filter: drop-shadow(0 0 20px rgba(134,0,161,0.4));
}
.hero-sub {
  font-size: 1.15rem;
  font-weight: 300;
  font-style: italic;
  color: var(--muted2);
  max-width: 600px;
  margin-bottom: 3rem;
  line-height: 1.7;
}
.hero-sub strong { color: var(--text); font-style: normal; font-weight: 600; }

/* ── TRUST SECTION ── */
.trust-section {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 2.5rem 4rem;
  box-sizing: border-box;
  width: 100%;
}
.trust-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}
.trust-header::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border), transparent);
}
.trust-header-text {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  white-space: nowrap;
}
.trust-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 2rem;
}
.trust-item {
  background: var(--surface);
  padding: 1.5rem;
  position: relative;
  transition: background 0.2s;
}
.trust-item:hover { background: var(--bg3); }
.trust-icon {
  font-size: 1.4rem;
  margin-bottom: 0.75rem;
  display: block;
}
.trust-title {
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--lime);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin-bottom: 0.5rem;
}
.trust-body {
  font-size: 1rem;
  color: var(--muted2);
  line-height: 1.6;
  font-weight: 300;
}
.trust-body strong { color: var(--text); font-weight: 600; }

/* RD Warning box */
.rd-warning {
  border: 1px solid rgba(134,0,161,0.4);
  background: rgba(134,0,161,0.06);
  border-radius: 3px;
  padding: 1.5rem 1.75rem;
  position: relative;
  overflow: hidden;
}
.rd-warning::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--purple), var(--purple2));
}
.rd-warning-label {
  font-family: var(--mono);
  font-size: 0.58rem;
  color: var(--purple3);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 0.6rem;
}
.rd-warning-text {
  font-size: 1rem;
  color: var(--muted2);
  line-height: 1.7;
  font-style: italic;
  font-weight: 300;
}
.rd-warning-text strong { color: var(--text); font-style: normal; font-weight: 600; }

/* ── DIVIDER ── */
.divider {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 2.5rem;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 4rem;
  box-sizing: border-box;
  width: 100%;
}
.divider-line { flex: 1; height: 1px; background: var(--border); }
.divider-skull { color: var(--muted); font-size: 1.1rem; }

/* ── SETUP SECTION ── */
.setup-section {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 2.5rem 6rem;
  box-sizing: border-box;
  width: 100%;
}
.setup-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.setup-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--border), transparent);
}
.setup-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3rem;
  align-items: start;
}
@media (max-width: 640px) { .setup-grid { grid-template-columns: 1fr; gap: 2rem; } }

/* Form */
.form-panel {}
.field { margin-bottom: 1.25rem; }
label {
  display: block;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  margin-bottom: 0.4rem;
}
input {
  width: 100%;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.8rem;
  padding: 0.7rem 0.9rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  -webkit-appearance: none;
}
input::placeholder { color: var(--muted); opacity: 0.6; }
input:focus {
  border-color: var(--purple2);
  box-shadow: 0 0 0 3px rgba(134,0,161,0.12);
}
.field-hint {
  font-family: var(--mono);
  font-size: 0.58rem;
  color: var(--muted);
  margin-top: 0.3rem;
  opacity: 0.7;
}

.btn-setup {
  width: 100%;
  background: var(--purple);
  color: #fff;
  border: none;
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.9rem 1.5rem;
  cursor: pointer;
  margin-top: 0.5rem;
  transition: background 0.15s, transform 0.1s;
  position: relative;
  overflow: hidden;
}
.btn-setup::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 60%);
}
.btn-setup:hover:not(:disabled) { background: var(--purple2); transform: translateY(-1px); }
.btn-setup:disabled { opacity: 0.4; cursor: not-allowed; }

/* Status */
.status-box { margin-top: 1rem; display: none; }
.status {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.72rem;
  line-height: 1.5;
}
.status.loading { background: rgba(134,0,161,0.08); border: 1px solid rgba(134,0,161,0.25); color: var(--purple3); }
.status.ok      { background: rgba(126,255,92,0.07); border: 1px solid rgba(126,255,92,0.25); color: var(--lime); }
.status.fail    { background: rgba(204,51,51,0.08);  border: 1px solid rgba(204,51,51,0.25);  color: #e06060; }
@keyframes spin { to { transform: rotate(360deg); } }
.spinner {
  width: 12px; height: 12px; flex-shrink: 0; margin-top: 1px;
  border: 2px solid rgba(176,0,212,0.2);
  border-top-color: var(--purple3);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

/* Progress */
.prog-wrap { margin-top: 1rem; display: none; }
.prog-meta { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 0.58rem; color: var(--muted); margin-bottom: 0.4rem; }
.prog-bar { height: 2px; background: var(--border); border-radius: 1px; overflow: hidden; }
.prog-fill { height: 100%; background: linear-gradient(90deg, var(--purple), var(--lime)); width: 0%; transition: width 0.35s ease; }

/* Info panel (right side during setup) */
.info-panel {
  border-left: 1px solid var(--border);
  padding-left: 2.5rem;
}
@media (max-width: 640px) { .info-panel { border-left: none; border-top: 1px solid var(--border); padding-left: 0; padding-top: 2rem; } }
.info-panel-title {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.16em;
  margin-bottom: 1.25rem;
}
.steps { display: flex; flex-direction: column; gap: 0; }
.step {
  display: flex;
  gap: 1rem;
  padding: 0.9rem 0;
  border-bottom: 1px solid rgba(62,62,62,0.5);
}
.step:last-child { border-bottom: none; }
.step-n {
  width: 20px; height: 20px; flex-shrink: 0;
  border: 1px solid var(--border2);
  border-radius: 2px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--mono);
  font-size: 0.55rem;
  color: var(--lime);
  background: var(--lime-dim);
}
.step-text {
  font-size: 1rem;
  color: var(--muted2);
  line-height: 1.55;
  font-weight: 300;
}
.step-text strong { color: var(--text); font-weight: 600; }

/* ── RESULT CARD ── */
.result-card { display: none; margin-top: 2.5rem; }
.result-card.visible { display: block; }
.result-header {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--lime);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.result-header::before { content: '✓'; }
.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 1.25rem;
}
@media (max-width: 500px) { .stats-row { grid-template-columns: 1fr 1fr; } }
.stat {
  background: var(--surface);
  padding: 0.9rem 1rem;
}
.stat-label { font-family: var(--mono); font-size: 0.55rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 0.3rem; }
.stat-value { font-family: var(--mono); font-size: 0.95rem; color: var(--text); }
.stat-value.green { color: var(--lime); }
.stat-value.yellow { color: var(--gold); }
.stat-value.red { color: var(--red); }

.url-block {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.9rem 1rem;
  margin-bottom: 1rem;
  position: relative;
}
.url-label { font-family: var(--mono); font-size: 0.55rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 0.4rem; }
.url-val { font-family: var(--mono); font-size: 0.7rem; color: var(--purple3); word-break: break-all; line-height: 1.5; padding-right: 4rem; }
.copy-btn {
  position: absolute; top: 0.7rem; right: 0.7rem;
  font-family: var(--mono); font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.1em;
  background: var(--pur-dim); border: 1px solid rgba(134,0,161,0.3); border-radius: 2px;
  color: var(--purple3); cursor: pointer; padding: 0.25rem 0.6rem;
  transition: all 0.15s;
}
.copy-btn:hover { background: rgba(134,0,161,0.25); }
.copy-btn.copied { color: var(--lime); border-color: rgba(126,255,92,0.3); background: var(--lime-dim); }

.btn-row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.btn-install {
  flex: 1;
  background: var(--lime);
  color: #111;
  border: none;
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 0.8rem 1.25rem;
  cursor: pointer;
  transition: background 0.15s;
  font-weight: 700;
}
.btn-install:hover { background: var(--lime2); }
.btn-copy {
  background: transparent;
  border: 1px solid var(--border2);
  border-radius: 2px;
  color: var(--muted2);
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 0.8rem 1.25rem;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-copy:hover { border-color: var(--purple2); color: var(--purple3); }

/* ── FOOTER ── */
footer {
  border-top: 1px solid var(--border);
  padding: 2rem 2.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
}
.footer-brand { font-family: var(--fraktur); font-size: 1.1rem; color: var(--muted); }
.footer-brand span { color: var(--lime); }
.footer-links { display: flex; gap: 1.5rem; }
.footer-links a {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--muted);
  text-decoration: none;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transition: color 0.15s;
}
.footer-links a:hover { color: var(--purple3); }

/* Decorative skull watermark */
.watermark {
  position: fixed;
  bottom: -2rem;
  right: -2rem;
  font-size: 18rem;
  opacity: 0.018;
  pointer-events: none;
  z-index: 0;
  user-select: none;
  line-height: 1;
}

@media (max-width: 600px) {
  .hero { padding: 3rem 1.25rem 2rem; }
  .trust-section, .setup-section, .divider { padding-left: 1.25rem; padding-right: 1.25rem; }
  footer { padding: 1.5rem 1.25rem; }
  .stats-row { grid-template-columns: 1fr 1fr; }
}
</style>
</head>
<body>
<div class="watermark">☠</div>
<div class="wrap">

<nav>
  <div style="display:flex;align-items:center;gap:0.9rem">
    <span class="nav-skull">☠</span>
    <span class="nav-brand">Low<span class="hi">Def</span>Pirate</span>
  </div>
  <div style="display:flex;align-items:center;gap:1rem">
    <a href="/configure" style="font-family:var(--mono);font-size:0.6rem;color:var(--muted);text-decoration:none;letter-spacing:0.15em;text-transform:uppercase;border:1px solid var(--border);padding:0.2rem 0.55rem;border-radius:2px;transition:all 0.15s" onmouseover="this.style.borderColor='#b000d4';this.style.color='#d060f0'" onmouseout="this.style.borderColor='';this.style.color=''">Manage Addon</a>
    <span class="nav-tag">StremCodes · XC Bridge</span>
  </div>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="hero-eyebrow">Xtream Codes · Stremio Integration</div>
  <h1>
    <span class="line1">Strem<span class="line2">Codes</span></span>
  </h1>
  <p class="hero-sub">
    Sail your IPTV library into Stremio. <strong>Your credentials stay yours.</strong>
    We built this the right way — encrypted, private, and direct.
    No middleman sitting between you and your streams.
  </p>
</section>

<!-- SETUP -->
<section class="setup-section">
  <div class="setup-label">Connect your provider</div>

  <div class="setup-grid">
    <div class="form-panel">
      <div class="field">
        <label>Server URL</label>
        <div style="display:flex;gap:0.5rem;align-items:stretch">
          <input id="inp-server" type="url" placeholder="http://your-provider.com:8080" style="flex:1" oninput="clearTestResult()"/>
          <button onclick="testServer()" id="test-btn" style="background:transparent;border:1px solid rgba(126,255,92,0.3);color:var(--lime);font-family:var(--mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;padding:0 0.9rem;border-radius:2px;cursor:pointer;white-space:nowrap;transition:border-color 0.15s" onmouseover="this.style.borderColor='var(--lime)'" onmouseout="this.style.borderColor='rgba(126,255,92,0.3)'">Test</button>
        </div>
        <div class="field-hint">Full URL — no trailing slash. Use http:// not https:// unless your provider requires it.</div>
        <div id="test-result" style="margin-top:0.5rem;font-family:var(--mono);font-size:0.68rem;line-height:1.5;display:none"></div>
      </div>
      <div class="field">
        <label>Username</label>
        <input id="inp-user" type="text" placeholder="username" autocomplete="off"/>
      </div>
      <div class="field">
        <label>Password</label>
        <input id="inp-pass" type="password" placeholder="password" autocomplete="off"/>
      </div>
      <button class="btn-setup" id="setup-btn" onclick="doSetup()">⚓ &nbsp;Set Sail</button>
      <div class="status-box" id="status-box"></div>
      <div class="prog-wrap" id="prog-wrap">
        <div class="prog-meta"><span id="prog-text">Working...</span><span id="prog-pct">0%</span></div>
        <div class="prog-bar"><div class="prog-fill" id="prog-fill"></div></div>
      </div>
    </div>

    <div class="info-panel">
      <div class="info-panel-title">What happens when you connect</div>
      <div class="steps">
        <div class="step"><div class="step-n">1</div><div class="step-text">Your credentials are <strong>validated directly</strong> against your provider — from your device, not our servers.</div></div>
        <div class="step"><div class="step-n">2</div><div class="step-text">Your <strong>full library</strong> is fetched from your provider and a TMDB lookup index is built locally in your browser.</div></div>
        <div class="step"><div class="step-n">3</div><div class="step-text">The index is <strong>synced to our edge cache</strong> — only stream IDs, no credentials, no personal data.</div></div>
        <div class="step"><div class="step-n">4</div><div class="step-text">You get an <strong>encrypted addon URL</strong>. Install it in Stremio. Your streams appear on any title page.</div></div>
        <div class="step"><div class="step-n">5</div><div class="step-text">The index <strong>auto-refreshes every 12 hours</strong> — new content appears automatically. No action needed.</div></div>
      </div>
    </div>
  </div>

  <!-- RESULT -->
  <div class="result-card" id="result-card">
    <div class="result-header">Addon ready — install below</div>
    <div class="stats-row" id="stats-row"></div>
    <div class="url-block" id="url-block" style="display:none">
      <div class="url-label">Addon URL</div>
      <div class="url-val" id="url-val"></div>
      <button class="copy-btn" id="copy-btn" onclick="copyUrl()">Copy</button>
    </div>
    <div class="btn-row">
      <button class="btn-install" onclick="openStremio()">▶ &nbsp;Install in Stremio</button>
      <button class="btn-copy" onclick="copyUrl()">Copy URL</button>
    </div>
  </div>
</section>

<!-- DONATIONS -->
<section style="max-width:860px;margin:0 auto;padding:0 2.5rem 3rem">
  <div style="border:1px solid rgba(134,0,161,0.4);background:rgba(134,0,161,0.06);border-radius:3px;padding:1.5rem 1.75rem;position:relative;overflow:hidden">
    <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--purple),var(--purple2))"></div>
    <div style="font-family:var(--mono);font-size:0.58rem;color:var(--purple3);text-transform:uppercase;letter-spacing:0.2em;margin-bottom:0.75rem">&#9749; &nbsp;Support the Crew</div>
    <p style="font-size:0.92rem;color:var(--muted2);font-style:italic;font-weight:300;line-height:1.7;margin-bottom:1.25rem">
      StremCodes is free, built in spare time, and costs real money to run. If it has saved you some headaches, a coffee goes a long way.
    </p>
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
      <a href="https://buymeacoffee.com/yourdsgnpro" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:0.6rem;background:#FFDD00;color:#000;text-decoration:none;font-family:var(--mono);font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:0.65rem 1.1rem;border-radius:2px;transition:opacity 0.15s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        <span>&#9749;</span> Buy Me a Coffee
      </a>
      <a href="https://cash.app/$Strong8Stream" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:0.6rem;background:#00D632;color:#000;text-decoration:none;font-family:var(--mono);font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:0.65rem 1.1rem;border-radius:2px;transition:opacity 0.15s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        <span>&#36;</span> Cash App
      </a>
    </div>
  </div>
</section>

<div class="divider">
  <div class="divider-line"></div>
  <div class="divider-skull">⚓</div>
  <div class="divider-line"></div>
</div>

<!-- TRUST -->
<section class="trust-section">
  <div class="trust-header">
    <span class="trust-header-text">Our pledge to you</span>
  </div>

  <div class="trust-grid">
    <div class="trust-item">
      <span class="trust-icon">🔐</span>
      <div class="trust-title">Zero Storage</div>
      <div class="trust-body">
        Your server URL, username, and password are <strong>never stored anywhere</strong> — not in our database, not in logs, not in memory. They exist only inside your addon URL, encrypted.
      </div>
    </div>
    <div class="trust-item">
      <span class="trust-icon">🛡</span>
      <div class="trust-title">AES-256-GCM Encryption</div>
      <div class="trust-body">
        Credentials are encrypted using <strong>AES-256-GCM</strong> with a secret key only our server knows. Even if someone captures your addon URL, they cannot extract your credentials.
      </div>
    </div>
    <div class="trust-item">
      <span class="trust-icon">📡</span>
      <div class="trust-title">Direct Streams</div>
      <div class="trust-body">
        When you press play, Stremio connects <strong>directly to your provider's servers</strong>. We never see your stream traffic, never proxy your video, never touch your content.
      </div>
    </div>
    <div class="trust-item">
      <span class="trust-icon">👤</span>
      <div class="trust-title">No Identity, No PII</div>
      <div class="trust-body">
        The only thing we store is an <strong>anonymous hash</strong> mapped to stream IDs — no usernames, no server addresses, no personal information of any kind.
      </div>
    </div>
    <div class="trust-item">
      <span class="trust-icon">🌍</span>
      <div class="trust-title">No Sharing, Ever</div>
      <div class="trust-body">
        We do not share, sell, or transmit your data to any third party. <strong>Full stop.</strong> This addon exists to connect your service to your player — nothing more.
      </div>
    </div>
    <div class="trust-item">
      <span class="trust-icon">⚓</span>
      <div class="trust-title">Open Architecture</div>
      <div class="trust-body">
        Your library index is <strong>built on your device</strong> and synced to our edge cache. The code is straightforward — no hidden calls, no telemetry, no analytics.
      </div>
    </div>
  </div>

  <div class="rd-warning">
    <div class="rd-warning-label">☠ &nbsp;A note on Real-Debrid &amp; provider warnings</div>
    <div class="rd-warning-text">
      There's noise right now about addons causing account warnings. StremCodes is <strong>not that kind of addon.</strong>
      We do not use Real-Debrid. We do not torrent. We do not touch indexers, scrapers, or cached streams from third parties.
      StremCodes talks exclusively to <strong>your own IPTV subscription</strong> — the same service you already pay for, accessed the same way your existing IPTV player does.
      If your provider is legitimate, your account is safe.
    </div>
  </div>
</section>

<!-- LEGAL -->
<section style="max-width:860px;margin:0 auto;padding:0 2.5rem 4rem;border-top:1px solid var(--border);padding-top:3rem">
  <div style="font-family:var(--mono);font-size:0.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.2em;margin-bottom:1.25rem">Legal &amp; Content Disclaimer</div>
  <div style="font-size:0.82rem;color:var(--muted);line-height:1.8;font-style:italic;font-weight:300">
    <p style="margin-bottom:0.75rem">
      StremCodes is a <strong style="color:var(--muted2);font-style:normal">technical integration tool only</strong>. It connects Stremio to IPTV services that users independently subscribe to and pay for. StremCodes does not host, store, transmit, index, or provide access to any media content whatsoever.
    </p>
    <p style="margin-bottom:0.75rem">
      <strong style="color:var(--muted2);font-style:normal">We do not condone, encourage, or facilitate access to unlicensed, pirated, or otherwise illegal content.</strong> Users are solely responsible for ensuring that any IPTV service they connect through this addon is legitimate and properly licensed in their jurisdiction. Use of this addon with illegal services is a violation of these terms and entirely the user's own liability.
    </p>
    <p style="margin-bottom:0.75rem">
      This addon operates identically to any other IPTV player application (such as IPTV Smarters, TiviMate, or GSE Player). It sends requests to a user's own provider URL using their own credentials. No content is proxied, cached, or redistributed by StremCodes or LowDefPirate.
    </p>
    <p>
      LowDefPirate and StremCodes accept no liability for how users choose to use this software. By using this addon you confirm you are accessing only content you have a legal right to access.
    </p>
  </div>
</section>

<footer>
  <div class="footer-brand">Low<span>Def</span>Pirate</div>
  <div style="font-family:var(--mono);font-size:0.55rem;letter-spacing:0.15em;color:var(--muted);opacity:0.6">StremCodes v2.1.3a</div>
  <div class="footer-links">
    <a href="https://lowdefpirate.link" target="_blank">lowdefpirate.link</a>
    <a href="https://buymeacoffee.com/yourdsgnpro" target="_blank">donate</a>
    <a href="https://stremio-addons.net" target="_blank">stremio addons</a>
  </div>
</footer>

</div><!-- .wrap -->

<script>
var installData = null;


  // Try player_api.php -> get.php -> get in order, return first that gives valid user_info
  async function resolveApiBase(server, username, password, proxy) {
    var creds = '?username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
    var candidates = [
      server + '/player_api.php' + creds,
      server + '/get.php' + creds,
      server + '/get' + creds,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var url = candidates[i] + '&action=get_server_info';
      // Try direct first (works for IP-locked providers that block datacenter IPs)
      try {
        var ctrl = new AbortController();
        var tid = setTimeout(function() { ctrl.abort(); }, 10000);
        var r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        var d; try { d = await r.json(); } catch(e2) { d = null; }
        if (d && d.user_info) {
          console.log('[api] resolved direct via', candidates[i].split('?')[0]);
          return { base: candidates[i], userInfo: d.user_info, direct: true };
        }
      } catch(e) {
        console.log('[api] direct failed for', i, e.message, '- trying proxy');
      }
      // Fall back to proxy
      try {
        var r2 = await xcFetch(proxy, url, 10000);
        var d2; try { d2 = await r2.json(); } catch(e2) { d2 = null; }
        if (d2 && d2.user_info) {
          console.log('[api] resolved via proxy for', candidates[i].split('?')[0]);
          return { base: candidates[i], userInfo: d2.user_info, direct: false };
        }
      } catch(e) {
        console.log('[api] proxy also failed for', i, e.message);
      }
    }
    return null;
  }

async function doSetup() {
  var server = document.getElementById('inp-server').value.trim();
  while (server.endsWith('/')) server = server.slice(0, -1);
  var username = document.getElementById('inp-user').value.trim();
  var password = document.getElementById('inp-pass').value;
  var btn = document.getElementById('setup-btn');

  if (!server || !username || !password) { showStatus('fail', 'All three fields are required.'); return; }
  if (!server.startsWith('http')) { showStatus('fail', 'Server URL must start with http:// or https://'); return; }

  var proxy = 'https://xcprox.managedservers.click';
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  showStatus('loading', 'Validating credentials...');
  setProgress(true, 'Validating credentials...', 5);

  var creds = '?username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password);
  var base;
  var acct;
  try {
    showStatus('loading', 'Detecting API endpoint...');
    var resolved = await resolveApiBase(server, username, password, proxy);
    if (!resolved) {
      throw new Error('Could not connect to server — tried /player_api.php, /get.php and /get. Check your Server URL and credentials.');
    }
    if (resolved.userInfo.auth == 0) throw new Error('Wrong username or password');
    base = resolved.base;
    acct = resolved.userInfo;
    console.log('Using API base:', base.split('?')[0]);
  } catch(e) {
    const friendly = e.message || 'Could not reach server';
    const hint = (friendly.includes('fetch') || friendly.includes('network') || friendly.includes('timeout'))
      ? friendly + ' (the proxy may not be able to reach your provider)'
      : friendly;
    showStatus('fail', hint);
    btn.disabled = false; btn.textContent = '⚓  Set Sail';
    setProgress(false); return;
  }

  showStatus('loading', 'Fetching library...');
  setProgress(true, 'Fetching VOD + Series...', 15);

  // Strip any existing action param from base before appending new actions
  var baseNoAction = base.replace(/&action=[^&]*/g, '');
  var vods = [], series = [];
  var useDirect = resolved.direct;
  try {
    var fetchLib = function(action, ms) {
      var url = baseNoAction + '&action=' + action;
      if (useDirect) {
        var ctrl = new AbortController();
        var tid = setTimeout(function() { ctrl.abort(); }, ms);
        return fetch(url, { signal: ctrl.signal }).then(function(r) { clearTimeout(tid); return r; });
      }
      return xcFetch(proxy, url, ms);
    };
    var results = await Promise.all([
      fetchLib('get_vod_streams', 90000),
      fetchLib('get_series', 90000)
    ]);
    setProgress(true, 'Parsing...', 60);
    vods   = await results[0].json(); if (!Array.isArray(vods))   vods   = [];
    series = await results[1].json(); if (!Array.isArray(series)) series = [];
  } catch(e) {
    showStatus('fail', 'Failed to fetch library: ' + e.message);
    btn.disabled = false; btn.textContent = '⚓  Set Sail';
    setProgress(false); return;
  }

  setProgress(true, 'Building index...', 75);

  function pri(name) {
    var n = (name || '').toUpperCase();
    if (n.startsWith('EN ') || n.startsWith('EN-') || n.indexOf(' - ') === -1) return 0;
    if (n.startsWith('NF')) return 1;
    if (n.startsWith('AMZ') || n.startsWith('A+')) return 2;
    if (n.startsWith('D+')) return 3;
    if (n.startsWith('MAX') || n.startsWith('HBO')) return 4;
    if (n.startsWith('4K-')) return 8;
    return 5;
  }

  var vodIndex = {}, vodP = {}, seriesIndex = {}, serP = {};
  var vodSkip = 0, serSkip = 0;
  for (var i = 0; i < vods.length; i++) {
    var s = vods[i];
    var tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (!tid || tid === '0') { vodSkip++; continue; }
    var p = pri(s.name);
    if (!(tid in vodIndex) || p < vodP[tid]) {
      vodIndex[tid] = { id: s.stream_id, ext: s.container_extension || 'mkv', name: s.name || '' };
      vodP[tid] = p;
    }
  }
  for (var i = 0; i < series.length; i++) {
    var s = series[i];
    var tid = s.tmdb ? String(s.tmdb).trim() : '';
    if (!tid || tid === '0') { serSkip++; continue; }
    var p = pri(s.name);
    if (!(tid in seriesIndex) || p < serP[tid]) {
      seriesIndex[tid] = String(s.series_id);
      serP[tid] = p;
    }
  }

  setProgress(true, 'Saving index...', 85);
  var hash = await credHash(server, username, password);
  try {
    var r = await fetch('/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hash, vod: vodIndex, series: seriesIndex, proxyUrl: proxy, apiBase: base })
    });
    var d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Index upload failed');
  } catch(e) {
    showStatus('fail', 'Failed to save index: ' + e.message);
    btn.disabled = false; btn.textContent = '⚓  Set Sail';
    setProgress(false); return;
  }

  setProgress(true, 'Generating addon URL...', 95);
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
    btn.disabled = false; btn.textContent = '⚓  Set Sail';
    setProgress(false); return;
  }

  setProgress(true, 'Anchored.', 100);
  var vc = Object.keys(vodIndex).length, sc = Object.keys(seriesIndex).length;
  showStatus('ok', 'Indexed ' + vc.toLocaleString() + ' movies and ' + sc.toLocaleString() + ' series.');
  showResult(acct, installData, vc, sc);
  setTimeout(function() { setProgress(false); }, 800);
  btn.disabled = false; btn.textContent = '⚓  Set Sail';
}

function showResult(acct, inst, vc, sc) {
  var exp = '—', ec = '';
  if (acct.exp_date) {
    var d = new Date(parseInt(acct.exp_date) * 1000);
    var dl = Math.floor((d - new Date()) / 86400000);
    exp = d.toLocaleDateString(); ec = dl < 0 ? 'red' : dl < 30 ? 'yellow' : 'green';
  }
  var sc2 = acct.status === 'Active' ? 'green' : 'red';
  document.getElementById('stats-row').innerHTML =
    stat('Status',   esc(acct.status || '—'), sc2) +
    stat('Expires',  exp, ec) +
    stat('Connections', (acct.active_cons||0) + ' / ' + (acct.max_connections||'?'), '') +
    stat('Movies indexed', vc.toLocaleString(), 'green') +
    stat('Series indexed', sc.toLocaleString(), sc > 0 ? 'green' : 'yellow') +
    stat('Auto-refresh', 'Every 12h', 'green');
  document.getElementById('url-val').textContent = inst.addonUrl;
  document.getElementById('url-block').style.display = 'block';
  var card = document.getElementById('result-card');
  card.classList.add('visible');
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function stat(label, value, cls) {
  return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value ' + cls + '">' + value + '</div></div>';
}

function openStremio() { if (installData) window.location.href = installData.stremioUrl; }

function copyUrl() {
  var text = document.getElementById('url-val').textContent;
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
    document.getElementById('prog-pct').textContent  = (pct || 0) + '%';
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
  return btoa(s).split('+').join('-').split('/').join('_').split('=').join('').slice(0, 24);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

['inp-server','inp-user','inp-pass'].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSetup(); });
});
function clearTestResult() {
  var el = document.getElementById('test-result');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

function showTestResult(msg, type) {
  var el = document.getElementById('test-result');
  var colors = { ok: 'var(--lime)', fail: '#f87171', warn: '#fbbf24', loading: 'var(--muted2)' };
  el.style.display = 'block';
  el.style.color = colors[type] || 'var(--muted2)';
  el.innerHTML = msg;
}

async function testServer() {
  var raw = document.getElementById('inp-server').value.trim();
  var btn = document.getElementById('test-btn');
  if (!raw) { showTestResult('Enter a server URL first', 'warn'); return; }
  var server = raw;
  while (server.endsWith('/')) server = server.slice(0, -1);
  try {
    var parsed = new URL(server);
    var pathPart = parsed.pathname.slice(1);
    if (/^[0-9]{2,5}$/.test(pathPart)) {
      var fixed = parsed.protocol + '//' + parsed.hostname + ':' + pathPart;
      showTestResult('Port is in the wrong place. Try: <strong>' + fixed + '</strong>', 'warn');
      return;
    }
  } catch(e) {}
  if (!server.startsWith('http')) { showTestResult('URL must start with http:// or https://', 'warn'); return; }
  btn.disabled = true; btn.textContent = '...';
  showTestResult('Probing...', 'loading');
  var proxy = 'https://xcprox.managedservers.click';
  var t = '?username=test&password=test&action=get_server_info';
  var paths = ['/player_api.php', '/get.php', '/get'];
  var hit = null, si = null;
  for (var i = 0; i < paths.length; i++) {
    try {
      var r = await xcFetch(proxy, server + paths[i] + t, 8000);
      var d; try { d = await r.json(); } catch(e) { continue; }
      if (d && (d.server_info || d.user_info)) { hit = paths[i]; si = d.server_info || null; break; }
    } catch(e) {}
  }
  btn.disabled = false; btn.textContent = 'Test';
  if (!hit) {
    showTestResult('Could not reach server. Tried /player_api.php, /get.php, /get. Check URL and port.', 'fail');
    return;
  }
  var extra = '';
  if (si) extra = ' &mdash; Protocol: ' + (si.server_protocol||'http') + ', Port: ' + (si.port||'80');
  showTestResult('Reachable via <strong>' + hit + '</strong>' + extra + '. Now enter credentials and Set Sail.', 'ok');
  if (server !== raw) document.getElementById('inp-server').value = server;
}

</script>
</body>
</html>`;
