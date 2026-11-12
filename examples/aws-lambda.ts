import { lambdaWebhook } from 'africa-payments-webhooks/lambda';

export const handler = lambdaWebhook({
  provider: 'squad',
  secret: process.env.SQUAD_SECRET_KEY as string,
  ipAllowlist: true, // Squad publishes 18.133.63.109
  onEvent: async (event) => {
    console.log(event.type, event.reference, event.amount);
  },
});
