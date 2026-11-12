# Getting started

```sh
npm install africa-payments-webhooks     # Node, Bun, Deno, Workers, Next.js
pip install africa-payments-webhooks     # Django, Flask, FastAPI
```

## One-step handler (recommended)

```ts
import { fetchWebhook } from 'africa-payments-webhooks/web';   // Next.js App Router, Hono, Workers, Deno, Bun

export const POST = fetchWebhook({
  provider: 'paystack',
  secret: process.env.PAYSTACK_SECRET_KEY!,
  onEvent: async (event) => {
    if (event.type === 'payment.succeeded') await markOrderPaid(event.reference);
  },
});
```

The handler verifies the signature, parses the event, skips duplicates (when you pass a `store`), calls `onEvent`,
and answers the provider correctly: **200** (empty body), **401** for bad signatures, **400** for a parsed body,
**500** if your `onEvent` throws (so the provider retries).

| Import | Framework |
|---|---|
| `africa-payments-webhooks/web` | Next.js App Router, Hono (`c.req.raw`), Cloudflare Workers, Deno, Bun, Remix, SvelteKit |
| `africa-payments-webhooks/express` | Express 4/5 |
| `africa-payments-webhooks/fastify` | Fastify 4/5 |
| `africa-payments-webhooks/nestjs` | NestJS |
| `africa-payments-webhooks/koa` | Koa |
| `africa-payments-webhooks/next` | Next.js Pages Router |
| `africa-payments-webhooks/lambda` | AWS Lambda |

## Low-level API

```ts
import { verify, parse, detectProvider } from 'africa-payments-webhooks';

const result = await verify('monnify', { rawBody, headers, secret });
// { ok: true, provider } | { ok: false, provider, code, message }
const event = parse('monnify', rawBody);
```

Error codes: `missing_signature`, `invalid_signature`, `malformed_signature`, `timestamp_out_of_range`,
`ip_not_allowed`, `body_already_parsed`, `invalid_body`, `unknown_provider`.

## Options

| Option | Default | Purpose |
|---|---|---|
| `secret` | — | String, array (rotation) or per-provider object |
| `store` | none | Duplicate protection (see [Duplicate events](./idempotency)) |
| `ttlSeconds` | 259200 | How long to remember event ids (72 h) |
| `ipAllowlist` | `false` | `true` = provider-published IPs; or your own list/CIDRs. An extra check, never sufficient alone |
| `allowUnsignedSandbox` | `false` | Monnify sandbox sends no signature. **Never enable in production** |
| `toleranceSeconds` | 300 | Nomba replay window (`0` disables) |
| `onError` | — | Called with `{ code, message }` on failures (never contains secrets) |
