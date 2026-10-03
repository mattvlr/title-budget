/**
 * Storefront Shopping Cart System
 * Client-side cart management with cookie synchronization for a vintage shop Flask app
 * Uses Bootstrap 5.3.2 and Bootstrap Icons
 */

// Module-level cart storage (not localStorage)
let cartData = [];

/**
 * Parse cart data from cookie
 * @returns {Array} Array of {item_id, quantity} objects
 */
function parseCartCookie() {
  const cookieStr = document.cookie
    .split('; ')
    .find(row => row.startsWith('cart_data='));

  if (!cookieStr) return [];

  try {
    const encoded = cookieStr.split('=')[1];
    const decoded = decodeURIComponent(encoded);
    return JSON.parse(decoded);
  } catch (e) {
    console.error('Failed to parse cart cookie:', e);
    return [];
  }
}

/**
 * Serialize cart to cookie
 * Stores as JSON, URL-encoded, with path=/
 */
function syncCartToCookie() {
  const serialized = JSON.stringify(cartData);
  const encoded = encodeURIComponent(serialized);
  document.cookie = `cart_data=${encoded}; path=/; SameSite=Lax`;
}

/**
 * Get current cart
 * @returns {Array} Array of {item_id, quantity} objects
 */
function getCart() {
  return cartData;
}

/**
 * Add item to cart or increment quantity
 * Shows toast notification on success
 * @param {number} itemId - Item ID
 * @param {number} quantity - Quantity to add
 * @param {string} itemName - Item name for display
 * @param {number} itemPrice - Item price
 * @param {string} itemPhoto - Photo URL
 * @param {string} itemSku - SKU
 * @param {number} maxQty - Maximum allowed quantity (optional)
 */
function addToCart(itemId, quantity, itemName, itemPrice, itemPhoto, itemSku, maxQty = 999) {
  quantity = parseInt(quantity) || 1;

  // Find existing cart item
  const existingItem = cartData.find(item => item.item_id === itemId);

  if (existingItem) {
    const newQty = existingItem.quantity + quantity;
    existingItem.quantity = Math.min(newQty, maxQty);
  } else {
    cartData.push({
      item_id: itemId,
      quantity: Math.min(quantity, maxQty)
    });
  }

  syncCartToCookie();
  updateCartBadge();
  refreshCartDrawer();
  showAddToCartToast(itemName);
}

/**
 * Remove item from cart
 * @param {number} itemId - Item ID to remove
 */
function removeFromCart(itemId) {
  cartData = cartData.filter(item => item.item_id !== itemId);
  syncCartToCookie();
  updateCartBadge();
  refreshCartDrawer();
}

/**
 * Update quantity of item in cart
 * @param {number} itemId - Item ID
 * @param {number} newQty - New quantity (0 removes item)
 */
function updateQuantity(itemId, newQty) {
  newQty = parseInt(newQty) || 0;

  if (newQty <= 0) {
    removeFromCart(itemId);
  } else {
    const item = cartData.find(i => i.item_id === itemId);
    if (item) {
      item.quantity = newQty;
      syncCartToCookie();
      updateCartBadge();
      refreshCartDrawer();
    }
  }
}

/**
 * Clear entire cart
 */
function clearCart() {
  cartData = [];
  syncCartToCookie();
  updateCartBadge();
  refreshCartDrawer();
}

/**
 * Get total item count in cart
 * @returns {number} Total quantity of all items
 */
