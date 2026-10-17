/* ==========================================================
 *  seasons.js  —  Season selector + management.
 *  A "season" is a custom date window (typically Nov-Apr) used
 *  as a global filter for Dashboard, Clients, and All Bookings.
 *
 *  Depends on globals from storage.js (Store) and app.js
 *  ($, $$, escapeHtml, fdate, toast, render, confirmAction).
 *  Loaded BEFORE app.js so `Seasons` is defined when boot runs.
 * ========================================================== */

const ACTIVE_SEASON_KEY = 'glamour_active_season_v1';

const Seasons = (() => {
  // ---------- internals --------------------------------------------------
  /** Pick the season that contains today; fallback = upcoming; else first. */
  const _autoCurrent = () => {
    const all = Store.seasons();
    if (all.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const containing = all.find(s => today >= s.startDate && today <= s.endDate);
    if (containing) return containing;
    // Otherwise pick the next upcoming season; if none, the most recent.
    const upcoming = all.slice().reverse().find(s => s.startDate > today);
    return upcoming || all[0];
  };

  let _activeId = localStorage.getItem(ACTIVE_SEASON_KEY) || null;
  let _editingId = null;

  // ---------- public state -----------------------------------------------
  const getActive = () => {
    const all = Store.seasons();
    if (_activeId === 'ALL') return null;          // sentinel = "All Seasons"
    let s = all.find(x => x.id === _activeId);
    if (!s) {
      s = _autoCurrent();
      _activeId = s ? s.id : null;
      if (_activeId) localStorage.setItem(ACTIVE_SEASON_KEY, _activeId);
    }
    return s;
  };

  const isAllMode = () => _activeId === 'ALL';

  const setActive = (id) => {
    _activeId = id;
    if (id) localStorage.setItem(ACTIVE_SEASON_KEY, id);
    else    localStorage.removeItem(ACTIVE_SEASON_KEY);
    renderSelector();
    if (typeof render === 'function') render();
  };

  /** Booking-date predicate: does this date fall in the active season? */
  const dateInActive = (iso) => {
    if (isAllMode()) return true;
    const s = getActive();
    if (!s) return true;          // no seasons defined yet => don't constrain
    if (!iso) return false;       // undated bookings are excluded from a season view
    return iso >= s.startDate && iso <= s.endDate;
  };

  /**
   * After bootstrap: if the persisted active season would hide ALL the user's
   * data, fall back to 'All Seasons' so the dashboard isn't deceptively empty.
   * Returns true if it switched.
   */
  const autoFallbackIfEmpty = () => {
    if (isAllMode()) return false;
    const active = getActive();
    if (!active) return false;
    const totalClients = Store.all().length;
    if (totalClients === 0) return false;
    // Any booking in the active window?
    const anyInSeason = Store.all().some(c =>
      (c.bookings || []).some(b => b.date >= active.startDate && b.date <= active.endDate)
    );
    if (anyInSeason) return false;
    // Nothing in this season — but data exists elsewhere. Switch to ALL.
    setActive('ALL');
    toast(`🌐 Switched to “All Seasons” — no bookings in “${active.label}”.`);
    return true;
  };
  /**
   * If `iso` falls outside the active season, jump to a season that contains
   * it (or to 'All Seasons' if none match). Returns true if it switched.
   * Used after Add/Edit Booking so the new row is never hidden.
   */
  const ensureVisibleFor = (iso) => {
    if (!iso || dateInActive(iso)) return false;
    const match = Store.seasons().find(s => iso >= s.startDate && iso <= s.endDate);
    if (match) {
      setActive(match.id);
      toast(`🍂 Jumped to “${match.label}” to show your new booking.`);
    } else {
      setActive('ALL');
      toast('🌐 Switched to “All Seasons” — booking date is outside every season.');
    }
    return true;
  };

  // ---------- selector bar ----------------------------------------------
  const renderSelector = () => {
    const sel = document.getElementById('seasonSelect');
    if (!sel) return;
    const all = Store.seasons();
    const active = getActive();
    const activeVal = isAllMode() ? 'ALL' : (active ? active.id : '');
    sel.innerHTML = [
      '<option value="ALL">🌐 All Seasons</option>',
      ...all.map(s => `<option value="${s.id}" ${s.id === activeVal ? 'selected' : ''}>${escapeHtml(s.label)} &nbsp;(${fdate(s.startDate)} → ${fdate(s.endDate)})</option>`),
    ].join('');
    if (activeVal) sel.value = activeVal;

    // Subtitle pill describing the window
    const sub = document.getElementById('seasonSubtitle');
    if (sub) {
      if (isAllMode()) {
        sub.textContent = 'Showing data across all seasons';
      } else if (active) {
        sub.textContent = `${fdate(active.startDate)} → ${fdate(active.endDate)}`;
      } else {
        sub.textContent = 'No seasons configured yet — click Manage to add one';
      }
    }
  };

  // ---------- manage modal (list of seasons) ----------------------------
  const openManage = () => {
    renderManageList();
    document.getElementById('seasonManageModal').classList.add('modal-open');
  };
  const closeManage = () => document.getElementById('seasonManageModal').classList.remove('modal-open');

  const renderManageList = () => {
    const list = document.getElementById('seasonManageList');
    const all = Store.seasons();
    if (all.length === 0) {
      list.innerHTML = '<div class="text-center py-8 text-gray-500 italic">No seasons yet. Click "+ New Season" to add one.</div>';
      return;
    }
    list.innerHTML = all.map(s => `
      <div class="flex items-center justify-between gap-3 p-3 bg-rose-50/60 border border-rose-100 rounded-xl">
        <div class="min-w-0">
          <div class="font-bold text-wine">${escapeHtml(s.label)}</div>
          <div class="text-xs text-gray-600">${fdate(s.startDate)} → ${fdate(s.endDate)}</div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button onclick="Seasons.openEdit('${s.id}')" class="text-xs border border-wine text-wine px-3 py-1.5 rounded-lg hover:bg-rose-50">Edit</button>
          <button onclick="Seasons.remove('${s.id}')" class="text-xs text-rose-700 px-3 py-1.5 rounded-lg hover:bg-rose-100">🗑 Delete</button>
        </div>
      </div>
    `).join('');
  };

  // ---------- edit/add modal --------------------------------------------
  const openEdit = (id = null) => {
    _editingId = id;
    const form = document.getElementById('seasonForm');
    form.reset();
    if (id) {
      const s = Store.getSeason(id);
      if (!s) return;
      document.getElementById('seasonFormTitle').textContent = 'Edit Season';
      document.getElementById('seasonLabel').value = s.label;
      document.getElementById('seasonStart').value = s.startDate;
      document.getElementById('seasonEnd').value   = s.endDate;
    } else {
      // Suggest the next season after the latest existing one.
      const all = Store.seasons();
      const lastYear = all.length
        ? Math.max(...all.map(s => Number(s.startDate.slice(0, 4))))
        : new Date().getFullYear();
      const nextYear = lastYear + 1;
      document.getElementById('seasonFormTitle').textContent = 'New Season';
      document.getElementById('seasonLabel').value = `${nextYear}-${nextYear + 1}`;
      document.getElementById('seasonStart').value = `${nextYear}-11-01`;
      document.getElementById('seasonEnd').value   = `${nextYear + 1}-04-30`;
    }
    document.getElementById('seasonFormModal').classList.add('modal-open');
  };
  const closeEdit = () => document.getElementById('seasonFormModal').classList.remove('modal-open');

  const _submit = async (e) => {
    e.preventDefault();
    const label = document.getElementById('seasonLabel').value.trim();
    const startDate = document.getElementById('seasonStart').value;
    const endDate   = document.getElementById('seasonEnd').value;
    if (!label || !startDate || !endDate) { toast('Label, start, and end are required.'); return; }
    if (startDate > endDate) { toast('Start date must be on or before end date.'); return; }

    try {
      if (_editingId) {
        await Store.updateSeason(_editingId, { label, startDate, endDate });
        toast('Season updated 🍂');
      } else {
        const s = await Store.addSeason({ label, startDate, endDate });
        _activeId = s.id;
        localStorage.setItem(ACTIVE_SEASON_KEY, s.id);
        toast('Season created ✨');
      }
      closeEdit();
      renderSelector();
      renderManageList();
      if (typeof render === 'function') render();
    } catch (err) {
      console.error(err);
      toast('❌ Save failed: ' + err.message);
    }
  };

  const remove = async (id) => {
    const s = Store.getSeason(id);
    if (!s) return;
    const ok = await confirmAction({
      title: `Delete season "${s.label}"?`,
      message: 'This only removes the season window. Your bookings & clients are untouched.',
      icon: '🗑️',
      confirmText: 'Yes, Delete Season',
    });
    if (!ok) return;
    try {
      await Store.deleteSeason(id);
      if (_activeId === id) {
        _activeId = null;
        localStorage.removeItem(ACTIVE_SEASON_KEY);
      }
      renderSelector();
      renderManageList();
      if (typeof render === 'function') render();
      toast('Season deleted.');
    } catch (err) {
      console.error(err);
      toast('❌ Delete failed: ' + err.message);
    }
  };

  // ---------- boot -------------------------------------------------------
  const init = async () => {
    if (!Store.isReadOnly()) {
      try { await Store.ensureSeasons(); }
      catch (e) { console.warn('ensureSeasons failed (likely offline):', e); }
    }
    // Resolve the active season (may auto-pick if persisted ID is stale).
    getActive();
    // If the persisted season would hide all data, fall back to ALL.
    autoFallbackIfEmpty();
    renderSelector();

    document.getElementById('seasonSelect').addEventListener('change', (e) => setActive(e.target.value));
    document.getElementById('seasonManageBtn').addEventListener('click', openManage);
    document.getElementById('seasonNewBtnInline').addEventListener('click', () => openEdit());
    document.getElementById('seasonNewBtnManage').addEventListener('click', () => openEdit());
    document.getElementById('seasonForm').addEventListener('submit', _submit);
  };

  return {
    init, getActive, isAllMode, setActive, dateInActive, ensureVisibleFor,
    autoFallbackIfEmpty,
    openManage, closeManage, openEdit, closeEdit, remove,
    renderSelector, renderManageList,
  };
})();
