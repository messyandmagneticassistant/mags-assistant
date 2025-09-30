type OrderContext = {
  email?: string;
  productId?: string;
  [key: string]: any;
};

export async function fulfill(order: OrderContext, env: any) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key || !order.productId) return;

  try {
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', 'https://maggie.messyandmagnetic.com/downloads');
    params.append('cancel_url', 'https://maggie.messyandmagnetic.com/');
    params.append('line_items[0][price]', order.productId);
    params.append('line_items[0][quantity]', '1');

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data: any = await res.json().catch(() => ({}));
    if (data?.url) {
      await env.BRAIN.put(
        `checkout:${order.email}`,
        JSON.stringify({ url: data.url, productId: order.productId, created: Date.now() })
      );
    }
  } catch (e) {
    console.log('[fulfill] error', e);
  }
}
