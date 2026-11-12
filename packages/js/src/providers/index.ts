import type { ProviderName } from '../types.js';
import { fincra } from './fincra.js';
import { flutterwave } from './flutterwave.js';
import { interswitch } from './interswitch.js';
import { korapay } from './korapay.js';
import { monnify } from './monnify.js';
import { nomba } from './nomba.js';
import { paystack } from './paystack.js';
import type { Provider } from './shared.js';
import { squad } from './squad.js';

export const providers: Record<ProviderName, Provider> = {
  paystack,
  flutterwave,
  monnify,
  squad,
  korapay,
  fincra,
  interswitch,
  nomba,
};

export type { Provider, ProviderStatus } from './shared.js';
