# views.py
from django.conf import settings
from africa_payments_webhooks.adapters.django import webhook_view


def on_event(event):
    if event.type == "payment.succeeded":
        print("paid", event.reference, event.amount)


paystack_webhook = webhook_view(provider="paystack", secret=settings.PAYSTACK_SECRET_KEY, on_event=on_event)
# urls.py: path("webhooks/paystack/", views.paystack_webhook)
