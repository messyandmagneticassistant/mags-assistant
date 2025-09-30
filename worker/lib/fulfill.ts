import { fulfill as doFulfill } from "../orders/fulfill";

export async function fulfill(ctx: any) {
  return doFulfill(ctx, ctx.env);
}
