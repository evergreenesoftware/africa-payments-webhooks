from __future__ import annotations

from typing import Any

import pytest

from africa_payments_webhooks import MemoryIdempotencyStore
from africa_payments_webhooks.testing import sign_test_payload

SECRET = "sk_test_adapters"
PAYLOAD = {
    "event": "charge.success",
    "data": {"id": 7, "reference": "adapter-1", "amount": 100, "currency": "NGN", "status": "success"},
}


def test_django() -> None:
    django = pytest.importorskip("django")
    from django.conf import settings

    if not settings.configured:
        settings.configure(DEBUG=True, SECRET_KEY="x", ROOT_URLCONF=__name__, ALLOWED_HOSTS=["*"], MIDDLEWARE=[])
        django.setup()
    from django.test import RequestFactory

    from africa_payments_webhooks.adapters.django import webhook_view

    seen: list[Any] = []
    view = webhook_view(provider="paystack", secret=SECRET, on_event=seen.append)
    body, headers = sign_test_payload("paystack", PAYLOAD, SECRET)
    rf = RequestFactory()
    req = rf.post(
        "/wh",
        data=body,
        content_type="application/json",
        headers={k: v for k, v in headers.items() if k != "content-type"},
    )
    assert view(req).status_code == 200
    assert seen and seen[0].reference == "adapter-1"
    bad = rf.post(
        "/wh",
        data=body + " ",
        content_type="application/json",
        headers={k: v for k, v in headers.items() if k != "content-type"},
    )
    assert view(bad).status_code == 401
    assert view(rf.get("/wh")).status_code == 405


def test_flask() -> None:
    flask = pytest.importorskip("flask")
    from africa_payments_webhooks.adapters.flask import webhook_view

    app = flask.Flask(__name__)
    seen: list[Any] = []
    app.add_url_rule(
        "/wh",
        view_func=webhook_view(provider="paystack", secret=SECRET, on_event=seen.append),
        methods=["POST"],
        endpoint="wh",
    )
    client = app.test_client()
    body, headers = sign_test_payload("paystack", PAYLOAD, SECRET)
    assert client.post("/wh", data=body, headers=headers).status_code == 200
    assert client.post("/wh", data=body + " ", headers=headers).status_code == 401
    assert len(seen) == 1


def test_fastapi_sync_and_async_handlers_and_dedupe() -> None:
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from africa_payments_webhooks.adapters.fastapi import webhook_endpoint

    seen: list[Any] = []

    async def on_event(e: Any) -> None:
        seen.append(e)

    app = fastapi.FastAPI()
    app.add_api_route(
        "/wh",
        webhook_endpoint(provider="paystack", secret=SECRET, on_event=on_event, store=MemoryIdempotencyStore()),
        methods=["POST"],
    )
    client = TestClient(app)
    body, headers = sign_test_payload("paystack", PAYLOAD, SECRET)
    assert client.post("/wh", content=body, headers=headers).status_code == 200
    assert client.post("/wh", content=body, headers=headers).status_code == 200  # duplicate
    assert len(seen) == 1
    assert client.post("/wh", content=body, headers={**headers, "x-paystack-signature": "ab" * 64}).status_code == 401
