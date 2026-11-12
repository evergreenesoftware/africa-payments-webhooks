from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from africa_payments_webhooks import (
    SUPPORTED_PROVIDERS,
    MemoryIdempotencyStore,
    detect_provider,
    handle_webhook,
    parse,
    verify,
)
from africa_payments_webhooks._core import extract_top_level_value
from africa_payments_webhooks.testing import sign_test_payload

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures"
VECTORS = json.loads((FIXTURES / "official-vectors.json").read_text())
CROSS = json.loads((FIXTURES / "cross-language.json").read_text())
SECRET = "sk_test_python"
TS = "2026-11-12T10:00:00Z"
NOW = datetime.fromisoformat("2026-11-12T10:00:00+00:00").timestamp()


# ------------------------------------------------------------------ official vectors
def test_monnify_official_vector() -> None:
    v = VECTORS["monnify"]
    body = (FIXTURES / v["bodyFile"]).read_bytes()
    assert verify("monnify", raw_body=body, headers={v["header"]: v["signature"]}, secret=v["secret"]).ok


@pytest.mark.parametrize("key", ["signatureAsPublished", "signatureComputed"])
def test_nomba_official_vector(key: str) -> None:
    v = VECTORS["nomba"]
    when = datetime.fromisoformat(v["timestamp"].replace("Z", "+00:00")).timestamp()
    r = verify(
        "nomba",
        raw_body=json.dumps(v["payload"]),
        headers={"nomba-signature": v[key], "nomba-timestamp": v["timestamp"]},
        secret=v["secret"],
        now=when,
    )
    assert r.ok, r


# ------------------------------------------------------------------ parity with JS
@pytest.mark.parametrize("name", list(CROSS["cases"]))
def test_cross_language_fixture_verifies(name: str) -> None:
    case = CROSS["cases"][name]
    provider = "flutterwave" if name == "flutterwave-v3" else name
    r = verify(provider, raw_body=case["body"], headers=case["headers"], secret=CROSS["secret"], now=NOW)
    assert r.ok, (name, r)


@pytest.mark.parametrize("name", [p for p in CROSS["cases"] if p != "flutterwave-v3"])
def test_python_signer_matches_js_signer(name: str) -> None:
    case = CROSS["cases"][name]
    _, headers = sign_test_payload(name, case["body"], CROSS["secret"], timestamp=CROSS["timestamp"])
    for k, val in case["headers"].items():
        assert headers.get(k) == val, (name, k)


# ------------------------------------------------------------------ independent reference implementation
def reference_headers(p: str, body: str, secret: str) -> dict[str, str]:
    data = json.loads(body)
    k = secret.encode()
    if p == "paystack":
        return {"x-paystack-signature": hmac.new(k, body.encode(), hashlib.sha512).hexdigest()}
    if p == "flutterwave":
        return {"flutterwave-signature": base64.b64encode(hmac.new(k, body.encode(), hashlib.sha256).digest()).decode()}
    if p == "monnify":
        return {"monnify-signature": hmac.new(k, body.encode(), hashlib.sha512).hexdigest()}
    if p == "squad":
        return {"x-squad-encrypted-body": hmac.new(k, body.encode(), hashlib.sha512).hexdigest().upper()}
    if p == "korapay":
        d = json.dumps(data["data"], separators=(",", ":"))
        return {"x-korapay-signature": hmac.new(k, d.encode(), hashlib.sha256).hexdigest()}
    if p == "fincra":
        return {"signature": hmac.new(k, body.encode(), hashlib.sha512).hexdigest()}
    if p == "interswitch":
        return {"X-Interswitch-Signature": hmac.new(k, body.encode(), hashlib.sha512).hexdigest()}
    if p == "nomba":
        t, m = data["data"]["transaction"], data["data"]["merchant"]
        msg = ":".join(
            [
                data["event_type"],
                data["requestId"],
                m["userId"],
                m["walletId"],
                t["transactionId"],
                t["type"],
                t["time"],
                t["responseCode"],
                TS,
            ]
        )
        sig = base64.b64encode(hmac.new(k, msg.encode(), hashlib.sha256).digest()).decode()
        return {"nomba-signature": sig, "nomba-timestamp": TS}
    raise AssertionError(p)


@pytest.mark.parametrize("provider", SUPPORTED_PROVIDERS)
def test_reference_signature_accepted(provider: str) -> None:
    body = CROSS["cases"][provider]["body"]
    r = verify(provider, raw_body=body, headers=reference_headers(provider, body, SECRET), secret=SECRET, now=NOW)
    assert r.ok, r


