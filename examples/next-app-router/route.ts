// app/api/webhooks/paystack/route.ts
import { fetchWebhook } from 'africa-payments-webhooks/web';

export const POST = fetchWebhook({
  provider: 'paystack',
  secret: process.env.PAYSTACK_SECRET_KEY as string,
  onEvent: async (event) => {
    if (event.type === 'payment.succeeded') {
      // Re-confirm with GET https://api.paystack.co/transaction/verify/:reference before giving value.
      console.log('paid', event.reference, event.amount); // { value: 500000, unit: 'minor', currency: 'NGN' }
    }
  },
});
