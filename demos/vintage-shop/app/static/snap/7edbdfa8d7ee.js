
/* Consignment toggle */
function toggleConsignmentFields() {
var sel = document.getElementById('consignerSelect');
var fields = document.getElementById('consignmentFields');
if (sel.value) {
fields.style.display = '';
} else {
fields.style.display = 'none';
document.getElementById('splitTypeField').value = '';
document.getElementById('splitValueField').value = '';
}
}
document.getElementById('generateSku')?.addEventListener('click', function() {
const catSelect = document.getElementById('categorySelect');
const catId = catSelect.value || '';
fetch(`/api/generate-sku?category_id=${catId}`)
.then(r => {
if (!r.ok) throw new Error('SKU generation failed');
return r.json();
})
.then(data => {
document.getElementById('skuField').value = data.sku;
})
.catch(function() {
showPill('Could not generate SKU — try again', 'warn', 4000);
});
});
// Auto-generate SKU when category changes (if SKU field is empty)
document.getElementById('categorySelect')?.addEventListener('change', function() {
const skuField = document.getElementById('skuField');
if (!skuField.value) {
document.getElementById('generateSku')?.click();
}
});
/* ── Edit photo gallery ── */
(function() {
var gallery = document.getElementById('itemEditPhotoGallery');
var main = document.getElementById('itemEditMainPhoto');
if (!gallery || !main) return;
var photoUrls = [];
try {
photoUrls = JSON.parse(gallery.dataset.photoUrls || '[]');
} catch (err) {
photoUrls = [];
}
if (!photoUrls.length) return;
var index = 0;
var prev = document.getElementById('itemEditPhotoPrev');
var next = document.getElementById('itemEditPhotoNext');
var count = document.getElementById('itemEditPhotoCount');
var thumbs = document.querySelectorAll('#itemEditPhotoThumbs .photo-thumb');
function updatePhoto() {
main.src = photoUrls[index];
main.setAttribute('data-lightbox-photos', JSON.stringify(photoUrls));
if (count) count.textContent = (index + 1) + ' / ' + photoUrls.length;
thumbs.forEach(function(thumb, i) {
var active = i === index;
thumb.classList.toggle('photo-thumb-active', active);
thumb.style.borderColor = active ? 'var(--sidebar-accent)' : 'transparent';
});
}
if (prev) {
prev.addEventListener('click', function() {
index = (index - 1 + photoUrls.length) % photoUrls.length;
updatePhoto();
});
}
if (next) {
next.addEventListener('click', function() {
index = (index + 1) % photoUrls.length;
updatePhoto();
});
}
thumbs.forEach(function(thumb) {
thumb.addEventListener('click', function() {
index = Number(thumb.dataset.index || 0);
updatePhoto();
});
});
})();
/* ── Tag picker (add/edit form) ── */
(function() {
var container = document.getElementById('formSelectedTags');
var picker = document.getElementById('formTagPicker');
if (!container || !picker) return;
function addPill(id, name, color) {
var pill = document.createElement('span');
pill.className = 'badge badge-tag d-inline-flex align-items-center gap-1 form-tag-pill';
pill.style.backgroundColor = color;
pill.dataset.tagId = id;
pill.innerHTML = name + ' <button type="button" class="btn-close btn-close-white ms-1 form-tag-remove" style="font-size:.55rem" aria-label="Remove"></button>';
pill.querySelector('.form-tag-remove').addEventListener('click', function() { removePill(id); });
container.appendChild(pill);
}
function removePill(id) {
var pill = container.querySelector('[data-tag-id="' + id + '"]');
if (pill) pill.remove();
var cb = document.getElementById('formTagCb' + id);
if (cb) cb.checked = false;
var opt = picker.querySelector('option[value="' + id + '"]');
if (opt) opt.disabled = false;
}
container.querySelectorAll('.form-tag-remove').forEach(function(btn) {
btn.addEventListener('click', function() {
var pill = btn.closest('.form-tag-pill');
if (pill) removePill(pill.dataset.tagId);
});
});
picker.addEventListener('change', function() {
var opt = picker.options[picker.selectedIndex];
if (!opt || !opt.value) return;
var id = opt.value;
var cb = document.getElementById('formTagCb' + id);
if (cb) cb.checked = true;
addPill(id, opt.text, opt.dataset.color || '#6c757d');
opt.disabled = true;
picker.selectedIndex = 0;
});
})();
/* ── AI Price Check ── */
(function() {
var btn = document.getElementById('aiPriceCheckBtn');
var resultPanel = document.getElementById('aiPriceResult');
var resultBody = document.getElementById('aiPriceResultBody');
var closeBtn = document.getElementById('aiPriceResultClose');
if (!btn) return;
closeBtn && closeBtn.addEventListener('click', function() {
resultPanel.classList.add('d-none');
});
btn.addEventListener('click', function() {
var itemId = btn.dataset.itemId;
btn.disabled = true;
btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Analyzing…';
resultPanel.classList.add('d-none');
var csrfToken = document.querySelector('meta[name="csrf-token"]');
var headers = {'Content-Type': 'application/json'};
if (csrfToken) headers['X-CSRFToken'] = csrfToken.content;
fetch('/items/' + itemId + '/ai-price-check', {method: 'POST', headers: headers})
.then(function(r) { return r.json(); })
.then(function(data) {
btn.disabled = false;
btn.innerHTML = '<i class="bi bi-stars"></i> AI Price Check';
if (!data.ok) {
resultBody.innerHTML = '<div class="text-muted small">' + (data.error || 'No result') + '</div>';
resultPanel.classList.remove('d-none');
return;
}
var ai = data.ai_result || {};
var html = '';
// Price suggestion row
html += '<div class="row g-2 mb-3">';
if (ai.suggested_low && ai.suggested_high) {
html += '<div class="col-sm-4"><div class="border rounded p-2 text-center">';
html += '<div class="text-muted small">Suggested Range</div>';
html += '<div class="fs-5 fw-bold text-primary">$' + Number(ai.suggested_low).toFixed(2) + ' – $' + Number(ai.suggested_high).toFixed(2) + '</div>';
html += '</div></div>';
}
if (ai.quick_sale_price) {
html += '<div class="col-sm-4"><div class="border rounded p-2 text-center">';
html += '<div class="text-muted small">Quick Sale</div>';
html += '<div class="fs-5 fw-semibold text-success">$' + Number(ai.quick_sale_price).toFixed(2) + '</div>';
html += '</div></div>';
}
if (ai.premium_price) {
html += '<div class="col-sm-4"><div class="border rounded p-2 text-center">';
html += '<div class="text-muted small">Premium</div>';
html += '<div class="fs-5 fw-semibold text-warning">$' + Number(ai.premium_price).toFixed(2) + '</div>';
html += '</div></div>';
}
html += '</div>';
// Confidence + comparables
var badges = '';
if (ai.confidence) {
var badgeCls = ai.confidence === 'high' ? 'success' : ai.confidence === 'medium' ? 'warning' : 'secondary';
badges += '<span class="badge bg-' + badgeCls + ' me-1">' + ai.confidence + ' confidence</span>';
}
badges += '<span class="badge bg-info">' + data.comparables_count + ' comparable sales analyzed</span>';
if (ai.avg_days_to_sell != null) {
badges += '<span class="badge bg-secondary ms-1">~' + ai.avg_days_to_sell + ' days to sell</span>';
}
html += '<div class="mb-2">' + badges + '</div>';
// Reasoning
if (ai.reasoning) {
html += '<div class="small mb-2">' + ai.reasoning + '</div>';
}
if (ai.margin_note) {
html += '<div class="small text-muted mb-2"><i class="bi bi-graph-up-arrow"></i> ' + ai.margin_note + '</div>';
}
// Apply buttons
if (ai.suggested_low && ai.suggested_high) {
var mid = ((Number(ai.suggested_low) + Number(ai.suggested_high)) / 2).toFixed(2);
html += '<div class="d-flex flex-wrap gap-2 mt-2">';
html += '<button type="button" class="btn btn-sm btn-outline-primary js-apply-price" data-price="' + mid + '">Apply $' + mid + '</button>';
if (ai.quick_sale_price) {
html += '<button type="button" class="btn btn-sm btn-outline-success js-apply-price" data-price="' + Number(ai.quick_sale_price).toFixed(2) + '">Apply Quick Sale $' + Number(ai.quick_sale_price).toFixed(2) + '</button>';
}
if (ai.premium_price) {
html += '<button type="button" class="btn btn-sm btn-outline-warning js-apply-price" data-price="' + Number(ai.premium_price).toFixed(2) + '">Apply Premium $' + Number(ai.premium_price).toFixed(2) + '</button>';
}
html += '</div>';
}
resultBody.innerHTML = html;
resultPanel.classList.remove('d-none');
// Wire up apply buttons
resultPanel.querySelectorAll('.js-apply-price').forEach(function(applyBtn) {
applyBtn.addEventListener('click', function() {
var priceField = document.getElementById('sellingPriceField');
if (priceField) {
priceField.value = applyBtn.dataset.price;
priceField.focus();
priceField.classList.add('border-primary');
setTimeout(function() { priceField.classList.remove('border-primary'); }, 2000);
}
});
});
})
.catch(function(err) {
btn.disabled = false;
btn.innerHTML = '<i class="bi bi-stars"></i> AI Price Check';
resultBody.innerHTML = '<div class="text-danger small">Request failed: ' + (err.message || 'unknown error') + '</div>';
resultPanel.classList.remove('d-none');
});
});
})();
