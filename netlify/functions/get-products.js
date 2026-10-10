// GET /.netlify/functions/get-products
// Returns every active Stripe product that has an active one-time default price.
// Add or edit products in the Stripe Dashboard — they appear on the site automatically.
import Stripe from 'stripe';

// Metadata keys with a special meaning. Every other metadata key is shown
// on the product page as a specification (e.g. material, dimensions, finish).
const RESERVED_KEYS = new Set(['category', 'featured', 'order', 'hidden']);
const MAX_PRODUCTS = 1000;

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

  const secretKey = env('STRIPE_SECRET_KEY');
  if (!secretKey) return json({ error: 'The store is not configured yet: STRIPE_SECRET_KEY is missing.' }, 500);

  const stripe = new Stripe(secretKey);

  try {
    const products = [];
    for await (const item of stripe.products.list({ active: true, limit: 100, expand: ['data.default_price'] })) {
      const mapped = toProduct(item);
      if (mapped) products.push(mapped);
      if (products.length >= MAX_PRODUCTS) break;
    }

    // metadata.order (ascending) first, then newest products.
    products.sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return b.created - a.created;
    });

    return json({ products, count: products.length }, 200, {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      // Short CDN cache: new Stripe products appear within about 30 seconds.
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=30, stale-while-revalidate=60',
    });
  } catch (err) {
    console.error('get-products failed:', err && err.message);
    return json({ error: 'Products could not be loaded right now.' }, 502);
  }
};
