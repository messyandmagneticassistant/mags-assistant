import Stripe from 'stripe';
import { getConfig } from '../../utils/config';

export async function getStripe() {
  const { secretKey } = await getConfig('stripe');
  if (!secretKey) {
    throw new Error('Missing stripe secret key');
  }
  return new Stripe(secretKey, { apiVersion: '2023-10-16' });
}
