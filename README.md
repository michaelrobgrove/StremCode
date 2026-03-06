# StremCodes v2.0 — LowDefPirate

Stremio addon for Xtream Codes IPTV. Deployed as a **Cloudflare Worker** (not Pages).

## Deploy in 5 minutes

### 1. Install Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 2. Create KV namespace
```bash
wrangler kv:namespace create "INDEX_CACHE"
```
Copy the `id` from the output and paste it into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "INDEX_CACHE"
id = "paste-your-id-here"
```

### 3. Set encryption secret
```bash
wrangler secret put ENCRYPTION_SECRET
# Enter any long random string when prompted
```

### 4. Deploy
```bash
npm install
npm run deploy
```

Your addon is live at: `https://stremcodes.<your-subdomain>.workers.dev`

---

## How it works

**Security model:**
- Credentials are AES-256-GCM encrypted inside the Stremio addon URL — never stored anywhere
- KV stores only: `sha256(server+user+pass)` → `{tmdbId: streamId}` index
- The hash reveals nothing. No server URLs, no usernames, no passwords ever touch KV.

**Stream matching:**
1. Stremio sends IMDB id (e.g. `tt1234567`)
2. Worker looks up IMDB→TMDB via Cinemeta (cached in KV 30 days)
3. Worker looks up TMDB→XC stream via the user's index (cached in KV 6 hours)
4. Returns direct stream URL

**First stream per session:** 10-30 seconds (index builds from your full XC library)
**All subsequent streams:** ~300ms (KV lookup)
**Index auto-rebuilds:** every 6 hours to catch daily library changes

**Scales to:**
- Unlimited users (each has their own anonymous KV entry)
- 200k+ stream libraries
- Multiple XC servers per user if needed

---

## KV storage estimate

Per user:
- `idx:<hash>`: ~500KB-2MB depending on library size (10k-200k streams)
- `cm:<imdbId>`: ~200 bytes per unique title looked up

KV free tier: 1GB storage, 100k reads/day — sufficient for hundreds of users.
KV paid tier: $0.50/GB/month — trivial cost even at thousands of users.
