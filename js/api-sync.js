/* ==========================================================
 *  api-sync.js  —  Just renders the backend status badge.
 *  Persistence used to live here as a debounced full-snapshot
 *  PUT; that was retired in favor of granular per-CRUD API
 *  calls in storage.js. This module is now ~30 lines of pure UI.
 * ========================================================== */

const ApiSync = (() => {
  // Tiny lookup — maps the backend ID returned by /api/health to a pretty label + icon
  const BACKEND_LABELS = {
    'ios-local':        { icon: '📱', label: 'On-device', color: 'emerald' },
    'spring-boot-java': { icon: '☕', label: 'Java',   color: 'orange' },
    'fastapi-python':   { icon: '🐍', label: 'Python', color: 'sky' },
  };

  const renderBadge = () => {
    // Two slots: one inside the data drawer (#backendStatusBadge), one always-visible in the top bar (#backendStatusBadgeTop).
    const slots = ['backendStatusBadge', 'backendStatusBadgeTop']
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (!slots.length) return;

    let html;
    if (Store.isOnline()) {
      const info = (typeof ApiClient !== 'undefined' && ApiClient.backendInfo) ? ApiClient.backendInfo() : null;
      const bk   = info?.backend || 'unknown';
      const meta = BACKEND_LABELS[bk] || { icon: '❓', label: bk, color: 'gray' };
      const tooltip = info
        ? `${info.backendVersion || ''} — ${ApiClient.baseUrl()}`
        : ApiClient.baseUrl();
      html = `
        <span class="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px] font-semibold"
              title="${tooltip}">
          🟢 Connected
          <span class="inline-flex items-center gap-0.5 ml-1 px-1.5 py-px rounded-full bg-white border border-${meta.color}-200 text-${meta.color}-700">
            ${meta.icon} ${meta.label}
          </span>
        </span>`;
    } else {
      html = `<span class="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-[11px] font-semibold" title="No backend. Run ./start-java.sh or ./start.sh to enable writes.">⚠️ Offline</span>`;
    }
    slots.forEach(el => { el.innerHTML = html; });
  };

  const renderReadOnlyBanner = () => {
    if (!Store.isReadOnly()) return;
    if (document.getElementById('readOnlyBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'readOnlyBanner';
    banner.className = 'fixed top-0 inset-x-0 z-[100] bg-amber-500 text-white text-center text-sm font-semibold py-1.5 shadow-lg';
    banner.innerHTML = '🔌 Backend offline — viewing cached data in <b>read-only mode</b>. Start the server with <code class="bg-amber-700/40 px-1 rounded">./start.sh</code> to make changes.';
    document.body.prepend(banner);
    document.body.style.paddingTop = '32px';
  };

  return { renderBadge, renderReadOnlyBanner };
})();
