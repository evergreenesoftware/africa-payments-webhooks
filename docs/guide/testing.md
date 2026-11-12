# Testing your handler

`signTestPayload` produces a body + headers exactly as the provider would sign them:

```ts
import { signTestPayload } from 'africa-payments-webhooks/testing';

const { body, headers } = await signTestPayload(
  'paystack',
  { event: 'charge.success', data: { id: 1, reference: 'order-42', amount: 500000, currency: 'NGN', status: 'success' } },
  process.env.PAYSTACK_SECRET_KEY_TEST!,
);
const res = await fetch('http://localhost:3000/webhooks/paystack', { method: 'POST', body, headers });
```

Nomba: pass `{ timestamp: '2026-11-12T10:00:00Z' }`. Flutterwave v3: pass `{ flutterwaveVersion: 'v3' }`.

Python:
```python
from africa_payments_webhooks.testing import sign_test_payload
body, headers = sign_test_payload("monnify", {"eventType": "SUCCESSFUL_TRANSACTION", "eventData": {...}}, SECRET)
```
