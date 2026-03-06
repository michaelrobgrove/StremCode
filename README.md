# 📡 StremCodes

**Stremio addon for Xtream Codes IPTV** — Browse and stream your XC VOD library (movies & series) inside Stremio.

Deployable on **Cloudflare Pages** (free tier). No server required. Credentials are AES-256-GCM encrypted inside the addon token — never stored anywhere.

---

## Features

- 🎬 **VOD Movies** — full catalog with search, pagination, posters, metadata
- 📺 **TV Series** — seasons, episodes, thumbnails, air dates
- 🔒 **Encrypted tokens** — XC credentials are AES-256-GCM encrypted, embedded in the Stremio addon URL
- ⚡ **Edge-deployed** — runs on Cloudflare's global network (free tier)
- 🔍 **Search** — full-text search across your VOD and series catalog
- 📄 **TMDB metadata** — pulls posters, backdrops, cast, trailers when available from your provider

---

## Deploy to Cloudflare Pages

### 1. Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) (free)
- [Node.js 18+](https://nodejs.org)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
npm install -g wrangler
wrangler login
```

### 2. Clone & install

```bash
git clone <your-repo>
cd stremcodes
npm install
```

### 3. Set your encryption secret

This is used to encrypt/decrypt user credentials in the addon token. **Change this to something random and secret.**

**Option A — Wrangler secret (recommended for production):**

```bash
wrangler pages secret put ENCRYPTION_SECRET
# Enter your secret when prompted
```

**Option B — Local `.dev.vars` for development:**

```
# .dev.vars  (never commit this file)
ENCRYPTION_SECRET=your-super-secret-random-string-here
```

### 4. (Optional) Rate limiting with KV

To enable IP-based rate limiting on the `/validate` endpoint, create a KV namespace and bind it:

```bash
wrangler kv:namespace create "RATE_LIMITER"
# Copy the id from the output, add to wrangler.toml:
```

In `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "RATE_LIMITER"
id = "your-kv-namespace-id"
```

### 5. Deploy

```bash
wrangler pages deploy public
```

Or connect your GitHub repo to Cloudflare Pages dashboard for automatic deploys on push.

---

## Local Development

```bash
npm run dev
# Opens at http://localhost:8788
```

---

## How It Works

```
User fills form → /api/validate → checks XC credentials
                → /api/install  → encrypts creds into AES-GCM token
                                → returns stremio:// URL

Stremio installs the addon URL:
  https://your-site.pages.dev/api/<encrypted-token>/manifest.json

On each Stremio request:
  /api/<token>/catalog/... → decrypts token → queries XC API → returns Stremio catalog
  /api/<token>/meta/...    → decrypts token → queries XC API → returns full metadata
  /api/<token>/stream/...  → decrypts token → builds stream URL → returns direct link
```

### Token Security

- Credentials are encrypted with **AES-256-GCM** using a key derived via **PBKDF2** (100,000 iterations, SHA-256)
- Each token uses a **random 96-bit IV** — no two tokens are alike
- The encryption secret lives only in Cloudflare environment variables
- Tokens are **never logged or stored**

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_SECRET` | ✅ Yes | Secret key for AES-256-GCM encryption. Set a long random string. |
| `RATE_LIMITER` | ⬜ Optional | Cloudflare KV namespace binding for rate limiting |

---

## Bunny.net Alternative

Bunny.net does not currently support serverless edge functions in the same way Cloudflare Pages does. The recommended platforms are:

| Platform | Free Tier | Notes |
|---|---|---|
| **Cloudflare Pages** ✅ | 100k req/day | Best option. Functions + KV on free tier. |
| **Vercel** | 100GB-hrs | Works with minor adapter changes |
| **Deno Deploy** | 100k req/day | Works natively (ES modules) |
| **Netlify Edge** | 125k req/month | Works with minor adapter changes |

Bunny.net is excellent for **CDN/storage** (hosting poster images, caching stream responses) but lacks the serverless compute layer needed for this addon.

---

## File Structure

```
stremcodes/
├── functions/
│   └── api/
│       └── [[route]].js     # Cloudflare Pages Function (all API routes)
├── src/
│   ├── crypto.js            # AES-256-GCM credential encryption
│   ├── xtream.js            # Xtream Codes API client
│   ├── stremio.js           # Stremio manifest/catalog/meta/stream builders
│   └── ratelimit.js         # CF KV rate limiter
├── public/
│   ├── index.html           # Configuration UI
│   ├── _headers             # Security & CORS headers
│   └── _redirects           # CF Pages redirects
├── wrangler.toml
└── package.json
```

---

## Stremio Addon URLs

Once deployed, your addon URLs are:

- **Config UI**: `https://your-site.pages.dev/`
- **Validate**: `https://your-site.pages.dev/api/validate?server=...&username=...&password=...`
- **Addon manifest**: `https://your-site.pages.dev/api/<token>/manifest.json`
- **Stremio install**: `stremio://your-site.pages.dev/api/<token>/manifest.json`

---

## Notes

- Stream URLs are **direct links to your XC server** — Stremio connects directly, not through Cloudflare
- VOD catalogs are paginated at 100 items per page (Stremio handles infinite scroll)
- Series episode IDs encode the stream ID and container extension for direct playback
- If your provider doesn't include TMDB metadata, posters/backdrops may be missing

---

## License

MIT — do whatever you want, no warranty.
