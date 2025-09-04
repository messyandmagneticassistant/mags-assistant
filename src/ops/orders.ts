import { sendReply } from './email';

export async function handle(job: any, env: any) {
  if (job.kind === 'fulfill_order') {
    const evt = await env.BRAIN.get(`stripe:evt:${job.id}`, { type: 'json' });
    if (!evt) return;
    const email = evt.data?.object?.customer_email || evt.data?.object?.receipt_email;
    const body = `Thank you for your order of ${evt.data?.object?.amount_total}`;
    await sendReply(env, { to: email, subject: 'Order received', text: body });
  }
  if (job.kind === 'process_form') {
    const evt = await env.BRAIN.get(`tally:evt:${job.id}`, { type: 'json' });
    if (!evt) return;
    const email = evt.data?.email;
    const body = 'Thanks for your submission';
    await sendReply(env, { to: email, subject: 'Form received', text: body });
  }
}
