/**
 * StremCodes - Cloudflare Pages Function v1.4
 */

import { encryptCredentials, decryptCredentials } from '../../src/crypto.js';
import { XtreamClient } from '../../src/xtream.js';
import { buildManifest, buildCatalog, buildMeta, buildStream } from '../../src/stremio.js';
import { RateLimiter } from '../../src/ratelimit.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const pathname = url.pathname.replace(/^\/api/, '');
  const parts = pathname.split('/').filter(Boolean);

  try {
    if (parts[0] === 'configure') return Response.redirect(url.origin + '/', 302);
    if (parts[0] === 'health') return json({ status: 'ok', version: '1.4.0' });
    if (parts[0] === 'validate') return handleValidate(request, env);
    if (parts[0] === 'install') return handleInstall(request, env);

    if (parts.length >= 2) {
      const token = parts[0];
      const addonPath = parts.slice(1);
      return handleAddonRoute(token, addonPath, url, env, request);
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('StremCodes error:', err && err.message);
    return json({ error: 'Internal server error' }, 500);
  }
}

async function handleValidate(request, env) {
  const url = new URL(request.url);
  const server = url.searchParams.get('server');
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');

  if (!server || !username || !password) {
    return json({ valid: false, error: 'Missing parameters' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.RATE_LIMITER) {
    const limiter = new RateLimiter(env.RATE_LIMITER);
    const ok = await limiter.check('validate:' + ip, 10, 60);
    if (!ok) return json({ valid: false, error: 'Rate limit exceeded' }, 429);
  }

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

async function handleInstall(request, env) {
  const url = new URL(request.url);
  const server = url.searchParams.get('server');
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');

  if (!server || !username || !password) {
    return json({ error: 'Missing parameters' }, 400);
  }

  const secret = env.ENCRYPTION_SECRET || 'stremcodes-default-secret-change-me';
  const token = await encryptCredentials({ server, username, password }, secret);
  const addonUrl = url.origin + '/api/' + token + '/manifest.json';
  const stremioUrl = 'stremio://' + url.host + '/api/' + token + '/manifest.json';

  return json({ token, addonUrl, stremioUrl });
}

async function handleAddonRoute(token, path, url, env, request) {
  const secret = env.ENCRYPTION_SECRET || 'stremcodes-default-secret-change-me';

  let credentials;
  try {
    credentials = await decryptCredentials(token, secret);
  } catch {
    return json({ error: 'Invalid or expired token' }, 401);
  }

  const { server, username, password } = credentials;
  const client = new XtreamClient(server, username, password);
  const route = path[0];

  if (route === 'manifest.json') {
    return json(buildManifest(url.origin, token));
  }

  if (route === 'catalog') {
    const type = path[1];
    const idClean = (path[2] || '').replace('.json', '');
    const skip = parseInt(url.searchParams.get('skip') || '0');
    const search = url.searchParams.get('search') || '';
    try {
      const metas = await buildCatalog(client, type, idClean, skip, search);
      return json({ metas }, { 'Cache-Control': 'public, max-age=300' });
    } catch (err) {
      console.error('Catalog error:', err && err.message);
      return json({ metas: [] });
    }
  }

  if (route === 'meta') {
    const type = path[1];
    const id = (path[2] || '').replace('.json', '');
    try {
      const meta = await buildMeta(client, type, id);
      if (!meta) return json({ meta: null }, 404);
      return json({ meta }, { 'Cache-Control': 'public, max-age=600' });
    } catch (err) {
      console.error('Meta error:', err && err.message);
      return json({ meta: null });
    }
  }

  if (route === 'stream') {
    const type = path[1];
    const id = (path[2] || '').replace('.json', '');
    try {
      // Pass env so buildStream can use STREAM_CACHE KV if bound
      const streams = await buildStream(client, type, id, env);
      return json({ streams }, { 'Cache-Control': 'public, max-age=120' });
    } catch (err) {
      console.error('Stream error:', err && err.message);
      return json({ streams: [] });
    }
  }

  return json({ error: 'Not found' }, 404);
}

function json(data, statusOrHeaders, extra) {
  let status = 200;
  let addH = {};
  if (typeof statusOrHeaders === 'number') { status = statusOrHeaders; addH = extra || {}; }
  else if (typeof statusOrHeaders === 'object') { addH = statusOrHeaders; }
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...addH } });
}
