import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectProvider, parse } from '../src/index.js';

const fixturesDir = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

describe('parse → normalised PaymentEvent (samples based on provider docs)', () => {
  it('Paystack charge.success (amount in kobo)', () => {
    const e = parse(
      'paystack',
      JSON.stringify({
        event: 'charge.success',
        data: {
          id: 690075529,
          reference: 'nms6uvr1pl',
          amount: 20000,
          currency: 'NGN',
          status: 'success',
          paid_at: '2020-05-19T12:30:56.000Z',
          customer: { email: 'a@b.co' },
        },
      }),
    );
    expect(e).toMatchObject({
      id: 'paystack:charge.success:690075529:success',
      type: 'payment.succeeded',
      reference: 'nms6uvr1pl',
      providerReference: '690075529',
      amount: { value: 20000, unit: 'minor', currency: 'NGN' },
      customer: { email: 'a@b.co' },
      occurredAt: '2020-05-19T12:30:56.000Z',
    });
  });

  it('Flutterwave v3 charge.completed (major units; status decides success)', () => {
    const base = {
      event: 'charge.completed',
      data: {
        id: 285959875,
        tx_ref: 'Links-616626414629',
        amount: 100,
        currency: 'NGN',
        status: 'successful',
        created_at: '2020-07-06T19:17:04.000Z',
      },
    };
    expect(parse('flutterwave', JSON.stringify(base))).toMatchObject({
      type: 'payment.succeeded',
      reference: 'Links-616626414629',
      amount: { value: 100, unit: 'major' },
    });
    const failed = { ...base, data: { ...base.data, status: 'failed' } };
    expect(parse('flutterwave', JSON.stringify(failed)).type).toBe('payment.failed');
  });

  it('Flutterwave v3 transfer.completed with string amount', () => {
    const e = parse(
      'flutterwave',
      JSON.stringify({
        event: 'transfer.completed',
        data: { id: 33286, reference: 'tr1', amount: '100.10', currency: 'USD', status: 'SUCCESSFUL' },
      }),
    );
    expect(e).toMatchObject({ type: 'transfer.succeeded', amount: { value: 100.1, unit: 'major', currency: 'USD' } });
  });

  it('Flutterwave v4 charge.completed', () => {
    const e = parse(
      'flutterwave',
      JSON.stringify({
        id: 'wbk_1',
        type: 'charge.completed',
        timestamp: 1735116884019,
        data: { id: 'chg_1', reference: 'ref-1', amount: 10, currency: 'NGN', status: 'succeeded' },
      }),
    );
    expect(e).toMatchObject({
      type: 'payment.succeeded',
      reference: 'ref-1',
      providerReference: 'chg_1',
      occurredAt: new Date(1735116884019).toISOString(),
    });
  });

  it('Monnify official webhook body', () => {
    const e = parse('monnify', readFileSync(`${fixturesDir}monnify-official-body.json`, 'utf8'));
    expect(e).toMatchObject({
      type: 'payment.succeeded',
      reference: '0.01462001097368737',
      providerReference: 'MNFY|76|20211117154810|000001',
      amount: { value: 78000, unit: 'major', currency: 'NGN' },
      status: 'PAID',
      customer: { name: 'Mockaroo Jesse' },
      occurredAt: '17/11/2021 3:48:10 PM',
    });
  });

  it('Squad charge_successful (kobo)', () => {
    const e = parse(
      'squad',
      JSON.stringify({
        Event: 'charge_successful',
        TransactionRef: 'SQTEST1',
        Body: {
          amount: 10000,
          gateway_ref: 'g1',
          transaction_status: 'Success',
          email: 'x@y.z',
          currency: 'NGN',
          created_at: '2025-08-24T15:26:38.994',
        },
      }),
    );
    expect(e).toMatchObject({
      type: 'payment.succeeded',
      reference: 'SQTEST1',
      amount: { value: 10000, unit: 'minor' },
      occurredAt: '2025-08-24T15:26:38.994',
    });
  });

  it('Korapay charge.failed', () => {
    expect(
      parse(
        'korapay',
        JSON.stringify({ event: 'charge.failed', data: { reference: 'K1', amount: 150.99, currency: 'NGN', status: 'failed' } }),
      ),
    ).toMatchObject({
      type: 'payment.failed',
      amount: { value: 150.99, unit: 'major' },
    });
  });

  it('Fincra payout.failed', () => {
    const e = parse(
      'fincra',
      JSON.stringify({
        event: 'payout.failed',
        data: { id: 9, reference: 'p1', customerReference: 'mine-1', amountCharged: 1000, sourceCurrency: 'NGN', status: 'failed' },
      }),
    );
    expect(e).toMatchObject({ type: 'transfer.failed', reference: 'mine-1', amount: { value: 1000, currency: 'NGN' } });
  });

  it('Interswitch TRANSACTION.COMPLETED uses responseCode and numeric currency', () => {
    const body = (rc: string) =>
      JSON.stringify({
        event: 'TRANSACTION.COMPLETED',
        uuid: 'u1',
        timestamp: 1594646111460,
        data: { paymentReference: 'FBN|1', merchantReference: 'm1', amount: 12000, currencyCode: '566', responseCode: rc },
      });
    expect(parse('interswitch', body('00'))).toMatchObject({
      type: 'payment.succeeded',
      amount: { value: 12000, currency: 'NGN' },
      reference: 'm1',
    });
    expect(parse('interswitch', body('Z1')).type).toBe('payment.failed');
  });

  it('Nomba payment_success (virtual account)', () => {
    const e = parse(
      'nomba',
      JSON.stringify({
        event_type: 'payment_success',
        requestId: 'r',
        data: {
          transaction: {
            transactionId: 'API-VACT',
            type: 'vact_transfer',
            transactionAmount: 120,
            aliasAccountReference: 'acc-ref',
            time: '2026-02-06T10:21:56Z',
            responseCode: '',
          },
          customer: { senderName: 'JOHN GRASS' },
        },
      }),
    );
    expect(e).toMatchObject({
      type: 'payment.succeeded',
      reference: 'acc-ref',
      amount: { value: 120, unit: 'major', currency: 'NGN' },
      customer: { name: 'JOHN GRASS' },
    });
    expect(e.status).toBeUndefined();
  });

  it('unknown events never throw and keep the raw payload', () => {
    const raw = { event: 'customeridentification.failed', data: { customer_code: 'C1' } };
    const e = parse('paystack', JSON.stringify(raw));
    expect(e.type).toBe('unknown');
    expect(e.raw).toEqual(raw);
  });

  it('non-JSON body throws SyntaxError', () => {
    expect(() => parse('paystack', 'not json')).toThrow(SyntaxError);
  });
});

describe('detectProvider', () => {
  it.each([
    ['x-paystack-signature', 'paystack'],
    ['flutterwave-signature', 'flutterwave'],
    ['verif-hash', 'flutterwave'],
    ['monnify-signature', 'monnify'],
    ['x-squad-encrypted-body', 'squad'],
    ['x-korapay-signature', 'korapay'],
    ['X-Interswitch-Signature', 'interswitch'],
    ['nomba-signature', 'nomba'],
  ])('%s → %s', (header, provider) => {
    expect(detectProvider({ [header]: 'x' })).toBe(provider);
  });
  it('returns undefined for unknown/generic headers (e.g. Fincra "signature")', () => {
    expect(detectProvider({ signature: 'x' })).toBeUndefined();
  });
});
