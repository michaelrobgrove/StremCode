/**
 * StremCodes Worker v2.0 — LowDefPirate
 *
 * Security model:
 * - Credentials: AES-256-GCM encrypted in addon URL token, never stored
 * - KV stores only: sha256(server+user+pass) -> TMDB index
 *   No credentials, no usernames, no server URLs — just an anonymous hash
 * - Cinemeta IMDB->TMDB mappings cached 30 days (permanent mapping)
 * - TMDB index cached 6 hours (catches daily library changes)
 */

import { encryptCredentials, decryptCredentials, credHash } from './crypto.js';
import { XtreamClient } from './xtream.js';
import { buildManifest, buildCatalog, buildMeta, buildStream } from './stremio.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (parts.length === 0) return serveUI();
      if (parts[0] === 'health')   return json({ status: 'ok', version: '2.0.0' });
      if (parts[0] === 'validate') return handleValidate(url, env);
      if (parts[0] === 'install')  return handleInstall(url, env, ctx);
      if (parts.length >= 2)       return handleAddon(parts[0], parts.slice(1), url, env, ctx);
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Worker error:', err && err.message);
      return json({ error: 'Internal server error' }, 500);
    }
  }
};

// ---- /validate --------------------------------------------------------------

async function handleValidate(url, env) {
  const server   = url.searchParams.get('server');
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!server || !username || !password) return json({ valid: false, error: 'Missing parameters' }, 400);
  try {
    const client = new XtreamClient(server, username, password);
    const info = await client.getPlayerInfo();
    if (info && info.user_info) {
      return json({
        valid: true,
        username: info.user_info.username,
        status: info.user_info.status,
        expiry: info.user_info.exp_date,
        maxConnections: info.user_info.max_connections,
        activeConnections: info.user_info.active_cons,
      });
    }
    return json({ valid: false, error: 'Invalid credentials' });
  } catch {
    return json({ valid: false, error: 'Could not reach server' });
  }
}

// ---- /install ---------------------------------------------------------------

async function handleInstall(url, env, ctx) {
  const server   = url.searchParams.get('server');
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!server || !username || !password) return json({ error: 'Missing parameters' }, 400);

  const secret = env.ENCRYPTION_SECRET || 'stremcodes-dev-secret-change-me';
  const token = await encryptCredentials({ server, username, password }, secret);
  const addonUrl   = url.origin + '/' + token + '/manifest.json';
  const stremioUrl = 'stremio://' + url.host + '/' + token + '/manifest.json';

  // Kick off index build in background so first stream request is faster
  if (ctx && ctx.waitUntil && env.INDEX_CACHE) {
    const { getOrBuildIndex } = await import('./index-builder.js');
    const client = new XtreamClient(server, username, password);
    const hash = await credHash(server, username, password);
    ctx.waitUntil(getOrBuildIndex(client, hash, env.INDEX_CACHE));
  }

  return json({ token, addonUrl, stremioUrl });
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

// ---- UI ---------------------------------------------------------------------

function serveUI() {
  return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

// ---- Helpers ----------------------------------------------------------------

function json(data, statusOrHeaders, extra) {
  let status = 200, addH = {};
  if (typeof statusOrHeaders === 'number') { status = statusOrHeaders; addH = extra || {}; }
  else if (typeof statusOrHeaders === 'object') { addH = statusOrHeaders; }
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...addH } });
}

