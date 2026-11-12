"""Verify and normalise payment webhooks from African providers.

from africa_payments_webhooks import verify, parse

result = verify("paystack", raw_body=request.body, headers=request.headers, secret=PAYSTACK_SECRET_KEY)
if not result.ok:
    return HttpResponse(status=401)
event = parse("paystack", request.body)
"""

from __future__ import annotations

import ipaddress
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from ._core import BodyError, HeadersInput, RawBody, Secret, get_header, read_raw_body, safe_json, secrets_of
from .providers import PROVIDERS, Ctx

__all__ = [
    "VerifyResult",
    "PaymentEvent",
    "IdempotencyStore",
    "MemoryIdempotencyStore",
    "WebhookResponse",
    "verify",
    "parse",
    "detect_provider",
    "provider_info",
    "handle_webhook",
    "SUPPORTED_PROVIDERS",
]

__version__ = "0.1.0"

SUPPORTED_PROVIDERS: tuple[str, ...] = tuple(PROVIDERS)


@dataclass(frozen=True)
class VerifyResult:
    ok: bool
    provider: str | None
    code: str | None = None
    message: str | None = None
    unsigned: bool = False

    def __bool__(self) -> bool:  # allows `if verify(...):`
        return self.ok


@dataclass(frozen=True)
class PaymentEvent:
    id: str
    provider: str
    type: str
    provider_event_type: str
    reference: str
    raw: Any
    provider_reference: str | None = None
    amount: dict[str, Any] | None = None
    status: str | None = None
    customer: dict[str, str | None] = field(default_factory=dict)
    occurred_at: str | None = None


def _ip_allowed(ip: str, allow: Sequence[str]) -> bool:
    try:
        addr = ipaddress.ip_address(ip.strip().removeprefix("::ffff:"))
    except ValueError:
        return False
    for entry in allow:
        try:
            if addr in ipaddress.ip_network(entry.strip(), strict=False):
                return True
        except ValueError:
            continue
    return False


def verify(
    provider: str,
    *,
    raw_body: RawBody,
    headers: HeadersInput,
    secret: Secret,
    allow_unsigned_sandbox: bool = False,
    tolerance_seconds: int = 300,
    now: float | None = None,
    ip_allowlist: bool | Sequence[str] = False,
    source_ip: str | None = None,
) -> VerifyResult:
    """Verify that a webhook genuinely came from ``provider``. Never raises for bad input; raises only for
    programmer errors (e.g. no secret)."""
    spec = PROVIDERS.get(provider)
    if spec is None:
        return VerifyResult(False, None, "unknown_provider", f'Unknown provider "{provider}".')
    secrets = secrets_of(secret)
    try:
        body, text = read_raw_body(raw_body)
    except BodyError as e:
        return VerifyResult(False, provider, e.code, str(e))
    if ip_allowlist:
        allow = spec.ips if ip_allowlist is True else tuple(ip_allowlist)
        if not allow:
            raise TypeError(
                f"africa_payments_webhooks: {provider} publishes no source IPs; pass your own ip_allowlist."
            )
        if not source_ip or not _ip_allowed(source_ip, allow):
            return VerifyResult(False, provider, "ip_not_allowed", "Request source IP is not in the allowlist.")
    outcome = spec.verify(Ctx(body, text, headers, secrets, allow_unsigned_sandbox, tolerance_seconds, now))
    if outcome.ok:
        return VerifyResult(True, provider, unsigned=outcome.unsigned)
    return VerifyResult(False, provider, outcome.code, outcome.message)


