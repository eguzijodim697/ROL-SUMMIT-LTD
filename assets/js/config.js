/* ROL SUMMIT LTD — store settings (safe to edit).
   Your Stripe SECRET key never goes here: add it in Netlify as the
   environment variable STRIPE_SECRET_KEY. Stripe Hosted Checkout does not
   need the publishable key, so it is optional. */
window.STORE_CONFIG = {
  storeName: 'ROL SUMMIT LTD',
  currency: 'gbp',
  locale: 'en-GB',
  apiBase: '/.netlify/functions',

  // Number of products in "Selected pieces" on the home page.
  // Products with metadata featured=true are shown first.
  featuredCount: 4,

  // Highest quantity of one product a customer can add to the basket.
  maxQuantityPerItem: 10,

  cartStorageKey: 'rolsummit_cart_v1',

  // 'cover' fills the image frame (lifestyle photos).
  // 'contain' shows the whole product with space around it (cut-out photos on white).
  productImageFit: 'cover',

  contact: {
    email: 'info@rolsummit.shop',
    phone: '07828 722036',
    phoneHref: '+447828722036',
    address: '84 Wood Lane, London, W12 0BZ, United Kingdom'
  },

  // Optional (pk_live_... or pk_test_...). Not required for Stripe Hosted Checkout.
  stripePublishableKey: ''
};
