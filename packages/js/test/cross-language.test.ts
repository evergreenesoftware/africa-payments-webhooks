import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build, SECRET, TIMESTAMP } from '../scripts/generate-cross-language-fixtures.js';
import { type ProviderName, verify } from '../src/index.js';

const target = fileURLToPath(new URL('../../../fixtures/cross-language.json', import.meta.url));

describe('cross-language fixtures (shared with the Python suite)', () => {
  it('fixture file is up to date with the JS implementation', async () => {
    const fresh = await build();
    if (!existsSync(target)) writeFileSync(target, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it('every case verifies', async () => {
    const fx = JSON.parse(readFileSync(target, 'utf8'));
    for (const [name, c] of Object.entries(fx.cases as Record<string, { body: string; headers: Record<string, string> }>)) {
      const provider = (name === 'flutterwave-v3' ? 'flutterwave' : name) as ProviderName;
      const r = await verify(provider, { rawBody: c.body, headers: c.headers, secret: SECRET, now: Date.parse(TIMESTAMP) });
      expect(r.ok, name).toBe(true);
    }
  });
});
