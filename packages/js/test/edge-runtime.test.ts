/**
 * Proves the built bundle runs in a Web-standard-only runtime (no Node.js APIs), like Vercel Edge / Cloudflare Workers.
 * Requires `npm run build` first; skipped when dist/ is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EdgeVM } from '@edge-runtime/vm';
import { describe, expect, it } from 'vitest';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const hasDist = existsSync(`${distDir}index.cjs`);

/** Bundle the CJS build into a single script with a tiny require() shim limited to the dist folder. */
function loadIntoVm(vm: EdgeVM, entry: string) {
  const modules: Record<string, string> = {};
  const collect = (file: string) => {
    if (modules[file]) return;
    const code = readFileSync(`${distDir}${file}`, 'utf8');
    modules[file] = code;
    for (const m of code.matchAll(/require\("\.\/([^"]+)"\)/g)) collect(m[1] as string);
  };
  collect(entry);
  const forbidden = Object.values(modules).some((c) => /require\("node:|require\("(crypto|buffer|fs)"\)/.test(c));
  expect(forbidden, 'bundle must not require Node built-ins').toBe(false);
  const defs = Object.entries(modules)
    .map(([f, c]) => `${JSON.stringify(f)}: function (module, exports, require) {\n${c}\n}`)
    .join(',\n');
  vm.evaluate(`
    var __mods = {${defs}}; var __cache = {};
    function __req(name) { var f = name.replace(/^\\.\\//, ''); if (__cache[f]) return __cache[f].exports;
      var m = { exports: {} }; __cache[f] = m; __mods[f](m, m.exports, __req); return m.exports; }
    globalThis.__lib = __req(${JSON.stringify(entry)});
  `);
}

describe.skipIf(!hasDist)('edge runtime (Web APIs only)', () => {
  it('verifies the official Monnify vector and serves a fetch handler', async () => {
    const vm = new EdgeVM();
    loadIntoVm(vm, 'index.cjs');
    const vectors = JSON.parse(readFileSync(`${fixturesDir}official-vectors.json`, 'utf8'));
    const body = readFileSync(`${fixturesDir}monnify-official-body.json`, 'utf8');
    const v = vectors.monnify;
    const ok = await vm.evaluate(
      `__lib.verify('monnify', { rawBody: ${JSON.stringify(body)}, headers: new Headers({ 'monnify-signature': ${JSON.stringify(v.signature)} }), secret: ${JSON.stringify(v.secret)} }).then(r => r.ok)`,
    );
    expect(ok).toBe(true);
    expect(vm.evaluate('typeof process === "undefined" || typeof require === "undefined"')).toBe(true);
  });
});
