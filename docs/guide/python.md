# Python

```sh
pip install africa-payments-webhooks
```
Same providers, behaviour and test vectors as the npm package (a shared fixture file guarantees parity).

**Django**
```python
from africa_payments_webhooks.adapters.django import webhook_view
urlpatterns = [path("webhooks/paystack/", webhook_view(provider="paystack", secret=settings.PAYSTACK_SECRET_KEY, on_event=on_event))]
```

**Flask**
```python
from africa_payments_webhooks.adapters.flask import webhook_view
app.add_url_rule("/webhooks/monnify", view_func=webhook_view(provider="monnify", secret=SECRET, on_event=on_event), methods=["POST"], endpoint="monnify")
```

**FastAPI** (`on_event` may be async)
```python
from africa_payments_webhooks.adapters.fastapi import webhook_endpoint
app.add_api_route("/webhooks/flutterwave", webhook_endpoint(provider="flutterwave", secret=SECRET, on_event=on_event), methods=["POST"])
```

**Low level**
```python
from africa_payments_webhooks import verify, parse, handle_webhook
result = verify("korapay", raw_body=raw_bytes, headers=headers, secret=SECRET)   # truthy when ok
event = parse("korapay", raw_bytes)                                              # PaymentEvent dataclass
```
