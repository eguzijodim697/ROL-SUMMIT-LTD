/* ROL SUMMIT LTD — storefront script (vanilla JS, no dependencies).
   Products load live from Stripe through Netlify Functions; the basket is kept
   in the browser and paid for in one Stripe Hosted Checkout session. */
(() => {
  'use strict';

  const CFG = window.STORE_CONFIG || {};
  const API = String(CFG.apiBase || '/.netlify/functions').replace(/\/$/, '');
  const CART_KEY = CFG.cartStorageKey || 'rolsummit_cart_v1';
  const MAX_QTY = Math.max(1, Number(CFG.maxQuantityPerItem) || 10);
  const LOCALE = CFG.locale || 'en-GB';
  const DEFAULT_CURRENCY = String(CFG.currency || 'gbp').toLowerCase();
  const CONTACT_EMAIL = (CFG.contact && CFG.contact.email) || 'info@rolsummit.shop';

  if (CFG.productImageFit === 'contain') document.documentElement.classList.add('fit-contain');

  /* ---------- Helpers ---------- */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
  const toMajor = (amount, currency) => (ZERO_DECIMAL.has(String(currency).toLowerCase()) ? amount : amount / 100);
  function formatPrice(amount, currency = DEFAULT_CURRENCY) {
    const code = String(currency || DEFAULT_CURRENCY).toUpperCase();
    try {
      return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code }).format(toMajor(amount, code));
    } catch (_) {
      return `${toMajor(amount, code).toFixed(2)} ${code}`;
    }
  }

  const productUrl = (id) => `product.html?id=${encodeURIComponent(id)}`;
  const pluralPieces = (n) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

  const MARK_SVG = '<svg viewBox="0 0 34 20" aria-hidden="true" focusable="false"><path d="M1.5 18.5 11.5 4l5.5 7.5L22.5 2l10 16.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  async function fetchJSON(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (_) {
      const error = new Error('Network error');
      error.status = 0;
      throw error;
    }
    let data = null;
    try { data = await response.json(); } catch (_) { /* not JSON */ }
    if (!response.ok) {
      const error = new Error((data && data.error) || `Request failed (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  /* ---------- Products (live from Stripe) ---------- */
  const productIndex = new Map();
  let productsPromise = null;

  function getProducts() {
    if (!productsPromise) {
      productsPromise = fetchJSON(`${API}/get-products`)
        .then((data) => {
          const list = Array.isArray(data && data.products) ? data.products : [];
          list.forEach((product) => productIndex.set(product.id, product));
          fillFooterCategories(list);
          return list;
        })
        .catch((error) => {
          productsPromise = null;
          throw error;
        });
    }
    return productsPromise;
  }

  async function getProduct(id) {
    const data = await fetchJSON(`${API}/get-product?id=${encodeURIComponent(id)}`);
    if (data && data.product) productIndex.set(data.product.id, data.product);
    return data && data.product;
  }

  function uniqueCategories(products) {
    const map = new Map();
    products.forEach((p) => { if (p.category) map.set(p.category.toLowerCase(), p.category); });
    return [...map.values()].sort((a, b) => a.localeCompare(b, LOCALE));
  }

  function fillFooterCategories(products) {
    const list = $('[data-footer-categories]');
    if (!list || list.dataset.filled) return;
    const categories = uniqueCategories(products).slice(0, 5);
    if (!categories.length) return;
    list.insertAdjacentHTML('beforeend', categories
      .map((c) => `<li><a href="products.html?category=${encodeURIComponent(c)}">${esc(c)}</a></li>`)
      .join(''));
    list.dataset.filled = 'true';
  }

  /* ---------- Basket ---------- */
  const clampQty = (value) => Math.max(1, Math.min(MAX_QTY, Math.floor(Number(value)) || 1));
  const snapshot = (p) => ({
    productId: p.id,
    priceId: p.priceId,
    name: p.name,
    image: (p.images && p.images[0]) || '',
    unitAmount: p.unitAmount,
    currency: p.currency,
  });
  const isValidItem = (i) => i && typeof i.priceId === 'string' && /^price_/.test(i.priceId) &&
    Number.isInteger(i.quantity) && i.quantity > 0 && Number.isFinite(i.unitAmount);

  const Cart = {
    items: [],
    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        this.items = Array.isArray(raw) ? raw.filter(isValidItem) : [];
      } catch (_) {
        this.items = [];
      }
    },
    save() {
      try { localStorage.setItem(CART_KEY, JSON.stringify(this.items)); } catch (_) { /* storage unavailable */ }
      renderCart();
    },
    find(priceId) { return this.items.find((i) => i.priceId === priceId); },
    add(product, quantity = 1) {
      const existing = this.find(product.priceId);
      if (!existing && this.items.length && this.items[0].currency !== product.currency) return { ok: false, reason: 'currency' };
      if (existing) {
        if (existing.quantity >= MAX_QTY) return { ok: false, reason: 'max' };
        Object.assign(existing, snapshot(product));
        existing.quantity = Math.min(MAX_QTY, existing.quantity + clampQty(quantity));
      } else {
        this.items.push({ ...snapshot(product), quantity: clampQty(quantity) });
      }
      this.save();
      return { ok: true };
    },
    setQuantity(priceId, quantity) {
      const item = this.find(priceId);
      if (!item) return;
      if (quantity < 1) { this.remove(priceId); return; }
      item.quantity = Math.min(MAX_QTY, Math.floor(quantity));
      this.save();
    },
    remove(priceId) {
      this.items = this.items.filter((i) => i.priceId !== priceId);
      this.save();
    },
    clear() {
      this.items = [];
      this.save();
    },
    count() { return this.items.reduce((sum, i) => sum + i.quantity, 0); },
    subtotal() { return this.items.reduce((sum, i) => sum + i.unitAmount * i.quantity, 0); },
    currency() { return this.items[0] ? this.items[0].currency : DEFAULT_CURRENCY; },
  };

  function addToCart(product, quantity = 1) {
    const result = Cart.add(product, quantity);
    if (result.ok) {
      $$('[data-cart-count]').forEach((el) => {
        el.classList.remove('is-bumped');
        void el.offsetWidth; // restart the animation
        el.classList.add('is-bumped');
      });
      toast(`${product.name} added to your basket.`, 'info', { label: 'View basket', onClick: openCart });
    } else if (result.reason === 'max') {
      toast(`You can order up to ${MAX_QTY} of this piece online. For larger quantities, please contact us.`, 'error');
    } else if (result.reason === 'currency') {
      toast('This piece is priced in a different currency from your basket. Please check out your current basket first.', 'error');
    }
    return result.ok;
  }

  /* ---------- Basket drawer ---------- */
  const drawer = $('[data-cart-drawer]');
  const overlay = $('[data-cart-overlay]');
  let lastFocused = null;

  function renderCart() {
    const count = Cart.count();
    $$('[data-cart-count]').forEach((el) => { el.textContent = String(count); });
    const headerButton = $('.cart-button');
    if (headerButton) headerButton.setAttribute('aria-label', `Open basket, ${count} ${count === 1 ? 'item' : 'items'}`);
    if (!drawer) return;

    const list = $('[data-cart-items]', drawer);
    const foot = $('[data-cart-foot]', drawer);

    if (!Cart.items.length) {
      list.innerHTML = `
        <div class="cart-empty">
          <p class="cart-empty-title">Your basket is empty</p>
          <p class="muted">Explore the collection to find something with character.</p>
          <a class="btn btn-secondary" href="products.html">Shop the collection</a>
        </div>`;
      foot.hidden = true;
      return;
    }

    foot.hidden = false;
    list.innerHTML = `<ul class="cart-list">${Cart.items.map((item) => `
      <li class="cart-item" data-price-id="${esc(item.priceId)}">
        <a class="cart-thumb" href="${productUrl(item.productId)}" tabindex="-1" aria-hidden="true">
          ${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : `<span class="media-fallback">${MARK_SVG}</span>`}
        </a>
        <div>
          <div class="cart-item-top">
            <a class="cart-item-name" href="${productUrl(item.productId)}">${esc(item.name)}</a>
            <span class="cart-item-price">${formatPrice(item.unitAmount * item.quantity, item.currency)}</span>
          </div>
          <p class="cart-item-unit">${formatPrice(item.unitAmount, item.currency)} each</p>
          <div class="cart-item-actions">
            <div class="qty qty-sm" role="group" aria-label="Quantity of ${esc(item.name)}">
              <button type="button" data-qty-dec aria-label="Decrease quantity" ${item.quantity <= 1 ? 'disabled' : ''}>&minus;</button>
              <span class="qty-value">${item.quantity}</span>
              <button type="button" data-qty-inc aria-label="Increase quantity" ${item.quantity >= MAX_QTY ? 'disabled' : ''}>+</button>
            </div>
            <button type="button" class="link-button" data-remove>Remove<span class="sr-only"> ${esc(item.name)}</span></button>
          </div>
        </div>
      </li>`).join('')}</ul>`;

    $('[data-cart-subtotal]', drawer).textContent = formatPrice(Cart.subtotal(), Cart.currency());
  }

  function onCartClick(event) {
    const row = event.target.closest('[data-price-id]');
    if (!row) return;
    const priceId = row.dataset.priceId;
    const item = Cart.find(priceId);
    if (!item) return;

    let focusTarget = null;
    if (event.target.closest('[data-qty-inc]')) {
      Cart.setQuantity(priceId, item.quantity + 1);
      focusTarget = '[data-qty-inc]';
    } else if (event.target.closest('[data-qty-dec]')) {
      Cart.setQuantity(priceId, item.quantity - 1);
      focusTarget = '[data-qty-dec]';
    } else if (event.target.closest('[data-remove]')) {
      Cart.remove(priceId);
    } else {
      return;
    }

    // Re-rendering replaces the buttons, so put keyboard focus back where it was.
    const sameRow = $$('[data-price-id]', drawer).find((el) => el.dataset.priceId === priceId);
    const next = sameRow && focusTarget ? $(focusTarget, sameRow) : null;
    if (next && !next.disabled) next.focus();
    else {
      const fallback = (sameRow && $('[data-remove]', sameRow)) || $('[data-cart-items] a, [data-cart-items] button', drawer) || $('[data-cart-close]', drawer);
      if (fallback) fallback.focus();
    }
  }

  function openCart() {
    if (!drawer) return;
    closeMenu();
    lastFocused = document.activeElement;
    renderCart();
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    window.setTimeout(() => { const close = $('[data-cart-close]', drawer); if (close) close.focus(); }, 60);
  }

  function closeCart() {
    if (!drawer || !drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('is-visible');
    window.setTimeout(() => { if (!drawer.classList.contains('is-open')) overlay.hidden = true; }, 320);
    document.body.classList.remove('no-scroll');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || !drawer || !drawer.classList.contains('is-open')) return;
    const focusable = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', drawer)
      .filter((el) => el.offsetParent !== null && el.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /* ---------- Checkout (Stripe Hosted Checkout) ---------- */
  async function checkout(button) {
    if (!Cart.items.length || button.disabled) return;
    if (!button.dataset.label) button.dataset.label = button.textContent.trim();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Opening secure checkout…';

    try {
      const data = await fetchJSON(`${API}/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: Cart.items.map((i) => ({ priceId: i.priceId, quantity: i.quantity })) }),
      });
      if (data && data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('Checkout URL missing');
    } catch (error) {
      const invalid = error.data && Array.isArray(error.data.invalidPriceIds) ? error.data.invalidPriceIds : [];
      if (invalid.length) {
        invalid.forEach((id) => Cart.remove(id));
        toast('Some pieces are no longer available and have been removed from your basket. Please review it and try again.', 'error');
      } else if (error.status === 0) {
        toast('Checkout could not be opened. Check your internet connection and try again.', 'error');
      } else {
        toast((error.data && error.data.error) || 'Checkout could not be opened. Please try again in a moment.', 'error');
      }
      resetCheckoutButtons();
    }
  }

  function resetCheckoutButtons() {
    $$('[data-checkout]').forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.label) button.textContent = button.dataset.label;
    });
  }

  /* ---------- Toasts ---------- */
  function toast(message, type = 'info', action) {
    const region = $('[data-toasts]');
    if (!region) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('p');
    text.textContent = message;
    el.appendChild(text);

    const dismiss = () => {
      el.classList.remove('is-visible');
      window.setTimeout(() => el.remove(), 300);
    };
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = action.label;
      button.addEventListener('click', () => { dismiss(); action.onClick(); });
      el.appendChild(button);
    }
    region.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    window.setTimeout(dismiss, type === 'error' ? 7000 : 4500);
  }

  /* ---------- Header & navigation ---------- */
  const menuToggle = $('[data-menu-toggle]');
  const siteNav = $('#site-nav');

  function closeMenu() {
    if (!menuToggle || !siteNav) return;
    menuToggle.setAttribute('aria-expanded', 'false');
    siteNav.classList.remove('is-open');
    const label = $('.sr-only', menuToggle);
    if (label) label.textContent = 'Open menu';
  }

  function initHeader() {
    const header = $('[data-header]');
    if (header) {
      const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    if (menuToggle && siteNav) {
      menuToggle.addEventListener('click', () => {
        const open = menuToggle.getAttribute('aria-expanded') === 'true';
        menuToggle.setAttribute('aria-expanded', String(!open));
        siteNav.classList.toggle('is-open', !open);
        const label = $('.sr-only', menuToggle);
        if (label) label.textContent = open ? 'Open menu' : 'Close menu';
      });
      siteNav.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
    }
    const page = document.body.dataset.page;
    const navKey = page === 'product' ? 'products' : page;
    $$('[data-nav]').forEach((link) => { if (link.dataset.nav === navKey) link.setAttribute('aria-current', 'page'); });
    $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
  }

  /* ---------- Rendering ---------- */
  function skeletonCards(count) {
    return Array.from({ length: count }, () => `
      <div class="product-card skeleton" aria-hidden="true">
        <div class="product-media"></div>
        <div class="product-info"><div class="sk-line w-40"></div><div class="sk-line w-70"></div><div class="sk-line w-25"></div></div>
      </div>`).join('');
  }

  function stateHTML(title, text, action = '') {
    return `<div class="state"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
  }

  function cardHTML(p) {
    const [first, second] = p.images || [];
    const url = productUrl(p.id);
    return `
      <article class="product-card">
        <a class="product-media${second ? ' has-alt' : ''}" href="${url}" tabindex="-1" aria-hidden="true">
          ${first ? `<img class="img-primary" src="${esc(first)}" alt="" loading="lazy" decoding="async">` : `<span class="media-fallback">${MARK_SVG}</span>`}
          ${second ? `<img class="img-secondary" src="${esc(second)}" alt="" loading="lazy" decoding="async">` : ''}
        </a>
        <div class="product-info">
          ${p.category ? `<p class="product-cat">${esc(p.category)}</p>` : ''}
          <h3 class="product-name"><a href="${url}">${esc(p.name)}</a></h3>
          <p class="product-price">${formatPrice(p.unitAmount, p.currency)}</p>
        </div>
        <button class="btn btn-secondary btn-sm product-add" type="button" data-add-to-cart="${esc(p.id)}">Add to basket<span class="sr-only">: ${esc(p.name)}</span></button>
      </article>`;
  }

  const retryButton = '<button class="btn btn-secondary" type="button" data-retry>Try again</button>';

  /* ---------- Home ---------- */
  async function initHome() {
    const grid = $('[data-featured-grid]');
    if (!grid) return;
    const count = Math.max(1, Number(CFG.featuredCount) || 4);
    grid.innerHTML = skeletonCards(count);
    grid.setAttribute('aria-busy', 'true');

    try {
      const products = await getProducts();
      const featured = [...products.filter((p) => p.featured), ...products.filter((p) => !p.featured)].slice(0, count);
      grid.innerHTML = featured.length
        ? featured.map(cardHTML).join('')
        : stateHTML('New pieces are on their way', 'The collection is being updated. Please check back soon, or contact us to ask about a specific piece.', '<a class="btn btn-secondary" href="contact.html">Contact us</a>');
      setupHero(products);
    } catch (_) {
      grid.innerHTML = stateHTML('The collection could not be loaded', 'Check your internet connection and try again.', retryButton);
      $('[data-retry]', grid).addEventListener('click', initHome);
    } finally {
      grid.removeAttribute('aria-busy');
    }
  }

  function setupHero(products) {
    const frame = $('[data-hero-frame]');
    if (!frame || $('img', frame)) return;
    const pick = products.find((p) => p.featured && p.images.length) || products.find((p) => p.images.length);
    if (!pick) return;

    const img = new Image();
    img.alt = pick.name;
    img.decoding = 'async';
    img.onload = () => {
      frame.appendChild(img);
      const art = $('.peak-art', frame);
      if (art) art.setAttribute('aria-hidden', 'true');
      requestAnimationFrame(() => img.classList.add('is-loaded'));
    };
    img.src = pick.images[0];

    const caption = $('[data-hero-caption]');
    if (caption) {
      caption.href = productUrl(pick.id);
      $('[data-hero-caption-name]', caption).textContent = pick.name;
      $('[data-hero-caption-meta]', caption).textContent = formatPrice(pick.unitAmount, pick.currency);
    }
  }

  /* ---------- Collection ---------- */
  const SORTS = ['featured', 'newest', 'price-asc', 'price-desc'];

  async function initProducts() {
    const grid = $('[data-products-grid]');
    if (!grid) return;
    const chips = $('[data-filters]');
    const sortSelect = $('[data-sort]');
    const countEl = $('[data-count]');

    const params = new URLSearchParams(window.location.search);
    const state = {
      category: params.get('category') || 'all',
      sort: SORTS.includes(params.get('sort')) ? params.get('sort') : 'featured',
    };
    sortSelect.value = state.sort;
    countEl.textContent = 'Loading the collection…';
    grid.innerHTML = skeletonCards(8);
    grid.setAttribute('aria-busy', 'true');

    let products;
    try {
      products = await getProducts();
    } catch (_) {
      grid.innerHTML = stateHTML('The collection could not be loaded', 'Check your internet connection and try again.', retryButton);
      $('[data-retry]', grid).addEventListener('click', initProducts);
      countEl.textContent = '';
      grid.removeAttribute('aria-busy');
      return;
    }
    grid.removeAttribute('aria-busy');

    const categories = uniqueCategories(products);
    if (state.category !== 'all') {
      state.category = categories.find((c) => c.toLowerCase() === state.category.toLowerCase()) || 'all';
    }
    if (categories.length) {
      chips.innerHTML = ['all', ...categories]
        .map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="false">${c === 'all' ? 'All pieces' : esc(c)}</button>`)
        .join('');
      chips.hidden = false;
    }

    const apply = () => {
      const list = state.category === 'all'
        ? products.slice()
        : products.filter((p) => p.category.toLowerCase() === state.category.toLowerCase());

      if (state.sort === 'featured') list.sort((a, b) => Number(b.featured) - Number(a.featured));
      else if (state.sort === 'newest') list.sort((a, b) => b.created - a.created);
      else if (state.sort === 'price-asc') list.sort((a, b) => a.unitAmount - b.unitAmount);
      else if (state.sort === 'price-desc') list.sort((a, b) => b.unitAmount - a.unitAmount);

      if (list.length) grid.innerHTML = list.map(cardHTML).join('');
      else if (products.length) grid.innerHTML = stateHTML('Nothing in this category yet', 'New pieces are added regularly. View the full collection in the meantime.', '<button class="btn btn-secondary" type="button" data-cat="all">View all pieces</button>');
      else grid.innerHTML = stateHTML('New pieces are on their way', 'The collection is being updated. Please check back soon, or contact us to ask about a specific piece.', '<a class="btn btn-secondary" href="contact.html">Contact us</a>');

      $$('[data-cat]', chips).forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cat === state.category)));
      countEl.textContent = state.category === 'all' ? pluralPieces(list.length) : `${pluralPieces(list.length)} in ${state.category}`;

      const query = new URLSearchParams();
      if (state.category !== 'all') query.set('category', state.category);
      if (state.sort !== 'featured') query.set('sort', state.sort);
      const qs = query.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    };

    const onCategory = (event) => {
      const button = event.target.closest('[data-cat]');
      if (!button) return;
      state.category = button.dataset.cat;
      apply();
    };
    chips.onclick = onCategory;
    grid.onclick = (event) => { if (event.target.closest('.state [data-cat]')) onCategory(event); };
    sortSelect.onchange = () => { state.sort = sortSelect.value; apply(); };
    apply();
  }

  /* ---------- Product page ---------- */
  async function initProduct() {
    const root = $('[data-product-root]');
    if (!root) return;
    const id = new URLSearchParams(window.location.search).get('id') || '';
    if (!/^prod_[A-Za-z0-9]+$/.test(id)) { renderProductMissing(root); return; }

    try {
      const product = await getProduct(id);
      if (!product) { renderProductMissing(root); return; }
      renderProduct(root, product);
      loadRelated(product);
    } catch (error) {
      if (error.status === 404 || error.status === 400) { renderProductMissing(root); return; }
      root.removeAttribute('aria-busy');
      root.innerHTML = stateHTML('This piece could not be loaded', 'Check your internet connection and try again.', retryButton);
      $('[data-retry]', root).addEventListener('click', () => window.location.reload());
    }
  }

  function renderProductMissing(root) {
    root.removeAttribute('aria-busy');
    document.title = 'Piece not available | ROL SUMMIT LTD';
    root.innerHTML = stateHTML('This piece is not available', 'It may have sold out or been removed from the collection. Explore the pieces that are available now.', '<a class="btn btn-primary" href="products.html">Back to the collection</a>');
  }

  const ICONS = {
    delivery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5h11v10h-11z"/><path d="M13.5 9.5h4l3 3.2v3.8h-7"/><circle cx="6.5" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>',
    returns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 9.5h10a5 5 0 0 1 0 10H9"/><path d="M8 5.5l-3.5 4 3.5 4"/></svg>',
    secure: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>',
  };

  function renderProduct(root, p) {
    const images = Array.isArray(p.images) ? p.images : [];
    document.title = `${p.name} | ROL SUMMIT LTD`;
    const metaDescription = $('meta[name="description"]');
    if (metaDescription) metaDescription.setAttribute('content', (p.description || `${p.name} — contemporary design from ROL SUMMIT LTD.`).slice(0, 155));

    const crumbs = $('[data-breadcrumb]');
    if (crumbs) {
      crumbs.insertAdjacentHTML('beforeend',
        `${p.category ? `<li><a href="products.html?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a></li>` : ''}<li aria-current="page">${esc(p.name)}</li>`);
    }

    const description = p.description
      ? p.description.split(/\n\s*\n/).map((para) => `<p>${esc(para.trim()).replace(/\n/g, '<br>')}</p>`).join('')
      : '';
    const specs = Array.isArray(p.specs) && p.specs.length
      ? `<details open><summary>Specifications</summary><div class="acc-body"><dl class="specs">${p.specs.map((s) => `<dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd>`).join('')}</dl></div></details>`
      : '';

    root.removeAttribute('aria-busy');
    root.innerHTML = `
      <div class="pd-gallery">
        <div class="gallery-main">
          ${images.length ? `<img src="${esc(images[0])}" alt="${esc(p.name)}" data-main-image>` : `<span class="media-fallback">${MARK_SVG}</span>`}
        </div>
        ${images.length > 1 ? `<ul class="thumbs" aria-label="More images">${images.map((src, i) => `
          <li><button type="button" class="thumb" data-thumb="${i}" aria-label="Show image ${i + 1} of ${images.length}" aria-current="${i === 0}">
            <img src="${esc(src)}" alt="" loading="lazy">
          </button></li>`).join('')}</ul>` : ''}
      </div>
      <div class="pd-info">
        ${p.category ? `<a class="pd-cat" href="products.html?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a>` : ''}
        <h1 class="pd-title">${esc(p.name)}</h1>
        <p class="pd-price">${formatPrice(p.unitAmount, p.currency)}</p>
        ${description ? `<div class="pd-desc">${description}</div>` : ''}
        <div class="pd-buy">
          <div class="qty" role="group" aria-label="Quantity">
            <button type="button" data-pd-dec aria-label="Decrease quantity" disabled>&minus;</button>
            <input type="number" inputmode="numeric" min="1" max="${MAX_QTY}" value="1" aria-label="Quantity" data-pd-qty>
            <button type="button" data-pd-inc aria-label="Increase quantity" ${MAX_QTY <= 1 ? 'disabled' : ''}>+</button>
          </div>
          <button type="button" class="btn btn-primary" data-pd-add>Add to basket</button>
        </div>
        <ul class="pd-assurances">
          <li>${ICONS.delivery}<span>Delivered across the UK</span></li>
          <li>${ICONS.returns}<span>14-day returns on eligible items</span></li>
          <li>${ICONS.secure}<span>Secure checkout powered by Stripe</span></li>
        </ul>
        <div class="accordion">
          ${specs}
          <details><summary>Delivery</summary><div class="acc-body">
            <p>We deliver to addresses across the United Kingdom. Most orders are dispatched within 3–5 working days and arrive 2–5 working days after dispatch.</p>
            <p>Larger furniture may need a scheduled delivery, in which case we will contact you to arrange a convenient date. Any delivery charge is shown at checkout before you pay.</p>
          </div></details>
          <details><summary>Returns</summary><div class="acc-body">
            <p>Changed your mind? You can cancel within 14 days of delivery and return the piece unused and in its original packaging.</p>
            <p>Full details are in our <a href="refund.html">refund policy</a>. Your statutory rights are not affected.</p>
          </div></details>
          <details><summary>Care</summary><div class="acc-body">
            <p>Dust with a soft, dry cloth. Avoid harsh cleaning products, prolonged direct sunlight and placing hot or wet items directly on surfaces.</p>
            <p>Natural materials such as wood and stone vary in grain, tone and texture, so each piece is slightly individual.</p>
          </div></details>
        </div>
      </div>`;

    // Gallery
    const main = $('[data-main-image]', root);
    $$('[data-thumb]', root).forEach((thumb) => {
      thumb.addEventListener('click', () => {
        const index = Number(thumb.dataset.thumb);
        if (main) main.src = images[index];
        $$('[data-thumb]', root).forEach((t) => t.setAttribute('aria-current', String(t === thumb)));
      });
    });

    // Quantity
    const input = $('[data-pd-qty]', root);
    const dec = $('[data-pd-dec]', root);
    const inc = $('[data-pd-inc]', root);
    const sync = (value) => {
      const qty = clampQty(value);
      input.value = String(qty);
      dec.disabled = qty <= 1;
      inc.disabled = qty >= MAX_QTY;
      return qty;
    };
    dec.addEventListener('click', () => sync(Number(input.value) - 1));
    inc.addEventListener('click', () => sync(Number(input.value) + 1));
    input.addEventListener('change', () => sync(input.value));

    $('[data-pd-add]', root).addEventListener('click', () => {
      if (addToCart(p, sync(input.value))) sync(1);
    });

    // Structured data for search engines
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description: p.description || undefined,
      image: images.length ? images : undefined,
      category: p.category || undefined,
      brand: { '@type': 'Brand', name: 'ROL SUMMIT' },
      offers: {
        '@type': 'Offer',
        price: toMajor(p.unitAmount, p.currency).toFixed(ZERO_DECIMAL.has(String(p.currency).toLowerCase()) ? 0 : 2),
        priceCurrency: String(p.currency).toUpperCase(),
        availability: 'https://schema.org/InStock',
        url: window.location.href,
      },
    });
    document.head.appendChild(ld);
  }

  async function loadRelated(product) {
    const section = $('[data-related]');
    const grid = $('[data-related-grid]');
    if (!section || !grid) return;
    try {
      const all = await getProducts();
      const others = all.filter((p) => p.id !== product.id);
      const sameCategory = product.category ? others.filter((p) => p.category.toLowerCase() === product.category.toLowerCase()) : [];
      const picks = [...sameCategory, ...others.filter((p) => !sameCategory.includes(p))].slice(0, 4);
      if (!picks.length) return;
      grid.innerHTML = picks.map(cardHTML).join('');
      section.hidden = false;
    } catch (_) { /* related pieces are optional */ }
  }

  /* ---------- Success page ---------- */
  function initSuccess() {
    const sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
    if (/^cs_/.test(sessionId)) Cart.clear();
  }

  /* ---------- Contact form (Netlify Forms) ---------- */
  function initContact() {
    const form = $('[data-contact-form]');
    if (!form) return;
    const status = $('[data-form-status]', form);
    const setStatus = (type, message) => {
      status.className = `form-status is-${type}`;
      status.textContent = message;
    };

    if (new URLSearchParams(window.location.search).get('sent') === '1') {
      setStatus('success', 'Message sent. Thank you — we will reply within one working day.');
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const button = $('button[type="submit"]', form);
      const label = button.textContent;
      button.disabled = true;
      button.textContent = 'Sending…';
      status.textContent = '';
      try {
        const response = await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(new FormData(form)).toString(),
        });
        if (!response.ok) throw new Error(String(response.status));
        form.reset();
        setStatus('success', 'Message sent. Thank you — we will reply within one working day.');
      } catch (_) {
        setStatus('error', `Your message could not be sent. Please try again or email us at ${CONTACT_EMAIL}.`);
      } finally {
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  /* ---------- Global events & start-up ---------- */
  function bindGlobalEvents() {
    document.addEventListener('click', (event) => {
      const addButton = event.target.closest('[data-add-to-cart]');
      if (addButton) {
        const product = productIndex.get(addButton.dataset.addToCart);
        if (product) addToCart(product, 1);
        return;
      }
      if (event.target.closest('[data-cart-open]')) { event.preventDefault(); openCart(); return; }
      if (event.target.closest('[data-cart-close]') || event.target.closest('[data-cart-overlay]')) { closeCart(); return; }
      const checkoutButton = event.target.closest('[data-checkout]');
      if (checkoutButton) checkout(checkoutButton);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeCart(); closeMenu(); }
      trapFocus(event);
    });

    if (drawer) $('[data-cart-items]', drawer).addEventListener('click', onCartClick);

    // Keep the basket in sync across tabs.
    window.addEventListener('storage', (event) => {
      if (event.key === CART_KEY) { Cart.load(); renderCart(); }
    });

    // Returning with the browser back button from Stripe Checkout.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) { Cart.load(); renderCart(); resetCheckoutButtons(); }
    });
  }

  function init() {
    Cart.load();
    initHeader();
    bindGlobalEvents();
    renderCart();

    const pages = {
      home: initHome,
      products: initProducts,
      product: initProduct,
      success: initSuccess,
      contact: initContact,
    };
    const start = pages[document.body.dataset.page];
    if (start) start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
