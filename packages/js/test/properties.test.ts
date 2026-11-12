import { createHmac, randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hmac, timingSafeEqual } from '../src/crypto.js';
import { fromBase64, fromHex, toBase64, toHex } from '../src/encoding.js';
import { verify } from '../src/index.js';
import { extractTopLevelValue } from '../src/internal.js';
import { ipMatches } from '../src/ip.js';

describe('property-based tests', () => {
  it('Web Crypto HMAC equals node:crypto HMAC for arbitrary inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.uint8Array(),
        fc.constantFrom('SHA-256', 'SHA-512') as fc.Arbitrary<'SHA-256' | 'SHA-512'>,
        async (secret, data, alg) => {
          const ours = toHex(await hmac(alg, secret, data));
          const node = createHmac(alg === 'SHA-256' ? 'sha256' : 'sha512', secret)
            .update(data)
            .digest('hex');
          expect(ours).toBe(node);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('hex and base64 codecs round-trip and match Buffer', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        expect(toHex(bytes)).toBe(Buffer.from(bytes).toString('hex'));
        expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
        expect(fromHex(toHex(bytes))).toEqual(bytes);
        expect(fromHex(toHex(bytes).toUpperCase())).toEqual(bytes);
        expect(fromBase64(toBase64(bytes))).toEqual(bytes);
      }),
    );
  });

  it('decoders return null (never throw) on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const h = fromHex(s);
        const b = fromBase64(s);
        expect(h === null || h instanceof Uint8Array).toBe(true);
        expect(b === null || b instanceof Uint8Array).toBe(true);
      }),
    );
  });

  it('timingSafeEqual agrees with naive equality', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), fc.uint8Array({ maxLength: 64 }), (a, b) => {
        expect(timingSafeEqual(a, b)).toBe(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
      }),
    );
  });

  it('Paystack: sign→verify always passes; flipping any byte of the body always fails', async () => {
    const secret = randomBytes(16).toString('hex');
    await fc.assert(
      fc.asyncProperty(fc.json(), fc.nat(), async (json, pos) => {
        const sig = createHmac('sha512', secret).update(json).digest('hex');
        expect((await verify('paystack', { rawBody: json, headers: { 'x-paystack-signature': sig }, secret })).ok).toBe(true);
        const bytes = new TextEncoder().encode(json);
        if (bytes.length === 0) return;
        const flipped = bytes.slice();
        const i = pos % flipped.length;
        flipped[i] = (flipped[i] as number) ^ 0x01;
        expect((await verify('paystack', { rawBody: flipped, headers: { 'x-paystack-signature': sig }, secret })).ok).toBe(false);
      }),
      { numRuns: 150 },
    );
  });

  it('verify never throws on arbitrary header values', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (sig, body) => {
        for (const p of ['paystack', 'flutterwave', 'monnify', 'squad', 'korapay', 'fincra', 'interswitch', 'nomba'] as const) {
          const headers = {
            'x-paystack-signature': sig,
            'flutterwave-signature': sig,
            'monnify-signature': sig,
            'x-squad-encrypted-body': sig,
            'x-korapay-signature': sig,
            signature: sig,
            'x-interswitch-signature': sig,
            'nomba-signature': sig,
            'nomba-timestamp': sig,
          };
          const r = await verify(p, { rawBody: body, headers, secret: 's' });
          expect(r.ok).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('extractTopLevelValue returns exactly the original substring for any data value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (data, other) => {
        const dataText = JSON.stringify(data, null, 1);
        const doc = `{ "event": ${JSON.stringify(other)} , "data" : ${dataText} }`;
        expect(extractTopLevelValue(doc, 'data')).toBe(dataText);
      }),
    );
  });

  it('CIDR matching agrees with a reference for /0../32', () => {
    fc.assert(
      fc.property(fc.ipV4(), fc.ipV4(), fc.integer({ min: 0, max: 32 }), (ip, base, bits) => {
        const toInt = (a: string) => a.split('.').reduce((n, p) => n * 256 + Number(p), 0);
        const mask = bits === 0 ? 0 : 2 ** 32 - 2 ** (32 - bits);
        const expected = Math.floor(toInt(ip) / 2 ** (32 - bits)) === Math.floor(toInt(base) / 2 ** (32 - bits));
        void mask;
        expect(ipMatches(ip, [`${base}/${bits}`])).toBe(expected);
      }),
    );
  });
});
