/* ============================================================
   Vintage Store Inventory — Client-side JS
   ============================================================ */

// ---------- Error Pill Toast ----------
(function () {
    var _pillTimer = null;

    /**
     * Show the floating error pill at the bottom of the screen.
     * @param {string} msg  - Text to display.
     * @param {string} type - 'error' (default, red), 'warn' (orange), 'info' (blue), 'success' (green).
     * @param {number} ms   - Auto-dismiss after N ms. 0 = manual dismiss only.
     */
    window.showPill = function (msg, type, ms) {
        var pill = document.getElementById('errorPill');
        var text = document.getElementById('errorPillMsg');
        if (!pill || !text) return;

        // Clear any pending dismiss
        if (_pillTimer) { clearTimeout(_pillTimer); _pillTimer = null; }

        text.textContent = msg || 'Something went wrong';
        pill.className = 'error-pill';
        if (type === 'warn')    pill.classList.add('error-pill--warn');
        if (type === 'info')    pill.classList.add('error-pill--info');
        if (type === 'success') pill.classList.add('error-pill--success');

        // Force reflow so transition runs even if already visible
        void pill.offsetWidth;
        pill.classList.add('show');

        var timeout = (ms !== undefined) ? ms : 6000;
        if (timeout > 0) {
            _pillTimer = setTimeout(function () { window._dismissPill(); }, timeout);
        }
    };

    window._dismissPill = function () {
        var pill = document.getElementById('errorPill');
        if (pill) pill.classList.remove('show');
        if (_pillTimer) { clearTimeout(_pillTimer); _pillTimer = null; }
    };
})();


// ---------- Sidebar Toggle (Mobile) ----------
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('show');
}

// Close sidebar when clicking outside on mobile
document.addEventListener('click', function (e) {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.sidebar-toggle');
    if (sidebar && sidebar.classList.contains('show') &&
        !sidebar.contains(e.target) && (!toggle || !toggle.contains(e.target))) {
        sidebar.classList.remove('show');
    }
});

function getCsrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
}

function ensureCsrfField(form) {
    if (!form || (form.method || '').toUpperCase() !== 'POST') return;
    if (form.querySelector('input[name="_csrf_token"]')) return;

    var token = getCsrfToken();
    if (!token) return;

    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = '_csrf_token';
    input.value = token;
    form.appendChild(input);
}

function csrfSafeMethod(method) {
    return ['GET', 'HEAD', 'OPTIONS', 'TRACE'].indexOf((method || '').toUpperCase()) !== -1;
}

// ---------- Global Search ----------
(function () {
    const input = document.getElementById('globalSearch');
    const results = document.getElementById('searchResults');
    if (!input || !results) return;

    let debounceTimer;

    input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        const q = this.value.trim();

        if (q.length < 2) {
            results.classList.remove('show');
            results.innerHTML = '';
            return;
        }

        debounceTimer = setTimeout(function () {
            fetch('/api/search?q=' + encodeURIComponent(q))
                .then(function (r) {
                    if (!r.ok) throw new Error('Search failed');
                    return r.json();
                })
                .then(function (items) {
                    if (items.length === 0) {
                        results.innerHTML = '<div class="p-3 text-muted small">No results found.</div>';
                        results.classList.add('show');
                        return;
                    }

                    results.innerHTML = items.map(function (item) {
                        return '<a class="search-result-item" href="/items/' + item.id + '">' +
                            '<strong>' + escapeHtml(item.name) + '</strong>' +
                            '<br><small class="text-muted">' + escapeHtml(item.sku) +
                            ' · $' + item.price.toFixed(2) +
                            ' · ' + escapeHtml(item.status) + '</small>' +
                            '</a>';
                    }).join('');
                    results.classList.add('show');
                })
                .catch(function () {
                    results.classList.remove('show');
                    showPill('Search is temporarily unavailable', 'warn', 4000);
                });
        }, 250);
    });

    // Hide results when clicking outside
    document.addEventListener('click', function (e) {
        if (!input.contains(e.target) && !results.contains(e.target)) {
            results.classList.remove('show');
        }
    });

    // Navigate with keyboard
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            results.classList.remove('show');
            input.blur();
        }
    });
})();

// ---------- Helpers ----------
function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---------- Auto-dismiss flash messages ----------
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('form').forEach(ensureCsrfField);

    if (window.bootstrap && bootstrap.Tooltip) {
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(function (el) {
            bootstrap.Tooltip.getOrCreateInstance(el);
        });
    }

    // Auto-dismiss flash banners: success/info after 5s, warnings/errors after 8s.
    document.querySelectorAll('.flash-container .alert').forEach(function (alert) {
        var isError = alert.classList.contains('alert-danger') || alert.classList.contains('alert-warning');
        setTimeout(function () {
            var bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
            bsAlert.close();
        }, isError ? 8000 : 5000);
    });
});

// ---------- Same-origin Fetch CSRF + Global Error Handling ----------
(function () {
    var originalFetch = window.fetch;
    if (!originalFetch) return;

    window.fetch = function (input, init) {
        init = init || {};
        var method = (init.method || 'GET').toUpperCase();
        if (!csrfSafeMethod(method)) {
            var headers = new Headers(init.headers || {});
            if (!headers.has('X-CSRF-Token')) {
                var token = getCsrfToken();
                if (token) headers.set('X-CSRF-Token', token);
            }
            init.headers = headers;
        }
        return originalFetch(input, init).catch(function (err) {
            showPill('Network error — check your connection', 'error', 6000);
            throw err; // re-throw so callers can still handle it
        });
    };
})();

// ---------- Global Uncaught Error Handler ----------
window.addEventListener('unhandledrejection', function (e) {
    // Only show pill for genuine runtime errors, not user-aborted fetches
    if (e.reason && e.reason.name === 'AbortError') return;
    console.error('Unhandled promise rejection:', e.reason);
    showPill('Something went wrong — please try again', 'error', 6000);
});
