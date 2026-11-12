/**
 * Express adapter (v4 and v5).
 *
 *   import express from 'express';
 *   import { expressWebhook } from 'africa-payments-webhooks/express';
 *
 *   app.post('/webhooks/paystack',
 *     express.raw({ type: 'application/json' }),            // REQUIRED: keep the raw bytes
 *     expressWebhook({ provider: 'paystack', secret: process.env.PAYSTACK_SECRET_KEY!, onEvent }));
 *
 * Do not put `express.json()` in front of this route (it destroys the raw body). If you must, use
 * `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })` — the adapter reads `req.rawBody` first.
 */
import { createWebhookHandler, type WebhookHandlerOptions } from '../handler.js';
import type { HeadersInput } from '../types.js';

interface ExpressLikeRequest {
  body?: unknown;
  rawBody?: unknown;
  headers: HeadersInput;
  ip?: string;
}
interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  send(body?: unknown): unknown;
  end(): unknown;
  set?(field: string, value: string): unknown;
}
type Next = (err?: unknown) => void;

export function expressWebhook(opts: WebhookHandlerOptions) {
  const handle = createWebhookHandler(opts);
  return async function africaPaymentsWebhook(req: ExpressLikeRequest, res: ExpressLikeResponse, next: Next) {
    try {
      const rawBody = (req.rawBody ?? req.body) as never;
      const result = await handle({ rawBody, headers: req.headers, sourceIp: req.ip });
      res.status(result.status);
      if (result.body) res.send(result.body);
      else res.end();
    } catch (err) {
      next(err);
    }
  };
}

export type { WebhookHandlerOptions };
