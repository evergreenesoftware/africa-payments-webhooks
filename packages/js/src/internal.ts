import { utf8 } from './crypto.js';
import type { HeadersInput, RawBody, Secret } from './types.js';

const decoder = new TextDecoder();

export class BodyError extends Error {
  constructor(
    public readonly code: 'body_already_parsed' | 'invalid_body',
    message: string,
  ) {
    super(message);
  }
}

/** Normalise the raw body to bytes + text. Rejects already-parsed objects (the #1 integration bug). */
export function readRawBody(rawBody: RawBody | unknown): { bytes: Uint8Array; text: string } {
  if (typeof rawBody === 'string') return { bytes: utf8(rawBody), text: rawBody };
  if (rawBody instanceof Uint8Array) return { bytes: rawBody, text: decoder.decode(rawBody) };
  if (rawBody instanceof ArrayBuffer) {
    const bytes = new Uint8Array(rawBody);
    return { bytes, text: decoder.decode(bytes) };
  }
  if (rawBody !== null && typeof rawBody === 'object') {
    throw new BodyError(
      'body_already_parsed',
      'The request body was already parsed into an object. Signatures must be verified against the raw bytes — see the "raw body" guide for your framework.',
    );
  }
  throw new BodyError('invalid_body', 'rawBody must be a string, Uint8Array/Buffer or ArrayBuffer.');
}

/** Case-insensitive header lookup over the supported header containers. First value wins for arrays. */
export function getHeader(headers: HeadersInput, name: string): string | undefined {
  const lower = name.toLowerCase();
  if (typeof (headers as Headers).get === 'function' && !(headers instanceof Map)) {
    return (headers as Headers).get(lower) ?? undefined;
  }
  if (headers instanceof Map) {
    for (const [k, v] of headers) if (k.toLowerCase() === lower) return v;
    return undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower || v === undefined || v === null) continue;
    if (Array.isArray(v)) return v[0];
    return String(v);
  }
  return undefined;
}

export function secretsOf(secret: Secret): string[] {
  const list = typeof secret === 'string' ? [secret] : [...secret];
  const clean = list.filter((s) => typeof s === 'string' && s.length > 0);
  if (clean.length === 0) {
    throw new TypeError('africa-payments-webhooks: at least one non-empty secret is required.');
  }
  return clean;
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function get(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Best-effort ISO conversion; returns the original string when it isn't unambiguously parseable. */
export function isoTime(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // seconds vs milliseconds
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  if (typeof v === 'string' && v.length > 0) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v) && /(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return v;
  }
  return undefined;
}

/**
 * Extract the exact raw JSON text of a top-level property value (e.g. `"data"`) from a JSON document,
 * without re-serialising. Returns undefined if not found. Used for providers that sign a sub-object.
 */
export function extractTopLevelValue(json: string, key: string): string | undefined {
  let i = 0;
  const n = json.length;
  const skipWs = () => {
    while (i < n && /\s/.test(json[i] as string)) i++;
  };
  const readString = (): string | undefined => {
    if (json[i] !== '"') return undefined;
    const start = i;
    i++;
    while (i < n) {
      const c = json[i];
      if (c === '\\') i += 2;
      else if (c === '"') {
        i++;
        return JSON.parse(json.slice(start, i)) as string;
      } else i++;
    }
    return undefined;
  };
  const skipValue = (): boolean => {
    skipWs();
    const c = json[i];
    if (c === '"') return readString() !== undefined;
    if (c === '{' || c === '[') {
      let depth = 0;
      while (i < n) {
        const ch = json[i];
        if (ch === '"') {
          if (readString() === undefined) return false;
          continue;
        }
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            i++;
            return true;
          }
        }
        i++;
      }
      return false;
    }
    while (i < n && !/[,}\]\s]/.test(json[i] as string)) i++;
    return true;
  };
  skipWs();
  if (json[i] !== '{') return undefined;
  i++;
  while (i < n) {
    skipWs();
    if (json[i] === '}') return undefined;
    const k = readString();
    if (k === undefined) return undefined;
    skipWs();
    if (json[i] !== ':') return undefined;
    i++;
    skipWs();
    const start = i;
    if (!skipValue()) return undefined;
    if (k === key) return json.slice(start, i);
    skipWs();
    if (json[i] === ',') i++;
  }
  return undefined;
}
