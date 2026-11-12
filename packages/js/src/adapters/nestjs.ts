/**
 * NestJS helper (Express or Fastify platform). No @nestjs dependency is required.
 *
 *   // main.ts — REQUIRED: keep raw bodies (do not set bodyParser: false)
 *   const app = await NestFactory.create(AppModule, { rawBody: true });
 *
 *   // webhooks.controller.ts
 *   import { Controller, Post, Req, Res, HttpCode } from '@nestjs/common';
 *   import type { RawBodyRequest } from '@nestjs/common';
 *   import { nestWebhook } from 'africa-payments-webhooks/nestjs';
 *
 *   const handlePaystack = nestWebhook({ provider: 'paystack', secret: process.env.PAYSTACK_SECRET_KEY!, onEvent });
 *
 *   @Controller('webhooks')
 *   export class WebhooksController {
 *     @Post('paystack')
 *     async paystack(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
 *       const r = await handlePaystack(req);
 *       return res.status(r.status).send(r.body);
 *     }
 *   }
 */
import { createWebhookHandler, type WebhookHandlerOptions, type WebhookResponse } from '../handler.js';
import type { HeadersInput } from '../types.js';

export interface NestLikeRawBodyRequest {
  rawBody?: unknown;
  headers: HeadersInput;
  ip?: string;
}

/** Returns `(req) => Promise<WebhookResponse>`; send `status` and `body` with your platform's response object. */
export function nestWebhook(opts: WebhookHandlerOptions) {
  const handle = createWebhookHandler(opts);
  return function handleNestRequest(req: NestLikeRawBodyRequest): Promise<WebhookResponse> {
    if (req.rawBody === undefined) {
      throw new Error(
        'africa-payments-webhooks: req.rawBody is undefined. Create the app with NestFactory.create(AppModule, { rawBody: true }).',
      );
    }
    return handle({ rawBody: req.rawBody as never, headers: req.headers, sourceIp: req.ip });
  };
}

export type { WebhookHandlerOptions, WebhookResponse };
