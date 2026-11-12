/**
 * Monnify — https://developers.monnify.com/docs/webhooks
 * Header `monnify-signature`: HMAC-SHA512 (lowercase hex) of the request body, keyed with your client secret.
 * (Monnify's prose says "SHA-512(secret + body)" but its own published test vector only reproduces as HMAC-SHA512.)
 * Monnify does NOT sign sandbox notifications — see `allowUnsignedSandbox`.
 * Source IP: 35.242.133.146. Amounts are in major units (naira).
 */
import { get, getHeader, isoTime, num, str } from '../internal.js';
import type { PaymentEventType } from '../types.js';
import { hexHmac, matchHexHmac, missing, type Provider } from './shared.js';

const HEADER = 'monnify-signature';

const EVENT_MAP: Record<string, PaymentEventType> = {
  SUCCESSFUL_TRANSACTION: 'payment.succeeded',
  REJECTED_PAYMENT: 'payment.failed',
  SUCCESSFUL_DISBURSEMENT: 'transfer.succeeded',
  FAILED_DISBURSEMENT: 'transfer.failed',
  REVERSED_DISBURSEMENT: 'transfer.reversed',
  SUCCESSFUL_REFUND: 'refund.processed',
  FAILED_REFUND: 'refund.failed',
};

export const monnify: Provider = {
  name: 'monnify',
  status: 'verified',
  ips: ['35.242.133.146'],
  detectHeaders: [HEADER],

  async verify({ bytes, headers, secrets, options }) {
    const sig = getHeader(headers, HEADER);
    if (!sig) {
      if (options.allowUnsignedSandbox) {
        console.warn(
          '[africa-payments-webhooks] Accepting an UNSIGNED Monnify notification because allowUnsignedSandbox=true. Never enable this in production.',
        );
        return { ok: true, unsigned: true };
      }
      return missing(HEADER);
    }
    return matchHexHmac('SHA-512', secrets, [bytes], sig, HEADER);
  },

  parse(payload) {
    const event = str(get(payload, 'eventType')) ?? 'unknown';
    const d = get(payload, 'eventData');
    const isCollection = event === 'SUCCESSFUL_TRANSACTION' || event === 'REJECTED_PAYMENT';
    const amount = num(isCollection ? get(d, 'amountPaid') : (get(d, 'amount') ?? get(d, 'refundAmount')));
    const currency = str(get(d, 'currency'));
    return {
      type: EVENT_MAP[event] ?? 'unknown',
      providerEventType: event,
      reference:
        str(get(d, 'paymentReference')) ??
        str(get(d, 'reference')) ??
        str(get(d, 'refundReference')) ??
        str(get(d, 'transactionReference')) ??
        '',
      providerReference: str(get(d, 'transactionReference')),
      amount: amount !== undefined && currency ? { value: amount, unit: 'major', currency } : undefined,
      status: str(get(d, 'paymentStatus')) ?? str(get(d, 'status')) ?? str(get(d, 'refundStatus')),
      customer: { email: str(get(d, 'customer', 'email')), name: str(get(d, 'customer', 'name')) },
      occurredAt: isoTime(get(d, 'paidOn') ?? get(d, 'completedOn') ?? get(d, 'createdOn')),
    };
  },

  async sign(body, secret) {
    return { [HEADER]: await hexHmac('SHA-512', secret, body) };
  },
};
