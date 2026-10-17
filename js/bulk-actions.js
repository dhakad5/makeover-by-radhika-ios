/* ==========================================================
 *  bulk-actions.js  —  Multi-select actions for the Bookings table.
 *
 *  Lets the user tick multiple bookings then:
 *    • Mark Done / Mark Scheduled (batch)
 *    • Set price on all selected (batch)
 *    • Delete selected (batch, with one confirm)
 *
 *  A floating action bar appears while ≥1 row is selected.
 *  Selection is keyed by `${clientId}|${bookingId}` so it survives
 *  re-renders (we re-tick the checkboxes after each render).
 *
 *  Depends on globals: Store, toast, confirmAction, render.
 *  Loaded AFTER app.js + bookings-table.js.
 * ========================================================== */

const BulkActions = (() => {
  const _selected = new Set();              // "cid|bid"
  const _key = (cid, bid) => `${cid}|${bid}`;
  const _split = (k) => { const [cid, bid] = k.split('|'); return { cid, bid }; };

  // ---------- selection state -------------------------------------------
  const _checks = () => Array.from(document.querySelectorAll('.bulk-check'));

  const onRowToggle = () => {
    _selected.clear();
    _checks().forEach(cb => { if (cb.checked) _selected.add(_key(cb.dataset.cid, cb.dataset.bid)); });
    _syncSelectAllBoxes();
    _renderBar();
  };

  const onSelectAll = (master) => {
    const table = master.closest('table');
    table?.querySelectorAll('.bulk-check').forEach(cb => {
      cb.checked = master.checked;
      if (master.checked) _selected.add(_key(cb.dataset.cid, cb.dataset.bid));
      else _selected.delete(_key(cb.dataset.cid, cb.dataset.bid));
    });
    _renderBar();
  };

  // Keep each month's "select all" box in sync with its rows.
  const _syncSelectAllBoxes = () => {
    document.querySelectorAll('.bulk-check-all').forEach(master => {
      const rows = Array.from(master.closest('table')?.querySelectorAll('.bulk-check') || []);
      const checkedCount = rows.filter(r => r.checked).length;
      master.checked = rows.length > 0 && checkedCount === rows.length;
      master.indeterminate = checkedCount > 0 && checkedCount < rows.length;
    });
  };

  // Re-apply selection to fresh DOM after a re-render. render() stays the
  // single source of truth; we just re-decorate the new checkboxes (DRY).
  const refresh = () => {
    _checks().forEach(cb => { cb.checked = _selected.has(_key(cb.dataset.cid, cb.dataset.bid)); });
    const live = new Set(_checks().map(cb => _key(cb.dataset.cid, cb.dataset.bid)));
    [..._selected].forEach(k => { if (!live.has(k)) _selected.delete(k); });
    _syncSelectAllBoxes();
    _renderBar();
  };

  const clear = () => {
    _selected.clear();
    _checks().forEach(cb => (cb.checked = false));
    _syncSelectAllBoxes();
    _renderBar();
  };

  // ---------- floating action bar ---------------------------------------
  const _ensureBar = () => {
    let bar = document.getElementById('bulkActionBar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'bulkActionBar';
    bar.className = 'bulk-action-bar';
    bar.innerHTML = `
      <span class="bulk-count"><b id="bulkCount">0</b> selected</span>
      <div class="bulk-btns">
        <button type="button" id="bulkDoneBtn"      class="btn-sage">✓ Mark Done</button>
        <button type="button" id="bulkSchedBtn"     class="btn-ghost">↺ Mark Scheduled</button>
        <button type="button" id="bulkPriceBtn"     class="btn-clay">₹ Set Price</button>
        <button type="button" id="bulkDeleteBtn"    class="btn-danger">🗑 Delete</button>
        <button type="button" id="bulkClearBtn"     class="btn-ghost" title="Clear selection">✕</button>
      </div>`;
    document.body.appendChild(bar);
    bar.querySelector('#bulkDoneBtn').onclick   = () => _setStatus('Done');
    bar.querySelector('#bulkSchedBtn').onclick  = () => _setStatus('Scheduled');
    bar.querySelector('#bulkPriceBtn').onclick  = _setPrice;
    bar.querySelector('#bulkDeleteBtn').onclick = _deleteSelected;
    bar.querySelector('#bulkClearBtn').onclick  = clear;
    return bar;
  };

  const _renderBar = () => {
    const bar = _ensureBar();
    const n = _selected.size;
    document.getElementById('bulkCount').textContent = n;
    bar.classList.toggle('show', n > 0);
  };

  // ---------- batch operations ------------------------------------------
  const _eachSelected = async (fn, verb) => {
    const items = [..._selected];
    if (items.length === 0) return;
    let ok = 0, fail = 0;
    for (const k of items) {
      const { cid, bid } = _split(k);
      try { await fn(cid, bid); ok++; } catch (e) { console.error(`[bulk] ${verb} failed`, e); fail++; }
    }
    clear();
    if (typeof render === 'function') render();
    toast(`${verb}: ${ok} done${fail ? `, ${fail} failed` : ''} ✅`);
  };

  const _setStatus = (status) =>
    _eachSelected((cid, bid) => Store.updateBooking(cid, bid, { status }),
      status === 'Done' ? 'Marked done' : 'Marked scheduled');

  const _setPrice = async () => {
    if (_selected.size === 0) return;
    const raw = prompt(`Set price (₹) for all ${_selected.size} selected booking(s):`, '');
    if (raw === null) return;                       // cancelled
    const price = raw.trim();
    if (price !== '' && isNaN(Number(price))) { toast('Price must be a number.'); return; }
    await _eachSelected((cid, bid) => Store.updateBooking(cid, bid, { price }), 'Price updated');
  };

  const _deleteSelected = async () => {
    if (_selected.size === 0) return;
    const n = _selected.size;
    const ok = await confirmAction({
      title: `Delete ${n} booking${n !== 1 ? 's' : ''}?`,
      message: `This permanently removes the ${n} selected booking${n !== 1 ? 's' : ''}. This cannot be undone.`,
      icon: '🗑️', confirmText: `Yes, Delete ${n}`,
    });
    if (!ok) return;
    await _eachSelected((cid, bid) => Store.deleteBooking(cid, bid), 'Deleted');
  };

  // ---------- live refresh on every render ------------------------------
  // The Store notifies subscribers after every mutation, which triggers
  // render(), which rebuilds the table. We re-sync selection right after.
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof Store !== 'undefined' && Store.subscribe) {
      // Defer so this runs AFTER app.js's render() subscriber rebuilds the DOM.
      Store.subscribe(() => requestAnimationFrame(refresh));
    }
  });

  return { onRowToggle, onSelectAll, refresh, clear };
})();
window.BulkActions = BulkActions;
