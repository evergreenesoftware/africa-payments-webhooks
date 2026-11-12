/**
 * AWS Lambda adapter (API Gateway REST v1, HTTP API v2, Lambda function URLs, ALB).
 *
 *   import { lambdaWebhook } from 'africa-payments-webhooks/lambda';
 *   export const handler = lambdaWebhook({ provider: 'squad', secret: process.env.SQUAD_SECRET_KEY!, onEvent });
 */
import { createWebhookHandler, type WebhookHandlerOptions } from '../handler.js';

export interface LambdaLikeEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined> | null;
  multiValueHeaders?: Record<string, string[] | undefined> | null;
  requestContext?: { identity?: { sourceIp?: string }; http?: { sourceIp?: string } };
}

export interface LambdaLikeResult {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function lambdaWebhook(opts: WebhookHandlerOptions) {
  const handle = createWebhookHandler(opts);
  return async function africaPaymentsWebhook(event: LambdaLikeEvent): Promise<LambdaLikeResult> {
    const body = event.body ?? '';
    const rawBody = event.isBase64Encoded ? base64ToBytes(body) : body;
    const headers: Record<string, string | string[] | undefined> = { ...(event.multiValueHeaders ?? {}), ...(event.headers ?? {}) };
    const sourceIp = event.requestContext?.http?.sourceIp ?? event.requestContext?.identity?.sourceIp;
    const result = await handle({ rawBody, headers, sourceIp });
    return { statusCode: result.status, body: result.body, headers: result.headers };
  };
}

export type { WebhookHandlerOptions };
