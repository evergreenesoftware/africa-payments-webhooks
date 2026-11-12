/**
 * Web-standard (Fetch API) adapter: `Request` in, `Response` out.
 * Works with Next.js App Router, Hono, Cloudflare Workers, Deno, Bun, Remix, SvelteKit, Astro, Elysia…
 *
 *   // Next.js: app/api/webhooks/paystack/route.ts
 *   import { fetchWebhook } from 'africa-payments-webhooks/web';
 *   export const POST = fetchWebhook({ provider: 'paystack', secret: process.env.PAYSTACK_SECRET_KEY!, onEvent });
 *
 *   // Hono
 *   app.post('/webhooks/paystack', (c) => handler(c.req.raw));
 *
 *   // Cloudflare Workers / Deno / Bun
 *   export default { fetch: (req) => handler(req) };
 */
import { createWebhookHandler, type WebhookHandlerOptions } from '../handler.js';

export interface FetchWebhookOptions extends WebhookHandlerOptions {
  /** Derive the client IP (needed only for `ipAllowlist`). E.g. `(req) => req.headers.get('cf-connecting-ip')`. */
  getSourceIp?: (request: Request) => string | null | undefined;
}

export function fetchWebhook(opts: FetchWebhookOptions) {
  const handle = createWebhookHandler(opts);
  return async function africaPaymentsWebhook(request: Request): Promise<Response> {
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const result = await handle({ rawBody, headers: request.headers, sourceIp: opts.getSourceIp?.(request) ?? undefined });
    return new Response(result.body || null, { status: result.status, headers: result.headers });
  };
}

export type { WebhookHandlerOptions };