@pytest.mark.parametrize("provider", SUPPORTED_PROVIDERS)
def test_wrong_secret_missing_header_rotation_parsed_body(provider: str) -> None:
    body = CROSS["cases"][provider]["body"]
    headers = reference_headers(provider, body, SECRET)
    assert verify(provider, raw_body=body, headers=headers, secret="nope", now=NOW).code == "invalid_signature"
    assert verify(provider, raw_body=body, headers={}, secret=SECRET, now=NOW).code == "missing_signature"
    assert verify(provider, raw_body=body, headers=headers, secret=["old", SECRET], now=NOW).ok
    assert (
        verify(provider, raw_body=json.loads(body), headers=headers, secret=SECRET, now=NOW).code
        == "body_already_parsed"
    )
    upper = {k.upper(): v for k, v in headers.items()}
    assert verify(provider, raw_body=body.encode(), headers=upper, secret=SECRET, now=NOW).ok


@pytest.mark.parametrize(
    "provider", ["paystack", "flutterwave", "monnify", "squad", "korapay", "fincra", "interswitch"]
)
def test_tampering_detected(provider: str) -> None:
    body = CROSS["cases"][provider]["body"]
    headers = reference_headers(provider, body, SECRET)
    tampered = body.replace("0", "1", 1)
    assert tampered != body
    assert verify(provider, raw_body=tampered, headers=headers, secret=SECRET).code == "invalid_signature"


def test_monnify_unsigned_sandbox_opt_in() -> None:
    body = CROSS["cases"]["monnify"]["body"]
    assert verify("monnify", raw_body=body, headers={}, secret=SECRET).code == "missing_signature"
    r = verify("monnify", raw_body=body, headers={}, secret=SECRET, allow_unsigned_sandbox=True)
    assert r.ok and r.unsigned


def test_nomba_replay_window() -> None:
    body = CROSS["cases"]["nomba"]["body"]
    headers = reference_headers("nomba", body, SECRET)
    assert (
        verify("nomba", raw_body=body, headers=headers, secret=SECRET, now=NOW + 301).code == "timestamp_out_of_range"
    )
    assert verify("nomba", raw_body=body, headers=headers, secret=SECRET, now=NOW + 301, tolerance_seconds=0).ok


