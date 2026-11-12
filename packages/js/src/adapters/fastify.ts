/**
 * Fastify adapter (v4/v5).
 *
 *   import { useRawJsonBody, fastifyWebhook } from 'africa-payments-webhooks/fastify';
 *
 *   await app.register(async (scope) => {
 *     useRawJsonBody(scope);                                   // REQUIRED: keep JSON bodies as Buffers in this scope
 *     scope.post('/webhooks/monnify', fastifyWebhook({ provider: 'monnify', secret: process.env.MONNIFY_CLIENT_SECRET!, onEvent }));
 *   });
 *
 * Registering inside a scoped plugin keeps normal JSON parsing for the rest of your app.
 */
import { createWebhookHandler, type WebhookHandlerOptions } from '../handler.js';
import type { HeadersInput } from '../types.js';

interface FastifyLikeInstance {
  addContentTypeParser(
    contentType: string | string[],
    opts: { parseAs: 'buffer' | 'string' },
    parser: (req: unknown, body: unknown, done: (err: Error | null, body?: unknown) => void) => void,
  ): unknown;
  hasContentTypeParser?(contentType: string): boolean;
  removeContentTypeParser?(contentType: string | string[]): unknown;
}
interface FastifyLikeRequest {
  body?: unknown;
  rawBody?: unknown;
  headers: HeadersInput;
  ip?: string;
}
interface FastifyLikeReply {
  code(statusCode: number): FastifyLikeReply;
  send(payload?: unknown): unknown;
}

/** Replace the JSON parser in this (encapsulated) scope with one that keeps the raw Buffer. */
export function useRawJsonBody(instance: FastifyLikeInstance): void {
  if (instance.hasContentTypeParser?.('application/json')) instance.removeContentTypeParser?.('application/json');
  instance.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
}

export function fastifyWebhook(opts: WebhookHandlerOptions) {
  const handle = createWebhookHandler(opts);
  return async function africaPaymentsWebhook(request: FastifyLikeRequest, reply: FastifyLikeReply) {
    const rawBody = (request.rawBody ?? request.body) as never;
    const result = await handle({ rawBody, headers: request.headers, sourceIp: request.ip });
    return reply.code(result.status).send(result.body);
  };
}

export type { WebhookHandlerOptions };
