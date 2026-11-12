import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type ProviderName, supportedProviders, verify } from '../src/index.js';
import { signTestPayload } from '../src/testing.js';

const SECRET = 'sk_test_0123456789abcdef';
const NOW = Date.parse('2026-11-12T10:00:00Z');
const TS = '2026-11-12T10:00:00Z';

const samples: Record<ProviderName, unknown> = {
  paystack: { event: 'charge.success', data: { id: 302961, reference: 'qTPrJoy9Bx', amount: 20000, currency: 'NGN', status: 'success' } },
  flutterwave: {
    id: 'wbk_1',
    type: 'charge.completed',
    timestamp: 1735116884019,
    data: { id: 'chg_1', reference: 'r1', amount: 100, currency: 'NGN', status: 'succeeded' },
  },
  monnify: {
    eventType: 'SUCCESSFUL_TRANSACTION',
    eventData: { paymentReference: 'p1', transactionReference: 'MNFY|1', amountPaid: 3000, currency: 'NGN', paymentStatus: 'PAID' },
  },
  squad: {
    Event: 'charge_successful',
    TransactionRef: 'SQ1',
    Body: { amount: 10000, transaction_ref: 'SQ1', transaction_status: 'Success', currency: 'NGN', email: 'a@b.co' },
  },
  korapay: {
    event: 'charge.success',
    data: { reference: 'KPY-1', amount: 150.99, fee: 2.25, currency: 'NGN', status: 'success', payment_reference: 'ord-1' },
  },
  fincra: {
    event: 'collection.successful',
    data: {
      reference: 'f1',
      sourceAmount: 50,
      amountReceived: 49.5,
      sourceCurrency: 'NGN',
      destinationCurrency: 'NGN',
      status: 'successful',
    },
  },
  interswitch: {
    event: 'TRANSACTION.COMPLETED',
    uuid: 'u1',
    timestamp: 1594646111460,
    data: { paymentReference: 'FBN|WEB|1', merchantReference: 'm1', amount: 12000, currencyCode: '566', responseCode: '00' },
  },
  nomba: {
    event_type: 'payment_success',
    requestId: 'r1',
    data: {
      merchant: { userId: 'u', walletId: 'w' },
      transaction: { transactionId: 't1', type: 'vact_transfer', time: TS, responseCode: '', transactionAmount: 120 },
    },
  },
};

/** Independent reference implementation of each provider's documented scheme using node:crypto. */
function referenceHeaders(p: ProviderName, body: string, secret: string): Record<string, string> {
  const parsed = JSON.parse(body);
  switch (p) {
    case 'paystack':
      return { 'x-paystack-signature': createHmac('sha512', secret).update(body).digest('hex') };
    case 'flutterwave':
      return { 'flutterwave-signature': createHmac('sha256', secret).update(body).digest('base64') };
    case 'monnify':
      return { 'monnify-signature': createHmac('sha512', secret).update(body).digest('hex') };
    case 'squad':
      return { 'x-squad-encrypted-body': createHmac('sha512', secret).update(body).digest('hex').toUpperCase() };
    case 'korapay':
      return { 'x-korapay-signature': createHmac('sha256', secret).update(JSON.stringify(parsed.data)).digest('hex') };
    case 'fincra':
      return { signature: createHmac('sha512', secret).update(JSON.stringify(parsed)).digest('hex') };
    case 'interswitch':
      return { 'X-Interswitch-Signature': createHmac('sha512', secret).update(body).digest('hex') };
    case 'nomba': {
      const t = parsed.data.transaction;
      const m = parsed.data.merchant;
      const s = [parsed.event_type, parsed.requestId, m.userId, m.walletId, t.transactionId, t.type, t.time, t.responseCode, TS].join(':');
      return { 'nomba-signature': createHmac('sha256', secret).update(s).digest('base64'), 'nomba-timestamp': TS };
    }
  }
}

