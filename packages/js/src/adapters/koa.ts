/**
 * Koa adapter.
 *
 *   import { bodyParser } from '@koa/bodyparser';
 *   import { koaWebhook } from 'africa-payments-webhooks/koa';
 *
 *   app.use(bodyParser());   // @koa/bodyparser exposes ctx.request.rawBody (the raw string)
 *   router.post('/webhooks/korapay', koaWebhook({ provider: 'korapay', secret: process.env.KORAPAY_SECRET_KEY!, onEvent }));
 */
import { createWebhookHandler, type WebhookHandlerOptions } from '../handler.js';
import type { HeadersInput } from '../types.js';

interface KoaLikeContext {
  request: { rawBody?: unknown; body?: unknown; headers: HeadersInput };
  ip?: string;
  status: number;
  body: unknown;
}

export function koaWebhook(opts: WebhookHandlerOptions) {
  const handle = createWebhookHandler(opts);
  return async function africaPaymentsWebhook(ctx: KoaLikeContext, _next?: () => Promise<unknown>) {
    const rawBody = (ctx.request.rawBody ?? ctx.request.body) as never;
    const result = await handle({ rawBody, headers: ctx.request.headers, sourceIp: ctx.ip });
    ctx.status = result.status;
    ctx.body = result.body || null;
    if (!result.body) ctx.status = result.status; // Koa resets status when body is null
  };
}

export type { WebhookHandlerOptions };
