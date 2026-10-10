// GET /.netlify/functions/get-product?id=prod_XXXX
// Returns one active Stripe product with its default one-time price.
import Stripe from 'stripe';

const RESERVED_KEYS = new Set(['category', 'featured', 'order', 'hidden']);

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
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function prettifyKey(key) {
  const label = String(key).replace(/[_-]+/g, ' ').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function toProduct(product) {
  if (!product || product.deleted || !product.active) return null;
  const price = product.default_price && typeof product.default_price === 'object' ? product.default_price : null;
  if (!price || !price.active || price.type !== 'one_time' || typeof price.unit_amount !== 'number') return null;

  const meta = product.metadata || {};
  if (String(meta.hidden || '').trim().toLowerCase() === 'true') return null;

  const order = Number(meta.order);
  const specs = Object.entries(meta)
    .filter(([key, value]) => !RESERVED_KEYS.has(key.toLowerCase()) && !key.startsWith('_') && String(value).trim() !== '')
    .map(([key, value]) => ({ label: prettifyKey(key), value: String(value).trim() }));

  return {
    id: product.id,
    name: product.name,
    description: product.description || '',
    images: Array.isArray(product.images) ? product.images : [],
    category: String(meta.category || '').trim(),
    featured: String(meta.featured || '').trim().toLowerCase() === 'true',
    order: meta.order !== undefined && String(meta.order).trim() !== '' && Number.isFinite(order) ? order : null,
    priceId: price.id,
    unitAmount: price.unit_amount,
    currency: price.currency,
    specs,
    created: product.created,
  };
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^prod_[A-Za-z0-9]+$/.test(id)) return json({ error: 'A valid product id is required.' }, 400);

  const secretKey = env('STRIPE_SECRET_KEY');
  if (!secretKey) return json({ error: 'The store is not configured yet: STRIPE_SECRET_KEY is missing.' }, 500);

  const stripe = new Stripe(secretKey);

  try {
    const product = toProduct(await stripe.products.retrieve(id, { expand: ['default_price'] }));
    if (!product) return json({ error: 'This product is not available.' }, 404);

    return json({ product }, 200, {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=30, stale-while-revalidate=60',
      'Netlify-Vary': 'query=id',
    });
  } catch (err) {
    if (err && (err.code === 'resource_missing' || err.statusCode === 404)) {
      return json({ error: 'This product is not available.' }, 404);
    }
    console.error('get-product failed:', err && err.message);
    return json({ error: 'The product could not be loaded right now.' }, 502);
  }
};