def parse(provider: str, raw_body: RawBody) -> PaymentEvent:
    """Parse an (already verified) webhook into a normalised PaymentEvent. Unknown events → type "unknown"."""
    spec = PROVIDERS.get(provider)
    if spec is None:
        raise ValueError(f'africa_payments_webhooks: unknown provider "{provider}".')
    _, text = read_raw_body(raw_body)
    payload = safe_json(text)
    if payload is None:
        raise ValueError("africa_payments_webhooks: webhook body is not valid JSON.")
    p = spec.parse(payload)
    customer = {k: v for k, v in (p.get("customer") or {}).items() if v is not None}
    key = p.get("provider_reference") or p["reference"]
    status = p.get("status")
    return PaymentEvent(
        id=f"{provider}:{p['provider_event_type']}:{key}" + (f":{status}" if status else ""),
        provider=provider,
        type=p["type"],
        provider_event_type=p["provider_event_type"],
        reference=p["reference"],
        raw=payload,
        provider_reference=p.get("provider_reference"),
        amount=p.get("amount"),
        status=status,
        customer=customer,
        occurred_at=p.get("occurred_at"),
    )


def detect_provider(headers: HeadersInput) -> str | None:
    """Guess the provider from headers (Fincra cannot be auto-detected)."""
    for spec in PROVIDERS.values():
        if any(get_header(headers, h) is not None for h in spec.detect_headers):
            return spec.name
    return None


def provider_info(provider: str) -> dict[str, Any]:
    spec = PROVIDERS[provider]
    return {"name": spec.name, "status": spec.status, "ips": list(spec.ips)}


class IdempotencyStore(Protocol):
    def claim(self, event_id: str, ttl_seconds: int) -> bool:
        """Atomically record the id; return True if newly recorded, False if already seen."""

    def release(self, event_id: str) -> None:
        """Forget a claim (called when processing failed so the provider's retry is processed)."""


class MemoryIdempotencyStore:
    """In-memory store for development/tests only."""

    def __init__(self, max_entries: int = 10_000) -> None:
        import time

        self._time = time.monotonic
        self._seen: dict[str, float] = {}
        self._max = max_entries

    def claim(self, event_id: str, ttl_seconds: int) -> bool:
        now = self._time()
        exp = self._seen.get(event_id)
        if exp is not None and exp > now:
            return False
        if len(self._seen) >= self._max:
            for k in [k for k, v in self._seen.items() if v <= now][: max(1, len(self._seen) - self._max + 1)]:
                self._seen.pop(k, None)
            while len(self._seen) >= self._max:
                self._seen.pop(next(iter(self._seen)))
        self._seen[event_id] = now + ttl_seconds
        return True

    def release(self, event_id: str) -> None:
        self._seen.pop(event_id, None)


@dataclass
class WebhookResponse:
    status: int
    body: str = ""
    event: PaymentEvent | None = None
    error: VerifyResult | None = None
    duplicate: bool = False


def handle_webhook(
    *,
    provider: str | Sequence[str],
    raw_body: RawBody,
    headers: HeadersInput,
    secret: Secret | dict[str, Secret],
    on_event: Callable[[PaymentEvent], Any],
    store: IdempotencyStore | None = None,
    ttl_seconds: int = 259_200,
    source_ip: str | None = None,
    **verify_options: Any,
) -> WebhookResponse:
    """verify → parse → dedupe → on_event → response (200 empty body / 401 / 400). Exceptions from on_event propagate
    (return 500 so the provider retries)."""
    allowed = [provider] if isinstance(provider, str) else list(provider)
    name = allowed[0] if len(allowed) == 1 else detect_provider(headers)
    if name is None or name not in allowed:
        err = VerifyResult(False, None, "unknown_provider", "Could not determine the webhook provider.")
        return WebhookResponse(400, error=err)
    sec = secret.get(name) if isinstance(secret, dict) else secret
    if sec is None:
        raise TypeError(f"africa_payments_webhooks: no secret configured for {name}.")
    result = verify(name, raw_body=raw_body, headers=headers, secret=sec, source_ip=source_ip, **verify_options)
    if not result.ok:
        return WebhookResponse(400 if result.code in ("body_already_parsed", "invalid_body") else 401, error=result)
    event = parse(name, raw_body)
    if store is not None and not store.claim(event.id, ttl_seconds):
        return WebhookResponse(200, event=event, duplicate=True)
    try:
        on_event(event)
    except Exception:
        if store is not None:
            store.release(event.id)
        raise
    return WebhookResponse(200, event=event)
