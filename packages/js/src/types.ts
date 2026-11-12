export type ProviderName = 'paystack' | 'flutterwave' | 'monnify' | 'squad' | 'korapay' | 'fincra' | 'interswitch' | 'nomba';

/** Anything we can read headers from: Fetch `Headers`, a Node `IncomingHttpHeaders`-style object, or a Map. */
export type HeadersInput = Headers | Map<string, string> | Record<string, string | string[] | number | undefined | null>;

/** The exact bytes received. Never pass a parsed JSON object. */
export type RawBody = string | Uint8Array | ArrayBuffer;

export type ErrorCode =
  | 'missing_signature'
  | 'invalid_signature'
  | 'malformed_signature'
  | 'timestamp_out_of_range'
  | 'ip_not_allowed'
  | 'body_already_parsed'
  | 'invalid_body'
  | 'unknown_provider'
  | 'duplicate_event';

export type Secret = string | readonly string[];

export interface VerifyOptions {
  /**
   * Monnify only: accept notifications without a `monnify-signature` header.
   * Monnify does NOT sign sandbox notifications. NEVER enable in production.
   * @default false
   */
  allowUnsignedSandbox?: boolean;
  /**
   * Nomba only: maximum allowed age (seconds) of the signed `nomba-timestamp` header.
   * Set to 0 to disable the check. @default 300
   */
  toleranceSeconds?: number;
  /** Override the current time (ms since epoch). Useful for tests. */
  now?: number;
  /**
   * Optional source-IP allowlist. `true` = use the provider's published IPs (where available).
   * An array = your own list (IPv4 addresses or IPv4 CIDR ranges). Never sufficient on its own.
   * @default false
   */
  ipAllowlist?: boolean | readonly string[];
  /** Source IP of the request (required when `ipAllowlist` is set). */
  sourceIp?: string;
}

export interface VerifyInput extends VerifyOptions {
  rawBody: RawBody;
  headers: HeadersInput;
  secret: Secret;
}

export type VerifyResult =
  | { ok: true; provider: ProviderName /** set when the event was accepted without a signature (sandbox). */; unsigned?: boolean }
  | { ok: false; provider: ProviderName | undefined; code: ErrorCode; message: string };

export type PaymentEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.reversed'
  | 'refund.processed'
  | 'refund.failed'
  | 'refund.pending'
  | 'transfer.succeeded'
  | 'transfer.failed'
  | 'transfer.reversed'
  | 'subscription.created'
  | 'subscription.disabled'
  | 'unknown';

export interface Amount {
  /** Numeric value exactly as the provider expressed it, in `unit`. */
  value: number;
  /**
   * `minor` = smallest currency unit (kobo/cent), `major` = whole units (naira).
   * We never silently convert between units.
   */
  unit: 'minor' | 'major';
  currency: string;
}

export interface PaymentEvent {
  /** Stable idempotency key: `${provider}:${providerEventType}:${providerReference ?? reference}`. */
  id: string;
  provider: ProviderName;
  type: PaymentEventType;
  /** The provider's own event name, e.g. `charge.success`. */
  providerEventType: string;
  /** Merchant/transaction reference used to look the payment up. */
  reference: string;
  /** Provider-side identifier, if different from `reference`. */
  providerReference?: string;
  amount?: Amount;
  /** Provider's original status string. */
  status?: string;
  customer?: { email?: string; phone?: string; name?: string };
  /** ISO-8601 when the provider gave a parseable timestamp, otherwise the provider's original string. */
  occurredAt?: string;
  /** Original parsed payload. */
  raw: unknown;
}
