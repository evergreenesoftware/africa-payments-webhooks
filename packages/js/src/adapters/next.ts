/**
 * Next.js **Pages Router** API routes (`pages/api/*`). For the App Router use `africa-payments-webhooks/web`.
 *
 *   // pages/api/webhooks/flutterwave.ts
 *   import { nextApiWebhook } from 'africa-payments-webhooks/next';
 *   export const config = { api: { bodyParser: false } };   // REQUIRED: keep the raw body
 *   export default nextApiWebhook({ provider: 'flutterwave', secret: process.env.FLW_SECRET_HASH!, onEvent });
 */
import { createWebhookHandler, type WebhookHandlerOptions } from '../handler.js';
import type { HeadersInput } from '../types.js';

interface NextLikeApiRequest extends AsyncIterable<unknown> {
  headers: HeadersInput;
  body?: unknown;
  socket?: { remoteAddress?: string };
}
interface NextLikeApiResponse {
  status(code: number): NextLikeApiResponse;
  send(body?: unknown): unknown;
  end(): unknown;
}

async function readStream(req: AsyncIterable<unknown>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    const c = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : (chunk as Uint8Array);
    chunks.push(c);
    total += c.byteLength;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export function nextApiWebhook(opts: WebhookHandlerOptions) {
  const handle = createWebhookHandler(opts);
  return async function africaPaymentsWebhook(req: NextLikeApiRequest, res: NextLikeApiResponse) {
    // If bodyParser was left on, req.body is already an object → the core reports body_already_parsed (400).
    const rawBody = (req.body !== undefined ? req.body : await readStream(req)) as never;
    const result = await handle({ rawBody, headers: req.headers, sourceIp: req.socket?.remoteAddress });
    res.status(result.status);
    if (result.body) res.send(result.body);
    else res.end();
  };
}

export type { WebhookHandlerOptions };
