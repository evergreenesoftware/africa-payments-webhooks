/**
 * Korapay — https://developers.korapay.com/docs/webhooks
 * Header `x-korapay-signature`: HMAC-SHA256 (hex) of ONLY the `data` object, keyed with your secret key.
 * Korapay's samples sign `JSON.stringify(body.data)`. We first try the exact raw bytes of the `data` value as received,
 * then the compact re-serialisation — both must be produced with your secret, so neither weakens verification.
 * Amounts appear in major units (unit not stated by Korapay).
 */
import { utf8 } from '../crypto.js';
import { extractTopLevelValue, get, getHeader, isoTime, num, safeJsonParse, str } from '../internal.js';
import type { PaymentEventType } from '../types.js';
import { hexHmac, matchHexHmac, missing, type Provider } from './shared.js';

const HEADER = 'x-korapay-signature';

const EVENT_MAP: Record<string, PaymentEventType> = {
  'charge.success': 'payment.succeeded',
  'charge.failed': 'payment.failed',
  'transfer.success': 'transfer.succeeded',
  'transfer.failed': 'transfer.failed',
  'refund.success': 'refund.processed',
  'refund.failed': 'refund.failed',
};

export const korapay: Provider = {
  name: 'korapay',
  status: 'documented',
  ips: [],
  detectHeaders: [HEADER],

  async verify({ text, headers, secrets }) {
    const sig = getHeader(headers, HEADER);
    if (!sig) return missing(HEADER);
    const candidates: Uint8Array[] = [];
    const rawData = extractTopLevelValue(text, 'data');
    if (rawData !== undefined) candidates.push(utf8(rawData));
    const parsed = safeJsonParse(text);
    const data = get(parsed, 'data');
    if (data !== undefined) {
      const compact = JSON.stringify(data);
      if (compact !== rawData) candidates.push(utf8(compact));
    }
    if (candidates.length === 0) return { ok: false, code: 'invalid_body', message: 'Korapay payload has no "data" object.' };
    return matchHexHmac('SHA-256', secrets, candidates, sig, HEADER);
  },

  parse(payload) {
    const event = str(get(payload, 'event')) ?? 'unknown';
    const data = get(payload, 'data');
    const amount = num(get(data, 'amount'));
    const currency = str(get(data, 'currency'));
    return {
      type: EVENT_MAP[event] ?? 'unknown',
      providerEventType: event,
      reference: str(get(data, 'reference')) ?? '',
      providerReference: str(get(data, 'payment_reference')),
      amount: amount !== undefined && currency ? { value: amount, unit: 'major', currency } : undefined,
      status: str(get(data, 'status')),
      customer: { email: str(get(data, 'customer', 'email')), name: str(get(data, 'customer', 'name')) },
      occurredAt: isoTime(get(data, 'transaction_date') ?? get(data, 'completion_date')),
    };
  },

  async sign(body, secret) {
    const parsed = safeJsonParse(body);
    const raw = extractTopLevelValue(body, 'data') ?? JSON.stringify(get(parsed, 'data'));
    return { [HEADER]: await hexHmac('SHA-256', secret, raw) };
  },
};
