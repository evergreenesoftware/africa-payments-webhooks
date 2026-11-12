/**
 * Flutterwave
 * - v3 (https://developer.flutterwave.com/docs/webhooks): header `verif-hash` carries the "secret hash" you set in the
 *   dashboard — a plain shared secret, NOT a body signature. It does not protect the body: always re-verify the
 *   transaction via GET /v3/transactions/{id}/verify before giving value.
 * - v4 (https://developer.flutterwave.com/v4.0.0/docs/webhooks): header `flutterwave-signature` = base64 HMAC-SHA256 of
 *   the raw body keyed with the secret hash. (BETA: Flutterwave's v4 docs are internally inconsistent.)
 * The version is chosen by which header is present. Amounts are in major units (e.g. naira).
 */
import { digest, timingSafeEqual, utf8 } from '../crypto.js';
import { get, getHeader, isoTime, num, str } from '../internal.js';
import type { PaymentEventType } from '../types.js';
import { base64Hmac, invalid, matchBase64Hmac, missing, OK, type Provider } from './shared.js';

const V3 = 'verif-hash';
const V4 = 'flutterwave-signature';

function v3Type(event: string, status: string | undefined): PaymentEventType {
  const s = status?.toLowerCase();
  if (event === 'charge.completed') return s === 'successful' ? 'payment.succeeded' : s === 'failed' ? 'payment.failed' : 'unknown';
  if (event === 'transfer.completed') return s === 'successful' ? 'transfer.succeeded' : s === 'failed' ? 'transfer.failed' : 'unknown';
  if (event === 'subscription.cancelled') return 'subscription.disabled';
  return 'unknown';
}

export const flutterwave: Provider = {
  name: 'flutterwave',
  status: 'documented',
  ips: [],
  detectHeaders: [V4, V3],

  async verify({ bytes, headers, secrets }) {
    const v4 = getHeader(headers, V4);
    if (v4) return matchBase64Hmac('SHA-256', secrets, [bytes], v4, V4);

    const v3 = getHeader(headers, V3);
    if (!v3) return missing(`${V4} or ${V3}`);
    // Constant-time compare of fixed-length digests of the shared secret.
    const got = await digest('SHA-256', utf8(v3));
    for (const secret of secrets) {
      if (timingSafeEqual(await digest('SHA-256', utf8(secret)), got)) return OK;
    }
    return invalid;
  },

  parse(payload) {
    // v4 envelope: { id, type, timestamp, data }
    const v4Type = str(get(payload, 'type'));
    if (v4Type && get(payload, 'event') === undefined) {
      const data = get(payload, 'data');
      const status = str(get(data, 'status'));
      const amount = num(get(data, 'amount'));
      const currency = str(get(data, 'currency'));
      const s = status?.toLowerCase();
      return {
        type:
          v4Type === 'charge.completed'
            ? s === 'succeeded' || s === 'successful'
              ? 'payment.succeeded'
              : s === 'failed'
                ? 'payment.failed'
                : 'unknown'
            : 'unknown',
        providerEventType: v4Type,
        reference: str(get(data, 'reference')) ?? '',
        providerReference: str(get(data, 'id')),
        amount: amount !== undefined && currency ? { value: amount, unit: 'major', currency } : undefined,
        status,
        customer: {
          email: str(get(data, 'customer', 'email')),
          name: str(get(data, 'customer', 'name')),
          phone: str(get(data, 'customer', 'phone')),
        },
        occurredAt: isoTime(get(data, 'created_datetime') ?? get(payload, 'timestamp')),
      };
    }
    // v3 envelope: { event, data }
    const event = str(get(payload, 'event')) ?? 'unknown';
    const data = get(payload, 'data');
    const status = str(get(data, 'status'));
    const amount = num(get(data, 'amount'));
    const currency = str(get(data, 'currency'));
    return {
      type: v3Type(event, status),
      providerEventType: event,
      reference: str(get(data, 'tx_ref')) ?? str(get(data, 'reference')) ?? '',
      providerReference: str(get(data, 'id')) ?? str(get(data, 'flw_ref')),
      amount: amount !== undefined && currency ? { value: amount, unit: 'major', currency } : undefined,
      status,
      customer: {
        email: str(get(data, 'customer', 'email')),
        name: str(get(data, 'customer', 'name')) ?? str(get(data, 'fullname')),
        phone: str(get(data, 'customer', 'phone_number')),
      },
      occurredAt: isoTime(get(data, 'created_at')),
    };
  },

  async sign(body, secret, opts) {
    // Default to v4 (body-signing). Pass { timestamp: 'v3' } is not used; use signFlutterwaveV3 for v3.
    void opts;
    return { [V4]: await base64Hmac('SHA-256', secret, body) };
  },
};

/** Test helper for Flutterwave v3 (`verif-hash` = the secret hash itself). */
export function signFlutterwaveV3(secretHash: string): Record<string, string> {
  return { [V3]: secretHash };
}
