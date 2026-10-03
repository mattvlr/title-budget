
(function() {
var lightbox = document.getElementById('photoLightbox');
if (!lightbox) return;
var imgEl = document.getElementById('photoLightboxImg');
var prevBtn = document.getElementById('photoLightboxPrev');
var nextBtn = document.getElementById('photoLightboxNext');
var closeBtn = document.getElementById('photoLightboxClose');
var countEl = document.getElementById('photoLightboxCount');
var photos = [];
var index = 0;
function render() {
if (!photos.length) return;
imgEl.src = photos[index];
var multi = photos.length > 1;
prevBtn.hidden = !multi;
nextBtn.hidden = !multi;
countEl.hidden = !multi;
if (multi) countEl.textContent = (index + 1) + ' / ' + photos.length;
}
function open(urls, startIndex) {
photos = (urls || []).filter(Boolean);
if (!photos.length) return;
index = Math.max(0, Math.min(startIndex || 0, photos.length - 1));
render();
lightbox.hidden = false;
lightbox.setAttribute('aria-hidden', 'false');
document.body.style.overflow = 'hidden';
}
function close() {
lightbox.hidden = true;
lightbox.setAttribute('aria-hidden', 'true');
imgEl.src = '';
document.body.style.overflow = '';
}
function goPrev(e) {
if (e) { e.preventDefault(); e.stopPropagation(); }
if (!photos.length) return;
index = (index - 1 + photos.length) % photos.length;
render();
}
function goNext(e) {
if (e) { e.preventDefault(); e.stopPropagation(); }
if (!photos.length) return;
index = (index + 1) % photos.length;
render();
}
prevBtn.addEventListener('click', goPrev);
nextBtn.addEventListener('click', goNext);
closeBtn.addEventListener('click', function(e) { e.stopPropagation(); close(); });
lightbox.addEventListener('click', function(e) {
if (e.target === lightbox) close();
});
imgEl.addEventListener('click', function(e) { e.stopPropagation(); });
document.addEventListener('keydown', function(e) {
if (lightbox.hidden) return;
if (e.key === 'Escape') close();
else if (e.key === 'ArrowLeft') goPrev();
else if (e.key === 'ArrowRight') goNext();
});
document.addEventListener('click', function(e) {
var trigger = e.target.closest('[data-lightbox-trigger]');
if (!trigger) return;
var raw = trigger.getAttribute('data-lightbox-photos');
if (!raw) return;
var urls;
try { urls = JSON.parse(raw); } catch (err) { return; }
if (!Array.isArray(urls) || !urls.length) return;
e.preventDefault();
e.stopPropagation();
var startStr = trigger.getAttribute('data-lightbox-index');
var start = parseInt(startStr, 10);
open(urls, isNaN(start) ? 0 : start);
}, true);
window.openPhotoLightbox = open;
})();
