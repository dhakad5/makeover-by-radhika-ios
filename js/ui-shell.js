/* ==========================================================
 *  ui-shell.js  —  App-shell controller (Sage & Terracotta v2)
 *
 *  Responsibilities:
 *    • Tab switching (Overview / Clients / Calendar / Bookings)
 *    • Overview widgets (Today, This Week, Balance Due)
 *    • Top-bar global search → bridges to existing filter inputs
 *    • Mobile sidebar toggle
 *    • Data-menu panel collapse
 *    • Stat-card click-to-jump (with optional quick-filter preset)
 *
 *  Plays nice with all existing modules. Single source of truth:
 *  the Store and the existing `applyFilters()` / `clearFilters()`.
 * ========================================================== */

window.ShellUI = (function () {
  const $  = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  // ---------- Tab switching ----------
  const VALID_TABS = ['overview', 'clients', 'calendar'];
  function switchTab(name) {
    if (!VALID_TABS.includes(name)) name = 'overview';
    $$('.sidebar-tab').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
    // Calendar needs a re-render after becoming visible (its grid layout depends on layout)
    if (name === 'calendar' && typeof Calendar !== 'undefined') {
      requestAnimationFrame(() => Calendar.render?.());
    }
    // Sync URL hash (deep-linkable + survives reload)
    if (location.hash.slice(1) !== name) {
      history.replaceState(null, '', name === 'overview' ? location.pathname : '#' + name);
    }
    closeSidebar();
    // Scroll main content area to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $$('.sidebar-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // Honor URL hash on load (e.g. /#calendar)
  const initialTab = location.hash.slice(1);
  if (initialTab && VALID_TABS.includes(initialTab)) {
    document.addEventListener('DOMContentLoaded', () => switchTab(initialTab));
  }
  window.addEventListener('hashchange', () => switchTab(location.hash.slice(1) || 'overview'));

  // ---------- Stat-card → jump (+ optional quick preset) ----------
  // Cards with a press-and-hold privacy reveal (js/privacy-mode.js) set a
  // one-shot window.__suppressCardJump flag right when a hold is detected,
  // so the click that inevitably fires on release never ALSO navigates.
  $$('.stat-card[data-jump]').forEach(card => {
    card.addEventListener('click', () => {
      if (window.__suppressCardJump) { window.__suppressCardJump = false; return; }
      const targetTab = card.dataset.jump;
      const quick = card.dataset.quick;
      if (quick && window.applyQuickFilter) window.applyQuickFilter(quick);
      switchTab(targetTab);
    });
  });

  // ---------- Mobile sidebar ----------
  const sidebar = $('#appSidebar');
  const backdrop = $('#sidebarBackdrop');
  function openSidebar()  { sidebar?.classList.add('open');  backdrop?.classList.add('open'); }
  function closeSidebar() { sidebar?.classList.remove('open'); backdrop?.classList.remove('open'); }
  $('#mobileNavBtn')?.addEventListener('click', openSidebar);

  // ---------- Data menu panel toggle ----------
  $('#dataMenuBtn')?.addEventListener('click', () => {
    $('#dataMenuPanel')?.classList.toggle('open');
  });

  // ---------- Top-bar search → unified "smart search" (matches name OR phone) ----------
  // Wired through Filters.read() which now picks up #topSearch as `Filters.search`.
  // Single source of truth, no input mirroring needed (DRY).
  const topSearch = $('#topSearch');
  let _searchTimer = null;
  let _previousQuery = '';
  topSearch?.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      const q = topSearch.value.trim();

      // Re-run filters + re-render (no toast/scroll spam)
      if (typeof Filters !== 'undefined') {
        Filters.read();
        if (typeof render === 'function') render();
        if (typeof renderActiveFilterChips === 'function') renderActiveFilterChips();
      }

      // Auto-jump to Clients tab ONLY on the keystroke that turns search non-empty
      // (not every subsequent keystroke). Stops the page from scrolling to top while typing.
      const wasEmpty = _previousQuery === '';
      const isNow    = q !== '';
      if (wasEmpty && isNow) {
        const activeTab = document.querySelector('.sidebar-tab.active')?.dataset.tab;
        if (activeTab !== 'clients') switchTab('clients');
      }
      _previousQuery = q;
    }, 180);
  });
  topSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { topSearch.value = ''; topSearch.dispatchEvent(new Event('input')); }
  });

  // ---------- '/' shortcut focuses top search ----------
  document.addEventListener('keydown', (e) => {
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (e.key === '/' && !inField) {
      e.preventDefault();
      topSearch?.focus();
    } else if (e.key === 'Escape') {
      closeSidebar();
      $('#dataMenuPanel')?.classList.remove('open');
    }
  });

  // ==========================================================
  //  OVERVIEW WIDGETS  —  Today / This Week / Balance Due
  //  Re-rendered automatically via Store.subscribe (set below).
  // ==========================================================
  const inr   = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
  const fdate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  function gatherUpcomingRows(clients, startISO, endISO) {
    const rows = [];
    clients.forEach(c => (c.bookings || []).forEach(b => {
      if (!b.date) return;
      if (b.date < startISO || b.date > endISO) return;
      if (b.status === 'Done') return;
      rows.push({ client: c, booking: b });
    }));
    rows.sort((a, b) => a.booking.date.localeCompare(b.booking.date));
    return rows;
  }

  function renderWidget(containerId, countId, rows, emptyText, formatter) {
    const container = $('#' + containerId);
    const countEl = $('#' + countId);
    if (!container) return;
    if (countEl) countEl.textContent = rows.length;
    if (rows.length === 0) {
      container.innerHTML = `<div class="widget-empty">${emptyText}</div>`;
      return;
    }
    // Render ALL rows; the .widget-body CSS (max-height + overflow-y:auto) keeps the
    // panel bounded and scrollable, so we don't need an arbitrary JS cap that would
    // make the badge count disagree with what the user actually sees.
    container.innerHTML = rows.map(formatter).join('');
    // Each row jumps to the client drawer on click
    $$('.widget-row[data-client]', container).forEach(r => {
      r.addEventListener('click', () => window.openClientDrawer?.(r.dataset.client));
    });
  }

  function renderOverview() {
    if (typeof Store === 'undefined') return;
    const clients = Store.all();
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();

    // --- Today ---
    const todayRows = gatherUpcomingRows(clients, today, today);
    renderWidget('overviewToday', 'overviewTodayCount', todayRows,
      'Nothing scheduled today. ✨',
      ({ client, booking }) => `
        <div class="widget-row" data-client="${client.id}">
          <div class="widget-row-main">
            <div class="widget-row-name">${escape(client.name)}</div>
            <div class="widget-row-sub">${escape(booking.makeupType)} • ${booking.timing} • ${escape(client.phone)}</div>
          </div>
          <div class="widget-row-amount">${booking.price != null ? inr(booking.price) : '—'}</div>
        </div>`);

    // --- This Week ---
    const weekRows = gatherUpcomingRows(clients, today, weekEnd).filter(r => r.booking.date > today);
    renderWidget('overviewWeek', 'overviewWeekCount', weekRows,
      'No bookings in the next 7 days.',
      ({ client, booking }) => `
        <div class="widget-row" data-client="${client.id}">
          <div class="widget-row-main">
            <div class="widget-row-name">${escape(client.name)} <span class="widget-row-sub" style="display:inline">· ${fdate(booking.date)}</span></div>
            <div class="widget-row-sub">${escape(booking.makeupType)} • ${booking.timing}</div>
          </div>
          <div class="widget-row-amount">${booking.price != null ? inr(booking.price) : '—'}</div>
        </div>`);

    // --- Balance Due ---
    const dueClients = clients
      .map(c => ({ c, t: Store.clientTotals(c) }))
      .filter(x => x.t.balance > 0)
      .sort((a, b) => b.t.balance - a.t.balance);
    renderWidget('overviewDue', 'overviewDueCount', dueClients,
      'All clients are paid up! 🎉',
      ({ c, t }) => `
        <div class="widget-row" data-client="${c.id}">
          <div class="widget-row-main">
            <div class="widget-row-name">${escape(c.name)}</div>
            <div class="widget-row-sub">${escape(c.phone)} • ${(c.bookings || []).length} bookings</div>
          </div>
          <div class="widget-row-amount">${inr(t.balance)}</div>
        </div>`);

    // Sidebar count badges are updated by renderDashboard() in app.js so they
    // respect the active season + search/type/status filters (DRY — one source of truth).
  }

  function escape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Hook into Store for live updates
  if (typeof Store !== 'undefined' && typeof Store.subscribe === 'function') {
    Store.subscribe(() => renderOverview());
  }
  // Initial render after DOM ready
  document.addEventListener('DOMContentLoaded', renderOverview);

  console.log('[ui-shell] App-shell ready: tabs, search, sidebar, overview widgets.');

  return { switchTab, openSidebar, closeSidebar };
})();