function getCartCount() {
  return cartData.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Update cart badge in header
 * Updates element with id="cartBadge"
 */
function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;

  const count = getCartCount();
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * Show toast notification for added item
 * @param {string} itemName - Name of added item
 */
function showAddToCartToast(itemName) {
  const toastHtml = `
    <div class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1060;">
      <div class="toast align-items-center text-white bg-success border-0" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body">
            <i class="bi bi-check-circle me-2"></i>
            <strong>Added to cart</strong><br>
            <small>${escapeHtml(itemName)}</small>
            <a href="/shop/cart" class="btn btn-sm btn-light ms-2">View Cart</a>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    </div>
  `;

  const toastContainer = document.createElement('div');
  toastContainer.innerHTML = toastHtml;
  document.body.appendChild(toastContainer);

  const toastEl = toastContainer.querySelector('.toast');
  const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
  toast.show();

  // Cleanup after toast is hidden
  toastEl.addEventListener('hidden.bs.toast', () => {
    toastContainer.remove();
  });
}

/**
 * Escape HTML special characters for safe display
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show/toggle cart drawer
 */
function toggleCartDrawer() {
  const drawer = document.getElementById('cartDrawer');
  if (!drawer) {
    createCartDrawer();
    return;
  }

  const isVisible = drawer.classList.contains('show');
  if (isVisible) {
    closeCartDrawer();
  } else {
    openCartDrawer();
  }
}

/**
 * Open cart drawer
 */
function openCartDrawer() {
  const drawer = document.getElementById('cartDrawer');
  if (!drawer) {
    createCartDrawer();
    return;
  }

  refreshCartDrawer();
  drawer.classList.add('show');
  const backdrop = document.getElementById('cartDrawerBackdrop');
  if (backdrop) {
    backdrop.classList.add('show');
  }
}

/**
 * Close cart drawer
 */
function closeCartDrawer() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('cartDrawerBackdrop');

  if (drawer) drawer.classList.remove('show');
  if (backdrop) backdrop.classList.remove('show');
}

/**
 * Create cart drawer HTML structure
 */
function createCartDrawer() {
  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'cartDrawerBackdrop';
  backdrop.className = 'cart-drawer-backdrop';
  backdrop.addEventListener('click', closeCartDrawer);
  document.body.appendChild(backdrop);

  // Create drawer
  const drawer = document.createElement('div');
  drawer.id = 'cartDrawer';
  drawer.className = 'cart-drawer';
  drawer.innerHTML = `
    <div class="cart-drawer-header">
      <h5 class="mb-0">Shopping Cart</h5>
      <button type="button" class="btn-close" aria-label="Close" onclick="closeCartDrawer()"></button>
    </div>
    <div class="cart-drawer-body"></div>
    <div class="cart-drawer-footer">
      <div class="cart-drawer-subtotal mb-3">
        <div class="d-flex justify-content-between mb-2">
          <span>Subtotal:</span>
          <strong id="cartSubtotal">$0.00</strong>
        </div>
      </div>
      <a href="/shop/cart" class="btn btn-primary w-100 mb-2">View Cart</a>
      <button type="button" class="btn btn-outline-secondary w-100" onclick="closeCartDrawer()">Continue Shopping</button>
    </div>
  `;
  document.body.appendChild(drawer);

  refreshCartDrawer();
  drawer.classList.add('show');
  backdrop.classList.add('show');
}

/**
 * Refresh cart drawer contents
 */
function renderCartDrawerItems(items) {
  let subtotal = 0;
  let itemsHtml = '';

  items.forEach(item => {
    const itemId = parseInt(item.item_id, 10);
    const qty = parseInt(item.quantity, 10) || 0;
    const itemName = item.name || 'Item';
    const itemPrice = parseFloat(item.price) || 0;
    const itemPhoto = item.photo_url || '';
    const itemUrl = item.item_url || '/shop/cart';
    const warningHtml = item.warning
      ? `<div class="small text-danger mt-1"><i class="bi bi-exclamation-triangle"></i> ${escapeHtml(item.warning)}</div>`
      : '';

    subtotal += itemPrice * qty;

    const photoHtml = itemPhoto
      ? `<img src="${escapeHtml(itemPhoto)}" alt="${escapeHtml(itemName)}" class="cart-item-thumbnail">`
      : '<div class="cart-item-thumbnail bg-light d-flex align-items-center justify-content-center"><i class="bi bi-image text-muted"></i></div>';

    itemsHtml += `
      <div class="cart-item">
        <div class="cart-item-photo">
          ${photoHtml}
        </div>
        <div class="cart-item-details">
          <h6 class="mb-1"><a href="${escapeHtml(itemUrl)}" class="text-decoration-none text-reset">${escapeHtml(itemName)}</a></h6>
          <p class="cart-item-price mb-2">$${itemPrice.toFixed(2)}</p>
          ${warningHtml}
          <div class="cart-item-controls">
            <div class="input-group input-group-sm w-auto">
              <button class="btn btn-outline-secondary" type="button" onclick="updateQuantity(${itemId}, ${qty - 1})">
                <i class="bi bi-dash"></i>
              </button>
              <input type="text" class="form-control text-center" value="${qty}" readonly style="width: 40px;">
              <button class="btn btn-outline-secondary" type="button" onclick="updateQuantity(${itemId}, ${qty + 1})">
                <i class="bi bi-plus"></i>
              </button>
            </div>
            <button class="btn btn-sm btn-link text-danger" type="button" onclick="removeFromCart(${itemId})">
              Remove
            </button>
          </div>
        </div>
      </div>
    `;
  });

  return {
    itemsHtml,
    subtotal,
  };
}

