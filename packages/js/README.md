# africa-payments-webhooks

📖 [Documentation](https://evergreenesoftware.github.io/africa-payments-webhooks/) · 💻 [GitHub](https://github.com/evergreenesoftware/africa-payments-webhooks) · 🐍 [Python package (PyPI)](https://pypi.org/project/africa-payments-webhooks/)

**Verify and normalise payment webhooks from African providers in one line** — Paystack, Flutterwave, Monnify, Squad,
Korapay, Fincra, Interswitch and Nomba.

- 🔐 **Correct signature verification** for every provider (they all do it differently), using the raw bytes and
  constant-time comparison.
- 🧩 **One event shape** (`payment.succeeded`, `transfer.failed`, …) with explicit amount units — no more per-provider parsing.
- 🔁 **Duplicate protection** for provider retries (Paystack retries for up to 72 hours).
- 🌍 **Runs everywhere**: Node.js ≥ 20, Bun, Deno, Cloudflare Workers, Vercel/Next.js, AWS Lambda — **zero dependencies**.
- 🧪 **Test helpers** to sign fake webhooks for your own unit tests.

```sh
npm install africa-payments-webhooks
```

> Python (Django / Flask / FastAPI) package: see the [repository](https://github.com/evergreenesoftware/africa-payments-webhooks).

## Quick start

### Next.js (App Router), Hono, Cloudflare Workers, Deno, Bun

```ts
// app/api/webhooks/paystack/route.ts
import { fetchWebhook } from 'africa-payments-webhooks/web';

export const POST = fetchWebhook({
  provider: 'paystack',
  secret: process.env.PAYSTACK_SECRET_KEY!,
  onEvent: async (event) => {
    if (event.type === 'payment.succeeded') {
      // event.reference, event.amount = { value: 20000, unit: 'minor', currency: 'NGN' }
      await markOrderPaid(event.reference);
    }
  },
});
```

### Express

```ts
import express from 'express';
import { expressWebhook } from 'africa-payments-webhooks/express';

app.post(
  '/webhooks/monnify',
  express.raw({ type: 'application/json' }), // keep the raw body — required
  expressWebhook({ provider: 'monnify', secret: process.env.MONNIFY_CLIENT_SECRET!, onEvent }),
);
```

### NestJS

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true }); // required

// webhooks.controller.ts
import { nestWebhook } from 'africa-payments-webhooks/nestjs';
const handlePaystack = nestWebhook({ provider: 'paystack', secret: process.env.PAYSTACK_SECRET_KEY!, onEvent });

@Post('paystack')
async paystack(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
  const r = await handlePaystack(req);
  return res.status(r.status).send(r.body);
}
```

### Just verify (any framework)

```ts
import { verify, parse } from 'africa-payments-webhooks';

