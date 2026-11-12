import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verify } from '../src/index.js';

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const vectors = JSON.parse(readFileSync(`${fixturesDir}official-vectors.json`, 'utf8'));

describe('official provider test vectors', () => {
  it('Monnify: docs example reproduces exactly (HMAC-SHA512, lowercase hex)', async () => {
    const v = vectors.monnify;
    const body = readFileSync(`${fixturesDir}${v.bodyFile}`, 'utf8');
    const res = await verify('monnify', { rawBody: body, headers: { [v.header]: v.signature }, secret: v.secret });
    expect(res).toEqual({ ok: true, provider: 'monnify' });
  });

  it('Monnify: docs prose ("SHA-512(secret+body)") is NOT what the vector encodes', async () => {
    const v = vectors.monnify;
    const body = readFileSync(`${fixturesDir}${v.bodyFile}`, 'utf8');
    const { createHash } = await import('node:crypto');
    const prose = createHash('sha512')
      .update(v.secret + body)
      .digest('hex');
    expect(prose).not.toBe(v.signature);
  });

  for (const sigKey of ['signatureAsPublished', 'signatureComputed'] as const) {
    it(`Nomba: docs example verifies (${sigKey})`, async () => {
      const v = vectors.nomba;
      const res = await verify('nomba', {
        rawBody: JSON.stringify(v.payload),
        headers: { 'nomba-signature': v[sigKey], 'nomba-timestamp': v.timestamp },
        secret: v.secret,
        now: Date.parse(v.timestamp),
      });
      expect(res).toEqual({ ok: true, provider: 'nomba' });
    });
  }

  it('Nomba: the docs example is rejected once outside the replay window', async () => {
    const v = vectors.nomba;
    const res = await verify('nomba', {
      rawBody: JSON.stringify(v.payload),
      headers: { 'nomba-signature': v.signatureComputed, 'nomba-timestamp': v.timestamp },
      secret: v.secret,
      now: Date.parse(v.timestamp) + 301_000,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('timestamp_out_of_range');
  });
});
