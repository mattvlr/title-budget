
(function() {
var gallery = document.getElementById('storefrontDetailGallery');
if (!gallery) return;
var photoUrls = JSON.parse(gallery.dataset.photoUrls || '[]');
if (!photoUrls.length) return;
var index = 0;
var main = document.getElementById('storefrontMainPhoto');
var count = document.getElementById('storefrontPhotoCount');
var prev = document.getElementById('storefrontPhotoPrev');
var next = document.getElementById('storefrontPhotoNext');
var thumbs = document.querySelectorAll('.sf-item-thumb');
function update(direction) {
if (direction && photos.length > 1) {
main.style.transition = 'none';
main.style.transform = 'translateX(0)';
void main.offsetWidth;
main.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
main.style.opacity = '0.4';
main.style.transform = direction === 'left' ? 'translateX(-40px)' : 'translateX(40px)';
setTimeout(function() {
main.src = photoUrls[index];
main.style.transition = 'none';
main.style.transform = direction === 'left' ? 'translateX(40px)' : 'translateX(-40px)';
main.style.opacity = '0.4';
void main.offsetWidth;
main.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
main.style.transform = 'translateX(0)';
main.style.opacity = '1';
}, 180);
} else {
main.src = photoUrls[index];
}
if (count) count.textContent = (index + 1) + ' / ' + photoUrls.length;
if (main && main.hasAttribute('data-lightbox-trigger')) {
main.setAttribute('data-lightbox-index', String(index));
}
thumbs.forEach(function(thumb) {
thumb.classList.remove('active');
if (parseInt(thumb.dataset.index, 10) === index) {
thumb.classList.add('active');
}
});
}
function goPrev() { index = (index - 1 + photoUrls.length) % photoUrls.length; update('right'); }
function goNext() { index = (index + 1) % photoUrls.length; update('left'); }
if (prev) prev.addEventListener('click', goPrev);
if (next) next.addEventListener('click', goNext);
thumbs.forEach(function(thumb) {
thumb.addEventListener('click', function() {
index = parseInt(thumb.dataset.index, 10) || 0;
update();
});
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
main.style.transform = 'translateX(' + (pct * 80) + 'px)';
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
