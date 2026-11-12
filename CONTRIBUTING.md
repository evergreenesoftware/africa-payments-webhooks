# Contributing

Thanks for helping! This library is only as good as its knowledge of each provider.

## Development
```sh
npm install
npm test          # JS tests (Vitest)
npm run typecheck
npm run lint
npm run build
cd packages/python && pip install -e '.[dev]' && pytest   # Python
```

## Adding or fixing a provider
1. Link the provider's **official** webhook-signature documentation in the PR.
2. Implement `verify`, `parse` and `sign` in `packages/js/src/providers/<name>.ts` (and the Python equivalent).
3. Status rules:
   - **verified** — add the provider's *published* test vector to `fixtures/official-vectors.json`; it must reproduce.
   - **documented** — the docs are unambiguous but publish no vector.
   - **beta** — the docs are ambiguous or inconsistent.
   A real sandbox webhook (with secrets rotated/redacted afterwards!) can also promote a provider to verified.
4. Add tests: independent `node:crypto` reference signature, tampering, wrong secret, missing/malformed header, parse mapping.
5. Never include real secrets, customer data or code from an employer in fixtures.

## Releases
We use [Changesets](https://github.com/changesets/changesets): run `npx changeset` in your PR to describe the change.
To release, a maintainer runs `npx changeset version` locally, commits and pushes to `main`; the Release workflow then
publishes the new version to npm (trusted publishing with provenance). The workflow never commits or opens PRs.
Python: bump `packages/python/pyproject.toml`, commit, and push a `py-vX.Y.Z` tag.
