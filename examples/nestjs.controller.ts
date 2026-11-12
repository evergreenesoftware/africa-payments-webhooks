// main.ts: const app = await NestFactory.create(AppModule, { rawBody: true });

import type { RawBodyRequest } from '@nestjs/common';
import { Controller, Post, Req, Res } from '@nestjs/common';
import { nestWebhook } from 'africa-payments-webhooks/nestjs';
import type { Request, Response } from 'express';

const handlePaystack = nestWebhook({
  provider: 'paystack',
  secret: process.env.PAYSTACK_SECRET_KEY as string,
  onEvent: async (event) => {
    console.log(event.type, event.reference);
  },
});

@Controller('webhooks')
export class WebhooksController {
  @Post('paystack')
  async paystack(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    const result = await handlePaystack(req);
    return res.status(result.status).send(result.body);
  }
}
