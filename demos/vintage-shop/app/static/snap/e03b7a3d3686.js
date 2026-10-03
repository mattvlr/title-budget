
(function() {
var gallery = document.getElementById('inventoryDetailGallery');
if (!gallery) return;
// Read photo URLs fresh on every navigation so cache-busted URLs written
// by background-removal (which update gallery.dataset.photoUrls) take
// effect immediately when the user clicks prev/next.
function currentPhotoUrls() {
try {
var arr = JSON.parse(gallery.dataset.photoUrls || '[]');
return Array.isArray(arr) ? arr : [];
} catch (e) {
return [];
}
}
var photoUrls = currentPhotoUrls();
if (!photoUrls.length) return;
var index = 0;
var main = document.getElementById('mainPhoto');
var count = document.getElementById('inventoryPhotoCount');
var prev = document.getElementById('inventoryPhotoPrev');
var next = document.getElementById('inventoryPhotoNext');
function currentThumbs() {
return document.querySelectorAll('.photo-thumb');
}
function filenameForIndex(i) {
// Thumbs are rendered in the same order as photo URLs and carry
// data-photo-filename. When the gallery has no thumbs (single photo),
// mainPhoto's own dataset filename is the right answer.
var thumbs = currentThumbs();
var t = thumbs[i];
if (t && t.dataset && t.dataset.photoFilename) return t.dataset.photoFilename;
return main.dataset.photoFilename || '';
}
function update(direction) {
photoUrls = currentPhotoUrls();
if (!photoUrls.length) return;
if (index >= photoUrls.length) index = 0;
if (direction && photoUrls.length > 1) {
main.style.transition = 'none';
main.style.transform = 'translateX(0)';
void main.offsetWidth;
main.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
main.style.opacity = '0.4';
main.style.transform = direction === 'left' ? 'translateX(-30px)' : 'translateX(30px)';
setTimeout(function() {
main.src = photoUrls[index];
main.style.transition = 'none';
main.style.transform = direction === 'left' ? 'translateX(30px)' : 'translateX(-30px)';
main.style.opacity = '0.4';
void main.offsetWidth;
main.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
main.style.transform = 'translateX(0)';
main.style.opacity = '1';
}, 180);
} else {
main.src = photoUrls[index];
}
// Keep mainPhoto.dataset.photoFilename in sync with whichever photo
// is on screen so the toolbar's rotate / remove-bg actions target the
// correct photo even after the user navigates via chevrons or arrow keys.
var fname = filenameForIndex(index);
if (fname) main.dataset.photoFilename = fname;
if (count) count.textContent = (index + 1) + ' / ' + photoUrls.length;
if (main.hasAttribute('data-lightbox-trigger')) {
main.setAttribute('data-lightbox-index', String(index));
// Keep the lightbox payload in sync with any cache-busted URLs
// written into gallery.dataset.photoUrls by background-removal.
main.setAttribute('data-lightbox-photos', JSON.stringify(photoUrls));
}
currentThumbs().forEach(function(t) {
t.style.borderColor = 'transparent';
t.classList.remove('photo-thumb-active');
if ((parseInt(t.dataset.index, 10) || 0) === index) {
t.style.borderColor = 'var(--sidebar-accent)';
t.classList.add('photo-thumb-active');
}
});
}
window.InventoryPhotoGallery = {
refresh: function(newPhotoUrls, newIndex) {
if (Array.isArray(newPhotoUrls)) {
gallery.dataset.photoUrls = JSON.stringify(newPhotoUrls);
}
photoUrls = currentPhotoUrls();
if (!photoUrls.length) return;
index = Math.max(0, Math.min(Number(newIndex) || 0, photoUrls.length - 1));
update();
}
};
function goPrev() { photoUrls = currentPhotoUrls(); if (!photoUrls.length) return; index = (index - 1 + photoUrls.length) % photoUrls.length; update('right'); }
function goNext() { photoUrls = currentPhotoUrls(); if (!photoUrls.length) return; index = (index + 1) % photoUrls.length; update('left'); }
if (prev) prev.addEventListener('click', goPrev);
if (next) next.addEventListener('click', goNext);
// Keyboard arrow navigation. Only when the inline gallery has multiple
// photos, the lightbox isn't open, and the user isn't typing in a field.
document.addEventListener('keydown', function (ev) {
if (ev.defaultPrevented) return;
if (photoUrls.length < 2) return;
var lightbox = document.getElementById('photoLightbox');
if (lightbox && !lightbox.hidden) return; // lightbox owns the keys when open
var t = ev.target;
if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
if (ev.key === 'ArrowLeft') { ev.preventDefault(); goPrev(); }
else if (ev.key === 'ArrowRight') { ev.preventDefault(); goNext(); }
});
/* Touch swipe */
if (photoUrls.length > 1) {
var touchStartX = 0, touchStartY = 0, swiping = false;
gallery.style.touchAction = 'pan-y';
gallery.style.userSelect = 'none';
gallery.style.overflow = 'hidden';
gallery.addEventListener('touchstart', function(e) {
touchStartX = e.touches[0].clientX;
touchStartY = e.touches[0].clientY;
swiping = false;
}, { passive: true });
gallery.addEventListener('touchmove', function(e) {
if (!touchStartX) return;
var dx = e.touches[0].clientX - touchStartX;
var dy = e.touches[0].clientY - touchStartY;
if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
swiping = true;
}
if (swiping) {
e.preventDefault();
var pct = Math.max(-1, Math.min(1, dx / gallery.offsetWidth));
main.style.transition = 'none';
main.style.transform = 'translateX(' + (pct * 60) + 'px)';
main.style.opacity = String(1 - Math.abs(pct) * 0.4);
}
}, { passive: false });
gallery.addEventListener('touchend', function(e) {
var dx = (e.changedTouches[0] || {}).clientX - touchStartX;
if (swiping && Math.abs(dx) > 40) {
if (dx < 0) goNext(); else goPrev();
} else {
main.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
main.style.transform = 'translateX(0)';
main.style.opacity = '1';
}
touchStartX = 0;
swiping = false;
}, { passive: true });
}
})();
