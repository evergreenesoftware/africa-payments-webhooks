"""Django helper.

    # views.py
    from africa_payments_webhooks.adapters.django import webhook_view

    def on_event(event):
        if event.type == "payment.succeeded":
            mark_paid(event.reference)

    paystack_webhook = webhook_view(provider="paystack", secret=settings.PAYSTACK_SECRET_KEY, on_event=on_event)

    # urls.py
    path("webhooks/paystack/", paystack_webhook)

`request.body` is always the raw bytes in Django, so no extra configuration is needed. The view is csrf_exempt and
POST-only.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .. import handle_webhook


def webhook_view(**options: Any) -> Callable[..., Any]:
    from django.http import HttpResponse, HttpResponseNotAllowed
    from django.views.decorators.csrf import csrf_exempt

    @csrf_exempt
    def view(request: Any) -> Any:
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        result = handle_webhook(
            raw_body=request.body,
            headers=request.headers,
            source_ip=request.META.get("REMOTE_ADDR"),
            **options,
        )
        return HttpResponse(result.body, status=result.status)

    return view
