import Stripe from 'stripe';
import { getConfig } from '../utils/config';

let client;

export async function getStripe() {
  if (client) return client;
  const { secretKey } = await getConfig('stripe');
  if (!secretKey) {
    throw new Error('Missing stripe secret key');
  }
  client = new Stripe(secretKey, { apiVersion: '2023-10-16' });
  return client;
}
