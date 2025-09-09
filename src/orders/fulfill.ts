import { OrderContext } from '../forms/schema';

export async function fulfill(ctx: OrderContext): Promise<void> {
  // Placeholder fulfillment logic
  console.log('fulfill', ctx.email, ctx.productId);
}
