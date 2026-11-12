import { type HashAlgorithm, hmac, timingSafeEqual, utf8 } from '../crypto.js';
import { fromBase64, fromHex, toBase64, toHex } from '../encoding.js';
import type { ErrorCode, HeadersInput, PaymentEvent, ProviderName, VerifyOptions } from '../types.js';

export interface VerifyContext {
  bytes: Uint8Array;
  text: string;
  headers: HeadersInput;
  secrets: string[];
  options: VerifyOptions;
}

export type Outcome = { ok: true; unsigned?: boolean } | { ok: false; code: ErrorCode; message: string };

export type ParsedEvent = Omit<PaymentEvent, 'id' | 'provider' | 'raw'>;

/**
 * - `verified`: an official test vector from the provider's docs reproduces in our test suite.
 * - `documented`: implemented exactly per the provider's official docs; no official vector published.
 * - `beta`: provider docs are ambiguous or inconsistent; please report real-world results.
 */
export type ProviderStatus = 'verified' | 'documented' | 'beta';

export interface Provider {
  name: ProviderName;
  status: ProviderStatus;
  /** Provider-published source IPs (if any). */
  ips: readonly string[];
  /** Header(s) whose presence identifies this provider (used by auto-detection). */
  detectHeaders: readonly string[];
  verify(ctx: VerifyContext): Promise<Outcome>;
  parse(payload: unknown): ParsedEvent;
  /** Test helper: produce the signature header(s) a genuine notification would carry. */
  sign(body: string, secret: string, opts?: { timestamp?: string }): Promise<Record<string, string>>;
}

export const missing = (header: string): Outcome => ({
  ok: false,
  code: 'missing_signature',
  message: `Missing ${header} header.`,
});
export const malformed = (header: string): Outcome => ({
  ok: false,
  code: 'malformed_signature',
  message: `The ${header} header is not a well-formed signature.`,
});
export const invalid: Outcome = { ok: false, code: 'invalid_signature', message: 'Signature does not match.' };
export const OK: Outcome = { ok: true };

/** Verify a hex-encoded HMAC (case-insensitive hex) over one or more candidate messages. */
export async function matchHexHmac(
  hash: HashAlgorithm,
  secrets: string[],
  candidates: Uint8Array[],
  headerValue: string,
  headerName: string,
): Promise<Outcome> {
  const expected = fromHex(headerValue);
  if (!expected || expected.length === 0) return malformed(headerName);
  for (const secret of secrets) {
    for (const msg of candidates) {
      if (timingSafeEqual(await hmac(hash, secret, msg), expected)) return OK;
    }
  }
  return invalid;
}

/** Verify a base64-encoded HMAC. */
export async function matchBase64Hmac(
  hash: HashAlgorithm,
  secrets: string[],
  candidates: Uint8Array[],
  headerValue: string,
  headerName: string,
): Promise<Outcome> {
  const expected = fromBase64(headerValue);
  if (!expected || expected.length === 0) return malformed(headerName);
  for (const secret of secrets) {
    for (const msg of candidates) {
      if (timingSafeEqual(await hmac(hash, secret, msg), expected)) return OK;
    }
  }
  return invalid;
}

export async function hexHmac(hash: HashAlgorithm, secret: string, message: string): Promise<string> {
  return toHex(await hmac(hash, secret, utf8(message)));
}

export async function base64Hmac(hash: HashAlgorithm, secret: string, message: string): Promise<string> {
  return toBase64(await hmac(hash, secret, utf8(message)));
}
