/*
 * Background-removal modal.
 *
 * Usage from anywhere on a page:
 *     RemoveBg.start(itemId, { onDone: () => ... });
 *
 * The modal has two phases:
 *   1. SELECTION — every photo is rendered as a tappable card; the user
 *      checks/unchecks which photos to process. Already-processed photos
 *      (those with a backup on disk) are flagged and can be restored from
 *      this menu. All photos start selected.
 *   2. PROCESSING — only the selected photos run, sequentially. Unselected
 *      photos remain visible in the grid but greyed out as "Skipped" so
 *      the spatial layout doesn't shift. Each selected card animates
 *      pending → processing → done | error.
 *
 * After processing, the original img tags on the host page are refreshed
 * in-place (cache-busted) per photo as it completes.
 */
(function () {
  const MODAL_ID = 'removeBgModal';

  function csrfToken() {
    const tag = document.querySelector('meta[name="csrf-token"]');
    return tag ? tag.getAttribute('content') || '' : '';
  }

  // ---------- modal scaffold ---------------------------------------------

  function buildModal() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) return existing;

    const wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'rbg-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="rbg-backdrop" data-rbg-close></div>
      <div class="rbg-shell">
        <header class="rbg-head">
          <div>
            <div class="rbg-title">Remove backgrounds</div>
            <div class="rbg-subtitle" data-rbg-subtitle></div>
          </div>
          <button type="button" class="rbg-close-btn" data-rbg-close aria-label="Close">&times;</button>
        </header>
        <div class="rbg-progress-track"><div class="rbg-progress-bar" data-rbg-bar></div></div>
        <div class="rbg-grid" data-rbg-grid></div>
        <footer class="rbg-foot">
          <div class="rbg-status" data-rbg-status>Loading photos…</div>
          <div class="rbg-actions">
            <button type="button" class="btn btn-link btn-sm d-none" data-rbg-select-all>Select all</button>
            <button type="button" class="btn btn-link btn-sm d-none" data-rbg-select-none>Clear</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" data-rbg-cancel>Cancel</button>
            <button type="button" class="btn btn-primary btn-sm d-none" data-rbg-start>
              <i class="bi bi-magic"></i>
              <span data-rbg-start-label>Remove backgrounds</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm d-none" data-rbg-done>Done</button>
          </div>
        </footer>
      </div>
    `;
    document.body.appendChild(wrap);

    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-rbg-close], [data-rbg-cancel], [data-rbg-done]')) {
        closeModal();
      } else if (e.target.closest('[data-rbg-select-all]')) {
        state.photos.forEach(p => state.selected.add(p.filename));
        renderSelectionGrid();
      } else if (e.target.closest('[data-rbg-select-none]')) {
        state.selected.clear();
        renderSelectionGrid();
      } else if (e.target.closest('[data-rbg-start]')) {
        if (state.selected.size > 0 && state.phase === 'select') {
          startProcessing();
        }
      }
    });
    document.addEventListener('keydown', escClose);
    return wrap;
  }

  function escClose(e) {
    if (e.key === 'Escape' && document.body.classList.contains('rbg-open')) closeModal();
  }

  function closeModal() {
    state.canceled = true;
    const m = document.getElementById(MODAL_ID);
    if (m) m.classList.remove('is-open');
    document.body.classList.remove('rbg-open');
    if (typeof window._rbgOnDone === 'function') {
      try { window._rbgOnDone(); } catch (_) {}
      window._rbgOnDone = null;
    }
  }

  function openModal() {
    state = freshState();
    const m = buildModal();
    m.classList.add('is-open');
    document.body.classList.add('rbg-open');
  }

  // ---------- per-run state ----------------------------------------------

  let state = freshState();

  function freshState() {
    return {
      itemId: null,
      photos: [],          // [{filename, url, has_original}]
      selected: new Set(), // filenames
      phase: 'loading',    // loading | select | processing | done
      canceled: false,
    };
  }

  // ---------- view helpers -----------------------------------------------

  function setSubtitle(text) {
    const sub = document.querySelector(`#${MODAL_ID} [data-rbg-subtitle]`);
    if (sub) sub.textContent = text || '';
  }
  function setStatus(text) {
    const el = document.querySelector(`#${MODAL_ID} [data-rbg-status]`);
    if (el) el.textContent = text || '';
  }
  function setProgress(done, total) {
    const bar = document.querySelector(`#${MODAL_ID} [data-rbg-bar]`);
    if (bar) bar.style.width = total ? `${(done / total) * 100}%` : '0%';
  }
  function show(sel) {
    const el = document.querySelector(`#${MODAL_ID} ${sel}`);
    if (el) el.classList.remove('d-none');
  }
  function hide(sel) {
    const el = document.querySelector(`#${MODAL_ID} ${sel}`);
    if (el) el.classList.add('d-none');
  }
  function setText(sel, txt) {
    const el = document.querySelector(`#${MODAL_ID} ${sel}`);
    if (el) el.textContent = txt;
  }

  // ---------- selection phase --------------------------------------------

  function renderSelectionGrid() {
    const grid = document.querySelector(`#${MODAL_ID} [data-rbg-grid]`);
    if (!grid) return;
    grid.innerHTML = '';
    grid.classList.add('rbg-grid--select');
    grid.classList.remove('rbg-grid--process');

    state.photos.forEach((p, idx) => {
      const isSelected = state.selected.has(p.filename);
      const card = document.createElement('div');
      card.className = 'rbg-card rbg-card--select' + (isSelected ? ' is-selected' : '');
      card.dataset.filename = p.filename;
      card.dataset.idx = String(idx);
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', String(isSelected));
      card.tabIndex = 0;
      card.innerHTML = `
        <div class="rbg-thumb">
          <img src="${escapeAttr(p.url)}" alt="">
          <span class="rbg-checkbox" aria-hidden="true">
            <i class="bi bi-check-lg"></i>
          </span>
          ${p.has_original ? '<span class="rbg-badge-prior">Already done</span>' : ''}
        </div>
        <div class="rbg-card-meta">
          <span class="rbg-state">${isSelected ? (p.has_original ? 'Will re-run' : 'Will process') : 'Skip'}</span>
          ${p.has_original ? '<button type="button" class="rbg-undo" data-rbg-restore><i class="bi bi-arrow-counterclockwise"></i> Undo</button>' : ''}
        </div>
      `;
      grid.appendChild(card);
    });

    grid.querySelectorAll('.rbg-card--select').forEach((card) => {
      const fname = card.dataset.filename;
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-rbg-restore]')) return;
        toggleSelected(fname);
      });
      card.addEventListener('keydown', (e) => {
        if (e.target.closest('[data-rbg-restore]')) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggleSelected(fname);
        }
      });
      const restoreBtn = card.querySelector('[data-rbg-restore]');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          modalUndo(card, fname, { returnToSelection: true });
        });
      }
    });

    updateSelectionFooter();
  }

  function toggleSelected(filename) {
    if (state.selected.has(filename)) state.selected.delete(filename);
    else state.selected.add(filename);

    const card = document.querySelector(`#${MODAL_ID} .rbg-card[data-filename="${cssEscape(filename)}"]`);
    if (card) {
      const isSel = state.selected.has(filename);
      card.classList.toggle('is-selected', isSel);
      card.setAttribute('aria-pressed', String(isSel));
      const state_el = card.querySelector('.rbg-state');
      const photo = state.photos.find(p => p.filename === filename);
      if (state_el) {
        if (!isSel) state_el.textContent = 'Skip';
        else state_el.textContent = (photo && photo.has_original) ? 'Will re-run' : 'Will process';
      }
    }
    updateSelectionFooter();
  }

  function updateSelectionFooter() {
    const n = state.selected.size;
    const total = state.photos.length;
    setStatus(`${n} of ${total} photo${total === 1 ? '' : 's'} selected`);
    const restorable = state.photos.filter(p => p.has_original).length;
    setSubtitle(restorable
      ? 'Choose photos to process. Use Undo here to restore originals.'
      : 'Choose which photos to process.');
    const startBtn = document.querySelector(`#${MODAL_ID} [data-rbg-start]`);
    const startLabel = document.querySelector(`#${MODAL_ID} [data-rbg-start-label]`);
    if (startBtn) startBtn.disabled = n === 0;
    if (startLabel) startLabel.textContent = n === 0
      ? 'Remove backgrounds'
      : `Remove backgrounds (${n})`;
    setProgress(0, total);
  }

  function enterSelectionPhase() {
    state.phase = 'select';
    // Footer
    show('[data-rbg-select-all]');
    show('[data-rbg-select-none]');
    show('[data-rbg-start]');
    show('[data-rbg-cancel]');
    hide('[data-rbg-done]');
    renderSelectionGrid();
  }

  // ---------- processing phase -------------------------------------------

  function enterProcessingPhase() {
    state.phase = 'processing';
    // Footer
    hide('[data-rbg-select-all]');
    hide('[data-rbg-select-none]');
    hide('[data-rbg-start]');
    show('[data-rbg-cancel]');
    hide('[data-rbg-done]');

    const grid = document.querySelector(`#${MODAL_ID} [data-rbg-grid]`);
    grid.classList.remove('rbg-grid--select');
    grid.classList.add('rbg-grid--process');

    // Convert each card into the processing form
    grid.querySelectorAll('.rbg-card').forEach((card) => {
      const fname = card.dataset.filename;
      const isSel = state.selected.has(fname);
      card.classList.remove('rbg-card--select', 'is-selected');
      card.classList.add('rbg-card--process');
      // Remove the click affordance.
      card.removeAttribute('role');
      card.removeAttribute('aria-pressed');
      card.tabIndex = -1;
      card.replaceWith(card.cloneNode(false)); // strip listeners
    });

    // Re-render the processing cards (we wiped contents in the clone above)
    state.photos.forEach((p, idx) => {
      const selector = `#${MODAL_ID} .rbg-card[data-filename="${cssEscape(p.filename)}"]`;
      const card = document.querySelector(selector);
      if (!card) return;
      const isSel = state.selected.has(p.filename);
      card.dataset.idx = String(idx);
      card.classList.remove('rbg-card--select', 'is-selected');
      card.classList.add('rbg-card--process');
      card.classList.add(isSel ? 'is-pending' : 'is-skipped');
      card.innerHTML = `
        <div class="rbg-thumb">
          <img src="${escapeAttr(p.url)}" alt="">
          <div class="rbg-thumb-overlay">
            <div class="rbg-spinner"></div>
            <div class="rbg-check"><i class="bi bi-check-lg"></i></div>
            <div class="rbg-cross"><i class="bi bi-x-lg"></i></div>
          </div>
        </div>
        <div class="rbg-card-meta">
          <span class="rbg-state">${isSel ? 'Pending' : 'Skipped'}</span>
          <button type="button" class="rbg-retry d-none">Retry</button>
        </div>
      `;
    });
  }

  async function startProcessing() {
    enterProcessingPhase();
    const selectedPhotos = state.photos.filter(p => state.selected.has(p.filename));
    const total = selectedPhotos.length;
    setSubtitle(`${total} photo${total === 1 ? '' : 's'} to process`);
    setStatus(`Working through ${total} photo${total === 1 ? '' : 's'}…`);
    setProgress(0, total);

    let done = 0;
    for (const p of selectedPhotos) {
      if (state.canceled) break;
      const card = document.querySelector(`#${MODAL_ID} .rbg-card[data-filename="${cssEscape(p.filename)}"]`);
      if (!card) continue;
      const ok = await processOne(state.itemId, p.filename, card);
      if (ok) {
        done++;
        setProgress(done, total);
        setStatus(`${done} of ${total} done`);
      }
    }

    state.phase = 'done';
    hide('[data-rbg-cancel]');
    show('[data-rbg-done]');
    if (done === total) {
      setStatus('All selected photos processed.');
    } else {
      setStatus(`Processed ${done} of ${total}. Retry any that failed, or close this dialog.`);
    }
  }

  // ---------- per-photo network call -------------------------------------

  function setCardState(card, st, detail) {
    card.classList.remove('is-pending', 'is-processing', 'is-done', 'is-error', 'is-restored');
    card.classList.add(`is-${st}`);
    const stateEl = card.querySelector('.rbg-state');
    const retryEl = card.querySelector('.rbg-retry');
    const map = {
      pending: 'Pending',
      processing: 'Processing…',
      done: 'Done',
      error: detail || 'Failed',
      restored: 'Restored',
    };
    if (stateEl) stateEl.textContent = map[st] || st;
    if (retryEl) retryEl.classList.toggle('d-none', st !== 'error');

    // Inject/remove an inline Undo button on the meta row when this card has
    // a backup to restore (state === 'done' or 'restored' with a backup still
    // present means the backup is gone — we only show it on 'done').
    let undoEl = card.querySelector('.rbg-undo');
    const filename = card.dataset.filename;
    if (st === 'done' && !undoEl) {
      undoEl = document.createElement('button');
      undoEl.type = 'button';
      undoEl.className = 'rbg-undo';
      undoEl.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i> Undo';
      undoEl.addEventListener('click', () => modalUndo(card, filename));
      const meta = card.querySelector('.rbg-card-meta');
      if (meta) meta.appendChild(undoEl);
    } else if (st !== 'done' && undoEl) {
      undoEl.remove();
    }
  }

  async function modalUndo(card, filename, opts) {
    const undoBtn = card.querySelector('.rbg-undo');
    const restoreToSelection = opts && opts.returnToSelection;
    if (undoBtn) {
      undoBtn.disabled = true;
      undoBtn.innerHTML = '<span class="rbg-undo-spin"></span> Restoring…';
    }
    try {
      const resp = await fetch(`/items/${state.itemId}/restore-photo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken(),
        },
        body: JSON.stringify({ filename }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const photo = state.photos.find(p => p.filename === filename);
      if (photo) {
        photo.has_original = false;
        if (data.photo && data.photo.url) photo.url = data.photo.url;
      }
      const img = card.querySelector('.rbg-thumb img');
      if (img && data.photo && data.photo.url) {
        const u = data.photo.url;
        img.src = `${u}${u.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      }
      if (data.photo && data.photo.url) refreshHostPageImage(filename, data.photo.url);
      if (restoreToSelection && state.phase === 'select') {
        state.selected.delete(filename);
        renderSelectionGrid();
      } else {
        setCardState(card, 'restored');
      }
    } catch (err) {
      if (undoBtn) {
        undoBtn.disabled = false;
        undoBtn.innerHTML = '<i class="bi bi-arrow-counterclockwise"></i> Undo';
      }
      alert('Could not restore: ' + (err.message || err));
    }
  }

  async function processOne(itemId, filename, card) {
    setCardState(card, 'processing');
    try {
      const resp = await fetch(`/items/${itemId}/remove-bg-photo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken(),
        },
        body: JSON.stringify({ filename }),
      });
      let data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const jobId = data.job_id || (data.job && data.job.id);
      if (jobId) {
        data = await pollRemoveBgJob(itemId, jobId, card);
      }
      if (!data.photo) throw new Error('Background-removal job finished without photo data.');
      const photo = state.photos.find(p => p.filename === filename);
      if (photo) {
        photo.has_original = true;
        if (data.photo && data.photo.url) photo.url = data.photo.url;
      }
      setCardState(card, 'done');
      const img = card.querySelector('.rbg-thumb img');
      if (img && data.photo && data.photo.url) {
        const u = data.photo.url;
        img.src = `${u}${u.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      }
      if (data.photo && data.photo.url) refreshHostPageImage(filename, data.photo.url);
      return true;
    } catch (err) {
      setCardState(card, 'error', (err && err.message) ? err.message.slice(0, 80) : 'Failed');
      const retry = card.querySelector('.rbg-retry');
      if (retry) retry.onclick = () => processOne(itemId, filename, card);
      return false;
    }
  }

  async function pollRemoveBgJob(itemId, jobId, card) {
    const startedAt = Date.now();
    let delay = 1200;
    while (Date.now() - startedAt < 5 * 60 * 1000) {
      if (state.canceled) throw new Error('Canceled');
      await sleep(delay);
      const resp = await fetch(`/items/${itemId}/remove-bg-photo/${encodeURIComponent(jobId)}`, {
        credentials: 'same-origin',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      const job = data.job || {};
      const stateEl = card.querySelector('.rbg-state');
      if (stateEl) {
        stateEl.textContent = job.status === 'queued' ? 'Queued…' : 'Processing…';
      }
      if (job.status === 'done') return data;
      if (job.status === 'error') throw new Error(job.error || 'Background removal failed.');
      delay = Math.min(3000, delay + 300);
    }
    throw new Error('Background removal is still processing. Close and reopen this menu to check the photo.');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ---------- host-page image refresh ------------------------------------

  function refreshHostPageImage(filename, newUrl) {
    const ts = Date.now();
    const target = `${newUrl}${newUrl.includes('?') ? '&' : '?'}_t=${ts}`;
    document.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (src && src.split('?')[0].endsWith(encodeURI(filename))) {
        img.src = target;
      } else if (src && src.split('?')[0] === newUrl.split('?')[0]) {
        img.src = target;
      }
    });
    document.querySelectorAll('[data-photo-urls]').forEach((el) => {
      try {
        const arr = JSON.parse(el.dataset.photoUrls || '[]');
        let changed = false;
        for (let i = 0; i < arr.length; i++) {
          const u = arr[i];
          if (typeof u === 'string' && u.split('?')[0].endsWith(encodeURI(filename))) {
            arr[i] = target;
            changed = true;
          }
        }
        if (changed) el.dataset.photoUrls = JSON.stringify(arr);
      } catch (_) {}
    });
  }

  // ---------- run loop ---------------------------------------------------

  async function run(itemId) {
    openModal();
    state.itemId = itemId;
    state.phase = 'loading';
    setStatus('Loading photos…');
    setSubtitle('');
    hide('[data-rbg-select-all]');
    hide('[data-rbg-select-none]');
    hide('[data-rbg-start]');
    hide('[data-rbg-done]');
    show('[data-rbg-cancel]');

    let listing;
    try {
      const resp = await fetch(`/items/${itemId}/photos.json`);
      listing = await resp.json();
      if (!resp.ok) throw new Error(listing.error || `HTTP ${resp.status}`);
    } catch (err) {
      setStatus(`Could not load photos: ${err.message || err}`);
      return;
    }

    const photos = listing.photos || [];
    if (!photos.length) {
      setStatus('This item has no photos.');
      return;
    }

    state.photos = photos;
    state.selected = new Set(photos.map(p => p.filename));
    enterSelectionPhase();
  }

  // ---------- utilities --------------------------------------------------

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_\-]/g, (ch) => `\\${ch}`);
  }

  window.RemoveBg = {
    start(itemId, opts) {
      if (opts && typeof opts.onDone === 'function') window._rbgOnDone = opts.onDone;
      run(itemId);
    },
  };
})();
