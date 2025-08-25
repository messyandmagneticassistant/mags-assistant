import { tgSend } from '../../../../lib/telegram';
import { logEmailFallback } from '../../../../utils/order-log';

export interface OrderInfo {
  id: string;
  email: string;
  [key: string]: any;
}

export async function generateEmailForOrder(order: OrderInfo) {
  return `Order ${order.id} confirmation`;
}

export async function sendEmail(to: string, body: string) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('Missing SENDGRID_API_KEY');
  const url = 'https://api.sendgrid.com/v3/mail/send';
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: 'noreply@example.com' },
    subject: 'Order Confirmation',
    content: [{ type: 'text/plain', value: body }],
  };
  await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function ensureTelegramWebhook(
  order: OrderInfo,
  deps: {
    sendTelegram?: typeof tgSend;
    emailSender?: typeof sendEmail;
    logger?: typeof logEmailFallback;
  } = {}
) {
  const sendTelegram = deps.sendTelegram || tgSend;
  const emailSender = deps.emailSender || sendEmail;
  const logger = deps.logger || logEmailFallback;
  const tgResp = await sendTelegram(`New order ${order.id}`);
  if (!tgResp.ok) {
    const body = await generateEmailForOrder(order);
    await emailSender(order.email, body);
    await logger(order.email, order.id, 'sent');
    return { fallback: true };
  }
  return { fallback: false };
}