const result = await verify('flutterwave', { rawBody, headers, secret: process.env.FLW_SECRET_HASH! });
if (!result.ok) return new Response(null, { status: 401 }); // result.code: 'invalid_signature' | 'missing_signature' | …
const event = parse('flutterwave', rawBody);
```

More: [Fastify, Koa, Next.js Pages Router, AWS Lambda](#adapters) · [raw body guide](#the-raw-body-rule) · [Python](https://github.com/evergreenesoftware/africa-payments-webhooks/tree/main/packages/python)

## Providers

| Provider | How it signs | Status |
|---|---|---|
| **Paystack** | `x-paystack-signature` — HMAC-SHA512 (hex) of the body, secret key. IPs: 52.31.139.75, 52.49.173.169, 52.214.14.220 | documented |
| **Flutterwave v3** | `verif-hash` — equals your dashboard *secret hash* (⚠️ does **not** protect the body) | documented |
| **Flutterwave v4** | `flutterwave-signature` — HMAC-SHA256 (base64) of the body, secret hash | beta |
| **Monnify** | `monnify-signature` — HMAC-SHA512 (hex) of the body, client secret. ⚠️ No signature in **sandbox**. IP: 35.242.133.146 | **verified** |
| **Squad** (payment gateway) | `x-squad-encrypted-body` — HMAC-SHA512 (hex) of the body, secret key. IP: 18.133.63.109 | documented |
| **Korapay** | `x-korapay-signature` — HMAC-SHA256 (hex) of the `data` object only, secret key | documented |
| **Fincra** | `signature` — HMAC-SHA512 (hex) of the payload, **webhook secret** (not your API key) | documented |
| **Interswitch** | `X-Interswitch-Signature` — HMAC-SHA512 (hex) of the body, webhook secret | documented |
| **Nomba** | `nomba-signature` — HMAC-SHA256 (base64) of selected fields + signed `nomba-timestamp` (replay-protected). ⚠️ amounts not signed | **verified** |

- **verified** — the provider's own published test vector reproduces in our test suite.
- **documented** — implemented exactly as the provider's official docs describe; no official test vector exists.
- **beta** — the provider's docs are ambiguous; please [report](https://github.com/evergreenesoftware/africa-payments-webhooks/issues) real-world results.

Planned: Squad virtual accounts, OPay, Paga (experimental), and helpers for **unsigned** callbacks (M-Pesa Daraja, MTN MoMo).

## The normalised event

```ts
interface PaymentEvent {
  id: string;                 // stable idempotency key
  provider: 'paystack' | 'flutterwave' | …;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.processed' | 'transfer.succeeded' | 'transfer.failed' | … | 'unknown';
  providerEventType: string;  // e.g. 'charge.success'
  reference: string;          // your reference
  providerReference?: string;
  amount?: { value: number; unit: 'minor' | 'major'; currency: string }; // never silently converted
  status?: string;
  customer?: { email?: string; phone?: string; name?: string };
  occurredAt?: string;
  raw: unknown;               // original payload
}
```

**Amount units differ by provider** — Paystack and Squad send kobo (`minor`); Flutterwave, Monnify, Korapay, Fincra and
Nomba send naira (`major`). We report the unit; we never convert behind your back.

Unrecognised events come through as `type: 'unknown'` with `raw` intact — they never throw.

## The raw-body rule

Signatures are computed over the **exact bytes** the provider sent. If your framework parses JSON first, verification
fails. Every adapter detects this and returns **400 `body_already_parsed`** instead of silently failing.

| Framework | Do this |
|---|---|
| Express | `express.raw({ type: 'application/json' })` on the route (or `express.json({ verify: (req,_,buf) => req.rawBody = buf })`) |
| Fastify | `useRawJsonBody(scope)` inside a scoped plugin |
| NestJS | `NestFactory.create(AppModule, { rawBody: true })` |
| Koa | `@koa/bodyparser` (exposes `ctx.request.rawBody`) |
| Next.js App Router / Hono / Workers / Deno / Bun | nothing — `fetchWebhook` reads `request.arrayBuffer()` |
| Next.js Pages Router | `export const config = { api: { bodyParser: false } }` |
| AWS Lambda | nothing — base64 bodies are decoded for you |

## Adapters

| Import | Use with |
|---|---|
| `africa-payments-webhooks/web` → `fetchWebhook()` | Next.js App Router, Hono (`c.req.raw`), Cloudflare Workers, Deno, Bun, Remix, SvelteKit, Astro |
| `africa-payments-webhooks/express` → `expressWebhook()` | Express 4/5 |
| `africa-payments-webhooks/fastify` → `fastifyWebhook()`, `useRawJsonBody()` | Fastify 4/5 |
| `africa-payments-webhooks/nestjs` → `nestWebhook()` | NestJS (Express or Fastify platform) |
| `africa-payments-webhooks/koa` → `koaWebhook()` | Koa |
| `africa-payments-webhooks/next` → `nextApiWebhook()` | Next.js Pages Router |
| `africa-payments-webhooks/lambda` → `lambdaWebhook()` | AWS Lambda (API Gateway v1/v2, function URLs, ALB) |

All adapters take the same options:

```ts
{
  provider: 'paystack',                    // or ['paystack', 'monnify'] to auto-detect on one endpoint
  secret: 'sk_live_…',                     // or ['new', 'old'] for rotation, or { paystack: '…', monnify: '…' }
  onEvent: async (event) => { … },         // throw → 500 → the provider retries
  onError: (err) => log(err.code),         // optional, never receives secrets
  store: myRedisStore,                     // optional dedupe (recommended in production)
  ipAllowlist: true,                       // optional extra check (published IPs) — never sufficient alone
  allowUnsignedSandbox: false,             // Monnify sandbox only — never in production
  toleranceSeconds: 300,                   // Nomba replay window
}
```

## Duplicate events

Providers retry, so the same event can arrive more than once. Pass a store implementing `claim(id, ttlSeconds)`:

```ts
// Redis (ioredis / node-redis)
const store = { claim: async (id, ttl) => (await redis.set(`wh:${id}`, '1', 'EX', ttl, 'NX')) === 'OK', release: (id) => redis.del(`wh:${id}`) };

// Postgres
// CREATE TABLE webhook_events (id text PRIMARY KEY, seen_at timestamptz DEFAULT now());
const store = { claim: async (id) => (await sql`INSERT INTO webhook_events (id) VALUES (${id}) ON CONFLICT DO NOTHING RETURNING id`).length > 0 };
```

`MemoryIdempotencyStore` is included for development and tests.

## Testing your handler

```ts
import { signTestPayload } from 'africa-payments-webhooks/testing';

const { body, headers } = await signTestPayload('paystack', { event: 'charge.success', data: { reference: 'r1', amount: 5000, currency: 'NGN' } }, 'sk_test_x');
const res = await app.request('/webhooks/paystack', { method: 'POST', body, headers });
```

## Security model

- Verification uses the raw bytes and **constant-time** comparison; malformed signatures are rejected without throwing.
- The library never logs secrets, signatures or payloads; error messages never contain them.
- **Always re-confirm the transaction with the provider's API before giving value** — mandatory for Flutterwave v3
  (`verif-hash` doesn't protect the body) and Nomba (amounts aren't signed). Webhooks tell you *something happened*;
  the API tells you *exactly what*.
- Most providers don't sign a timestamp, so a captured webhook can be replayed — use an idempotency `store`.
- Report vulnerabilities privately — see [SECURITY.md](https://github.com/evergreenesoftware/africa-payments-webhooks/blob/main/SECURITY.md).

## Contributing

Provider docs change and are sometimes wrong (Monnify's prose describes a different algorithm than its own example).
If you have a real sandbox webhook that doesn't verify, please open an issue. See
[CONTRIBUTING.md](https://github.com/evergreenesoftware/africa-payments-webhooks/blob/main/CONTRIBUTING.md).

## License

MIT © Evergreene Software LTD. Built and maintained by [Popoola Sinaayo](https://github.com/Popoola-Sinaayo) —
available for payment-integration work.
