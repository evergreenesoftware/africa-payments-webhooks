# Security model

- Signatures are checked over the **raw bytes**, with **constant-time** comparison. Malformed signatures are rejected
  without exceptions.
- The library never logs secrets, signatures or payloads, and its error messages never contain them.
- **Webhooks say "something happened"; the API says exactly what.** Re-confirm the transaction (amount, currency,
  status, reference) with the provider's API before giving value. This is **mandatory** for:
  - Flutterwave v3 (`verif-hash` doesn't protect the body),
  - Nomba (amounts aren't covered by the signature),
  - M-Pesa / MTN MoMo (unsigned callbacks — planned helpers).
- Only Nomba signs a timestamp. For the others, a captured webhook can be replayed — use a `store` and make
  fulfilment idempotent.
- `ipAllowlist` is defence in depth only; behind proxies make sure `sourceIp` is the real client IP.
- Rotate secrets with `secret: [newSecret, oldSecret]`, then remove the old one.
- Report vulnerabilities privately — see [SECURITY.md](https://github.com/evergreenesoftware/africa-payments-webhooks/blob/main/SECURITY.md).

This library is provided "as is" (MIT). It does not move money; you remain responsible for your payment logic.
