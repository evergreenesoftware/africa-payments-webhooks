# Providers

| Provider | Header | Algorithm & key | Signed input | Amount unit | Status |
|---|---|---|---|---|---|
| Paystack | `x-paystack-signature` | HMAC-SHA512 hex · secret key | raw body | minor (kobo) | documented |
| Flutterwave v3 | `verif-hash` | equals your dashboard *secret hash* | — (no body integrity) | major | documented |
| Flutterwave v4 | `flutterwave-signature` | HMAC-SHA256 base64 · secret hash | raw body | major | beta |
| Monnify | `monnify-signature` | HMAC-SHA512 hex · client secret | raw body | major | **verified** |
| Squad (gateway) | `x-squad-encrypted-body` | HMAC-SHA512 hex (upper) · secret key | raw body | minor (kobo) | documented |
| Korapay | `x-korapay-signature` | HMAC-SHA256 hex · secret key | the `data` object only | major | documented |
| Fincra | `signature` | HMAC-SHA512 hex · **webhook** secret | payload | major | documented |
| Interswitch | `X-Interswitch-Signature` | HMAC-SHA512 hex · webhook secret | raw body | minor | documented |
| Nomba | `nomba-signature` + `nomba-timestamp` | HMAC-SHA256 base64 · signature key | selected fields + timestamp | major | **verified** |

**Status:** *verified* = the provider's published test vector reproduces in our CI; *documented* = implemented
exactly as the official docs describe (no vector published); *beta* = the provider's docs are inconsistent.

## Provider notes

- **Paystack** — sends only from `52.31.139.75`, `52.49.173.169`, `52.214.14.220`. Retries every 3 min ×4, then hourly
  for 72 h. There is no `charge.failed` webhook. Re-verify with `GET /transaction/verify/:reference`.
- **Flutterwave** — v3's `verif-hash` is a shared secret, not a body signature: **always** re-verify with
  `GET /v3/transactions/{id}/verify`. v4 accounts send `flutterwave-signature`; we pick the scheme by header.
  Retries (if enabled): 3 times, 30 min apart.
- **Monnify** — its docs' prose says "SHA-512(secret + body)", but its own published example only reproduces as
  HMAC-SHA512 (we test both facts). **Sandbox notifications are unsigned** — use `allowUnsignedSandbox` only in sandbox.
  Single source IP `35.242.133.146`.
- **Squad** — gateway notifications only (`x-squad-encrypted-body`, source IP `18.133.63.109`). Virtual-account
  notifications use a different scheme and are planned.
- **Korapay** — signs only `JSON.stringify(body.data)`. We verify the exact `data` bytes received first, then the
  compact re-serialisation.
- **Fincra** — key is the **webhook encryption key**, not your API secret; sandbox and live keys differ.
- **Interswitch** — reply **200 with no body** (the handler does). `TRANSACTION.COMPLETED` is not success — check
  `responseCode === "00"` (the parser does).
- **Nomba** — the only provider that signs a timestamp (replay window enforced). **Amounts are not signed** —
  re-verify via Nomba's API. Its docs print the example signature with a lowercase first letter and its samples compare
  case-insensitively, so we do too (in constant time).

## Planned
Squad virtual accounts, OPay (HMAC-SHA3-512 over a field template), Paga (SHA-512 field hashes), and **unsigned
callback helpers** for M-Pesa Daraja and MTN MoMo (URL token, optional IP allowlist, mandatory status query).
