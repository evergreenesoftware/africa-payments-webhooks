/**
 * Fincra — https://docs.fincra.com/docs/validating-webhook
 * Header `signature`: HMAC-SHA512 (hex) of the payload, keyed with your WEBHOOK SECRET (encryption key) — not your API key.
 * Fincra's samples re-serialise the payload; we try the raw bytes first, then the compact re-serialisation.
 * Amounts are in major units.
 */
import { utf8 } from '../crypto.js';
import { get, getHeader, isoTime, num, safeJsonParse, str } from '../internal.js';
import type { PaymentEventType } from '../types.js';
import { hexHmac, matchHexHmac, missing, type Provider } from './shared.js';

const HEADER = 'signature';

const EVENT_MAP: Record<string, PaymentEventType> = {
  'charge.successful': 'payment.succeeded',
  'collection.successful': 'payment.succeeded',
  'collection.failed': 'payment.failed',
  'payout.successful': 'transfer.succeeded',
  'payout.failed': 'transfer.failed',
};

export const fincra: Provider = {
  name: 'fincra',
  status: 'documented',
  ips: [],
  detectHeaders: [], // the bare `signature` header is too generic to auto-detect

  async verify({ bytes, text, headers, secrets }) {
    const sig = getHeader(headers, HEADER);
    if (!sig) return missing(HEADER);
    const candidates = [bytes];
    const parsed = safeJsonParse(text);
    if (parsed !== undefined) {
      const compact = JSON.stringify(parsed);
      if (compact !== text) candidates.push(utf8(compact));
    }
    return matchHexHmac('SHA-512', secrets, candidates, sig, HEADER);
  },

  parse(payload) {
    const event = str(get(payload, 'event')) ?? 'unknown';
    const d = get(payload, 'data');
    const isPayout = event.startsWith('payout.');
    const amount = num(
      isPayout
        ? (get(d, 'amountCharged') ?? get(d, 'amountReceived'))
        : (get(d, 'amountReceived') ?? get(d, 'amount') ?? get(d, 'sourceAmount')),
    );
    const currency = str(get(d, 'currency')) ?? str(get(d, isPayout ? 'sourceCurrency' : 'destinationCurrency'));
    return {
      type: EVENT_MAP[event] ?? 'unknown',
      providerEventType: event,
      reference:
        str(get(d, 'merchantReference')) ??
        str(get(d, 'customerReference')) ??
        str(get(d, 'reference')) ??
        str(get(d, 'chargeReference')) ??
        '',
      providerReference: str(get(d, 'reference')) ?? str(get(d, 'id')),
      amount: amount !== undefined && currency ? { value: amount, unit: 'major', currency } : undefined,
      status: str(get(d, 'status')),
      customer: {
        email: str(get(d, 'customer', 'email')) ?? str(get(d, 'recipient', 'email')),
        name: str(get(d, 'customer', 'name')) ?? str(get(d, 'customerName')) ?? str(get(d, 'recipient', 'name')),
      },
      occurredAt: isoTime(get(d, 'createdAt') ?? get(d, 'updatedAt')),
    };
  },

  async sign(body, secret) {
    return { [HEADER]: await hexHmac('SHA-512', secret, body) };
  },
};
