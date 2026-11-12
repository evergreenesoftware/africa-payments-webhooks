"""Test helpers: build genuinely signed webhook requests for your own unit tests. Never use in production paths."""

from __future__ import annotations

import json
from typing import Any

from .providers import PROVIDERS


def sign_test_payload(
    provider: str,
    payload: Any,
    secret: str,
    *,
    timestamp: str | None = None,
    flutterwave_version: str = "v4",
) -> tuple[str, dict[str, str]]:
    """Return (body, headers). ``payload`` may be a dict (serialised compactly) or a str used as-is."""
    body = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    if provider == "flutterwave" and flutterwave_version == "v3":
        return body, {"content-type": "application/json", "verif-hash": secret}
    headers = PROVIDERS[provider].sign(body, secret, timestamp)
    return body, {"content-type": "application/json", **headers}
