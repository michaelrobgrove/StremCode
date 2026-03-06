/**
 * StremCodes - Cloudflare Pages Function
 * Stremio Addon for Xtream Codes IPTV
 *
 * Route: /api/[...route]
 * Handles: manifest, catalog, stream, meta
 */

import { encryptCredentials, decryptCredentials, hashCredentials } from '../../src/crypto.js';
import { XtreamClient } from '../../src/xtream.js';
import { buildManifest, buildCatalog, buildMeta, buildStream } from '../../src/stremio.js';
import { RateLimiter } from '../../src/ratelimit.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Only allow GET
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = url.pathname.replace(/^\/api/, '');
  const parts = pathname.split('/').filter(Boolean);

  try {
    // Route: /api/configure  (landing page redirect)
    if (parts[0] === 'configure') {
      return Response.redirect(url.origin + '/', 302);
    }

    // Route: /api/health
    if (parts[0] === 'health') {
      return jsonResponse({ status: 'ok', version: '1.2.0' });
    }

    // Route: /api/validate - validate XC credentials
    if (parts[0] === 'validate') {
      return handleValidate(request, env);
    }

    // Route: /api/install - generate encrypted install URL
    if (parts[0] === 'install') {
      return handleInstall(request, env);
    }

    // Stremio addon routes: /api/:token/...
    if (parts.length >= 2) {
      const token = parts[0];
      const addonPath = parts.slice(1);
      return handleAddonRoute(token, addonPath, url, env, request);
    }

    return jsonResponse({ error: 'Not found' }, 404);

  } catch (err) {
    console.error('StremCodes error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

/**
 * Validate Xtream Codes credentials
 */
async function handleValidate(request, env) {
  const url = new URL(request.url);
  const server = url.searchParams.get('server');
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');

  if (!server || !username || !password) {
    return jsonResponse({ valid: false, error: 'Missing parameters' }, 400);
  }

  // Rate limit by IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMITER) {
    const limiter = new RateLimiter(env.RATE_LIMITER);
    const allowed = await limiter.check(`validate:${ip}`, 10, 60); // 10 per minute
    if (!allowed) {
      return jsonResponse({ valid: false, error: 'Rate limit exceeded' }, 429);
    }
  }

  try {
    const client = new XtreamClient(server, username, password);
    const info = await client.getPlayerInfo();
    if (info && info.user_info) {
      return jsonResponse({
        valid: true,
        username: info.user_info.username,
        status: info.user_info.status,
        expiry: info.user_info.exp_date,
        maxConnections: info.user_info.max_connections,
        activeConnections: info.user_info.active_cons,
      });
    }
    return jsonResponse({ valid: false, error: 'Invalid credentials' });
  } catch (err) {
    return jsonResponse({ valid: false, error: 'Could not reach server' });
  }
}

/**
 * Generate encrypted install token and stremio:// URL
 */
async function handleInstall(request, env) {
  const url = new URL(request.url);
  const server = url.searchParams.get('server');
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');

  if (!server || !username || !password) {
    return jsonResponse({ error: 'Missing parameters' }, 400);
  }

  const secret = env.ENCRYPTION_SECRET || 'stremcodes-default-secret-change-me';
  const token = await encryptCredentials({ server, username, password }, secret);
  const addonUrl = `${url.origin}/api/${token}/manifest.json`;
  const stremioUrl = `stremio://${url.host}/api/${token}/manifest.json`;

  return jsonResponse({ token, addonUrl, stremioUrl });
}

/**
 * Handle Stremio addon routes
 */
async function handleAddonRoute(token, path, url, env, request) {
  const secret = env.ENCRYPTION_SECRET || 'stremcodes-default-secret-change-me';

  let credentials;
  try {
    credentials = await decryptCredentials(token, secret);
  } catch {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  const { server, username, password } = credentials;
  const client = new XtreamClient(server, username, password);
  const route = path[0];

  // manifest.json
  if (route === 'manifest.json') {
    const manifest = buildManifest(url.origin, token);
    return jsonResponse(manifest);
  }

  // catalog/:type/:id.json or catalog/:type/:id/skip=N.json
  if (route === 'catalog') {
    const type = path[1]; // 'movie' or 'series'
    const idPart = path[2] || '';
    const idClean = idPart.replace('.json', '');

    // Parse extras from query or path
    const skip = parseInt(url.searchParams.get('skip') || '0');
    const search = url.searchParams.get('search') || '';

    // Category id is encoded in the catalog id
    // Format: "vod_<category_id>" or "series_<category_id>" or "vod_all"
    const catalogId = idClean;

    try {
      const metas = await buildCatalog(client, type, catalogId, skip, search);
      return jsonResponse({ metas }, { 'Cache-Control': 'public, max-age=300' });
    } catch (err) {
      console.error('Catalog error:', err);
      return jsonResponse({ metas: [] });
    }
  }

  // meta/:type/:id.json
  if (route === 'meta') {
    const type = path[1];
    const idPart = path[2] || '';
    const id = idPart.replace('.json', '');

    try {
      const meta = await buildMeta(client, type, id);
      if (!meta) return jsonResponse({ meta: null }, 404);
      return jsonResponse({ meta }, { 'Cache-Control': 'public, max-age=600' });
    } catch (err) {
      console.error('Meta error:', err);
      return jsonResponse({ meta: null });
    }
  }

  // stream/:type/:id.json
  if (route === 'stream') {
    const type = path[1];
    const idPart = path[2] || '';
    const id = idPart.replace('.json', '');

    try {
      const streams = await buildStream(client, type, id);
      return jsonResponse({ streams }, { 'Cache-Control': 'public, max-age=120' });
    } catch (err) {
      console.error('Stream error:', err);
      return jsonResponse({ streams: [] });
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

function jsonResponse(data, statusOrHeaders = 200, extraHeaders = {}) {
  let status = 200;
  let addHeaders = {};

  if (typeof statusOrHeaders === 'number') {
    status = statusOrHeaders;
    addHeaders = extraHeaders;
  } else if (typeof statusOrHeaders === 'object') {
    addHeaders = statusOrHeaders;
  }

  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, ...addHeaders },
  });
}
