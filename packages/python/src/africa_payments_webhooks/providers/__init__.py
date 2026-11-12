"""Provider specifications. Mirrors packages/js/src/providers — keep both in sync."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .._core import (
    HeadersInput,
    compact_json,
    extract_top_level_value,
    get,
    get_header,
    iso_time,
    mac,
    match_b64,
    match_hex,
    n,
    s,
    safe_json,
)

logger = logging.getLogger("africa_payments_webhooks")


@dataclass
class Ctx:
    body: bytes
    text: str
    headers: HeadersInput
    secrets: list[str]
    allow_unsigned_sandbox: bool = False
    tolerance_seconds: int = 300
    now: float | None = None  # epoch seconds


@dataclass
class Outcome:
    ok: bool
    code: str | None = None
    message: str | None = None
    unsigned: bool = False


OK = Outcome(True)


def _missing(h: str) -> Outcome:
    return Outcome(False, "missing_signature", f"Missing {h} header.")


def _from_match(result: str, header: str) -> Outcome:
    if result == "ok":
        return OK
    if result == "malformed":
        return Outcome(False, "malformed_signature", f"The {header} header is not a well-formed signature.")
    return Outcome(False, "invalid_signature", "Signature does not match.")


def _amount(value: Any, unit: str, currency: str | None) -> dict[str, Any] | None:
    num = n(value)
    if num is None or not currency:
        return None
    return {"value": num, "unit": unit, "currency": currency}


@dataclass
class Provider:
    name: str
    status: str
    ips: tuple[str, ...]
    detect_headers: tuple[str, ...]
    verify: Callable[[Ctx], Outcome]
    parse: Callable[[Any], dict[str, Any]]
    sign: Callable[[str, str, str | None], dict[str, str]] = field(repr=False)


# ---------------------------------------------------------------- Paystack
_PAYSTACK = "x-paystack-signature"
_PAYSTACK_EVENTS = {
    "charge.success": "payment.succeeded",
    "invoice.payment_failed": "payment.failed",
    "refund.processed": "refund.processed",
    "refund.failed": "refund.failed",
    "refund.pending": "refund.pending",
    "refund.processing": "refund.pending",
    "transfer.success": "transfer.succeeded",
    "transfer.failed": "transfer.failed",
    "transfer.reversed": "transfer.reversed",
    "subscription.create": "subscription.created",
    "subscription.disable": "subscription.disabled",
}


def _paystack_verify(c: Ctx) -> Outcome:
    sig = get_header(c.headers, _PAYSTACK)
    if not sig:
        return _missing(_PAYSTACK)
    return _from_match(match_hex("sha512", c.secrets, [c.body], sig), _PAYSTACK)


def _paystack_parse(p: Any) -> dict[str, Any]:
    event = s(get(p, "event")) or "unknown"
    d = get(p, "data")
    name = " ".join(x for x in [s(get(d, "customer", "first_name")), s(get(d, "customer", "last_name"))] if x) or None
    return {
        "type": _PAYSTACK_EVENTS.get(event, "unknown"),
        "provider_event_type": event,
        "reference": s(get(d, "reference")) or s(get(d, "transfer_code")) or s(get(d, "subscription_code")) or "",
        "provider_reference": s(get(d, "id")),
        "amount": _amount(get(d, "amount"), "minor", s(get(d, "currency"))),
        "status": s(get(d, "status")),
        "customer": {"email": s(get(d, "customer", "email")), "phone": s(get(d, "customer", "phone")), "name": name},
        "occurred_at": iso_time(get(d, "paid_at") or get(d, "created_at") or get(d, "createdAt")),
    }


def _hex(name: str, secret: str, msg: str) -> str:
    return mac(name, secret, msg.encode("utf-8")).hex()  # type: ignore[arg-type]


def _b64(name: str, secret: str, msg: str) -> str:
    return base64.b64encode(mac(name, secret, msg.encode("utf-8"))).decode("ascii")  # type: ignore[arg-type]


# ---------------------------------------------------------------- Flutterwave
_FLW_V3 = "verif-hash"
_FLW_V4 = "flutterwave-signature"


def _flw_verify(c: Ctx) -> Outcome:
    v4 = get_header(c.headers, _FLW_V4)
    if v4:
        return _from_match(match_b64("sha256", c.secrets, [c.body], v4), _FLW_V4)
    v3 = get_header(c.headers, _FLW_V3)
    if not v3:
        return _missing(f"{_FLW_V4} or {_FLW_V3}")
    got = hashlib.sha256(v3.encode("utf-8")).digest()
    for secret in c.secrets:
        if hmac.compare_digest(hashlib.sha256(secret.encode("utf-8")).digest(), got):
            return OK
    return Outcome(False, "invalid_signature", "Signature does not match.")


def _flw_parse(p: Any) -> dict[str, Any]:
    v4_type = s(get(p, "type"))
    if v4_type and get(p, "event") is None:
        d = get(p, "data")
        status = s(get(d, "status"))
        st = (status or "").lower()
        typ = "unknown"
        if v4_type == "charge.completed":
            typ = (
                "payment.succeeded"
                if st in ("succeeded", "successful")
                else "payment.failed"
                if st == "failed"
                else "unknown"
            )
        return {
            "type": typ,
            "provider_event_type": v4_type,
            "reference": s(get(d, "reference")) or "",
            "provider_reference": s(get(d, "id")),
            "amount": _amount(get(d, "amount"), "major", s(get(d, "currency"))),
            "status": status,
            "customer": {
                "email": s(get(d, "customer", "email")),
                "name": s(get(d, "customer", "name")),
                "phone": s(get(d, "customer", "phone")),
            },
            "occurred_at": iso_time(get(d, "created_datetime") or get(p, "timestamp")),
        }
    event = s(get(p, "event")) or "unknown"
    d = get(p, "data")
    status = s(get(d, "status"))
    st = (status or "").lower()
    typ = "unknown"
    if event == "charge.completed":
        typ = "payment.succeeded" if st == "successful" else "payment.failed" if st == "failed" else "unknown"
    elif event == "transfer.completed":
        typ = "transfer.succeeded" if st == "successful" else "transfer.failed" if st == "failed" else "unknown"
    elif event == "subscription.cancelled":
        typ = "subscription.disabled"
    return {
        "type": typ,
        "provider_event_type": event,
        "reference": s(get(d, "tx_ref")) or s(get(d, "reference")) or "",
        "provider_reference": s(get(d, "id")) or s(get(d, "flw_ref")),
        "amount": _amount(get(d, "amount"), "major", s(get(d, "currency"))),
        "status": status,
        "customer": {
            "email": s(get(d, "customer", "email")),
            "name": s(get(d, "customer", "name")) or s(get(d, "fullname")),
            "phone": s(get(d, "customer", "phone_number")),
        },
        "occurred_at": iso_time(get(d, "created_at")),
    }


# ---------------------------------------------------------------- Monnify
_MONNIFY = "monnify-signature"
_MONNIFY_EVENTS = {
    "SUCCESSFUL_TRANSACTION": "payment.succeeded",
    "REJECTED_PAYMENT": "payment.failed",
    "SUCCESSFUL_DISBURSEMENT": "transfer.succeeded",
    "FAILED_DISBURSEMENT": "transfer.failed",
    "REVERSED_DISBURSEMENT": "transfer.reversed",
    "SUCCESSFUL_REFUND": "refund.processed",
    "FAILED_REFUND": "refund.failed",
}


def _monnify_verify(c: Ctx) -> Outcome:
    sig = get_header(c.headers, _MONNIFY)
    if not sig:
        if c.allow_unsigned_sandbox:
            logger.warning(
                "Accepting an UNSIGNED Monnify notification because allow_unsigned_sandbox=True. "
                "Never enable this in production."
            )
            return Outcome(True, unsigned=True)
        return _missing(_MONNIFY)
    return _from_match(match_hex("sha512", c.secrets, [c.body], sig), _MONNIFY)


def _monnify_parse(p: Any) -> dict[str, Any]:
    event = s(get(p, "eventType")) or "unknown"
    d = get(p, "eventData")
    collection = event in ("SUCCESSFUL_TRANSACTION", "REJECTED_PAYMENT")
    raw_amount = (
        get(d, "amountPaid")
        if collection
        else (get(d, "amount") if get(d, "amount") is not None else get(d, "refundAmount"))
    )
    return {
        "type": _MONNIFY_EVENTS.get(event, "unknown"),
        "provider_event_type": event,
        "reference": s(get(d, "paymentReference"))
        or s(get(d, "reference"))
        or s(get(d, "refundReference"))
        or s(get(d, "transactionReference"))
        or "",
        "provider_reference": s(get(d, "transactionReference")),
        "amount": _amount(raw_amount, "major", s(get(d, "currency"))),
        "status": s(get(d, "paymentStatus")) or s(get(d, "status")) or s(get(d, "refundStatus")),
        "customer": {"email": s(get(d, "customer", "email")), "name": s(get(d, "customer", "name"))},
        "occurred_at": iso_time(get(d, "paidOn") or get(d, "completedOn") or get(d, "createdOn")),
    }


# ---------------------------------------------------------------- Squad (payment gateway)
_SQUAD = "x-squad-encrypted-body"


def _squad_verify(c: Ctx) -> Outcome:
    sig = get_header(c.headers, _SQUAD)
    if not sig:
        return _missing(_SQUAD)
    return _from_match(match_hex("sha512", c.secrets, [c.body], sig), _SQUAD)


def _squad_parse(p: Any) -> dict[str, Any]:
    event = s(get(p, "Event")) or "unknown"
    b = get(p, "Body")
    status = s(get(b, "transaction_status"))
    ok = (status or "").lower() == "success"
    return {
        "type": "payment.succeeded" if event == "charge_successful" and ok else "unknown",
        "provider_event_type": event,
        "reference": s(get(p, "TransactionRef")) or s(get(b, "transaction_ref")) or "",
        "provider_reference": s(get(b, "gateway_ref")),
        "amount": _amount(get(b, "amount"), "minor", s(get(b, "currency"))),
        "status": status,
        "customer": {"email": s(get(b, "email")), "phone": s(get(b, "customer_mobile"))},
        "occurred_at": iso_time(get(b, "created_at")),
    }


# ---------------------------------------------------------------- Korapay
_KORA = "x-korapay-signature"
_KORA_EVENTS = {
    "charge.success": "payment.succeeded",
    "charge.failed": "payment.failed",
    "transfer.success": "transfer.succeeded",
    "transfer.failed": "transfer.failed",
    "refund.success": "refund.processed",
    "refund.failed": "refund.failed",
}


def _kora_verify(c: Ctx) -> Outcome:
    sig = get_header(c.headers, _KORA)
    if not sig:
        return _missing(_KORA)
    candidates: list[bytes] = []
    raw = extract_top_level_value(c.text, "data")
    if raw is not None:
        candidates.append(raw.encode("utf-8"))
    parsed = safe_json(c.text)
    data = get(parsed, "data")
    if data is not None:
        compact = compact_json(data)
        if compact != raw:
            candidates.append(compact.encode("utf-8"))
    if not candidates:
        return Outcome(False, "invalid_body", 'Korapay payload has no "data" object.')
    return _from_match(match_hex("sha256", c.secrets, candidates, sig), _KORA)


def _kora_parse(p: Any) -> dict[str, Any]:
    event = s(get(p, "event")) or "unknown"
    d = get(p, "data")
    return {
        "type": _KORA_EVENTS.get(event, "unknown"),
        "provider_event_type": event,
        "reference": s(get(d, "reference")) or "",
        "provider_reference": s(get(d, "payment_reference")),
        "amount": _amount(get(d, "amount"), "major", s(get(d, "currency"))),
        "status": s(get(d, "status")),
        "customer": {"email": s(get(d, "customer", "email")), "name": s(get(d, "customer", "name"))},
        "occurred_at": iso_time(get(d, "transaction_date") or get(d, "completion_date")),
    }


# ---------------------------------------------------------------- Fincra
_FINCRA = "signature"
_FINCRA_EVENTS = {
    "charge.successful": "payment.succeeded",
    "collection.successful": "payment.succeeded",
    "collection.failed": "payment.failed",
    "payout.successful": "transfer.succeeded",
    "payout.failed": "transfer.failed",
}


def _fincra_verify(c: Ctx) -> Outcome:
    sig = get_header(c.headers, _FINCRA)
    if not sig:
        return _missing(_FINCRA)
    candidates = [c.body]
    parsed = safe_json(c.text)
    if parsed is not None:
        compact = compact_json(parsed)
        if compact != c.text:
            candidates.append(compact.encode("utf-8"))
    return _from_match(match_hex("sha512", c.secrets, candidates, sig), _FINCRA)


def _first(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None


def _fincra_parse(p: Any) -> dict[str, Any]:
    event = s(get(p, "event")) or "unknown"
    d = get(p, "data")
    payout = event.startswith("payout.")
    raw_amount = (
        _first(get(d, "amountCharged"), get(d, "amountReceived"))
        if payout
        else _first(get(d, "amountReceived"), get(d, "amount"), get(d, "sourceAmount"))
    )
    currency = s(get(d, "currency")) or s(get(d, "sourceCurrency" if payout else "destinationCurrency"))
    return {
        "type": _FINCRA_EVENTS.get(event, "unknown"),
        "provider_event_type": event,
        "reference": s(get(d, "merchantReference"))
        or s(get(d, "customerReference"))
        or s(get(d, "reference"))
        or s(get(d, "chargeReference"))
        or "",
        "provider_reference": s(get(d, "reference")) or s(get(d, "id")),
        "amount": _amount(raw_amount, "major", currency),
        "status": s(get(d, "status")),
        "customer": {
            "email": s(get(d, "customer", "email")) or s(get(d, "recipient", "email")),
            "name": s(get(d, "customer", "name")) or s(get(d, "customerName")) or s(get(d, "recipient", "name")),
        },
        "occurred_at": iso_time(get(d, "createdAt") or get(d, "updatedAt")),
    }


# ---------------------------------------------------------------- Interswitch
_ISW = "x-interswitch-signature"
_ISO_NUMERIC = {"566": "NGN", "840": "USD", "936": "GHS", "404": "KES"}


def _isw_verify(c: Ctx) -> Outcome:
    sig = get_header(c.headers, _ISW)
    if not sig:
        return _missing(_ISW)
    return _from_match(match_hex("sha512", c.secrets, [c.body], sig), _ISW)


def _isw_parse(p: Any) -> dict[str, Any]:
    event = s(get(p, "event")) or "unknown"
    d = get(p, "data")
    rc = s(get(d, "responseCode"))
    if event.endswith("TRANSACTION_SUCCESSFUL"):
        typ = "payment.succeeded"
    elif event.endswith("TRANSACTION_FAILURE"):
        typ = "payment.failed"
    elif event == "TRANSACTION.COMPLETED":
        typ = "payment.succeeded" if rc == "00" else "payment.failed"
    elif event == "SUBSCRIPTION.CREATED":
        typ = "subscription.created"
    elif event == "SUBSCRIPTION.CANCELLED":
        typ = "subscription.disabled"
    else:
        typ = "unknown"
    cc = s(get(d, "currencyCode"))
    return {
        "type": typ,
        "provider_event_type": event,
        "reference": s(get(d, "merchantReference")) or s(get(d, "paymentReference")) or "",
        "provider_reference": s(get(d, "paymentReference")) or s(get(p, "uuid")),
        "amount": _amount(get(d, "amount"), "minor", _ISO_NUMERIC.get(cc, cc) if cc else None),
        "status": rc,
        "customer": {"name": s(get(d, "merchantCustomerName"))},
        "occurred_at": iso_time(get(d, "transactionDate") or get(p, "timestamp")),
    }


# ---------------------------------------------------------------- Nomba
_NOMBA = "nomba-signature"
_NOMBA_TS = "nomba-timestamp"
_NOMBA_EVENTS = {
    "payment_success": "payment.succeeded",
    "payment_failed": "payment.failed",
    "payment_reversal": "payment.reversed",
    "payout_success": "transfer.succeeded",
    "payout_failed": "transfer.failed",
    "payout_refund": "transfer.reversed",
}


def _field(v: Any) -> str:
    out = s(v)
    return "" if out is None or out == "null" else out


def nomba_signing_string(payload: Any, timestamp: str) -> str:
    tx = get(payload, "data", "transaction")
    m = get(payload, "data", "merchant")
    return ":".join(
        [
            _field(get(payload, "event_type")),
            _field(get(payload, "requestId")),
            _field(get(m, "userId")),
            _field(get(m, "walletId")),
            _field(get(tx, "transactionId")),
            _field(get(tx, "type")),
            _field(get(tx, "time")),
            _field(get(tx, "responseCode")),
            timestamp,
        ]
    )


def _nomba_verify(c: Ctx) -> Outcome:
    sig = get_header(c.headers, _NOMBA)
    if not sig:
        return _missing(_NOMBA)
    ts = get_header(c.headers, _NOMBA_TS)
    if not ts:
        return _missing(_NOMBA_TS)
    if c.tolerance_seconds > 0:
        try:
            when = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
        except ValueError:
            return Outcome(False, "malformed_signature", f"The {_NOMBA_TS} header is not a well-formed signature.")
        import time

        now = c.now if c.now is not None else time.time()
        if abs(now - when.timestamp()) > c.tolerance_seconds:
            return Outcome(
                False, "timestamp_out_of_range", f"nomba-timestamp is outside the {c.tolerance_seconds}s tolerance."
            )
    payload = safe_json(c.text)
    if payload is None:
        return Outcome(False, "invalid_body", "Nomba payload is not valid JSON.")
    message = nomba_signing_string(payload, ts).encode("utf-8")
    received = sig.strip().lower().encode("utf-8")
    for secret in c.secrets:
        expected = base64.b64encode(mac("sha256", secret, message)).lower()
        if hmac.compare_digest(expected, received):
            return OK
    return Outcome(False, "invalid_signature", "Signature does not match.")


def _nomba_parse(p: Any) -> dict[str, Any]:
    event = s(get(p, "event_type")) or "unknown"
    tx = get(p, "data", "transaction")
    amount = n(get(tx, "transactionAmount"))
    return {
        "type": _NOMBA_EVENTS.get(event, "unknown"),
        "provider_event_type": event,
        "reference": s(get(tx, "merchantTxRef"))
        or s(get(tx, "aliasAccountReference"))
        or s(get(tx, "transactionId"))
        or "",
        "provider_reference": s(get(tx, "transactionId")),
        "amount": {"value": amount, "unit": "major", "currency": "NGN"} if amount is not None else None,
        "status": s(get(tx, "responseCode")) or None,
        "customer": {"name": s(get(p, "data", "customer", "senderName"))},
        "occurred_at": iso_time(get(tx, "time")),
    }


def _nomba_sign(body: str, secret: str, timestamp: str | None) -> dict[str, str]:
    ts = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        _NOMBA: _b64("sha256", secret, nomba_signing_string(safe_json(body), ts)),
        _NOMBA_TS: ts,
        "nomba-signature-algorithm": "HmacSHA256",
        "nomba-signature-version": "1.0.0",
    }


def _kora_sign(body: str, secret: str, _ts: str | None) -> dict[str, str]:
    raw = extract_top_level_value(body, "data") or compact_json(get(safe_json(body), "data"))
    return {_KORA: _hex("sha256", secret, raw)}


PROVIDERS: dict[str, Provider] = {
    "paystack": Provider(
        "paystack",
        "documented",
        ("52.31.139.75", "52.49.173.169", "52.214.14.220"),
        (_PAYSTACK,),
        _paystack_verify,
        _paystack_parse,
        lambda b, k, _t: {_PAYSTACK: _hex("sha512", k, b)},
    ),
    "flutterwave": Provider(
        "flutterwave",
        "documented",
        (),
        (_FLW_V4, _FLW_V3),
        _flw_verify,
        _flw_parse,
        lambda b, k, _t: {_FLW_V4: _b64("sha256", k, b)},
    ),
    "monnify": Provider(
        "monnify",
        "verified",
        ("35.242.133.146",),
        (_MONNIFY,),
        _monnify_verify,
        _monnify_parse,
        lambda b, k, _t: {_MONNIFY: _hex("sha512", k, b)},
    ),
    "squad": Provider(
        "squad",
        "documented",
        ("18.133.63.109",),
        (_SQUAD,),
        _squad_verify,
        _squad_parse,
        lambda b, k, _t: {_SQUAD: _hex("sha512", k, b).upper()},
    ),
    "korapay": Provider("korapay", "documented", (), (_KORA,), _kora_verify, _kora_parse, _kora_sign),
    "fincra": Provider(
        "fincra",
        "documented",
        (),
        (),
        _fincra_verify,
        _fincra_parse,
        lambda b, k, _t: {_FINCRA: _hex("sha512", k, b)},
    ),
    "interswitch": Provider(
        "interswitch",
        "documented",
        (),
        (_ISW,),
        _isw_verify,
        _isw_parse,
        lambda b, k, _t: {"X-Interswitch-Signature": _hex("sha512", k, b)},
    ),
    "nomba": Provider("nomba", "verified", (), (_NOMBA,), _nomba_verify, _nomba_parse, _nomba_sign),
}
