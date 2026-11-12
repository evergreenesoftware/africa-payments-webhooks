import type { AddressInfo } from 'node:net';
import { bodyParser } from '@koa/bodyparser';
import express from 'express';
import Fastify from 'fastify';
import Koa from 'koa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expressWebhook } from '../src/adapters/express.js';
import { fastifyWebhook, useRawJsonBody } from '../src/adapters/fastify.js';
import { koaWebhook } from '../src/adapters/koa.js';
import { lambdaWebhook } from '../src/adapters/lambda.js';
import { nestWebhook } from '../src/adapters/nestjs.js';
import { nextApiWebhook } from '../src/adapters/next.js';
import { fetchWebhook } from '../src/adapters/web.js';
import { signTestPayload } from '../src/testing.js';

const SECRET = 'sk_test_adapters';
const payload = { event: 'charge.success', data: { id: 7, reference: 'adapter-1', amount: 100, currency: 'NGN', status: 'success' } };
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

async function post(url: string, body: string, headers: Record<string, string>) {
  const r = await fetch(url, { method: 'POST', body, headers });
  return { status: r.status, text: await r.text() };
}

describe('Express adapter', () => {
  it('works with express.raw()', async () => {
    const onEvent = vi.fn();
    const app = express();
    app.post('/wh', express.raw({ type: 'application/json' }), expressWebhook({ provider: 'paystack', secret: SECRET, onEvent }));
    const server = app.listen(0);
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wh`;
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    expect((await post(url, body, headers)).status).toBe(200);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ reference: 'adapter-1' }));
    expect((await post(url, body, { ...headers, 'x-paystack-signature': 'ab'.repeat(64) })).status).toBe(401);
  });

  it('detects express.json() (body already parsed) with a 400', async () => {
    const app = express();
    app.post('/wh', express.json(), expressWebhook({ provider: 'paystack', secret: SECRET, onEvent: () => {} }));
    const server = app.listen(0);
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wh`;
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    expect((await post(url, body, headers)).status).toBe(400);
  });

  it('works with express.json({ verify }) capturing req.rawBody', async () => {
    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as unknown as { rawBody: Buffer }).rawBody = buf;
        },
      }),
    );
    app.post('/wh', expressWebhook({ provider: 'paystack', secret: SECRET, onEvent: () => {} }));
    const server = app.listen(0);
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wh`;
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    expect((await post(url, body, headers)).status).toBe(200);
  });
});

describe('Fastify adapter', () => {
  it('works with useRawJsonBody in a scoped plugin', async () => {
    const onEvent = vi.fn();
    const app = Fastify();
    await app.register(async (scope) => {
      useRawJsonBody(scope);
      scope.post('/wh', fastifyWebhook({ provider: 'paystack', secret: SECRET, onEvent }));
    });
    closers.push(() => app.close());
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    const r = await app.inject({ method: 'POST', url: '/wh', payload: body, headers });
    expect(r.statusCode).toBe(200);
    expect(onEvent).toHaveBeenCalledOnce();
  });

  it('reports a parsed body (default JSON parser) as 400', async () => {
    const app = Fastify();
    app.post('/wh', fastifyWebhook({ provider: 'paystack', secret: SECRET, onEvent: () => {} }));
    closers.push(() => app.close());
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    expect((await app.inject({ method: 'POST', url: '/wh', payload: body, headers })).statusCode).toBe(400);
  });
});

describe('Koa adapter', () => {
  it('works with @koa/bodyparser rawBody', async () => {
    const onEvent = vi.fn();
    const app = new Koa();
    app.use(bodyParser());
    const mw = koaWebhook({ provider: 'paystack', secret: SECRET, onEvent });
    app.use(async (ctx) => mw(ctx as never));
    const server = app.listen(0);
    closers.push(() => new Promise<void>((r) => server.close(() => r())));
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    expect((await post(url, body, headers)).status).toBe(200);
    expect(onEvent).toHaveBeenCalledOnce();
  });
});

describe('Web (Fetch) adapter — Next.js App Router, Hono, Workers, Deno, Bun', () => {
  it('handles a Request and returns a Response', async () => {
    const onEvent = vi.fn();
    const handler = fetchWebhook({ provider: 'paystack', secret: SECRET, onEvent });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    const res = await handler(new Request('https://example.com/wh', { method: 'POST', body, headers }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    const bad = await handler(new Request('https://example.com/wh', { method: 'POST', body: `${body} `, headers }));
    expect(bad.status).toBe(401);
  });

  it('passes the source IP via getSourceIp for the allowlist', async () => {
    const handler = fetchWebhook({
      provider: 'paystack',
      secret: SECRET,
      onEvent: () => {},
      ipAllowlist: true,
      getSourceIp: (r) => r.headers.get('cf-connecting-ip'),
    });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    const ok = await handler(
      new Request('https://x/wh', { method: 'POST', body, headers: { ...headers, 'cf-connecting-ip': '52.214.14.220' } }),
    );
    const denied = await handler(
      new Request('https://x/wh', { method: 'POST', body, headers: { ...headers, 'cf-connecting-ip': '8.8.8.8' } }),
    );
    expect([ok.status, denied.status]).toEqual([200, 401]);
  });
});

describe('Next.js Pages Router adapter', () => {
  function mockReq(body: string, headers: Record<string, string>, parsed?: unknown) {
    return {
      headers,
      body: parsed,
      socket: { remoteAddress: '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body.slice(0, 5));
        yield Buffer.from(body.slice(5));
      },
    };
  }
  function mockRes() {
    const res = {
      code: 0,
      sent: undefined as unknown,
      status(c: number) {
        res.code = c;
        return res;
      },
      send(b: unknown) {
        res.sent = b;
      },
      end() {},
    };
    return res;
  }
  it('reads the raw stream when bodyParser is disabled', async () => {
    const handler = nextApiWebhook({ provider: 'paystack', secret: SECRET, onEvent: () => {} });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    const res = mockRes();
    await handler(mockReq(body, headers) as never, res);
    expect(res.code).toBe(200);
  });
  it('returns 400 when bodyParser left the body parsed', async () => {
    const handler = nextApiWebhook({ provider: 'paystack', secret: SECRET, onEvent: () => {} });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    const res = mockRes();
    await handler(mockReq(body, headers, JSON.parse(body)) as never, res);
    expect(res.code).toBe(400);
  });
});

describe('AWS Lambda adapter', () => {
  it('handles plain and base64-encoded bodies (API Gateway v1/v2)', async () => {
    const handler = lambdaWebhook({ provider: 'paystack', secret: SECRET, onEvent: () => {} });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    expect((await handler({ body, headers, requestContext: { http: { sourceIp: '1.1.1.1' } } })).statusCode).toBe(200);
    expect((await handler({ body: Buffer.from(body).toString('base64'), isBase64Encoded: true, headers })).statusCode).toBe(200);
    expect((await handler({ body: `${body}x`, headers })).statusCode).toBe(401);
  });
});

describe('NestJS helper', () => {
  it('uses req.rawBody and explains the fix when it is missing', async () => {
    const handle = nestWebhook({ provider: 'paystack', secret: SECRET, onEvent: () => {} });
    const { body, headers } = await signTestPayload('paystack', payload, SECRET);
    expect((await handle({ rawBody: Buffer.from(body), headers, ip: '127.0.0.1' })).status).toBe(200);
    expect(() => handle({ headers })).toThrow(/rawBody: true/);
  });
});
