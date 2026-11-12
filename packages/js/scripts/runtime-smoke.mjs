// Runtime smoke test for Bun / Deno / Node: verifies the official Monnify and Nomba vectors using the BUILT package.
import { readFileSync } from 'node:fs';
import { parse, verify } from '../dist/index.js';

const fixtures = new URL('../../../fixtures/', import.meta.url);
const vectors = JSON.parse(readFileSync(new URL('official-vectors.json', fixtures), 'utf8'));
const body = readFileSync(new URL('monnify-official-body.json', fixtures), 'utf8');

const m = await verify('monnify', {
  rawBody: body,
  headers: { 'monnify-signature': vectors.monnify.signature },
  secret: vectors.monnify.secret,
});
const n = vectors.nomba;
const nb = await verify('nomba', {
  rawBody: JSON.stringify(n.payload),
  headers: { 'nomba-signature': n.signatureComputed, 'nomba-timestamp': n.timestamp },
  secret: n.secret,
  now: Date.parse(n.timestamp),
});
const runtime = globalThis.Bun ? 'bun' : globalThis.Deno ? 'deno' : 'node';
if (!m.ok || !nb.ok || parse('monnify', body).type !== 'payment.succeeded') {
  console.error(`[${runtime}] FAILED`, m, nb);
  throw new Error('runtime smoke test failed');
}
console.log(`[${runtime}] ok: monnify + nomba official vectors verified`);