function refreshCartDrawer() {
  const drawer = document.getElementById('cartDrawer');
  if (!drawer) return;

  const body = drawer.querySelector('.cart-drawer-body');
  const cart = getCart();

  if (cart.length === 0) {
    body.innerHTML = '<p class="text-center text-muted py-4">Your cart is empty</p>';
    document.getElementById('cartSubtotal').textContent = '$0.00';
    return;
  }

  body.innerHTML = '<p class="text-center text-muted py-4">Loading cart...</p>';

  fetch('/api/storefront/cart', {
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json'
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Cart request failed: ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => {
      const items = Array.isArray(payload.items) ? payload.items : [];
      cartData = items.map((item) => ({
        item_id: parseInt(item.item_id, 10),
        quantity: parseInt(item.quantity, 10) || 0
      })).filter((item) => item.item_id && item.quantity > 0);
      syncCartToCookie();
      updateCartBadge();

      if (items.length === 0) {
        body.innerHTML = '<p class="text-center text-muted py-4">Your cart is empty</p>';
        document.getElementById('cartSubtotal').textContent = '$0.00';
        return;
      }

      const rendered = renderCartDrawerItems(items);
      body.innerHTML = rendered.itemsHtml;
      document.getElementById('cartSubtotal').textContent = `$${rendered.subtotal.toFixed(2)}`;
    })
    .catch((error) => {
      console.error('Failed to refresh cart drawer:', error);
      body.innerHTML = '<p class="text-center text-muted py-4">Could not load cart details.</p>';
      document.getElementById('cartSubtotal').textContent = '$0.00';
    });
}

/**
 * Attach click handlers to "Add to Cart" buttons
 * Looks for elements with class "js-add-to-cart"
 */
function initAddToCartButtons() {
  const buttons = document.querySelectorAll('.js-add-to-cart');

  buttons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();

      const itemId = parseInt(button.dataset.itemId);
      const itemName = button.dataset.itemName;
      const itemPrice = parseFloat(button.dataset.itemPrice);
      const itemPhoto = button.dataset.itemPhoto;
      const itemSku = button.dataset.itemSku;
      const maxQty = parseInt(button.dataset.maxQty) || 999;

      // Find quantity input in the same form/parent
      const form = button.closest('form') || button.parentElement;
      const quantityInput = form ? form.querySelector('input[name="quantity"]') : null;
      const quantity = quantityInput ? parseInt(quantityInput.value) || 1 : 1;

      addToCart(itemId, quantity, itemName, itemPrice, itemPhoto, itemSku, maxQty);
    });
  });
}

/**
 * Initialize cart system on page load
 */
function initCart() {
  // Load cart from cookie
  cartData = parseCartCookie();

  // Initialize cart badge
  updateCartBadge();

  // Attach click handlers to add-to-cart buttons
  initAddToCartButtons();

  // Attach cart icon click handler
  const cartIcon = document.querySelector('[data-bs-toggle="cart-drawer"], .js-cart-toggle, [onclick*="toggleCartDrawer"]');
  if (cartIcon && !cartIcon.hasListener) {
    cartIcon.addEventListener('click', (e) => {
      e.preventDefault();
      toggleCartDrawer();
    });
    cartIcon.hasListener = true;
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCart);
} else {
  initCart();
}