describe.each(supportedProviders)('%s', (provider) => {
  const body = JSON.stringify(samples[provider]);

  it('accepts a signature produced by an independent node:crypto implementation of the documented scheme', async () => {
    const res = await verify(provider, { rawBody: body, headers: referenceHeaders(provider, body, SECRET), secret: SECRET, now: NOW });
    expect(res).toEqual({ ok: true, provider });
  });

  it('round-trips with signTestPayload', async () => {
    const signed = await signTestPayload(provider, samples[provider], SECRET, { timestamp: TS });
    const res = await verify(provider, { rawBody: signed.body, headers: signed.headers, secret: SECRET, now: NOW });
    expect(res.ok).toBe(true);
  });

  it('accepts Uint8Array and ArrayBuffer bodies', async () => {
    const signed = await signTestPayload(provider, samples[provider], SECRET, { timestamp: TS });
    const bytes = new TextEncoder().encode(signed.body);
    expect((await verify(provider, { rawBody: bytes, headers: signed.headers, secret: SECRET, now: NOW })).ok).toBe(true);
    expect((await verify(provider, { rawBody: bytes.slice().buffer, headers: signed.headers, secret: SECRET, now: NOW })).ok).toBe(true);
  });

  it('rejects the wrong secret', async () => {
    const signed = await signTestPayload(provider, samples[provider], SECRET, { timestamp: TS });
    const res = await verify(provider, { rawBody: signed.body, headers: signed.headers, secret: 'wrong-secret', now: NOW });
    expect(res).toMatchObject({ ok: false, code: 'invalid_signature' });
  });

  it('supports secret rotation (array of secrets)', async () => {
    const signed = await signTestPayload(provider, samples[provider], SECRET, { timestamp: TS });
    const res = await verify(provider, { rawBody: signed.body, headers: signed.headers, secret: ['old-secret', SECRET], now: NOW });
    expect(res.ok).toBe(true);
  });

  it('reports a missing signature', async () => {
    const res = await verify(provider, { rawBody: body, headers: { 'content-type': 'application/json' }, secret: SECRET, now: NOW });
    expect(res).toMatchObject({ ok: false, code: 'missing_signature' });
  });

  it('rejects an already-parsed body', async () => {
    const signed = await signTestPayload(provider, samples[provider], SECRET, { timestamp: TS });
    const res = await verify(provider, { rawBody: JSON.parse(signed.body) as never, headers: signed.headers, secret: SECRET, now: NOW });
    expect(res).toMatchObject({ ok: false, code: 'body_already_parsed' });
  });

  it('header lookup is case-insensitive and works with a Fetch Headers object', async () => {
    const signed = await signTestPayload(provider, samples[provider], SECRET, { timestamp: TS });
    const upper = Object.fromEntries(Object.entries(signed.headers).map(([k, v]) => [k.toUpperCase(), v]));
    expect((await verify(provider, { rawBody: signed.body, headers: upper, secret: SECRET, now: NOW })).ok).toBe(true);
    expect((await verify(provider, { rawBody: signed.body, headers: new Headers(signed.headers), secret: SECRET, now: NOW })).ok).toBe(
      true,
    );
  });
});

describe('tampering is detected for body-signing providers', () => {
  const bodySigning: ProviderName[] = ['paystack', 'flutterwave', 'monnify', 'squad', 'korapay', 'fincra', 'interswitch'];
  it.each(bodySigning)('%s: changed amount fails', async (provider) => {
    const signed = await signTestPayload(provider, samples[provider], SECRET);
    const tampered = signed.body.replace(/(\d)(?=[,}])/, (d) => String((Number(d) + 1) % 10));
    expect(tampered).not.toBe(signed.body);
    const res = await verify(provider, { rawBody: tampered, headers: signed.headers, secret: SECRET });
    expect(res).toMatchObject({ ok: false, code: 'invalid_signature' });
  });
});

