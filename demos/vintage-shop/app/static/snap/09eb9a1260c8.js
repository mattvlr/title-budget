
(function() {
var gallery = document.getElementById('inventoryDetailGallery');
if (!gallery) return;
var itemId = parseInt(gallery.dataset.itemId, 10);
if (!itemId) return;
document.addEventListener('click', function(ev) {
var btn = ev.target.closest('.js-remove-bg');
if (!btn) return;
ev.preventDefault();
if (!window.RemoveBg) return;
var id = parseInt(btn.dataset.itemId, 10) || itemId;
window.RemoveBg.start(id);
});
// ---- Photo rotation ------------------------------------------------
var mainPhoto = document.getElementById('mainPhoto');
var loader = document.getElementById('photoRotateLoader');
var toastEl = document.getElementById('photoRotateToast');
var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
function showToast(msg, isError) {
if (!toastEl) return;
toastEl.textContent = msg;
toastEl.classList.toggle('err', !!isError);
toastEl.classList.add('show');
clearTimeout(showToast._t);
showToast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
}
function setRotating(on) {
if (on) {
gallery.classList.add('is-rotating');
if (loader) loader.hidden = false;
} else {
gallery.classList.remove('is-rotating');
if (loader) loader.hidden = true;
}
}
function cacheBust(url) {
if (!url) return url;
var bust = '_t=' + Date.now();
return url + (url.indexOf('?') === -1 ? '?' : '&') + bust;
}
function applyNewPhotoUrl(filename, newUrl) {
if (!filename || !newUrl) return;
// Always tack on a fresh _t so the browser doesn't keep showing the
// cached pre-rotation file (the server URL is the same path).
var busted = cacheBust(newUrl);
if (mainPhoto && (mainPhoto.dataset.photoFilename === filename)) {
mainPhoto.src = busted;
}
document.querySelectorAll('.photo-thumb').forEach(function (t) {
if (t.dataset && t.dataset.photoFilename === filename) {
t.src = busted;
}
});
// Patch the gallery's photoUrls list so chevron / arrow nav and the
// lightbox pick up the new URL on subsequent clicks.
try {
var arr = JSON.parse(gallery.dataset.photoUrls || '[]');
var changed = false;
for (var i = 0; i < arr.length; i++) {
var raw = String(arr[i] || '');
var bare = raw.split('?')[0];
if (bare.endsWith(encodeURI(filename)) || bare.endsWith(filename)) {
arr[i] = busted;
changed = true;
}
}
if (changed) {
gallery.dataset.photoUrls = JSON.stringify(arr);
if (mainPhoto && mainPhoto.hasAttribute('data-lightbox-trigger')) {
mainPhoto.setAttribute('data-lightbox-photos', JSON.stringify(arr));
}
}
} catch (_) { /* dataset may be missing; non-fatal */ }
}
var rotating = false;
document.addEventListener('click', function (ev) {
var btn = ev.target.closest('.js-rotate-photo');
if (!btn || rotating) return;
ev.preventDefault();
if (!mainPhoto) return;
var filename = mainPhoto.dataset.photoFilename || '';
if (!filename) {
showToast('Could not figure out which photo to rotate.', true);
return;
}
var direction = btn.dataset.direction === 'ccw' ? 'ccw' : 'cw';
rotating = true;
setRotating(true);
var headers = { 'Content-Type': 'application/json' };
if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
fetch('/items/' + itemId + '/rotate-photo', {
method: 'POST',
credentials: 'same-origin',
headers: headers,
body: JSON.stringify({ filename: filename, direction: direction })
})
.then(function (r) {
return r.json().catch(function () { return {}; }).then(function (d) {
if (!r.ok || !d.ok) {
var err = (d && d.error) || ('HTTP ' + r.status);
throw new Error(err);
}
return d;
});
})
.then(function (d) {
var photo = (d && d.photo) || {};
applyNewPhotoUrl(photo.filename || filename, photo.url);
showToast('Photo rotated.', false);
})
.catch(function (err) {
showToast('Could not rotate photo: ' + (err.message || err), true);
})
.finally(function () {
rotating = false;
setRotating(false);
});
});
document.addEventListener('click', function (ev) {
var btn = ev.target.closest('.js-delete-photo');
if (!btn || rotating) return;
ev.preventDefault();
if (!mainPhoto) return;
var filename = mainPhoto.dataset.photoFilename || '';
if (!filename) {
showToast('Could not figure out which photo to delete.', true);
return;
}
if (!confirm('Delete this photo from the item? This cannot be undone.')) return;
rotating = true;
btn.disabled = true;
setRotating(true);
var headers = { 'Content-Type': 'application/json' };
if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
fetch('/items/' + itemId + '/delete-photo', {
method: 'POST',
credentials: 'same-origin',
headers: headers,
body: JSON.stringify({ filename: filename })
})
.then(function (r) {
return r.json().catch(function () { return {}; }).then(function (d) {
if (!r.ok || !d.ok) {
var err = (d && d.error) || ('HTTP ' + r.status);
throw new Error(err);
}
return d;
});
})
.then(function () {
showToast('Photo deleted.', false);
setTimeout(function () { window.location.reload(); }, 350);
})
.catch(function (err) {
showToast('Could not delete photo: ' + (err.message || err), true);
rotating = false;
btn.disabled = false;
setRotating(false);
});
});
})();
