// POST /.netlify/functions/create-checkout
// Body: { "items": [{ "priceId": "price_XXXX", "quantity": 2 }, ...] }
// Every price is re-checked with Stripe, so the amount charged always comes from
// Stripe — never from the browser. Returns { url } for Stripe Hosted Checkout.
//
// Optional environment variables (Netlify > Site configuration > Environment variables):
//   STRIPE_SHIPPING_RATE_IDS   comma-separated Shipping Rate ids (shr_...) shown at checkout (max 5)
//   STRIPE_ALLOWED_COUNTRIES   comma-separated ISO country codes for delivery (default: GB)
//   STRIPE_AUTOMATIC_TAX       "true" to enable Stripe Tax (requires Stripe Tax to be set up)
import Stripe from 'stripe';

const MAX_LINE_ITEMS = 50;
const MAX_QUANTITY = 99;

function env(name) {
  try {
    if (typeof Netlify !== 'undefined' && Netlify.env) {
      const value = Netlify.env.get(name);
      if (value) return value;
    }
  } catch (_) { /* fall back to process.env */ }
  return process.env[name];
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function listFromEnv(name, fallback = []) {
  const raw = env(name);
  if (!raw) return fallback;
  return raw.split(',').map((value) => value.trim()).filter(Boolean);
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });

  const secretKey = env('STRIPE_SECRET_KEY');
  if (!secretKey) return json({ error: 'Checkout is not configured yet. Please contact us to complete your order.' }, 500);

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'Invalid request.' }, 400);
  }

  const items = Array.isArray(body && body.items) ? body.items : [];
  if (!items.length) return json({ error: 'Your basket is empty.' }, 400);
  if (items.length > MAX_LINE_ITEMS) return json({ error: 'Too many items in one order. Please contact us for large orders.' }, 400);

  // Validate and merge duplicate price ids.
  const quantities = new Map();
  for (const item of items) {
    const priceId = String((item && item.priceId) || '');
    const quantity = Math.floor(Number(item && item.quantity));
    if (!/^price_[A-Za-z0-9]+$/.test(priceId) || !(quantity >= 1 && quantity <= MAX_QUANTITY)) {
      return json({ error: 'Your basket contains an invalid item. Please refresh the page and try again.' }, 400);
    }
    quantities.set(priceId, Math.min(MAX_QUANTITY, (quantities.get(priceId) || 0) + quantity));
  }

  const stripe = new Stripe(secretKey);
  const priceIds = [...quantities.keys()];

  try {
    const prices = await Promise.all(
      priceIds.map((id) => stripe.prices.retrieve(id, { expand: ['product'] }).catch(() => null)),
    );

    const invalidPriceIds = [];
    const currencies = new Set();
    prices.forEach((price, index) => {
      const product = price && price.product;
      const available =
        price &&
        price.active &&
        price.type === 'one_time' &&
        typeof price.unit_amount === 'number' &&
        product &&
        typeof product === 'object' &&
        !product.deleted &&
        product.active &&
        String((product.metadata && product.metadata.hidden) || '').toLowerCase() !== 'true';
      if (available) currencies.add(price.currency);
      else invalidPriceIds.push(priceIds[index]);
    });

    if (invalidPriceIds.length) {
      return json({ error: 'Some items in your basket are no longer available.', invalidPriceIds }, 409);
    }
    if (currencies.size > 1) {
      return json({ error: 'Items priced in different currencies cannot be paid for together.' }, 400);
    }

    const origin = new URL(req.url).origin;
    const allowedCountries = listFromEnv('STRIPE_ALLOWED_COUNTRIES', ['GB']).map((code) => code.toUpperCase());
    const shippingRates = listFromEnv('STRIPE_SHIPPING_RATE_IDS').filter((id) => /^shr_[A-Za-z0-9]+$/.test(id)).slice(0, 5);

    const params = {
      mode: 'payment',
      line_items: priceIds.map((price) => ({ price, quantity: quantities.get(price) })),
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel.html`,
      shipping_address_collection: { allowed_countries: allowedCountries },
      phone_number_collection: { enabled: true },
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
      submit_type: 'pay',
      locale: 'en-GB',
      metadata: { source: 'website' },
    };

    if (shippingRates.length) {
      params.shipping_options = shippingRates.map((shipping_rate) => ({ shipping_rate }));
    }
    if (String(env('STRIPE_AUTOMATIC_TAX') || '').toLowerCase() === 'true') {
      params.automatic_tax = { enabled: true };
    }

    const session = await stripe.checkout.sessions.create(params);
    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout failed:', err && err.message);
    return json({ error: 'Checkout could not be started. Please try again in a moment.' }, 502);
  }
};
