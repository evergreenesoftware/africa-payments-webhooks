import { MemoryIdempotencyStore } from 'africa-payments-webhooks';
import { expressWebhook } from 'africa-payments-webhooks/express';
import express from 'express';

const app = express();

app.post(
  '/webhooks/monnify',
  express.raw({ type: 'application/json' }), // keep the raw body — required
  expressWebhook({
    provider: 'monnify',
    secret: process.env.MONNIFY_CLIENT_SECRET as string,
    store: new MemoryIdempotencyStore(), // use Redis/Postgres in production
    onEvent: async (event) => {
      if (event.type === 'payment.succeeded') console.log('paid', event.reference, event.amount);
    },
    onError: (err) => console.warn('webhook rejected:', err.code),
  }),
);

app.use(express.json()); // other routes can still use JSON parsing
app.listen(3000);
