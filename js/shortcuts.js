/* ==========================================================
 *  shortcuts.js  —  Keyboard shortcut help panel + a couple of
 *  new global shortcuts. Press "?" (Shift+/) anywhere to open.
 *
 *  We DON'T re-implement existing shortcuts ('/', '+', Esc) — those
 *  live in their own modules. This file just (a) documents them in a
 *  discoverable cheat-sheet and (b) adds a few convenience keys.
 *
 *  Depends on globals: ShellUI (ui-shell.js), openClientModal (app.js).
 * ========================================================== */

const Shortcuts = (() => {
  // Single source of truth for the cheat-sheet. Add a row here and it
  // shows up in the panel automatically (DRY).
  const KEYS = [
    { keys: ['/'],        desc: 'Focus the search box' },
    { keys: ['+'],        desc: 'Open the quick-add menu (FAB)' },
    { keys: ['?'],        desc: 'Show this shortcuts panel' },
    { keys: ['n'],        desc: 'New client' },
    { keys: ['g', 'o'],   desc: 'Go to Overview' },
    { keys: ['g', 'c'],   desc: 'Go to Clients' },
    { keys: ['g', 'b'],   desc: 'Go to Calendar & Bookings' },
    { keys: ['a'],        desc: 'Open the activity log' },
    { keys: ['Esc'],      desc: 'Close any open modal / menu' },
  ];

  const _kbd = (k) =>
    `<kbd class="px-2 py-0.5 rounded-md bg-sage-50 border border-sage-200 text-sage font-mono text-xs font-semibold">${k}</kbd>`;

  const renderList = () => {
    const list = document.getElementById('shortcutsList');
    if (!list) return;
    list.innerHTML = KEYS.map(({ keys, desc }) => `
      <div class="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-rose-50">
        <span class="text-sm text-ink">${desc}</span>
        <span class="flex items-center gap-1 shrink-0">
          ${keys.map(_kbd).join('<span class="text-gray-300 text-xs">then</span>')}
        </span>
      </div>`).join('');
  };

  const open  = () => { renderList(); document.getElementById('shortcutsModal')?.classList.add('modal-open'); };
  const close = () => document.getElementById('shortcutsModal')?.classList.remove('modal-open');
  const toggle = () => {
    const m = document.getElementById('shortcutsModal');
    if (!m) return;
    m.classList.contains('modal-open') ? close() : open();
  };

  // ---------- key handling ----------------------------------------------
  // "g" is a leader key: g→o, g→c, g→b. Times out after 800ms.
  let _leader = false, _leaderTimer = null;
  const _armLeader = () => {
    _leader = true;
    clearTimeout(_leaderTimer);
    _leaderTimer = setTimeout(() => { _leader = false; }, 800);
  };

  document.addEventListener('keydown', (e) => {
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (inField || e.metaKey || e.ctrlKey || e.altKey) return;

    // Leader sequences (g + letter)
    if (_leader) {
      _leader = false;
      const go = { o: 'overview', c: 'clients', b: 'calendar' }[e.key];
      if (go && window.ShellUI) { e.preventDefault(); ShellUI.switchTab(go); }
      return;
    }

    switch (e.key) {
      case '?':                                   // Shift+/ on most layouts
        e.preventDefault(); toggle(); break;
      case 'g':
        _armLeader(); break;
      case 'n':
        if (typeof openClientModal === 'function') { e.preventDefault(); openClientModal(); }
        break;
      case 'a':
        if (window.AuditLog) { e.preventDefault(); AuditLog.open(); }
        break;
    }
  });

  return { open, close, toggle };
})();
window.Shortcuts = Shortcuts;
