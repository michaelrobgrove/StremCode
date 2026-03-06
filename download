<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>StremCodes — LowDefPirate</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Barlow:wght@300;400;500;600;700;900&family=Barlow+Condensed:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg:       #0e0e0e;
      --bg2:      #161616;
      --bg3:      #1c1c1c;
      --surface:  #1e1e1e;
      --surface2: #252525;
      --border:   #2e2e2e;
      --border2:  #3a3a3a;
      --purple:   #8b5cf6;
      --purple2:  #a78bfa;
      --purple-dim: rgba(139,92,246,0.12);
      --lime:     #a3e635;
      --lime2:    #bef264;
      --lime-dim: rgba(163,230,53,0.1);
      --text:     #f0f0f0;
      --muted:    #666;
      --muted2:   #888;
      --red:      #ef4444;
      --green:    #a3e635;
      --yellow:   #eab308;
      --mono:     'Space Mono', monospace;
      --sans:     'Barlow', sans-serif;
      --cond:     'Barlow Condensed', sans-serif;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html { scroll-behavior: smooth; }

    body {
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: var(--sans);
      font-weight: 400;
      overflow-x: hidden;
    }

    /* ── Grid texture ── */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(163,230,53,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(163,230,53,0.02) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }

    /* ── Glow blobs ── */
    body::after {
      content: '';
      position: fixed;
      inset: 0;
      background:
        radial-gradient(ellipse 55% 35% at 5% 5%, rgba(139,92,246,0.07) 0%, transparent 60%),
        radial-gradient(ellipse 40% 40% at 95% 90%, rgba(163,230,53,0.05) 0%, transparent 60%);
      pointer-events: none;
      z-index: 0;
    }

    .wrapper {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ── Top bar ── */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2rem;
      height: 52px;
      background: rgba(14,14,14,0.9);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .topbar-brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .brand-text {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .brand-text .low { color: var(--text); }
    .brand-text .def { color: var(--muted2); }
    .brand-text .pirate { color: var(--lime); }

    .brand-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--lime);
      box-shadow: 0 0 8px var(--lime);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--lime); }
      50% { opacity: 0.5; box-shadow: 0 0 3px var(--lime); }
    }

    .topbar-tag {
      font-family: var(--mono);
      font-size: 0.6rem;
      color: var(--muted);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    /* ── Header ── */
    header {
      padding: 4rem 2rem 2rem;
      max-width: 620px;
      margin: 0 auto;
      width: 100%;
    }

    .hero-eyebrow {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 1rem;
    }

    .eyebrow-line {
      width: 28px;
      height: 2px;
      background: var(--lime);
    }

    .eyebrow-text {
      font-family: var(--mono);
      font-size: 0.65rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--lime);
    }

    h1 {
      font-family: var(--cond);
      font-weight: 800;
      font-size: 3.5rem;
      line-height: 0.95;
      letter-spacing: -0.01em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }

    h1 .line1 { color: var(--text); display: block; }
    h1 .line2 {
      color: transparent;
      -webkit-text-stroke: 1px var(--purple2);
      display: block;
    }

    .hero-sub {
      font-family: var(--sans);
      font-size: 0.88rem;
      color: var(--muted2);
      line-height: 1.6;
      margin-bottom: 2.5rem;
      max-width: 420px;
    }

    /* ── Main content ── */
    main {
      flex: 1;
      padding: 0 2rem 4rem;
      max-width: 620px;
      margin: 0 auto;
      width: 100%;
    }

    /* ── Card ── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1.75rem;
      margin-bottom: 1rem;
      position: relative;
    }

    /* Left accent bar */
    .card::before {
      content: '';
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: linear-gradient(180deg, var(--purple), transparent);
      border-radius: 4px 0 0 4px;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }

    .card-num {
      font-family: var(--mono);
      font-size: 0.6rem;
      color: var(--purple2);
      letter-spacing: 0.1em;
      background: var(--purple-dim);
      border: 1px solid rgba(139,92,246,0.2);
      padding: 0.2rem 0.5rem;
      border-radius: 2px;
    }

    .card-title {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 0.85rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted2);
    }

    /* ── Form ── */
    .field { margin-bottom: 1.1rem; }

    label {
      display: block;
      font-family: var(--mono);
      font-size: 0.62rem;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 0.45rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    input[type="text"],
    input[type="password"],
    input[type="url"] {
      width: 100%;
      background: var(--bg2);
      border: 1px solid var(--border2);
      border-radius: 3px;
      color: var(--text);
      font-family: var(--mono);
      font-size: 0.82rem;
      padding: 0.7rem 0.9rem;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      -webkit-appearance: none;
    }

    input::placeholder { color: var(--muted); }

    input:focus {
      border-color: var(--purple);
      box-shadow: 0 0 0 3px rgba(139,92,246,0.1), inset 0 0 0 1px rgba(139,92,246,0.1);
    }

    input.has-error { border-color: var(--red); }
    input.has-success { border-color: var(--lime); }

    .field-hint {
      font-family: var(--mono);
      font-size: 0.6rem;
      color: var(--muted);
      margin-top: 0.35rem;
      letter-spacing: 0.04em;
    }

    /* ── Buttons ── */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-family: var(--cond);
      font-weight: 700;
      font-size: 0.9rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0.75rem 1.5rem;
      text-decoration: none;
      white-space: nowrap;
      position: relative;
      overflow: hidden;
    }

    .btn::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0);
      transition: background 0.15s;
    }

    .btn:hover::after { background: rgba(255,255,255,0.05); }

    .btn-primary {
      background: var(--purple);
      color: #fff;
      box-shadow: 0 2px 12px rgba(139,92,246,0.3);
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--purple2);
      box-shadow: 0 4px 20px rgba(139,92,246,0.45);
      transform: translateY(-1px);
    }

    .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

    .btn-lime {
      background: var(--lime);
      color: #0e0e0e;
      box-shadow: 0 2px 12px rgba(163,230,53,0.25);
    }

    .btn-lime:hover {
      background: var(--lime2);
      box-shadow: 0 4px 20px rgba(163,230,53,0.4);
      transform: translateY(-1px);
    }

    .btn-ghost {
      background: transparent;
      color: var(--muted2);
      border: 1px solid var(--border2);
    }

    .btn-ghost:hover {
      border-color: var(--purple);
      color: var(--purple2);
    }

    .btn-full { width: 100%; }

    /* ── Status ── */
    .status {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      padding: 0.8rem 1rem;
      border-radius: 3px;
      font-size: 0.78rem;
      font-family: var(--mono);
      margin-top: 1rem;
      animation: slideIn 0.2s ease;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .status.loading {
      background: rgba(139,92,246,0.08);
      border: 1px solid rgba(139,92,246,0.2);
      color: var(--purple2);
    }

    .status.ok {
      background: rgba(163,230,53,0.07);
      border: 1px solid rgba(163,230,53,0.2);
      color: var(--lime);
    }

    .status.fail {
      background: rgba(239,68,68,0.07);
      border: 1px solid rgba(239,68,68,0.2);
      color: #f87171;
    }

    /* ── Result card ── */
    .result-card { display: none; }
    .result-card.visible { display: block; }

    /* ── Info grid ── */
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.6rem;
      margin-bottom: 1.25rem;
    }

    .info-item {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 0.75rem 0.9rem;
    }

    .info-item-label {
      font-family: var(--mono);
      font-size: 0.58rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 0.3rem;
    }

    .info-item-value {
      font-family: var(--cond);
      font-weight: 700;
      font-size: 1rem;
      letter-spacing: 0.02em;
      color: var(--text);
    }

    .info-item-value.green { color: var(--lime); }
    .info-item-value.red { color: var(--red); }
    .info-item-value.yellow { color: var(--yellow); }

    /* ── URL box ── */
    .url-box {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 0.75rem 3.5rem 0.75rem 0.9rem;
      margin-bottom: 0.75rem;
      position: relative;
    }

    .url-label {
      font-family: var(--mono);
      font-size: 0.58rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 0.3rem;
    }

    .url-value {
      font-family: var(--mono);
      font-size: 0.72rem;
      color: var(--purple2);
      word-break: break-all;
      line-height: 1.5;
    }

    .copy-btn {
      position: absolute;
      top: 0.6rem;
      right: 0.6rem;
      background: var(--purple-dim);
      border: 1px solid rgba(139,92,246,0.25);
      border-radius: 2px;
      color: var(--purple2);
      cursor: pointer;
      font-size: 0.6rem;
      font-family: var(--mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 0.25rem 0.6rem;
      transition: all 0.15s;
    }

    .copy-btn:hover { background: rgba(139,92,246,0.2); }

    .copy-btn.copied {
      color: var(--lime);
      border-color: rgba(163,230,53,0.3);
      background: var(--lime-dim);
    }

    /* ── Button row ── */
    .btn-row {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
    }

    .btn-row .btn-lime { flex: 1; }

    /* ── Steps ── */
    .steps { display: flex; flex-direction: column; gap: 0.6rem; }

    .step {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--border);
    }

    .step:last-child { border-bottom: none; }

    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 2px;
      background: var(--lime-dim);
      border: 1px solid rgba(163,230,53,0.25);
      color: var(--lime);
      font-family: var(--mono);
      font-size: 0.62rem;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
      font-weight: 700;
    }

    .step-text {
      font-size: 0.82rem;
      color: var(--muted2);
      line-height: 1.55;
    }

    .step-text strong { color: var(--text); font-weight: 600; }

    /* ── Security note ── */
    .security-note {
      margin-top: 1.25rem;
      padding: 0.9rem 1rem;
      background: rgba(139,92,246,0.06);
      border: 1px solid rgba(139,92,246,0.15);
      border-radius: 3px;
      display: flex;
      gap: 0.65rem;
      align-items: flex-start;
    }

    .security-icon {
      font-size: 0.9rem;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .security-text {
      font-family: var(--mono);
      font-size: 0.68rem;
      color: var(--muted2);
      line-height: 1.65;
    }

    .security-text strong { color: var(--purple2); }

    /* ── Divider ── */
    .divider {
      height: 1px;
      background: var(--border);
      margin: 1.5rem 0;
    }

    /* ── Spinner ── */
    @keyframes spin { to { transform: rotate(360deg); } }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(167,139,250,0.2);
      border-top-color: var(--purple2);
      border-radius: 50%;
      animation: spin 0.65s linear infinite;
      flex-shrink: 0;
    }

    /* ── Footer ── */
    footer {
      text-align: center;
      padding: 2rem;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1.5rem;
      flex-wrap: wrap;
    }

    .footer-brand {
      font-family: var(--cond);
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .footer-brand span { color: var(--lime); }

    .footer-links {
      display: flex;
      gap: 1rem;
    }

    .footer-links a {
      font-family: var(--mono);
      font-size: 0.62rem;
      color: var(--muted);
      text-decoration: none;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      transition: color 0.15s;
    }

    .footer-links a:hover { color: var(--purple2); }

    .footer-sep {
      font-size: 0.6rem;
      color: var(--border2);
    }

    /* ── Responsive ── */
    @media (max-width: 500px) {
      h1 { font-size: 2.6rem; }
      .card { padding: 1.25rem; }
      .info-grid { grid-template-columns: 1fr; }
      header { padding: 2.5rem 1.25rem 1.5rem; }
      main { padding: 0 1.25rem 3rem; }
    }
  </style>
</head>
<body>
<div class="wrapper">

  <!-- Top bar -->
  <div class="topbar">
    <div class="topbar-brand">
      <div class="brand-dot"></div>
      <div class="brand-text">
        <span class="low">Low</span><span class="def">Def</span><span class="pirate">Pirate</span>
      </div>
    </div>
    <div class="topbar-tag">StremCodes // XC Bridge</div>
  </div>

  <!-- Header -->
  <header>
    <div class="hero-eyebrow">
      <div class="eyebrow-line"></div>
      <div class="eyebrow-text">Xtream Codes · Stremio Addon</div>
    </div>
    <h1>
      <span class="line1">Strem</span>
      <span class="line2">Codes</span>
    </h1>
    <p class="hero-sub">
      Connect your XC provider to Stremio in seconds. Your credentials are AES-256 encrypted — never stored, never logged.
    </p>
  </header>

  <main>

    <!-- Card 01: Credentials -->
    <div class="card" id="cred-card">
      <div class="card-header">
        <span class="card-num">01</span>
        <span class="card-title">Connect Your Provider</span>
      </div>

      <div class="field">
        <label>Server URL</label>
        <input id="server" type="url" placeholder="http://your-provider.com:8080" autocomplete="off" />
        <div class="field-hint">Full URL including port — no trailing slash</div>
      </div>

      <div class="field">
        <label>Username</label>
        <input id="username" type="text" placeholder="your_username" autocomplete="off" />
      </div>

      <div class="field">
        <label>Password</label>
        <input id="password" type="password" placeholder="••••••••••••" autocomplete="off" />
      </div>

      <button class="btn btn-primary btn-full" id="validate-btn" onclick="handleValidate()">
        Verify Credentials
      </button>

      <div id="validate-status" style="display:none"></div>
    </div>

    <!-- Card 02: Result -->
    <div class="card result-card" id="result-card">
      <div class="card-header">
        <span class="card-num" style="background:rgba(163,230,53,0.08);border-color:rgba(163,230,53,0.2);color:var(--lime)">02</span>
        <span class="card-title">Account &amp; Install</span>
      </div>

      <div class="info-grid" id="info-grid"></div>

      <div class="url-box" id="addon-url-box" style="display:none">
        <div class="url-label">Addon URL</div>
        <div class="url-value" id="addon-url-text"></div>
        <button class="copy-btn" onclick="copyUrl('addon-url-text', this)">Copy</button>
      </div>

      <div class="btn-row">
        <button class="btn btn-lime" id="stremio-btn" onclick="openStremio()">
          ▶ &nbsp;Install in Stremio
        </button>
        <button class="btn btn-ghost" onclick="copyUrl('addon-url-text', this)">
          Copy URL
        </button>
      </div>

      <div class="divider"></div>

      <div class="card-header" style="margin-bottom:1rem">
        <span class="card-num">?</span>
        <span class="card-title">How to Install</span>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-text">Click <strong>Install in Stremio</strong> — Stremio opens and asks to confirm addon installation.</div>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <div class="step-text">Or copy the <strong>Addon URL</strong> and paste it in Stremio → Add-ons → Community Add-ons → Install URL.</div>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <div class="step-text">Your XC library appears under <strong>Discover → XC Movies</strong> and <strong>XC Series</strong>.</div>
        </div>
      </div>

      <div class="security-note">
        <div class="security-icon">🔒</div>
        <div class="security-text">
          Credentials are <strong>AES-256-GCM encrypted</strong> inside the addon token using PBKDF2 key derivation. They are never stored on any server — only your Stremio client decodes them on-demand.
        </div>
      </div>
    </div>

  </main>

  <footer>
    <div class="footer-brand">Low<span>Def</span>Pirate</div>
    <div class="footer-sep">·</div>
    <div class="footer-links">
      <a href="https://github.com" target="_blank">GitHub</a>
      <a href="https://lowdefpirate.link" target="_blank">lowdefpirate.link</a>
    </div>
  </footer>

</div>

<script>
  let installData = null;

  async function handleValidate() {
    const server = document.getElementById('server').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const statusEl = document.getElementById('validate-status');
    const btn = document.getElementById('validate-btn');

    if (!server || !username || !password) {
      showStatus(statusEl, 'fail', '⚠', 'Please fill in all fields.');
      return;
    }

    if (!server.startsWith('http')) {
      showStatus(statusEl, 'fail', '⚠', 'Server URL must start with http:// or https://');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Verifying...';
    showStatus(statusEl, 'loading', null, 'Connecting to your provider...');

    try {
      const params = new URLSearchParams({ server, username, password });

      const validateRes = await fetch(`/api/validate?${params}`);
      const validateData = await validateRes.json();

      if (!validateData.valid) {
        showStatus(statusEl, 'fail', '✕', validateData.error || 'Invalid credentials');
        btn.disabled = false;
        btn.textContent = 'Verify Credentials';
        return;
      }

      const installRes = await fetch(`/api/install?${params}`);
      installData = await installRes.json();

      if (installData.error) {
        showStatus(statusEl, 'fail', '✕', installData.error);
        btn.disabled = false;
        btn.textContent = 'Verify Credentials';
        return;
      }

      showStatus(statusEl, 'ok', '✓', `Connected · ${validateData.username}`);
      showResult(validateData, installData);

    } catch (err) {
      showStatus(statusEl, 'fail', '✕', 'Network error — check the server URL and try again.');
      btn.disabled = false;
      btn.textContent = 'Verify Credentials';
    }
  }

  function showStatus(el, type, icon, msg) {
    el.style.display = 'flex';
    el.className = `status ${type}`;
    if (type === 'loading') {
      el.innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
    } else {
      el.innerHTML = `<span class="status-icon">${icon}</span><span>${msg}</span>`;
    }
  }

  function showResult(account, install) {
    const card = document.getElementById('result-card');
    const grid = document.getElementById('info-grid');

    let expiry = '—', expiryClass = '';
    if (account.expiry) {
      const d = new Date(parseInt(account.expiry) * 1000);
      const daysLeft = Math.floor((d - new Date()) / 86400000);
      expiry = d.toLocaleDateString();
      if (daysLeft < 0) { expiryClass = 'red'; expiry += ' (expired)'; }
      else if (daysLeft < 30) { expiryClass = 'yellow'; expiry += ` (${daysLeft}d)`; }
      else { expiryClass = 'green'; }
    }

    const statusClass = account.status === 'Active' ? 'green' : 'red';

    grid.innerHTML = `
      <div class="info-item">
        <div class="info-item-label">Username</div>
        <div class="info-item-value">${esc(account.username || '—')}</div>
      </div>
      <div class="info-item">
        <div class="info-item-label">Status</div>
        <div class="info-item-value ${statusClass}">${esc(account.status || '—')}</div>
      </div>
      <div class="info-item">
        <div class="info-item-label">Expires</div>
        <div class="info-item-value ${expiryClass}">${expiry}</div>
      </div>
      <div class="info-item">
        <div class="info-item-label">Connections</div>
        <div class="info-item-value">${account.activeConnections || 0} / ${account.maxConnections || '?'}</div>
      </div>
    `;

    document.getElementById('addon-url-text').textContent = install.addonUrl;
    document.getElementById('addon-url-box').style.display = 'block';
    card.classList.add('visible');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function openStremio() {
    if (!installData?.stremioUrl) return;
    window.location.href = installData.stremioUrl;
  }

  async function copyUrl(elementId, btn) {
    const text = document.getElementById(elementId)?.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (btn && btn.classList) {
        const orig = btn.textContent;
        btn.textContent = '✓ Copied';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
      }
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  ['server','username','password'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleValidate();
    });
  });
</script>
</body>
</html>
