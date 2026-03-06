/**
 * AES-256-GCM credential encryption
 * Credentials are encrypted into the addon URL token — never stored anywhere.
 */

const ALGO = 'AES-GCM';
const IV_LEN = 12;

async function deriveKey(secret) {
  const enc = new TextEncoder();
  const mat = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('stremcodes-v2'), iterations: 100000, hash: 'SHA-256' },
    mat,
    { name: ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptCredentials(creds, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(JSON.stringify(creds)));
  const out = new Uint8Array(IV_LEN + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), IV_LEN);
  return toBase64url(out);
}

export async function decryptCredentials(token, secret) {
  const buf = fromBase64url(token);
  if (buf.length <= IV_LEN) throw new Error('Token too short');
  const key = await deriveKey(secret);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv: buf.slice(0, IV_LEN) }, key, buf.slice(IV_LEN));
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * Anonymous hash of credentials — used as KV key.
 * The hash reveals nothing about the credentials themselves.
 */
export async function credHash(server, username, password) {
  const enc = new TextEncoder();
  const data = enc.encode(server + ':' + username + ':' + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toBase64url(new Uint8Array(hash)).slice(0, 24);
}

function toBase64url(buf) {
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(s) {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = p.length % 4;
  const b64 = pad ? p + '==='.slice(0, 4 - pad) : p;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
