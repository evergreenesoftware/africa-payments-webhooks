"""Shared helpers: raw-body handling, header lookup, constant-time HMAC matching."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Literal

HashName = Literal["sha256", "sha512"]
RawBody = str | bytes | bytearray | memoryview
Secret = str | Sequence[str]
HeadersInput = Mapping[str, Any] | Iterable[tuple[str, Any]]


class BodyError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def read_raw_body(raw_body: object) -> tuple[bytes, str]:
    """Normalise the raw body to (bytes, text). Rejects already-parsed dicts/lists (the #1 integration bug)."""
    if isinstance(raw_body, str):
        return raw_body.encode("utf-8"), raw_body
    if isinstance(raw_body, (bytes, bytearray, memoryview)):
        data = bytes(raw_body)
        return data, data.decode("utf-8", errors="replace")
    if isinstance(raw_body, (dict, list)):
        raise BodyError(
            "body_already_parsed",
            "The request body was already parsed into an object. Signatures must be verified against the raw bytes.",
        )
    raise BodyError("invalid_body", "raw_body must be str or bytes.")


def get_header(headers: HeadersInput, name: str) -> str | None:
    lower = name.lower()
    # Django's request.headers / Starlette / Werkzeug headers are case-insensitive mappings with .get()
    getter = getattr(headers, "get", None)
    if callable(getter):
        value = getter(name)
        if value is None:
            value = getter(lower)
        if value is not None:
            return str(value[0] if isinstance(value, (list, tuple)) else value)
    items = headers.items() if isinstance(headers, Mapping) else headers
    for key, value in items:
        if str(key).lower() == lower and value is not None:
            return str(value[0] if isinstance(value, (list, tuple)) else value)
    return None


def secrets_of(secret: Secret) -> list[str]:
    values = [secret] if isinstance(secret, str) else list(secret)
    clean = [s for s in values if isinstance(s, str) and s]
    if not clean:
        raise TypeError("africa_payments_webhooks: at least one non-empty secret is required.")
    return clean


def mac(name: HashName, secret: str, message: bytes) -> bytes:
    return hmac.new(secret.encode("utf-8"), message, getattr(hashlib, name)).digest()


def decode_hex(value: str) -> bytes | None:
    try:
        out = bytes.fromhex(value.strip())
    except ValueError:
        return None
    return out or None


def decode_b64(value: str) -> bytes | None:
    s = value.strip()
    try:
        out = base64.b64decode(
            s + "=" * (-len(s) % 4), altchars=b"-_" if ("-" in s or "_" in s) else None, validate=True
        )
    except (binascii.Error, ValueError):
        return None
    return out or None


def match_hex(name: HashName, secrets: list[str], candidates: list[bytes], header: str) -> str:
    """Return 'ok', 'malformed' or 'invalid'."""
    expected = decode_hex(header)
    if expected is None:
        return "malformed"
    for secret in secrets:
        for msg in candidates:
            if hmac.compare_digest(mac(name, secret, msg), expected):
                return "ok"
    return "invalid"


def match_b64(name: HashName, secrets: list[str], candidates: list[bytes], header: str) -> str:
    expected = decode_b64(header)
    if expected is None:
        return "malformed"
    for secret in secrets:
        for msg in candidates:
            if hmac.compare_digest(mac(name, secret, msg), expected):
                return "ok"
    return "invalid"


def compact_json(value: Any) -> str:
    """Equivalent of JavaScript JSON.stringify for JSON-decoded data (compact, no ASCII escaping)."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def safe_json(text: str) -> Any:
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def get(obj: Any, *path: str) -> Any:
    cur = obj
    for part in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def s(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    return None


def n(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            f = float(value)
        except ValueError:
            return None
        return int(f) if f.is_integer() and "." not in value else f
    return None


def iso_time(value: Any) -> str | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = value / 1000 if value >= 1e12 else value
        return (
            datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
    if isinstance(value, str) and value:
        if "T" in value and (value.endswith("Z") or value[-6:-5] in "+-" and ":" in value[-6:]):
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            except ValueError:
                return value
        return value
    return None


def extract_top_level_value(text: str, key: str) -> str | None:
    """Return the exact raw JSON text of a top-level property value without re-serialising."""
    decoder = json.JSONDecoder()
    i = 0
    length = len(text)

    def ws(idx: int) -> int:
        while idx < length and text[idx] in " \t\r\n":
            idx += 1
        return idx

    i = ws(i)
    if i >= length or text[i] != "{":
        return None
    i += 1
    while True:
        i = ws(i)
        if i >= length or text[i] == "}":
            return None
        try:
            name, i = decoder.raw_decode(text, i)
        except ValueError:
            return None
        i = ws(i)
        if i >= length or text[i] != ":":
            return None
        i = ws(i + 1)
        start = i
        try:
            _, i = decoder.raw_decode(text, i)
        except ValueError:
            return None
        if name == key:
            return text[start:i]
        i = ws(i)
        if i < length and text[i] == ",":
            i += 1
