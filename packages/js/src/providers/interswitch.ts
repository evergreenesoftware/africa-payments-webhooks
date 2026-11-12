/**
 * Interswitch (Quickteller Business) — https://docs.interswitchgroup.com/docs/webhooks
 * Header `X-Interswitch-Signature`: HMAC-SHA512 (hex) of the raw JSON body, keyed with the webhook secret from your
 * Quickteller Business configuration. Interswitch expects HTTP 200 with NO body.
 * Note: TRANSACTION.COMPLETED does not mean successful — check responseCode "00".
 * Amount unit is not stated in the webhook docs (reported as `minor` per Interswitch IPG convention — verify for your account).
 */
import { get, getHeader, isoTime, num, str } from '../internal.js';
import type { PaymentEventType } from '../types.js';
import { hexHmac, matchHexHmac, missing, type Provider } from './shared.js';

const HEADER = 'x-interswitch-signature';

const ISO_NUMERIC: Record<string, string> = { '566': 'NGN', '840': 'USD', '936': 'GHS', '404': 'KES' };

function typeFor(event: string, responseCode: string | undefined): PaymentEventType {
  if (event.endsWith('TRANSACTION_SUCCESSFUL')) return 'payment.succeeded';
  if (event.endsWith('TRANSACTION_FAILURE')) return 'payment.failed';
  if (event === 'TRANSACTION.COMPLETED') return responseCode === '00' ? 'payment.succeeded' : 'payment.failed';
  if (event === 'SUBSCRIPTION.CREATED') return 'subscription.created';
  if (event === 'SUBSCRIPTION.CANCELLED') return 'subscription.disabled';
  return 'unknown';
}

export const interswitch: Provider = {
  name: 'interswitch',
  status: 'documented',
  ips: [],
  detectHeaders: [HEADER],

  async verify({ bytes, headers, secrets }) {
    const sig = getHeader(headers, HEADER);
    if (!sig) return missing(HEADER);
    return matchHexHmac('SHA-512', secrets, [bytes], sig, HEADER);
  },

  parse(payload) {
    const event = str(get(payload, 'event')) ?? 'unknown';
    const d = get(payload, 'data');
    const responseCode = str(get(d, 'responseCode'));
    const amount = num(get(d, 'amount'));
    const cc = str(get(d, 'currencyCode'));
    const currency = cc ? (ISO_NUMERIC[cc] ?? cc) : undefined;
    return {
      type: typeFor(event, responseCode),
      providerEventType: event,
      reference: str(get(d, 'merchantReference')) ?? str(get(d, 'paymentReference')) ?? '',
      providerReference: str(get(d, 'paymentReference')) ?? str(get(payload, 'uuid')),
      amount: amount !== undefined && currency ? { value: amount, unit: 'minor', currency } : undefined,
      status: responseCode,
      customer: { name: str(get(d, 'merchantCustomerName')) },
      occurredAt: isoTime(get(d, 'transactionDate') ?? get(payload, 'timestamp')),
    };
  },

  async sign(body, secret) {
    return { 'X-Interswitch-Signature': await hexHmac('SHA-512', secret, body) };
  },
};
