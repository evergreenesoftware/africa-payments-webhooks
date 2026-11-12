"""FastAPI / Starlette helper.

    from africa_payments_webhooks.adapters.fastapi import webhook_endpoint

    app.add_api_route(
        "/webhooks/flutterwave",
        webhook_endpoint(provider="flutterwave", secret=os.environ["FLW_SECRET_HASH"], on_event=on_event),
        methods=["POST"],
    )

Reads `await request.body()` (raw bytes). Do not declare a Pydantic body parameter on this route. `on_event` may be a
regular function or a coroutine function.
"""

# NOTE: no `from __future__ import annotations` here — FastAPI must see the real `Request` class at runtime.

import inspect
from collections.abc import Awaitable, Callable
from typing import Any

from .. import PaymentEvent, handle_webhook


def webhook_endpoint(**options: Any) -> Callable[[Any], Awaitable[Any]]:
    from starlette.requests import Request
    from starlette.responses import Response

    on_event = options.pop("on_event")

    async def endpoint(request: Request) -> Response:
        body = await request.body()
        captured: list[PaymentEvent] = []
        result = handle_webhook(
            raw_body=body,
            headers=request.headers,
            source_ip=request.client.host if request.client else None,
            on_event=captured.append,
            **options,
        )
        if captured and not result.duplicate:
            store = options.get("store")
            try:
                outcome = on_event(captured[0])
                if inspect.isawaitable(outcome):
                    await outcome
            except Exception:
                if store is not None:
                    store.release(captured[0].id)
                raise
        return Response(result.body, status_code=result.status)

    return endpoint
