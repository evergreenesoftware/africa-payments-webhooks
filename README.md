# africa-payments-webhooks

[![CI](https://github.com/evergreenesoftware/africa-payments-webhooks/actions/workflows/ci.yml/badge.svg)](https://github.com/evergreenesoftware/africa-payments-webhooks/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/africa-payments-webhooks)](https://www.npmjs.com/package/africa-payments-webhooks)
[![PyPI](https://img.shields.io/pypi/v/africa-payments-webhooks)](https://pypi.org/project/africa-payments-webhooks/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/evergreenesoftware/africa-payments-webhooks/badge)](https://scorecard.dev/viewer/?uri=github.com/evergreenesoftware/africa-payments-webhooks)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Verify and normalise payment webhooks from African providers** — Paystack, Flutterwave, Monnify, Squad, Korapay,
Fincra, Interswitch and Nomba — in **JavaScript/TypeScript** (Node, Bun, Deno, Cloudflare Workers, Next.js, Lambda) and
**Python** (Django, Flask, FastAPI). Zero dependencies.

Every provider signs webhooks differently (different headers, algorithms, encodings — some sign only part of the
body, Monnify's docs describe the wrong algorithm, Monnify sandbox doesn't sign at all). This library gets each one
right, tests it against the providers' own published examples, and gives you one event shape.

| Package | Install | Docs |
|---|---|---|
| JavaScript / TypeScript | `npm install africa-payments-webhooks` | [packages/js](packages/js#readme) |
| Python | `pip install africa-payments-webhooks` | [packages/python](packages/python#readme) |

📖 **Documentation:** https://evergreenesoftware.github.io/africa-payments-webhooks/ · 🧪 [Examples](examples)

```ts
import { fetchWebhook } from 'africa-payments-webhooks/web';

export const POST = fetchWebhook({
  provider: 'paystack',
  secret: process.env.PAYSTACK_SECRET_KEY!,
  onEvent: async (e) => { if (e.type === 'payment.succeeded') await markPaid(e.reference); },
});
```

## Feedback & support

- 💬 **Questions, ideas, "I'm using this in production"** → [GitHub Discussions](https://github.com/evergreenesoftware/africa-payments-webhooks/discussions)
- 🐞 **A genuine webhook doesn't verify, or a provider changed its docs** → [open an issue](https://github.com/evergreenesoftware/africa-payments-webhooks/issues/new/choose) (never paste real secrets)
- 🔒 **Security issue** → private report via the repo's *Security* tab
- ⭐ If it saved you time, a star helps other developers find it.

## Repository layout
```
packages/js       npm package (TypeScript, zero deps, ESM + CJS)
packages/python   PyPI package (zero deps; Django/Flask/FastAPI helpers)
fixtures/         official provider test vectors + cross-language fixtures shared by both test suites
docs/             documentation site (VitePress → GitHub Pages)
examples/         copy-paste examples per stack
```

## Status
v0.1 — 9 signing schemes across 8 providers. **verified** (official vector reproduces): Monnify, Nomba.
**documented**: Paystack, Flutterwave v3, Squad, Korapay, Fincra, Interswitch. **beta**: Flutterwave v4.
Planned: Squad virtual accounts, OPay, Paga, M-Pesa & MTN MoMo (unsigned-callback helpers).

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security: [SECURITY.md](SECURITY.md).

MIT © Evergreene Software LTD · Maintained by [Popoola Sinaayo](https://github.com/Popoola-Sinaayo).
