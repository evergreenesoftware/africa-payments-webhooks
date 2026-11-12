# The raw-body rule

Providers sign the **exact bytes** they send. If your framework parses the JSON first, the bytes are gone and
verification fails — this is the #1 webhook bug. Every adapter detects a pre-parsed body and returns
**400 `body_already_parsed`** instead of failing silently.

| Framework | What to do |
|---|---|
| **Express** | Route-level `express.raw({ type: 'application/json' })`. If you need a global `express.json()`, add `verify: (req, _res, buf) => { req.rawBody = buf }` — the adapter reads `req.rawBody` first. |
| **Fastify** | Register the route inside a scoped plugin and call `useRawJsonBody(scope)`. |
| **NestJS** | `NestFactory.create(AppModule, { rawBody: true })`. Don't set `bodyParser: false`. |
| **Koa** | Use `@koa/bodyparser` — it exposes `ctx.request.rawBody`. |
| **Next.js App Router, Hono, Workers, Deno, Bun** | Nothing. `fetchWebhook` reads `request.arrayBuffer()`. With Hono, pass `c.req.raw`. |
| **Next.js Pages Router** | `export const config = { api: { bodyParser: false } }` in the route file. |
| **AWS Lambda** | Nothing. Base64 bodies (`isBase64Encoded`) are decoded for you. |
| **Django** | Nothing — `request.body` is raw. |
| **Flask** | Nothing — the helper uses `request.get_data()`. Don't read `request.json` first. |
| **FastAPI** | Don't declare a Pydantic body parameter on the webhook route. |

**Proxies and gateways** that re-encode JSON (some API gateways, some no-code tools) also break signatures — forward
bodies untouched.
