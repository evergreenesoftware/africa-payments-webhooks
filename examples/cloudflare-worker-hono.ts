// One endpoint for several providers, on Cloudflare Workers with Hono.

import { fetchWebhook } from 'africa-payments-webhooks/web';
import { Hono } from 'hono';

type Env = { PAYSTACK_SECRET_KEY: string; MONNIFY_CLIENT_SECRET: string; FLW_SECRET_HASH: string };
const app = new Hono<{ Bindings: Env }>();

app.post('/webhooks', (c) =>
  fetchWebhook({
    provider: ['paystack', 'monnify', 'flutterwave'],
    secret: { paystack: c.env.PAYSTACK_SECRET_KEY, monnify: c.env.MONNIFY_CLIENT_SECRET, flutterwave: c.env.FLW_SECRET_HASH },
    getSourceIp: (req) => req.headers.get('cf-connecting-ip'),
    onEvent: async (event) => {
      console.log(event.provider, event.type, event.reference);
    },
  })(c.req.raw),
);

export default app;
