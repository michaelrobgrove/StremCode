# StremCodes

**Connect your Xtream Codes IPTV subscription to Stremio.**  
Built by [LowDefPirate](https://lowdefpirate.link) · Hosted on Cloudflare Workers

---

## What it does

StremCodes bridges your XC/IPTV provider with Stremio. It matches your provider's VOD and series library against TMDB IDs, so your streams appear automatically on any Stremio title page — no manual browsing required.

- 🎬 **Movies** — matched via TMDB, appear on any movie page in Stremio  
- 📺 **Series** — matched via TMDB, episode-level resolution via your provider  
- 🔄 **Auto-refresh** — library index rebuilds every 12 hours automatically  
- 🔐 **Privacy-first** — credentials AES-256-GCM encrypted in addon URL, never stored  
- ☠ **IP-safe** — all XC API calls route through VPS proxy, never from Cloudflare IPs  

---

## Architecture

```
Browser (setup)
  ├─ Validates credentials → XC server (user's device IP)
  ├─ Fetches full library → XC server (user's device IP)
  ├─ Builds TMDB index in browser
  ├─ POSTs index to CF Worker → stored in KV (hash → stream IDs only, no PII)
  └─ Receives encrypted addon URL

Stremio (stream request)
  ├─ /stream/movie/tt1234567.json
  │    ├─ Cinemeta: IMDB → TMDB id
  │    ├─ KV lookup: TMDB id → stream id
  │    └─ Returns direct stream URL to provider
  └─ /stream/series/tt1234567:1:1.json
       ├─ Cinemeta: IMDB → TMDB id
       ├─ KV lookup: TMDB id → series id
       ├─ getSeriesInfo via VPS proxy → episode id
       └─ Returns direct stream URL to provider
```

**Security:** Credentials are AES-256-GCM encrypted inside the addon URL token. KV only stores `sha256(server+user+pass)` → stream IDs. No usernames, no server URLs, no PII ever stored.

---

## Project structure

```
stremcodes-worker/
├── src/
│   ├── worker.js          — CF Worker entry, routing, UI pages
│   ├── stremio.js         — Stremio protocol (manifest, catalog, meta, stream)
│   ├── xtream.js          — XC API client (proxied through VPS)
│   ├── cinemeta.js        — IMDB → TMDB resolver
│   ├── index-builder.js   — KV index reader + 12h auto-refresh
│   └── crypto.js          — AES-256-GCM + credHash
├── .github/workflows/
│   └── deploy.yml         — Auto-deploy on push to main
├── wrangler.toml
└── package.json
```

---

## Deployment

### Prerequisites
- Cloudflare account (Workers + KV)
- GitHub repo
- VPS running xc-proxy (see xc-proxy/ directory)

### Steps

**1. Create KV namespace**
```bash
npx wrangler kv namespace create INDEX_CACHE
```
Add the returned ID to `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "INDEX_CACHE"
id = "PASTE_ID_HERE"
```

**2. Set encryption secret**
```bash
npx wrangler secret put ENCRYPTION_SECRET
```

**3. GitHub Actions secrets**  
Settings → Secrets → Actions:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

**4. Update proxy URL**  
In `src/worker.js` and `src/index-builder.js`, set `PROXY_URL` to your VPS address.

**5. Push to deploy**
```bash
git push origin main
```

---

## xc-proxy

Tiny Node.js CORS proxy — routes XC API calls through your VPS to bypass provider IP blocks.

```bash
cd xc-proxy
docker compose up -d
ufw allow 6767
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Setup page |
| `GET` | `/manifest.json` | Default manifest (addon directory) |
| `GET` | `/configure` | Manage / update credentials |
| `POST` | `/install` | Encrypt creds → return token |
| `POST` | `/index` | Store TMDB index from browser |
| `POST` | `/refresh` | Clear index → triggers rebuild |
| `GET` | `/:token/manifest.json` | User manifest |
| `GET` | `/:token/catalog/...` | Catalog |
| `GET` | `/:token/meta/...` | Metadata |
| `GET` | `/:token/stream/...` | Stream resolution |

---

## Support

- ☕ [Buy Me a Coffee](https://buymeacoffee.com/yourdsgnpro)  
- 💵 [Cash App](https://cash.app/$Strong8Stream)  
- 🌐 [lowdefpirate.link](https://lowdefpirate.link)

---

MIT License
