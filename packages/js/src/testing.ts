/**
 * Test helpers: build genuinely-signed webhook requests so you can unit-test your handlers without calling providers.
 * Never use these in production code paths.
 */
import { signFlutterwaveV3 } from './providers/flutterwave.js';
import { providers } from './providers/index.js';
import type { ProviderName } from './types.js';

export interface SignedTestRequest {
  body: string;
  headers: Record<string, string>;
}

/**
 * Serialise `payload` (or use it as-is if it's a string) and attach the signature header(s) the provider would send.
 * For Nomba, pass `timestamp` (RFC-3339) to control the signed `nomba-timestamp` header.
 * For Flutterwave, the v4 `flutterwave-signature` header is produced; pass `flutterwaveVersion: 'v3'` for `verif-hash`.
 */
export async function signTestPayload(
  provider: ProviderName,
  payload: unknown,
  secret: string,
  options: { timestamp?: string; flutterwaveVersion?: 'v3' | 'v4' } = {},
): Promise<SignedTestRequest> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (provider === 'flutterwave' && options.flutterwaveVersion === 'v3') {
    return { body, headers: { 'content-type': 'application/json', ...signFlutterwaveV3(secret) } };
  }
  const headers = await providers[provider].sign(body, secret, { timestamp: options.timestamp });
  return { body, headers: { 'content-type': 'application/json', ...headers } };
}
