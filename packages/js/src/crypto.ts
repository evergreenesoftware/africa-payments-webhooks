/**
 * Cross-runtime crypto helpers built on the Web Crypto API (`globalThis.crypto.subtle`).
 * Available on Node.js >= 20, Bun, Deno, Cloudflare Workers and Vercel/Next.js runtimes.
 * Everything here is async because `crypto.subtle` is async-only.
 */

const encoder = new TextEncoder();

export type HashAlgorithm = 'SHA-256' | 'SHA-512';

function getSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'africa-payments-webhooks: Web Crypto API (globalThis.crypto.subtle) is not available. Use Node.js >= 20, Bun, Deno or an edge runtime.',
    );
  }
  return subtle;
}

export function utf8(input: string): Uint8Array {
  return encoder.encode(input);
}

/** Copy into a fresh ArrayBuffer-backed view (avoids SharedArrayBuffer / offset issues with SubtleCrypto). */
function toBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  return copy;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
const KEY_CACHE_LIMIT = 32;

function importHmacKey(secret: string, hash: HashAlgorithm): Promise<CryptoKey> {
  const cacheKey = `${hash}\u0000${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = getSubtle().importKey('raw', toBufferSource(utf8(secret)), { name: 'HMAC', hash }, false, ['sign']);
    if (keyCache.size >= KEY_CACHE_LIMIT) {
      const oldest = keyCache.keys().next().value;
      if (oldest !== undefined) keyCache.delete(oldest);
    }
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** HMAC over raw bytes. Returns the raw MAC bytes. */
export async function hmac(hash: HashAlgorithm, secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await importHmacKey(secret, hash);
  const sig = await getSubtle().sign('HMAC', key, toBufferSource(data));
  return new Uint8Array(sig);
}

/** Plain digest (no key). */
export async function digest(hash: HashAlgorithm, data: Uint8Array): Promise<Uint8Array> {
  const out = await getSubtle().digest(hash, toBufferSource(data));
  return new Uint8Array(out);
}

/**
 * Constant-time comparison of two byte arrays.
 * Returns false immediately only when lengths differ (length is not secret: it is fixed per algorithm).
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}
