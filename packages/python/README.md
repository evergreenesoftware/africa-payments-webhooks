# africa-payments-webhooks (Python)

Verify and normalise payment webhooks from **Paystack, Flutterwave, Monnify, Squad, Korapay, Fincra, Interswitch and
Nomba** — zero dependencies, with helpers for **Django, Flask and FastAPI**. Same behaviour and test vectors as the
[npm package](https://www.npmjs.com/package/africa-payments-webhooks).

```sh
pip install africa-payments-webhooks
```

## Django
```python
from africa_payments_webhooks.adapters.django import webhook_view

def on_event(event):
    if event.type == "payment.succeeded":
        mark_order_paid(event.reference)   # event.amount == {"value": 20000, "unit": "minor", "currency": "NGN"}

urlpatterns = [path("webhooks/paystack/", webhook_view(provider="paystack", secret=settings.PAYSTACK_SECRET_KEY, on_event=on_event))]
```

## Flask
```python
from africa_payments_webhooks.adapters.flask import webhook_view
app.add_url_rule("/webhooks/monnify", view_func=webhook_view(provider="monnify", secret=os.environ["MONNIFY_CLIENT_SECRET"], on_event=on_event), methods=["POST"], endpoint="monnify")
```

## FastAPI
```python
from africa_payments_webhooks.adapters.fastapi import webhook_endpoint
app.add_api_route("/webhooks/flutterwave", webhook_endpoint(provider="flutterwave", secret=os.environ["FLW_SECRET_HASH"], on_event=on_event), methods=["POST"])
```
(`on_event` may be `async`. Don't declare a Pydantic body on this route — the raw bytes are needed.)

## Any framework
```python
from africa_payments_webhooks import verify, parse

result = verify("korapay", raw_body=raw_bytes, headers=headers, secret=KORAPAY_SECRET_KEY)
if not result:                      # result.code: "invalid_signature" | "missing_signature" | ...
    return 401
event = parse("korapay", raw_bytes)
```

Options: `secret=[new, old]` (rotation), `store=` (dedupe: implement `claim(id, ttl)` / `release(id)`),
`ip_allowlist=True` (published IPs, optional extra), `allow_unsigned_sandbox=True` (Monnify sandbox only — never in
production), `tolerance_seconds=300` (Nomba replay window).

Test helper: `from africa_payments_webhooks.testing import sign_test_payload`.

See the [main README](https://github.com/EVERGREENE_ORG/africa-payments-webhooks#readme) for the provider table,
amount units, the raw-body rule and the security model. MIT © Evergreene Software LTD.
