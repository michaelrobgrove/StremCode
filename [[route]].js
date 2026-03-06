{
  "name": "stremcodes",
  "version": "1.2.0",
  "description": "Stremio addon for Xtream Codes IPTV — LowDefPirate edition, deployable on Cloudflare Pages",
  "private": true,
  "scripts": {
    "dev": "wrangler pages dev public --compatibility-date=2024-01-01",
    "deploy": "wrangler pages deploy public",
    "build": "echo 'No build step required for CF Pages'"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  },
  "engines": {
    "node": ">=18"
  }
}
