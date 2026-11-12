/**
 * Squad (payment gateway) — https://docs.squadco.com/webhook-direct-url/signature-validation
 * Header `x-squad-encrypted-body`: HMAC-SHA512 of the request body keyed with your secret key, hex (Squad compares
 * UPPERCASE; we accept either case). Source IP: 18.133.63.109. Amounts are in kobo.
 * Note: Squad VIRTUAL-ACCOUNT notifications use a different header/scheme (`x-squad-signature`) — not supported yet.
 */
import { get, getHeader, isoTime, num, str } from '../internal.js';
import { hexHmac, matchHexHmac, missing, type Provider } from './shared.js';

const HEADER = 'x-squad-encrypted-body';

export const squad: Provider = {
  name: 'squad',
  status: 'documented',
  ips: ['18.133.63.109'],
  detectHeaders: [HEADER],

  async verify({ bytes, headers, secrets }) {
    const sig = getHeader(headers, HEADER);
    if (!sig) return missing(HEADER);
    return matchHexHmac('SHA-512', secrets, [bytes], sig, HEADER);
  },

  parse(payload) {
    const event = str(get(payload, 'Event')) ?? 'unknown';
    const body = get(payload, 'Body');
    const status = str(get(body, 'transaction_status'));
    const amount = num(get(body, 'amount'));
    const currency = str(get(body, 'currency'));
    const ok = status?.toLowerCase() === 'success';
    return {
      type: event === 'charge_successful' ? (ok ? 'payment.succeeded' : 'unknown') : 'unknown',
      providerEventType: event,
      reference: str(get(payload, 'TransactionRef')) ?? str(get(body, 'transaction_ref')) ?? '',
      providerReference: str(get(body, 'gateway_ref')),
      amount: amount !== undefined && currency ? { value: amount, unit: 'minor', currency } : undefined,
      status,
      customer: { email: str(get(body, 'email')), phone: str(get(body, 'customer_mobile')) },
      occurredAt: isoTime(get(body, 'created_at')),
    };
  },

  async sign(body, secret) {
    return { [HEADER]: (await hexHmac('SHA-512', secret, body)).toUpperCase() };
  },
};