def test_korapay_raw_data_bytes() -> None:
    raw = '{ "reference" : "KPY-1", "amount": 150.10, "url": "https:\\/\\/x" }'
    body = '{"event":"charge.success","data":' + raw + "}"
    sig = hmac.new(SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    assert verify("korapay", raw_body=body, headers={"x-korapay-signature": sig}, secret=SECRET).ok


def test_malformed_signatures_never_raise() -> None:
    body = CROSS["cases"]["paystack"]["body"]
    assert (
        verify("paystack", raw_body=body, headers={"x-paystack-signature": "zz"}, secret=SECRET).code
        == "malformed_signature"
    )
    assert (
        verify("flutterwave", raw_body=body, headers={"flutterwave-signature": "%%%"}, secret=SECRET).code
        == "malformed_signature"
    )
    assert verify("unknown", raw_body=body, headers={}, secret=SECRET).code == "unknown_provider"
    with pytest.raises(TypeError):
        verify("paystack", raw_body=body, headers={}, secret="")


def test_ip_allowlist() -> None:
    body = CROSS["cases"]["paystack"]["body"]
    headers = reference_headers("paystack", body, SECRET)
    assert verify(
        "paystack", raw_body=body, headers=headers, secret=SECRET, ip_allowlist=True, source_ip="52.31.139.75"
    ).ok
    assert (
        verify("paystack", raw_body=body, headers=headers, secret=SECRET, ip_allowlist=True, source_ip="1.2.3.4").code
        == "ip_not_allowed"
    )
    assert verify(
        "paystack", raw_body=body, headers=headers, secret=SECRET, ip_allowlist=["10.0.0.0/8"], source_ip="10.9.9.9"
    ).ok
    with pytest.raises(TypeError):
        verify("korapay", raw_body=body, headers={}, secret=SECRET, ip_allowlist=True, source_ip="1.1.1.1")


# ------------------------------------------------------------------ parse
def test_parse_matches_js_semantics() -> None:
    e = parse("paystack", CROSS["cases"]["paystack"]["body"])
    assert (e.type, e.reference, e.provider_reference) == ("payment.succeeded", "qTPrJoy9Bx", "302961")
    assert e.amount == {"value": 20000, "unit": "minor", "currency": "NGN"}
    assert e.id == "paystack:charge.success:302961:success"
    m = parse("monnify", (FIXTURES / "monnify-official-body.json").read_bytes())
    assert (m.type, m.reference, m.amount) == (
        "payment.succeeded",
        "0.01462001097368737",
        {"value": 78000, "unit": "major", "currency": "NGN"},
    )
    i = parse("interswitch", CROSS["cases"]["interswitch"]["body"])
    assert i.amount == {"value": 12000, "unit": "minor", "currency": "NGN"} and i.type == "payment.succeeded"
    f = parse("flutterwave", CROSS["cases"]["flutterwave"]["body"])
    assert f.type == "payment.succeeded" and f.occurred_at == "2024-12-25T08:54:44.019Z"
    u = parse("paystack", '{"event":"customeridentification.failed","data":{}}')
    assert u.type == "unknown"
    with pytest.raises(ValueError):
        parse("paystack", "not json")


def test_detect_provider() -> None:
    assert detect_provider({"X-Paystack-Signature": "x"}) == "paystack"
    assert detect_provider({"verif-hash": "x"}) == "flutterwave"
    assert detect_provider({"signature": "x"}) is None


# ------------------------------------------------------------------ handler
def test_handle_webhook_dedupe_and_release() -> None:
    body, headers = sign_test_payload(
        "paystack", {"event": "charge.success", "data": {"id": 1, "reference": "r"}}, SECRET
    )
    seen: list[str] = []
    store = MemoryIdempotencyStore()
    r1 = handle_webhook(
        provider="paystack",
        raw_body=body,
        headers=headers,
        secret=SECRET,
        on_event=lambda e: seen.append(e.id),
        store=store,
    )
    r2 = handle_webhook(
        provider="paystack",
        raw_body=body,
        headers=headers,
        secret=SECRET,
        on_event=lambda e: seen.append(e.id),
        store=store,
    )
    assert (r1.status, r2.status, r2.duplicate, len(seen)) == (200, 200, True, 1)

    calls = {"n": 0}

    def flaky(_e: object) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("db down")

    store2 = MemoryIdempotencyStore()
    with pytest.raises(RuntimeError):
        handle_webhook(provider="paystack", raw_body=body, headers=headers, secret=SECRET, on_event=flaky, store=store2)
    assert (
        handle_webhook(
            provider="paystack", raw_body=body, headers=headers, secret=SECRET, on_event=flaky, store=store2
        ).status
        == 200
    )
    assert handle_webhook(provider="paystack", raw_body=body, headers=headers, secret="x", on_event=flaky).status == 401


# ------------------------------------------------------------------ properties
@settings(max_examples=150)
@given(st.text(), st.binary(min_size=1), st.integers(min_value=0))
def test_flip_any_byte_fails(secret_suffix: str, body: bytes, pos: int) -> None:
    secret = "k" + secret_suffix
    sig = hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    assert verify("paystack", raw_body=body, headers={"x-paystack-signature": sig}, secret=secret).ok
    flipped = bytearray(body)
    flipped[pos % len(flipped)] ^= 1
    assert not verify("paystack", raw_body=bytes(flipped), headers={"x-paystack-signature": sig}, secret=secret).ok


@settings(max_examples=100)
@given(st.text(), st.text())
def test_verify_never_raises_on_garbage(sig: str, body: str) -> None:
    for p in SUPPORTED_PROVIDERS:
        headers = {
            h: sig
            for h in [
                "x-paystack-signature",
                "flutterwave-signature",
                "monnify-signature",
                "x-squad-encrypted-body",
                "x-korapay-signature",
                "signature",
                "x-interswitch-signature",
                "nomba-signature",
                "nomba-timestamp",
            ]
        }
        assert not verify(p, raw_body=body, headers=headers, secret="s").ok


@given(
    st.recursive(
        st.none() | st.booleans() | st.integers() | st.text(),
        lambda c: st.lists(c) | st.dictionaries(st.text(), c),
        max_leaves=10,
    )
)
def test_extract_top_level_value_exact(data: object) -> None:
    text = json.dumps(data, indent=1)
    doc = '{ "event": 1 , "data" : ' + text + " }"
    assert extract_top_level_value(doc, "data") == text
