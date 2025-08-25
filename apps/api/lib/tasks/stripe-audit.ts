import { planStripeSync } from "../../../../lib/stripe-sync";
import type { TaskResult } from "./index";

export async function stripeAudit(): Promise<TaskResult> {
  try {
    const plan = await planStripeSync();
    const msg = `${plan.summary.toCreate} create / ${plan.summary.toUpdate} update`;
    return { name: "stripe.audit", ok: true, msg };
  } catch (err: any) {
    return { name: "stripe.audit", ok: false, msg: err?.message || String(err) };
  }
}
