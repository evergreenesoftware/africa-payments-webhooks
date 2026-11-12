/**
 * Paystack — https://paystack.com/docs/payments/webhooks
 * Header `x-paystack-signature`: HMAC-SHA512 (hex) of the request body, keyed with your secret key (sk_test_/sk_live_).
 * Webhooks are sent only from 52.31.139.75, 52.49.173.169, 52.214.14.220.
 * Amounts are in the currency subunit (kobo, pesewa, cent).
 */
import { get, getHeader, isoTime, num, str } from '../internal.js';
import type { PaymentEventType } from '../types.js';
import { hexHmac, matchHexHmac, missing, type Provider } from './shared.js';

const HEADER = 'x-paystack-signature';

const EVENT_MAP: Record<string, PaymentEventType> = {
  'charge.success': 'payment.succeeded',
  'invoice.payment_failed': 'payment.failed',
  'refund.processed': 'refund.processed',
  'refund.failed': 'refund.failed',
  'refund.pending': 'refund.pending',
  'refund.processing': 'refund.pending',
  'transfer.success': 'transfer.succeeded',
  'transfer.failed': 'transfer.failed',
  'transfer.reversed': 'transfer.reversed',
  'subscription.create': 'subscription.created',
  'subscription.disable': 'subscription.disabled',
};

export const paystack: Provider = {
  name: 'paystack',
  status: 'documented',
  ips: ['52.31.139.75', '52.49.173.169', '52.214.14.220'],
  detectHeaders: [HEADER],

  async verify({ bytes, headers, secrets }) {
    const sig = getHeader(headers, HEADER);
    if (!sig) return missing(HEADER);
    return matchHexHmac('SHA-512', secrets, [bytes], sig, HEADER);
  },

  parse(payload) {
    const event = str(get(payload, 'event')) ?? 'unknown';
    const data = get(payload, 'data');
    const reference = str(get(data, 'reference')) ?? str(get(data, 'transfer_code')) ?? str(get(data, 'subscription_code')) ?? '';
    const amount = num(get(data, 'amount'));
    const currency = str(get(data, 'currency'));
    return {
      type: EVENT_MAP[event] ?? 'unknown',
      providerEventType: event,
      reference,
      providerReference: str(get(data, 'id')),
      amount: amount !== undefined && currency ? { value: amount, unit: 'minor', currency } : undefined,
      status: str(get(data, 'status')),
      customer: {
        email: str(get(data, 'customer', 'email')),
        phone: str(get(data, 'customer', 'phone')),
        name: [str(get(data, 'customer', 'first_name')), str(get(data, 'customer', 'last_name'))].filter(Boolean).join(' ') || undefined,
      },
      occurredAt: isoTime(get(data, 'paid_at') ?? get(data, 'created_at') ?? get(data, 'createdAt')),
    };
  },

  async sign(body, secret) {
    return { [HEADER]: await hexHmac('SHA-512', secret, body) };
  },
};
