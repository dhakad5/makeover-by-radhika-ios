/* ==========================================================
 *  undo.js  —  Soft-undo for deletes (clients, bookings, services).
 *
 *  HOW IT WORKS
 *    • We wrap the three Store delete methods. BEFORE the delete
 *      runs we snapshot the full entity. AFTER it succeeds we show
 *      an "Undo" toast with a recovery window (default 8s).
 *    • Clicking Undo re-creates the entity through the normal add
 *      endpoints. (IDs may change, but all data is preserved — the
 *      backend is the source of truth and assigns fresh IDs.)
 *
 *  This composes on top of audit-log.js's wrappers — JS function
 *  wrapping stacks cleanly, so both features observe every delete.
 *
 *  Depends on globals: Store, $, render, openClientDrawer (optional).
 *  Loaded AFTER app.js + audit-log.js.
 * ========================================================== */

const UndoManager = (() => {
  const WINDOW_MS = 8000;
  let _timer = null;

  // ---------- toast UI ---------------------------------------------------
  const _hide = () => {
    const el = document.getElementById('undoToast');
    if (el) el.classList.remove('show');
    clearTimeout(_timer);
  };

  /** Show the undo toast. `onUndo` is an async fn that restores the entity. */
  const _show = (message, onUndo) => {
    const el  = document.getElementById('undoToast');
    const msg = document.getElementById('undoToastMsg');
    const btn = document.getElementById('undoToastBtn');
    if (!el || !msg || !btn) return;

    msg.textContent = message;
    el.classList.add('show');

    // Fresh handler each time (avoid stacking listeners).
    btn.onclick = async () => {
      _hide();
      try {
        await onUndo();
        if (typeof render === 'function') render();
        if (typeof toast === 'function') toast('Restored ↩️');
      } catch (e) {
        console.error('[undo] restore failed', e);
        if (typeof toast === 'function') toast('❌ Undo failed: ' + e.message);
      }
    };

    clearTimeout(_timer);
    _timer = setTimeout(_hide, WINDOW_MS);
  };

  // ---------- restore builders ------------------------------------------
  // Re-create a client and all of its nested bookings + services.
  const _restoreClient = (snap) => async () => {
    const c = await Store.addClient({
      name: snap.name, phone: snap.phone, type: snap.type,
      advance: snap.advance, paymentReceived: snap.paymentReceived,
      notes: snap.notes,
    });
    // addClient doesn't carry discount — patch it back if present.
    if (Number(snap.discount) > 0) await Store.updateClient(c.id, { discount: snap.discount });
    for (const b of (snap.bookings || [])) {
      await Store.addBooking(c.id, b);
    }
    for (const s of (snap.services || [])) {
      await Store.addService(c.id, s);
    }
  };
  const _restoreBooking = (cid, snap) => async () => {
    if (!Store.get(cid)) throw new Error('client no longer exists');
    await Store.addBooking(cid, snap);
  };
  const _restoreService = (cid, snap) => async () => {
    if (!Store.get(cid)) throw new Error('client no longer exists');
    await Store.addService(cid, snap);
  };

  // ---------- Store wrapping --------------------------------------------
  let _wired = false;
  const wireStore = () => {
    if (_wired || typeof Store === 'undefined') return;
    _wired = true;

    const origDeleteClient  = Store.deleteClient.bind(Store);
    const origDeleteBooking = Store.deleteBooking.bind(Store);
    const origDeleteService = Store.deleteService.bind(Store);

    Store.deleteClient = async (id) => {
      const snap = JSON.parse(JSON.stringify(Store.get(id) || {}));
      const r = await origDeleteClient(id);
      if (snap.name) _show(`Deleted “${snap.name}”.`, _restoreClient(snap));
      return r;
    };

    Store.deleteBooking = async (cid, bid) => {
      const c = Store.get(cid);
      const b = (c?.bookings || []).find(x => x.id === bid);
      const snap = b ? JSON.parse(JSON.stringify(b)) : null;
      const r = await origDeleteBooking(cid, bid);
      if (snap) _show(`Deleted ${snap.makeupType} (${snap.timing}).`, _restoreBooking(cid, snap));
      return r;
    };

    Store.deleteService = async (cid, sid) => {
      const c = Store.get(cid);
      const s = (c?.services || []).find(x => x.id === sid);
      const snap = s ? JSON.parse(JSON.stringify(s)) : null;
      const r = await origDeleteService(cid, sid);
      if (snap) _show(`Deleted service “${snap.name}”.`, _restoreService(cid, snap));
      return r;
    };
  };

  document.addEventListener('DOMContentLoaded', wireStore);

  return { wireStore };
})();
window.UndoManager = UndoManager;
