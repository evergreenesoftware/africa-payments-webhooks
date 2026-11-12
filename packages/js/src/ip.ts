/** Minimal IPv4 / IPv4-CIDR allowlist matching (IPv6 addresses are compared exactly). */

function ipv4ToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const v = Number(p);
    if (v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

/** Strip IPv4-mapped IPv6 prefix and whitespace, e.g. "::ffff:52.31.139.75" → "52.31.139.75". */
export function normaliseIp(ip: string): string {
  const s = ip.trim();
  return s.startsWith('::ffff:') ? s.slice(7) : s;
}

export function ipMatches(ip: string, allow: readonly string[]): boolean {
  const addr = normaliseIp(ip);
  const n = ipv4ToInt(addr);
  for (const entry of allow) {
    const e = entry.trim();
    if (e.includes('/')) {
      const [base, bitsStr] = e.split('/');
      const bits = Number(bitsStr);
      const b = base === undefined ? undefined : ipv4ToInt(base);
      if (n === undefined || b === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((n & mask) >>> 0 === (b & mask) >>> 0) return true;
    } else if (normaliseIp(e) === addr) {
      return true;
    }
  }
  return false;
}
