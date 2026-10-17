/* ==========================================================
 *  ui-quick.js  —  Quick UX upgrades for the Sage & Terracotta redesign:
 *    • Floating Action Button (FAB) with quick-add menu
 *    • Quick filter chips (Upcoming / Confirmed / Tentative / etc.)
 *    • Keyboard shortcuts (+ opens FAB, / focuses search, Esc closes)
 *
 *  Plays nice with existing globals: applyFilters, clearFilters,
 *  openClientModal, openBookingModal, Store, toast.
 * ========================================================== */

(function () {
  // ---------- FAB toggle ----------
  const fabBtn      = document.getElementById('fabBtn');
  const fabMenu     = document.getElementById('fabMenu');
  const fabBackdrop = document.getElementById('fabBackdrop');

  window.toggleFab = function (force) {
    if (!fabBtn || !fabMenu || !fabBackdrop) return;
    const willOpen = (force === undefined) ? !fabMenu.classList.contains('open') : !!force;
    fabMenu.classList.toggle('open',     willOpen);
    fabBackdrop.classList.toggle('open', willOpen);
    fabBtn.classList.toggle('open',      willOpen);
    fabBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  };

  // ---------- Quick "Add Booking" prompt ----------
  // Opens the booking modal for the FIRST client, or asks the user to pick one
  // if there are many. Saves the user from drilling into a client first.
  window.quickAddBookingPrompt = function () {
    const clients = Store.all();
    if (!clients.length) {
      toast('Add a client first — then you can add bookings.');
      openClientModal();
      return;
    }
    if (clients.length === 1) {
      openBookingModal(clients[0].id);
      return;
    }
    // Multi-client: switch to Clients tab + focus top search, hint the user.
    if (window.ShellUI) ShellUI.switchTab('clients');
    document.querySelector('#topSearch')?.focus();
    toast('Pick a client below, then tap "+ Add Booking" on their card.');
  };

  // ---------- Quick filter chips ----------
  // Each chip maps to a preset combination of the existing filter inputs.
  // Single source of truth — we set inputs then call applyFilters(),
  // so all downstream logic Just Works (DRY).
  const QUICK_PRESETS = {
    upcoming: () => {
      clearFiltersSilently();
      const today = new Date().toISOString().slice(0, 10);
      document.querySelector('#filterFrom').value = today;
    },
    confirmed: () => {
      clearFiltersSilently();
      document.querySelector('#filterStatus').value = 'Confirmed';
    },
    tentative: () => {
      clearFiltersSilently();
      document.querySelector('#filterStatus').value = 'Tentative';
    },
    bride: () => {
      clearFiltersSilently();
      document.querySelector('#filterType').value = 'Bride';
    },
    party: () => {
      clearFiltersSilently();
      document.querySelector('#filterType').value = 'Party';
    },
    pendingDue: () => {
      // No direct filter input for balance > 0, so we let applyFilters do its
      // thing then post-filter by hiding zero-balance cards in render().
      clearFiltersSilently();
      window.__quickPendingDueOnly = true;
    },
  };

  function clearFiltersSilently() {
    window.__quickPendingDueOnly = false;
    ['filterName', 'filterPhone', 'filterFrom', 'filterTo', 'filterYear', 'filterType', 'filterStatus']
      .forEach(id => { const el = document.querySelector('#' + id); if (el) el.value = ''; });
    // Also clear the calendar's selected-day highlight so the UI stays consistent
    if (typeof Calendar !== 'undefined' && Calendar.clearDayUI) Calendar.clearDayUI();
  }

  document.querySelectorAll('.chip[data-quick]').forEach(chip => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.quick;
      const isActive = chip.classList.contains('active');

      // De-activate all other chips (single-select)
      document.querySelectorAll('.chip[data-quick]').forEach(c => c.classList.remove('active'));

      if (isActive) {
        // Toggle off → clear filters
        clearFilters?.();
        window.__quickPendingDueOnly = false;
        return;
      }

      chip.classList.add('active');
      QUICK_PRESETS[key]?.();
      applyFilters?.();
    });
  });

  // Expose so other modules (e.g. stat cards in ui-shell.js) can trigger
  window.applyQuickFilter = function (key) {
    const chip = document.querySelector(`.chip[data-quick="${key}"]`);
    if (chip) { chip.click(); }
    else { QUICK_PRESETS[key]?.(); applyFilters?.(); }
  };

  // ---------- Keyboard shortcuts ----------
  // '+' anywhere      → toggle FAB menu
  // '/'              → focus name search
  // 'Esc'            → close FAB if open
  document.addEventListener('keydown', (e) => {
    // Don't hijack when user is typing in a form field
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (e.key === '+' && !inField) {
      e.preventDefault();
      toggleFab();
    } else if (e.key === 'Escape') {
      if (fabMenu?.classList.contains('open')) toggleFab(false);
    }
    // '/' shortcut handled by ui-shell.js (focuses top search)
  });

  console.log('[ui-quick] FAB + quick filters + shortcuts ready.');
})();
