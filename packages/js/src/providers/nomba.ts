/**
 * Nomba — https://developer.nomba.com/docs/api-basics/webhook
 * Header `nomba-signature`: base64 HMAC-SHA256 of a colon-joined field string (NOT the body), keyed with the signature key
 * set in your dashboard:
 *   event_type:requestId:merchant.userId:merchant.walletId:transaction.transactionId:transaction.type:transaction.time:transaction.responseCode:<nomba-timestamp>
 * Missing fields become "" and a responseCode of "null" becomes "". `nomba-timestamp` is signed, so we enforce a replay
 * window (default 300 s). Nomba's own samples compare signatures case-insensitively (and its docs' published example only
 * matches that way), so we compare case-insensitively too — still in constant time.
 * IMPORTANT: amounts are NOT covered by the signature — re-verify the transaction via Nomba's API before giving value.
 */
import { hmac, timingSafeEqual, utf8 } from '../crypto.js';
import { toBase64 } from '../encoding.js';
import { get, getHeader, isoTime, num, safeJsonParse, str } from '../internal.js';
import type { PaymentEventType } from '../types.js';
import { base64Hmac, invalid, malformed, missing, OK, type Provider } from './shared.js';

const HEADER = 'nomba-signature';
const TS_HEADER = 'nomba-timestamp';

const EVENT_MAP: Record<string, PaymentEventType> = {
  payment_success: 'payment.succeeded',
  payment_failed: 'payment.failed',
  payment_reversal: 'payment.reversed',
  payout_success: 'transfer.succeeded',
  payout_failed: 'transfer.failed',
  payout_refund: 'transfer.reversed',
};

const field = (v: unknown): string => {
  const s = str(v);
  return s === undefined || s === 'null' ? '' : s;
};

export function nombaSigningString(payload: unknown, timestamp: string): string {
  const tx = get(payload, 'data', 'transaction');
  const merchant = get(payload, 'data', 'merchant');
  return [
    field(get(payload, 'event_type')),
    field(get(payload, 'requestId')),
    field(get(merchant, 'userId')),
    field(get(merchant, 'walletId')),
    field(get(tx, 'transactionId')),
    field(get(tx, 'type')),
    field(get(tx, 'time')),
    field(get(tx, 'responseCode')),
    timestamp,
  ].join(':');
}

export const nomba: Provider = {
  name: 'nomba',
  status: 'verified',
  ips: [],
  detectHeaders: [HEADER],

  async verify({ text, headers, secrets, options }) {
    const sig = getHeader(headers, HEADER);
    if (!sig) return missing(HEADER);
    const ts = getHeader(headers, TS_HEADER);
    if (!ts) return missing(TS_HEADER);
    const tolerance = options.toleranceSeconds ?? 300;
    if (tolerance > 0) {
      const when = Date.parse(ts);
      if (Number.isNaN(when)) return malformed(TS_HEADER);
      const now = options.now ?? Date.now();
      if (Math.abs(now - when) > tolerance * 1000) {
        return { ok: false, code: 'timestamp_out_of_range', message: `nomba-timestamp is outside the ${tolerance}s tolerance.` };
      }
    }
    const payload = safeJsonParse(text);
    if (payload === undefined) return { ok: false, code: 'invalid_body', message: 'Nomba payload is not valid JSON.' };
    const message = utf8(nombaSigningString(payload, ts));
    const received = utf8(sig.trim().toLowerCase());
    for (const secret of secrets) {
      const expected = utf8(toBase64(await hmac('SHA-256', secret, message)).toLowerCase());
      if (timingSafeEqual(expected, received)) return OK;
    }
    return invalid;
  },

  parse(payload) {
    const event = str(get(payload, 'event_type')) ?? 'unknown';
    const tx = get(payload, 'data', 'transaction');
    const amount = num(get(tx, 'transactionAmount'));
    return {
      type: EVENT_MAP[event] ?? 'unknown',
      providerEventType: event,
      reference: str(get(tx, 'merchantTxRef')) ?? str(get(tx, 'aliasAccountReference')) ?? str(get(tx, 'transactionId')) ?? '',
      providerReference: str(get(tx, 'transactionId')),
      amount: amount !== undefined ? { value: amount, unit: 'major', currency: 'NGN' } : undefined,
      status: str(get(tx, 'responseCode')) || undefined,
      customer: { name: str(get(payload, 'data', 'customer', 'senderName')) },
      occurredAt: isoTime(get(tx, 'time')),
    };
  },

  async sign(body, secret, opts) {
    const timestamp = opts?.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const signature = await base64Hmac('SHA-256', secret, nombaSigningString(safeJsonParse(body), timestamp));
    return { [HEADER]: signature, [TS_HEADER]: timestamp, 'nomba-signature-algorithm': 'HmacSHA256', 'nomba-signature-version': '1.0.0' };
  },
};