// ---- UI HTML ----------------------------------------------------------------

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
    body::after{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 55% 35% at 5% 5%,rgba(139,92,246,.07) 0%,transparent 60%),radial-gradient(ellipse 40% 40% at 95% 90%,rgba(163,230,53,.05) 0%,transparent 60%);pointer-events:none;z-index:0}
    .wrap{position:relative;z-index:1;min-height:100vh;display:flex;flex-direction:column}
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0 2rem;height:52px;background:rgba(14,14,14,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
    .brand{display:flex;align-items:center;gap:.6rem}
    .dot{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 8px var(--lime);animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 8px var(--lime)}50%{opacity:.5;box-shadow:0 0 3px var(--lime)}}
    .brand-text{font-family:var(--cond);font-weight:700;font-size:1.15rem;letter-spacing:.08em;text-transform:uppercase}
    .brand-text .def{color:var(--muted2)}.brand-text .pi{color:var(--lime)}
    .topbar-tag{font-family:var(--mono);font-size:.6rem;color:var(--muted);letter-spacing:.12em;text-transform:uppercase}
    header{padding:4rem 2rem 2rem;max-width:620px;margin:0 auto;width:100%}
    .eyebrow{display:flex;align-items:center;gap:.6rem;margin-bottom:1rem}
    .eyebrow-line{width:28px;height:2px;background:var(--lime)}
    .eyebrow-text{font-family:var(--mono);font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;color:var(--lime)}
    h1{font-family:var(--cond);font-weight:800;font-size:3.5rem;line-height:.95;letter-spacing:-.01em;text-transform:uppercase;margin-bottom:1rem}
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
    input[type=text],input[type=password],input[type=url]{width:100%;background:var(--bg2);border:1px solid var(--border2);border-radius:3px;color:var(--text);font-family:var(--mono);font-size:.82rem;padding:.7rem .9rem;outline:none;transition:border-color .15s,box-shadow .15s;-webkit-appearance:none}
    input::placeholder{color:var(--muted)}
    input:focus{border-color:var(--purple);box-shadow:0 0 0 3px rgba(139,92,246,.1)}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;font-family:var(--cond);font-weight:700;font-size:.9rem;letter-spacing:.12em;text-transform:uppercase;border:none;border-radius:3px;cursor:pointer;transition:all .15s;padding:.75rem 1.5rem;white-space:nowrap}
    .btn-primary{background:var(--purple);color:#fff;box-shadow:0 2px 12px rgba(139,92,246,.3)}
    .btn-primary:hover:not(:disabled){background:var(--purple2);transform:translateY(-1px)}
    .btn-primary:disabled{opacity:.4;cursor:not-allowed}
    .btn-lime{background:var(--lime);color:#0e0e0e;box-shadow:0 2px 12px rgba(163,230,53,.25)}
    .btn-lime:hover{background:var(--lime2);transform:translateY(-1px)}
    .btn-ghost{background:transparent;color:var(--muted2);border:1px solid var(--border2)}
    .btn-ghost:hover{border-color:var(--purple);color:var(--purple2)}
    .btn-full{width:100%}
    .status{display:flex;align-items:flex-start;gap:.65rem;padding:.8rem 1rem;border-radius:3px;font-size:.78rem;font-family:var(--mono);margin-top:1rem;animation:fadeIn .2s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
    .status.loading{background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.2);color:var(--purple2)}
    .status.ok{background:rgba(163,230,53,.07);border:1px solid rgba(163,230,53,.2);color:var(--lime)}
    .status.fail{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);color:#f87171}
    .result-card{display:none}.result-card.visible{display:block}
    .info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.6rem;margin-bottom:1.25rem}
    .info-item{background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:.75rem .9rem}
    .info-item-label{font-family:var(--mono);font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:.3rem}
    .info-item-value{font-family:var(--cond);font-weight:700;font-size:1rem;color:var(--text)}
    .info-item-value.green{color:var(--lime)}.info-item-value.red{color:var(--red)}.info-item-value.yellow{color:var(--yellow)}
    .url-box{background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:.75rem 3.5rem .75rem .9rem;margin-bottom:.75rem;position:relative}
    .url-label{font-family:var(--mono);font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:.3rem}
    .url-value{font-family:var(--mono);font-size:.72rem;color:var(--purple2);word-break:break-all;line-height:1.5}
    .copy-btn{position:absolute;top:.6rem;right:.6rem;background:var(--purple-dim);border:1px solid rgba(139,92,246,.25);border-radius:2px;color:var(--purple2);cursor:pointer;font-size:.6rem;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:.25rem .6rem;transition:all .15s}
    .copy-btn:hover{background:rgba(139,92,246,.2)}.copy-btn.copied{color:var(--lime);border-color:rgba(163,230,53,.3);background:var(--lime-dim)}
    .btn-row{display:flex;gap:.6rem;flex-wrap:wrap}.btn-row .btn-lime{flex:1}
    .divider{height:1px;background:var(--border);margin:1.5rem 0}
    .steps{display:flex;flex-direction:column;gap:.6rem}
    .step{display:flex;align-items:flex-start;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--border)}
    .step:last-child{border-bottom:none}
    .step-num{width:22px;height:22px;border-radius:2px;background:var(--lime-dim);border:1px solid rgba(163,230,53,.25);color:var(--lime);font-family:var(--mono);font-size:.62rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-weight:700}
    .step-text{font-size:.82rem;color:var(--muted2);line-height:1.55}.step-text strong{color:var(--text);font-weight:600}
    .sec-note{margin-top:1.25rem;padding:.9rem 1rem;background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.15);border-radius:3px;display:flex;gap:.65rem;align-items:flex-start}
    .sec-text{font-family:var(--mono);font-size:.68rem;color:var(--muted2);line-height:1.65}.sec-text strong{color:var(--purple2)}
    @keyframes spin{to{transform:rotate(360deg)}}
    .spinner{width:14px;height:14px;border:2px solid rgba(167,139,250,.2);border-top-color:var(--purple2);border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0}
    footer{text-align:center;padding:2rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:center;gap:1.5rem;flex-wrap:wrap}
    .footer-brand{font-family:var(--cond);font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
    .footer-brand span{color:var(--lime)}
    .footer-links a{font-family:var(--mono);font-size:.62rem;color:var(--muted);text-decoration:none;letter-spacing:.08em;text-transform:uppercase;transition:color .15s}
    .footer-links a:hover{color:var(--purple2)}
    @media(max-width:500px){h1{font-size:2.6rem}.card{padding:1.25rem}.info-grid{grid-template-columns:1fr}header{padding:2.5rem 1.25rem 1.5rem}main{padding:0 1.25rem 3rem}}
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
    <p class="sub">Connect your XC provider to Stremio in seconds. Your credentials are AES-256 encrypted — never stored, never logged.</p>
  </header>
  <main>
    <div class="card" id="cred-card">
      <div class="card-hdr"><span class="card-num">01</span><span class="card-title">Connect Your Provider</span></div>
      <div class="field"><label>Server URL</label><input id="server" type="url" placeholder="http://your-provider.com:8080" autocomplete="off"/><div class="hint" style="font-family:var(--mono);font-size:.6rem;color:var(--muted);margin-top:.35rem">Full URL including port — no trailing slash</div></div>
      <div class="field"><label>Username</label><input id="username" type="text" placeholder="your_username" autocomplete="off"/></div>
      <div class="field"><label>Password</label><input id="password" type="password" placeholder="••••••••••••" autocomplete="off"/></div>
      <button class="btn btn-primary btn-full" id="vbtn" onclick="doValidate()">Verify Credentials</button>
      <div id="vstatus" style="display:none"></div>
    </div>
    <div class="card result-card" id="result-card">
      <div class="card-hdr"><span class="card-num lime">02</span><span class="card-title">Account &amp; Install</span></div>
      <div class="info-grid" id="info-grid"></div>
      <div class="url-box" id="url-box" style="display:none">
        <div class="url-label">Addon URL</div>
        <div class="url-value" id="url-text"></div>
        <button class="copy-btn" onclick="copyUrl(this)">Copy</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-lime" onclick="openStremio()">▶ &nbsp;Install in Stremio</button>
        <button class="btn btn-ghost" onclick="copyUrl(this)">Copy URL</button>
      </div>
      <div class="divider"></div>
      <div class="card-hdr" style="margin-bottom:1rem"><span class="card-num">?</span><span class="card-title">How to Install</span></div>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text">Click <strong>Install in Stremio</strong> — Stremio opens and asks to confirm.</div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Or copy the <strong>Addon URL</strong> and paste it in Stremio → Add-ons → Install from URL.</div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Your library appears under <strong>Discover → XC Movies</strong> and <strong>XC Series</strong>.</div></div>
        <div class="step"><div class="step-num">4</div><div class="step-text"><strong>First stream</strong> on any title may take 10-30s while your library index builds. All streams after that are instant.</div></div>
      </div>
      <div class="sec-note"><div style="font-size:.9rem;flex-shrink:0;margin-top:1px">🔒</div><div class="sec-text">Credentials are <strong>AES-256-GCM encrypted</strong> inside the addon URL token — <strong>never stored</strong> on any server. The stream index is stored as an anonymous hash with no usernames, no server URLs, no PII.</div></div>
    </div>
  </main>
  <footer>
    <div class="footer-brand">Low<span>Def</span>Pirate</div>
    <div class="footer-links"><a href="https://lowdefpirate.link" target="_blank">lowdefpirate.link</a></div>
  </footer>
</div>
<script>
let installData=null;
async function doValidate(){
  const server=document.getElementById('server').value.trim();
  const username=document.getElementById('username').value.trim();
  const password=document.getElementById('password').value;
  const st=document.getElementById('vstatus');
  const btn=document.getElementById('vbtn');
  if(!server||!username||!password){showStatus(st,'fail','⚠','Please fill in all fields.');return;}
  if(!server.startsWith('http')){showStatus(st,'fail','⚠','Server URL must start with http:// or https://');return;}
  btn.disabled=true;btn.textContent='Verifying...';
  showStatus(st,'loading',null,'Connecting to your provider...');
  try{
    const p=new URLSearchParams({server,username,password});
    const vr=await fetch('/validate?'+p);const vd=await vr.json();
    if(!vd.valid){showStatus(st,'fail','✕',vd.error||'Invalid credentials');btn.disabled=false;btn.textContent='Verify Credentials';return;}
    const ir=await fetch('/install?'+p);installData=await ir.json();
    if(installData.error){showStatus(st,'fail','✕',installData.error);btn.disabled=false;btn.textContent='Verify Credentials';return;}
    showStatus(st,'ok','✓','Connected · '+vd.username);
    showResult(vd,installData);
  }catch(e){showStatus(st,'fail','✕','Network error — check the server URL.');btn.disabled=false;btn.textContent='Verify Credentials';}
}
function showStatus(el,type,icon,msg){
  el.style.display='flex';el.className='status '+type;
  el.innerHTML=type==='loading'?'<div class="spinner"></div><span>'+msg+'</span>':'<span>'+icon+'</span><span>'+msg+'</span>';
}
function showResult(acct,inst){
  const card=document.getElementById('result-card');
  const grid=document.getElementById('info-grid');
  let exp='—',ec='';
  if(acct.expiry){const d=new Date(parseInt(acct.expiry)*1000);const dl=Math.floor((d-new Date())/86400000);exp=d.toLocaleDateString();if(dl<0){ec='red';}else if(dl<30){ec='yellow';}else ec='green';}
  const sc=acct.status==='Active'?'green':'red';
  grid.innerHTML='<div class="info-item"><div class="info-item-label">Username</div><div class="info-item-value">'+esc(acct.username||'—')+'</div></div><div class="info-item"><div class="info-item-label">Status</div><div class="info-item-value '+sc+'">'+esc(acct.status||'—')+'</div></div><div class="info-item"><div class="info-item-label">Expires</div><div class="info-item-value '+ec+'">'+exp+'</div></div><div class="info-item"><div class="info-item-label">Connections</div><div class="info-item-value">'+(acct.activeConnections||0)+' / '+(acct.maxConnections||'?')+'</div></div>';
  document.getElementById('url-text').textContent=inst.addonUrl;
  document.getElementById('url-box').style.display='block';
  card.classList.add('visible');
  card.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function openStremio(){if(installData&&installData.stremioUrl)window.location.href=installData.stremioUrl;}
async function copyUrl(btn){
  const text=document.getElementById('url-text').textContent;if(!text)return;
  try{await navigator.clipboard.writeText(text);}catch{const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);}
  if(btn&&btn.classList){const o=btn.textContent;btn.textContent='✓ Copied';btn.classList.add('copied');setTimeout(()=>{btn.textContent=o;btn.classList.remove('copied');},2000);}
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
['server','username','password'].forEach(id=>document.getElementById(id).addEventListener('keydown',e=>{if(e.key==='Enter')doValidate();}));
</script>
</body>
</html>`;
