import type { IdempotencyStore } from './idempotency.js';
import type { HeadersInput, PaymentEvent, ProviderName, RawBody, Secret, VerifyOptions, VerifyResult } from './types.js';
import { detectProvider, parse, verify } from './verify.js';

export interface WebhookHandlerOptions extends VerifyOptions {
  /** One provider, or a list (auto-detected from headers). Prefer a single provider per endpoint. */
  provider: ProviderName | readonly ProviderName[];
  /** Secret per provider, or a single secret when `provider` is a single name. Arrays allow rotation. */
  secret: Secret | Partial<Record<ProviderName, Secret>>;
  /** Your business logic. Throwing makes the handler respond 500 so the provider retries. */
  onEvent: (event: PaymentEvent) => unknown | Promise<unknown>;
  /** Called when verification fails (for logging/metrics). Never receives secrets. */
  onError?: (result: Extract<VerifyResult, { ok: false }>) => void;
  /** Dedupe store. Strongly recommended in production. */
  store?: IdempotencyStore;
  /** How long to remember processed event ids. @default 259200 (72 h, Paystack's retry window) */
  ttlSeconds?: number;
}

export interface WebhookRequest {
  rawBody: RawBody;
  headers: HeadersInput;
  sourceIp?: string;
}

export interface WebhookResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  /** Present when the event was verified and parsed. */
  event?: PaymentEvent;
  /** Present when verification failed. */
  error?: Extract<VerifyResult, { ok: false }>;
  duplicate?: boolean;
}

const EMPTY: Record<string, string> = {};

function secretFor(opts: WebhookHandlerOptions, provider: ProviderName): Secret | undefined {
  const s = opts.secret;
  if (typeof s === 'string' || Array.isArray(s)) return s as Secret;
  return (s as Partial<Record<ProviderName, Secret>>)[provider];
}

/**
 * Framework-agnostic core: verify → parse → dedupe → onEvent → response.
 * Responds 200 with an empty body (Interswitch requires no body; other providers ignore it),
 * 401 for failed verification, 500 if `onEvent` throws (so the provider retries).
 */
export function createWebhookHandler(opts: WebhookHandlerOptions) {
  const allowed = Array.isArray(opts.provider) ? (opts.provider as ProviderName[]) : [opts.provider as ProviderName];
  const ttl = opts.ttlSeconds ?? 259_200;

  return async function handle(req: WebhookRequest): Promise<WebhookResponse> {
    const provider = allowed.length === 1 ? allowed[0] : detectProvider(req.headers);
    if (!provider || !allowed.includes(provider)) {
      const error = {
        ok: false as const,
        provider: undefined,
        code: 'unknown_provider' as const,
        message: 'Could not determine the webhook provider.',
      };
      opts.onError?.(error);
      return { status: 400, body: '', headers: EMPTY, error };
    }
    const secret = secretFor(opts, provider);
    if (secret === undefined) throw new TypeError(`africa-payments-webhooks: no secret configured for ${provider}.`);

    const result = await verify(provider, {
      ...opts,
      rawBody: req.rawBody,
      headers: req.headers,
      secret,
      sourceIp: req.sourceIp ?? opts.sourceIp,
    });
    if (!result.ok) {
      opts.onError?.(result);
      const status = result.code === 'body_already_parsed' || result.code === 'invalid_body' ? 400 : 401;
      return { status, body: '', headers: EMPTY, error: result };
    }

    const event = parse(provider, req.rawBody);
    if (opts.store) {
      const fresh = await opts.store.claim(event.id, ttl);
      if (!fresh) return { status: 200, body: '', headers: EMPTY, event, duplicate: true };
    }
    try {
      await opts.onEvent(event);
    } catch (err) {
      await opts.store?.release?.(event.id);
      throw err;
    }
    return { status: 200, body: '', headers: EMPTY, event };
  };
}

export type WebhookHandler = ReturnType<typeof createWebhookHandler>;