describe('provider-specific behaviour', () => {
  it('Flutterwave v3: verif-hash equal to the secret hash passes; anything else fails', async () => {
    const body = JSON.stringify({
      event: 'charge.completed',
      data: { id: 1, tx_ref: 't', amount: 100, currency: 'NGN', status: 'successful' },
    });
    expect((await verify('flutterwave', { rawBody: body, headers: { 'verif-hash': SECRET }, secret: SECRET })).ok).toBe(true);
    expect(await verify('flutterwave', { rawBody: body, headers: { 'verif-hash': `${SECRET}x` }, secret: SECRET })).toMatchObject({
      ok: false,
      code: 'invalid_signature',
    });
  });

  it('Flutterwave: v4 header takes precedence over v3', async () => {
    const body = '{"type":"charge.completed","data":{}}';
    const res = await verify('flutterwave', {
      rawBody: body,
      headers: { 'verif-hash': SECRET, 'flutterwave-signature': 'AAAA' },
      secret: SECRET,
    });
    expect(res).toMatchObject({ ok: false, code: 'invalid_signature' });
  });

  it('Squad: lower-case hex is also accepted', async () => {
    const body = JSON.stringify(samples.squad);
    const sig = createHmac('sha512', SECRET).update(body).digest('hex');
    expect((await verify('squad', { rawBody: body, headers: { 'x-squad-encrypted-body': sig }, secret: SECRET })).ok).toBe(true);
  });

  it('Korapay: verifies against the raw `data` bytes even when formatting differs from JSON.stringify', async () => {
    const dataRaw = '{ "reference" : "KPY-1", "amount": 150.10, "currency":"NGN", "url": "https:\\/\\/x" }';
    const body = `{"event":"charge.success","data":${dataRaw}}`;
    const sig = createHmac('sha256', SECRET).update(dataRaw).digest('hex');
    expect((await verify('korapay', { rawBody: body, headers: { 'x-korapay-signature': sig }, secret: SECRET })).ok).toBe(true);
  });

  it('Fincra: verifies when the body was pretty-printed but signed compactly', async () => {
    const compact = JSON.stringify(samples.fincra);
    const pretty = JSON.stringify(samples.fincra, null, 2);
    const sig = createHmac('sha512', SECRET).update(compact).digest('hex');
    expect((await verify('fincra', { rawBody: pretty, headers: { signature: sig }, secret: SECRET })).ok).toBe(true);
  });

  it('Monnify: unsigned sandbox events are rejected unless explicitly allowed', async () => {
    const body = JSON.stringify(samples.monnify);
    expect(await verify('monnify', { rawBody: body, headers: {}, secret: SECRET })).toMatchObject({ ok: false, code: 'missing_signature' });
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await verify('monnify', { rawBody: body, headers: {}, secret: SECRET, allowUnsignedSandbox: true })).toEqual({
        ok: true,
        provider: 'monnify',
        unsigned: true,
      });
    } finally {
      console.warn = warn;
    }
  });

  it('Nomba: missing timestamp header and malformed timestamp are rejected', async () => {
    const body = JSON.stringify(samples.nomba);
    const { headers } = await signTestPayload('nomba', samples.nomba, SECRET, { timestamp: TS });
    const { 'nomba-timestamp': _ts, ...noTs } = headers;
    expect(await verify('nomba', { rawBody: body, headers: noTs, secret: SECRET, now: NOW })).toMatchObject({
      ok: false,
      code: 'missing_signature',
    });
    expect(
      await verify('nomba', { rawBody: body, headers: { ...headers, 'nomba-timestamp': 'yesterday' }, secret: SECRET, now: NOW }),
    ).toMatchObject({
      ok: false,
      code: 'malformed_signature',
    });
  });

  it('Nomba: tolerance 0 disables the replay window', async () => {
    const { body, headers } = await signTestPayload('nomba', samples.nomba, SECRET, { timestamp: TS });
    expect((await verify('nomba', { rawBody: body, headers, secret: SECRET, toleranceSeconds: 0, now: NOW + 10 * 86_400_000 })).ok).toBe(
      true,
    );
  });

  it('malformed hex/base64 signatures are reported, never thrown', async () => {
    const body = JSON.stringify(samples.paystack);
    expect(await verify('paystack', { rawBody: body, headers: { 'x-paystack-signature': 'zz-not-hex' }, secret: SECRET })).toMatchObject({
      ok: false,
      code: 'malformed_signature',
    });
    expect(await verify('flutterwave', { rawBody: body, headers: { 'flutterwave-signature': '%%%' }, secret: SECRET })).toMatchObject({
      ok: false,
      code: 'malformed_signature',
    });
  });

  it('unknown provider and empty secret', async () => {
    expect(await verify('stripe' as ProviderName, { rawBody: '{}', headers: {}, secret: SECRET })).toMatchObject({
      ok: false,
      code: 'unknown_provider',
    });
    await expect(verify('paystack', { rawBody: '{}', headers: {}, secret: '' })).rejects.toThrow(/secret/);
  });

  it('error messages never contain the secret or the received signature', async () => {
    const body = JSON.stringify(samples.paystack);
    const sig = createHash('sha512').update('x').digest('hex');
    const res = await verify('paystack', { rawBody: body, headers: { 'x-paystack-signature': sig }, secret: SECRET });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).not.toContain(SECRET);
      expect(res.message).not.toContain(sig);
    }
  });
});

describe('IP allowlist (optional)', () => {
  it('uses provider-published IPs when true', async () => {
    const { body, headers } = await signTestPayload('paystack', samples.paystack, SECRET);
    expect((await verify('paystack', { rawBody: body, headers, secret: SECRET, ipAllowlist: true, sourceIp: '52.31.139.75' })).ok).toBe(
      true,
    );
    expect(
      (await verify('paystack', { rawBody: body, headers, secret: SECRET, ipAllowlist: true, sourceIp: '::ffff:52.49.173.169' })).ok,
    ).toBe(true);
    expect(await verify('paystack', { rawBody: body, headers, secret: SECRET, ipAllowlist: true, sourceIp: '1.2.3.4' })).toMatchObject({
      ok: false,
      code: 'ip_not_allowed',
    });
  });

  it('supports custom CIDR lists and throws when a provider publishes none', async () => {
    const { body, headers } = await signTestPayload('korapay', samples.korapay, SECRET);
    expect(
      (await verify('korapay', { rawBody: body, headers, secret: SECRET, ipAllowlist: ['10.0.0.0/8'], sourceIp: '10.2.3.4' })).ok,
    ).toBe(true);
    await expect(verify('korapay', { rawBody: body, headers, secret: SECRET, ipAllowlist: true, sourceIp: '10.2.3.4' })).rejects.toThrow(
      /no source IPs/,
    );
  });
});
