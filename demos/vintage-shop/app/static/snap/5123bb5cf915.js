
// Remove-background row buttons
document.addEventListener('click', function(ev) {
var btn = ev.target.closest('.js-remove-bg');
if (!btn) return;
ev.preventDefault();
var itemId = parseInt(btn.dataset.itemId, 10);
if (!itemId || !window.RemoveBg) return;
window.RemoveBg.start(itemId);
});
// Bulk selection
var selectAll = document.getElementById('selectAll');
var bulkBar = document.getElementById('bulkBar');
if (selectAll) {
selectAll.addEventListener('change', function() {
document.querySelectorAll('.bulk-check').forEach(function(cb) { cb.checked = selectAll.checked; });
updateBulkBar();
});
document.querySelectorAll('.bulk-check').forEach(function(cb) {
cb.addEventListener('change', updateBulkBar);
});
}
function updateBulkBar() {
var checked = document.querySelectorAll('.bulk-check:checked');
document.getElementById('bulkCount').textContent = checked.length;
var applyBtn = document.getElementById('bulkApplyBtn');
var hint = document.getElementById('bulkHint');
if (applyBtn) applyBtn.disabled = checked.length === 0;
if (hint) hint.style.display = checked.length > 0 ? 'none' : 'inline';
}
function prepareBulk() {
var container = document.getElementById('bulkIdsContainer');
container.innerHTML = '';
var action = document.querySelector('[name="bulk_action"]').value;
if (!action) { alert('Select an action first'); return false; }
if (action === 'delete' && !confirm('Delete selected items permanently?')) return false;
document.querySelectorAll('.bulk-check:checked').forEach(function(cb) {
var input = document.createElement('input');
input.type = 'hidden';
input.name = 'bulk_ids';
input.value = cb.value;
container.appendChild(input);
});
return true;
}
function clearBulk() {
document.querySelectorAll('.bulk-check').forEach(function(cb) { cb.checked = false; });
if (selectAll) selectAll.checked = false;
updateBulkBar();
}
updateBulkBar();
// Thumbnail photo cycling
document.querySelectorAll('.inventory-thumb-cycler').forEach(function(cycler) {
var photoUrls = JSON.parse(cycler.dataset.photoUrls || '[]');
if (!photoUrls.length) return;
var index = 0;
var img = cycler.querySelector('.inventory-thumb-main');
var prev = cycler.querySelector('.inventory-thumb-prev');
var next = cycler.querySelector('.inventory-thumb-next');
function update() {
img.src = photoUrls[index];
if (img.hasAttribute('data-lightbox-trigger')) {
img.setAttribute('data-lightbox-index', String(index));
}
}
if (prev) {
prev.addEventListener('click', function(e) {
e.preventDefault();
e.stopPropagation();
index = (index - 1 + photoUrls.length) % photoUrls.length;
update();
});
}
if (next) {
next.addEventListener('click', function(e) {
e.preventDefault();
e.stopPropagation();
index = (index + 1) % photoUrls.length;
update();
});
}
});
// Inventory row auto-save
(function() {
var debounceTimers = new Map();
function setRowSavingState(form, state) {
if (!form) return;
var row = form.closest('tr');
if (!row) return;
row.classList.remove('table-info', 'table-success');
if (state === 'saving') row.classList.add('table-info');
if (state === 'saved') row.classList.add('table-success');
}
function clearSavedStateLater(form) {
setTimeout(function() {
var row = form.closest('tr');
if (!row) return;
row.classList.remove('table-success');
}, 700);
}
function submitQuickUpdate(formId) {
var form = document.getElementById(formId);
if (!form) return;
setRowSavingState(form, 'saving');
var body = new FormData(form);
fetch(form.action, {
method: 'POST',
body: body,
headers: {
'X-Requested-With': 'XMLHttpRequest'
}
}).then(function(resp) {
if (!resp.ok) throw new Error('Save failed');
return resp.json();
}).then(function(payload) {
if (!payload || !payload.ok) throw new Error('Save failed');
setRowSavingState(form, 'saved');
clearSavedStateLater(form);
}).catch(function() {
setRowSavingState(form, null);
if (window.showPill) {
window.showPill('Could not auto-save that row. Please retry.', 'error', 4500);
} else {
alert('Could not auto-save that row. Please retry.');
}
});
}
document.querySelectorAll('.js-quick-autosave').forEach(function(el) {
var formId = el.getAttribute('form');
if (!formId) return;
el.addEventListener('change', function() {
if (debounceTimers.has(formId)) {
clearTimeout(debounceTimers.get(formId));
}
debounceTimers.set(formId, setTimeout(function() {
submitQuickUpdate(formId);
}, 250));
});
});
})();
/* ── Quick-tag toggle ── */
(function() {
var csrfMeta = document.querySelector('meta[name="csrf-token"]');
var csrfToken = csrfMeta ? csrfMeta.content : '';
document.querySelectorAll('.js-quick-tag-btn').forEach(function(btn) {
btn.addEventListener('click', function(e) {
e.preventDefault();
e.stopPropagation();
var itemId = btn.dataset.itemId;
var tagId = btn.dataset.tagId;
var check = btn.querySelector('.js-quick-tag-check');
var body = new FormData();
body.append('tag_id', tagId);
body.append('action', 'toggle');
body.append('_csrf_token', csrfToken);
fetch('/items/' + itemId + '/quick-tag', {
method: 'POST',
body: body,
headers: { 'X-Requested-With': 'XMLHttpRequest' }
}).then(function(r) { return r.json(); })
.then(function(data) {
if (!data.ok) throw new Error(data.error || 'Failed');
btn.dataset.attached = data.attached ? 'true' : 'false';
if (check) check.classList.toggle('d-none', !data.attached);
/* Update count badge */
var counter = document.getElementById('tagCount' + itemId);
if (counter) counter.textContent = data.tag_count;
}).catch(function() {
if (window.showPill) {
window.showPill('Could not update tag. Please retry.', 'error', 3500);
}
});
});
});
})();
/* ── AI Price Check from inventory list ── */
(function() {
/* Floating result toast */
var toast = document.createElement('div');
toast.id = 'aiPriceToast';
toast.style.cssText = 'display:none;position:fixed;bottom:1.5rem;right:1.5rem;z-index:1080;width:380px;max-width:92vw;background:#fff;border-radius:0.75rem;box-shadow:0 8px 30px rgba(0,0,0,.18);overflow:hidden;';
toast.innerHTML = '<div class="px-3 py-2 bg-light d-flex justify-content-between align-items-center border-bottom">'
+ '<span class="fw-semibold small" id="aiPriceToastTitle"><i class="bi bi-stars"></i> AI Price Check</span>'
+ '<button type="button" class="btn-close" style="font-size:.6rem" id="aiPriceToastClose"></button>'
+ '</div><div class="p-3" id="aiPriceToastBody" style="max-height:60vh;overflow-y:auto;"></div>';
document.body.appendChild(toast);
document.getElementById('aiPriceToastClose').addEventListener('click', function() {
toast.style.display = 'none';
});
document.querySelectorAll('.js-ai-price-check-list').forEach(function(btn) {
btn.addEventListener('click', function() {
var itemId = btn.dataset.itemId;
var body = document.getElementById('aiPriceToastBody');
var title = document.getElementById('aiPriceToastTitle');
var buttonItemName = (btn.dataset.itemName || '').trim();
// Prefer the server-rendered item name so the toast title never carries over
// the previous result while the next request is starting.
var row = btn.closest('tr');
var nameInput = row && row.querySelector('input[name="name"]');
var rowName = nameInput && nameInput.value ? nameInput.value.trim() : '';
var displayName = rowName || buttonItemName || 'AI Price Check';
title.innerHTML = '<i class="bi bi-stars"></i> ' + displayName + ' - analyzing...';
btn.disabled = true;
btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
toast.style.display = 'block';
body.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Analyzing comparable sales…</div>';
var csrfToken = document.querySelector('meta[name="csrf-token"]');
var headers = {'Content-Type': 'application/json'};
if (csrfToken) headers['X-CSRFToken'] = csrfToken.content;
fetch('/items/' + itemId + '/ai-price-check', {method: 'POST', headers: headers})
.then(function(r) { return r.json(); })
.then(function(data) {
btn.disabled = false;
btn.innerHTML = '<i class="bi bi-stars"></i>';
if (!data.ok) {
title.innerHTML = '<i class="bi bi-stars"></i> ' + displayName;
body.innerHTML = '<div class="text-muted small">' + (data.error || 'No result') + '</div>';
return;
}
title.innerHTML = '<i class="bi bi-stars"></i> ' + (data.item_name || displayName);
var ai = data.ai_result || {};
var html = '';
if (ai.suggested_low && ai.suggested_high) {
html += '<div class="text-center mb-2">';
html += '<div class="text-muted small">Suggested</div>';
html += '<div class="fs-4 fw-bold text-primary">$' + Number(ai.suggested_low).toFixed(2) + ' – $' + Number(ai.suggested_high).toFixed(2) + '</div>';
if (data.current_price) html += '<div class="small text-muted">Current: $' + Number(data.current_price).toFixed(2) + '</div>';
html += '</div>';
}
var badges = '<div class="mb-2">';
if (ai.confidence) {
var cls = ai.confidence === 'high' ? 'success' : ai.confidence === 'medium' ? 'warning' : 'secondary';
badges += '<span class="badge bg-' + cls + ' me-1">' + ai.confidence + '</span>';
}
badges += '<span class="badge bg-info">' + data.comparables_count + ' comps</span>';
if (ai.avg_days_to_sell != null) badges += '<span class="badge bg-secondary ms-1">~' + ai.avg_days_to_sell + 'd</span>';
badges += '</div>';
html += badges;
if (ai.quick_sale_price || ai.premium_price) {
html += '<div class="d-flex gap-3 mb-2 small">';
if (ai.quick_sale_price) html += '<span><span class="text-muted">Quick:</span> <strong class="text-success">$' + Number(ai.quick_sale_price).toFixed(2) + '</strong></span>';
if (ai.premium_price) html += '<span><span class="text-muted">Premium:</span> <strong class="text-warning">$' + Number(ai.premium_price).toFixed(2) + '</strong></span>';
html += '</div>';
}
if (ai.reasoning) html += '<div class="small mb-1">' + ai.reasoning + '</div>';
if (ai.margin_note) html += '<div class="small text-muted"><i class="bi bi-graph-up-arrow"></i> ' + ai.margin_note + '</div>';
body.innerHTML = html;
})
.catch(function(err) {
btn.disabled = false;
btn.innerHTML = '<i class="bi bi-stars"></i>';
title.innerHTML = '<i class="bi bi-stars"></i> ' + displayName;
body.innerHTML = '<div class="text-danger small">Failed: ' + (err.message || 'unknown') + '</div>';
});
});
});
})();
