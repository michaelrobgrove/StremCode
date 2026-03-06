/**
 * StremCodes - Credential Encryption
 *
 * Uses AES-GCM 256-bit encryption to safely embed
 * Xtream Codes credentials in the Stremio addon URL token.
 *
 * The token is base64url-encoded and contains:
 * [iv (12 bytes)] + [ciphertext] + [auth tag (16 bytes)]
 */

const ALGO = 'AES-GCM';
const KEY_LEN = 256;
const IV_LEN = 12;

/**
 * Derive a CryptoKey from a string secret using PBKDF2
 */
async function deriveKey(secret) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('stremcodes-v1'),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGO, length: KEY_LEN },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt credentials object → base64url token
 */
export async function encryptCredentials(credentials, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(credentials));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    plaintext
  );

  // Combine iv + ciphertext into one buffer
  const combined = new Uint8Array(IV_LEN + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LEN);

  // Base64url encode (URL-safe, no padding issues)
  return bufferToBase64url(combined);
}

/**
 * Decrypt base64url token → credentials object
 */
export async function decryptCredentials(token, secret) {
  const combined = base64urlToBuffer(token);
  if (combined.length <= IV_LEN) {
    throw new Error('Token too short');
  }

  const iv = combined.slice(0, IV_LEN);
  const ciphertext = combined.slice(IV_LEN);
  const key = await deriveKey(secret);

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: ALGO, iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error('Decryption failed - invalid token or wrong secret');
  }

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plaintext));
}

/**
 * Hash credentials for cache keys (non-reversible)
 */
export async function hashCredentials(server, username) {
  const enc = new TextEncoder();
  const data = enc.encode(`${server}:${username}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64url(new Uint8Array(hash)).slice(0, 16);
}

// Helpers
function bufferToBase64url(buffer) {
  let binary = '';
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToBuffer(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const base64 = pad ? padded + '==='.slice(0, 4 - pad) : padded;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
