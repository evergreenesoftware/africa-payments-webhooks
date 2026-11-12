import { describe, expect, it, vi } from 'vitest';
import { createWebhookHandler, MemoryIdempotencyStore, type PaymentEvent } from '../src/index.js';
import { signTestPayload } from '../src/testing.js';

const SECRET = 'sk_test_handler';
const payload = { event: 'charge.success', data: { id: 1, reference: 'r1', amount: 500, currency: 'NGN', status: 'success' } };

describe('createWebhookHandler', () => {
  it('verifies, parses and calls onEvent; responds 200 with empty body', async () => {
    const onEvent = vi.fn();
    const handle = createWebhookHandler({ provider: 'paystack', secret: SECRET, onEvent });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    const res = await handle({ rawBody: body, headers });
    expect(res).toMatchObject({ status: 200, body: '' });
    expect(onEvent).toHaveBeenCalledOnce();
    const event = onEvent.mock.calls[0]?.[0] as PaymentEvent | undefined;
    expect(event?.type).toBe('payment.succeeded');
  });

  it('responds 401 and calls onError for bad signatures (never calling onEvent)', async () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const handle = createWebhookHandler({ provider: 'paystack', secret: SECRET, onEvent, onError });
    const { body, headers } = await signTestPayload('paystack', payload, 'other');
    const res = await handle({ rawBody: body, headers });
    expect(res.status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_signature' }));
  });

  it('responds 400 when the body was already parsed', async () => {
    const handle = createWebhookHandler({ provider: 'paystack', secret: SECRET, onEvent: () => {} });
    const { headers } = await signTestPayload('paystack', payload, SECRET);
    const res = await handle({ rawBody: payload as never, headers });
    expect(res).toMatchObject({ status: 400, error: { code: 'body_already_parsed' } });
  });

  it('dedupes retried events with an idempotency store', async () => {
    const onEvent = vi.fn();
    const handle = createWebhookHandler({ provider: 'paystack', secret: SECRET, onEvent, store: new MemoryIdempotencyStore() });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    await handle({ rawBody: body, headers });
    const second = await handle({ rawBody: body, headers });
    expect(second).toMatchObject({ status: 200, duplicate: true });
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('releases the claim when onEvent throws so the retry is processed', async () => {
    let calls = 0;
    const handle = createWebhookHandler({
      provider: 'paystack',
      secret: SECRET,
      store: new MemoryIdempotencyStore(),
      onEvent: () => {
        calls++;
        if (calls === 1) throw new Error('db down');
      },
    });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    await expect(handle({ rawBody: body, headers })).rejects.toThrow('db down');
    expect((await handle({ rawBody: body, headers })).status).toBe(200);
    expect(calls).toBe(2);
  });

  it('routes several providers on one endpoint using per-provider secrets', async () => {
    const seen: string[] = [];
    const handle = createWebhookHandler({
      provider: ['paystack', 'monnify'],
      secret: { paystack: SECRET, monnify: 'monnify-secret' },
      onEvent: (e) => {
        seen.push(e.provider);
      },
    });
    const p = await signTestPayload('paystack', payload, SECRET);
    const m = await signTestPayload(
      'monnify',
      { eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: 'x' } },
      'monnify-secret',
    );
    expect((await handle({ rawBody: p.body, headers: p.headers })).status).toBe(200);
    expect((await handle({ rawBody: m.body, headers: m.headers })).status).toBe(200);
    expect(seen).toEqual(['paystack', 'monnify']);
    expect((await handle({ rawBody: '{}', headers: { 'x-korapay-signature': 'ab' } })).status).toBe(400);
  });

  it('throws a configuration error when a provider has no secret', async () => {
    const handle = createWebhookHandler({ provider: ['paystack', 'monnify'], secret: { paystack: SECRET }, onEvent: () => {} });
    const m = await signTestPayload('monnify', { eventType: 'X', eventData: {} }, 's');
    await expect(handle({ rawBody: m.body, headers: m.headers })).rejects.toThrow(/no secret configured for monnify/);
  });
});

describe('MemoryIdempotencyStore', () => {
  it('expires entries after ttl and evicts when full', () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryIdempotencyStore({ maxEntries: 2 });
      expect(store.claim('a', 1)).toBe(true);
      expect(store.claim('a', 1)).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(store.claim('a', 1)).toBe(true);
      store.claim('b', 60);
      store.claim('c', 60);
      expect(store.claim('c', 60)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
