import { BodyError, getHeader, readRawBody, safeJsonParse, secretsOf } from './internal.js';
import { ipMatches } from './ip.js';
import { providers } from './providers/index.js';
import type { HeadersInput, PaymentEvent, ProviderName, RawBody, VerifyInput, VerifyResult } from './types.js';

function isProvider(name: string): name is ProviderName {
  return Object.hasOwn(providers, name);
}

/**
 * Verify that a webhook genuinely came from `provider`.
 * Never throws for bad input — returns `{ ok: false, code }`. Throws only for programmer errors (e.g. no secret).
 */
export async function verify(provider: ProviderName, input: VerifyInput): Promise<VerifyResult> {
  if (!isProvider(provider)) {
    return { ok: false, provider: undefined, code: 'unknown_provider', message: `Unknown provider "${String(provider)}".` };
  }
  const spec = providers[provider];
  const secrets = secretsOf(input.secret);

  let body: { bytes: Uint8Array; text: string };
  try {
    body = readRawBody(input.rawBody);
  } catch (e) {
    if (e instanceof BodyError) return { ok: false, provider, code: e.code, message: e.message };
    throw e;
  }

  if (input.ipAllowlist) {
    const list = input.ipAllowlist === true ? spec.ips : input.ipAllowlist;
    if (list.length === 0) {
      throw new TypeError(`africa-payments-webhooks: ${provider} publishes no source IPs; pass your own ipAllowlist array.`);
    }
    if (!input.sourceIp || !ipMatches(input.sourceIp, list)) {
      return { ok: false, provider, code: 'ip_not_allowed', message: 'Request source IP is not in the allowlist.' };
    }
  }

  const outcome = await spec.verify({ bytes: body.bytes, text: body.text, headers: input.headers, secrets, options: input });
  if (outcome.ok) return outcome.unsigned ? { ok: true, provider, unsigned: true } : { ok: true, provider };
  return { ok: false, provider, code: outcome.code, message: outcome.message };
}

/**
 * Parse an (already verified) webhook body into a normalised `PaymentEvent`.
 * Unknown event types are returned as `type: 'unknown'` with the original payload in `raw` — this never throws for
 * unrecognised events, only for a body that isn't JSON.
 */
export function parse(provider: ProviderName, rawBody: RawBody): PaymentEvent {
  if (!isProvider(provider)) throw new TypeError(`africa-payments-webhooks: unknown provider "${String(provider)}".`);
  const { text } = readRawBody(rawBody);
  const payload = safeJsonParse(text);
  if (payload === undefined) throw new SyntaxError('africa-payments-webhooks: webhook body is not valid JSON.');
  const parsed = providers[provider].parse(payload);
  const key = parsed.providerReference ?? parsed.reference;
  return {
    id: `${provider}:${parsed.providerEventType}:${key}${parsed.status ? `:${parsed.status}` : ''}`,
    provider,
    ...parsed,
    raw: payload,
  };
}

/**
 * Guess the provider from request headers. Prefer one endpoint per provider; use this only when several providers post
 * to the same URL. Fincra cannot be auto-detected (its `signature` header is too generic).
 */
export function detectProvider(headers: HeadersInput): ProviderName | undefined {
  for (const spec of Object.values(providers)) {
    if (spec.detectHeaders.some((h) => getHeader(headers, h) !== undefined)) return spec.name;
  }
  return undefined;
}

/** Status of each provider's implementation (see README → Provider status). */
export function providerInfo(provider: ProviderName) {
  const p = providers[provider];
  return { name: p.name, status: p.status, ips: [...p.ips] };
}

export const supportedProviders = Object.keys(providers) as ProviderName[];
