"""Flask helper.

    from africa_payments_webhooks.adapters.flask import webhook_view

    app.add_url_rule(
        "/webhooks/monnify",
        view_func=webhook_view(provider="monnify", secret=os.environ["MONNIFY_CLIENT_SECRET"], on_event=on_event),
        methods=["POST"],
        endpoint="monnify_webhook",
    )

Uses `request.get_data(cache=True)` — the raw bytes — so do not read `request.json` before it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .. import handle_webhook


def webhook_view(**options: Any) -> Callable[[], Any]:
    from flask import Response, request

    def view() -> Any:
        result = handle_webhook(
            raw_body=request.get_data(cache=True),
            headers=request.headers,
            source_ip=request.remote_addr,
            **options,
        )
        return Response(result.body, status=result.status)

    return view
