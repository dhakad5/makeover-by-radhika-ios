/* ==========================================================
 *  audit-log.js  —  "Who changed what, when" activity trail.
 *
 *  HOW IT WORKS
 *    • We wrap every mutating Store.* method exactly once and
 *      record a human-readable entry AFTER the call succeeds.
 *    • For deletes we snapshot the entity name BEFORE the call
 *      (it's gone afterwards).
 *    • Entries live in localStorage as a capped ring buffer so
 *      the log survives reloads but never grows unbounded.
 *
 *  Single source of truth: the Store. We never duplicate data —
 *  we just observe its mutations.
 *
 *  Depends on globals: Store (storage.js), $ / escapeHtml (app.js).
 *  Loaded AFTER app.js so those exist.
 * ========================================================== */

const AuditLog = (() => {
  const KEY = 'glamour_audit_log_v1';
  const CAP = 500;                       // keep the most recent N entries

  // ---------- persistence ------------------------------------------------
  const _load = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  };
  const _save = (list) => {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP))); }
    catch { /* quota — oldest entries silently roll off */ }
  };

  let _entries = _load();

  /** Append one entry. `action` is a short verb, `detail` a sentence. */
  const record = (action, detail, meta = {}) => {
    _entries.push({
      id: 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      who: meta.who || 'You',           // future-proof for multi-staff
      action,
      detail,
    });
    _save(_entries);
    // Live-refresh the panel if it's open.
    if (document.getElementById('auditModal')?.classList.contains('modal-open')) renderList();
  };

  const entries = () => _entries.slice().reverse();   // newest first
  const clear = () => { _entries = []; _save(_entries); renderList(); };

  // ---------- Store wrapping (the magic) ---------------------------------
  // Each wrapper records AFTER a successful call. For deletes we capture a
  // label up front because the entity vanishes once the call resolves.
  let _wired = false;
  const wireStore = () => {
    if (_wired || typeof Store === 'undefined') return;
    _wired = true;

    const wrap = (name, build) => {
      const orig = Store[name];
      if (typeof orig !== 'function') return;
      Store[name] = async function (...args) {
        const pre = build.pre ? build.pre(...args) : undefined;
        const result = await orig.apply(Store, args);
        try { const e = build.post(result, pre, ...args); if (e) record(e.action, e.detail); }
        catch (err) { console.warn('[audit] record failed', err); }
        return result;
      };
    };

    const cname = (id) => Store.get(id)?.name || 'a client';

    // ----- clients -----
    wrap('addClient',    { post: (c) => ({ action: 'Add Client',    detail: `Added client “${c.name}”.` }) });
    wrap('updateClient', { post: (c) => ({ action: 'Edit Client',   detail: `Updated client “${c.name}”.` }) });
    wrap('deleteClient', {
      pre:  (id) => cname(id),
      post: (_r, name) => ({ action: 'Delete Client', detail: `Deleted client “${name}”.` }),
    });

    // ----- bookings -----
    wrap('addBooking', {
      pre:  (cid) => cname(cid),
      post: (b, name) => ({ action: 'Add Booking', detail: `Added ${b.makeupType} (${b.timing}) for “${name}”.` }),
    });
    wrap('updateBooking', {
      pre:  (cid) => cname(cid),
      post: (b, name) => ({ action: 'Edit Booking', detail: `Updated ${b.makeupType} (${b.timing}) for “${name}”.` }),
    });
    wrap('deleteBooking', {
      pre: (cid, bid) => {
        const c = Store.get(cid);
        const b = (c?.bookings || []).find(x => x.id === bid);
        return { name: c?.name || 'a client', label: b ? `${b.makeupType} (${b.timing})` : 'a booking' };
      },
      post: (_r, pre) => ({ action: 'Delete Booking', detail: `Deleted ${pre.label} for “${pre.name}”.` }),
    });

    // ----- services -----
    wrap('addService', {
      pre:  (cid) => cname(cid),
      post: (s, name) => ({ action: 'Add Service', detail: `Added service “${s.name}” for “${name}”.` }),
    });
    wrap('updateService', {
      pre:  (cid) => cname(cid),
      post: (s, name) => ({ action: 'Edit Service', detail: `Updated service “${s.name}” for “${name}”.` }),
    });
    wrap('deleteService', {
      pre: (cid, sid) => {
        const c = Store.get(cid);
        const s = (c?.services || []).find(x => x.id === sid);
        return { name: c?.name || 'a client', label: s ? s.name : 'a service' };
      },
      post: (_r, pre) => ({ action: 'Delete Service', detail: `Deleted service “${pre.label}” for “${pre.name}”.` }),
    });

    // ----- bulk + seasons -----
    wrap('markAllDone', {
      pre:  (cid) => cname(cid),
      post: (r, name) => ({ action: 'Bulk Done', detail: `Marked ${r.changed} item(s) done for “${name}”.` }),
    });
    wrap('addSeason',    { post: (s) => ({ action: 'Add Season',    detail: `Added season “${s.label}”.` }) });
    wrap('updateSeason', { post: (s) => ({ action: 'Edit Season',   detail: `Updated season “${s.label}”.` }) });
    wrap('deleteSeason', {
      pre:  (id) => Store.getSeason(id)?.label || 'a season',
      post: (_r, label) => ({ action: 'Delete Season', detail: `Deleted season “${label}”.` }),
    });
    wrap('replaceAll', { post: () => ({ action: 'Import Data', detail: 'Replaced all data from an import/restore.' }) });
  };

  // ---------- UI ---------------------------------------------------------
  const ICONS = {
    'Add Client': '👰', 'Edit Client': '✏️', 'Delete Client': '🗑️',
    'Add Booking': '💄', 'Edit Booking': '✏️', 'Delete Booking': '🗑️',
    'Add Service': '💆', 'Edit Service': '✏️', 'Delete Service': '🗑️',
    'Bulk Done': '✅', 'Add Season': '🌿', 'Edit Season': '🌿',
    'Delete Season': '🗑️', 'Import Data': '📥',
  };

  const _relTime = (iso) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)     return 'just now';
    if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const _absTime = (iso) =>
    new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const renderList = () => {
    const list = document.getElementById('auditList');
    if (!list) return;
    const q = (document.getElementById('auditSearch')?.value || '').toLowerCase();
    const rows = entries().filter(e =>
      !q || e.action.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q));

    document.getElementById('auditCount').textContent = rows.length;

    if (rows.length === 0) {
      list.innerHTML = `<div class="text-center text-gray-400 italic py-10">${
        q ? 'No entries match your search.' : 'No activity recorded yet. Make a change and it’ll show up here. ✨'
      }</div>`;
      return;
    }
    list.innerHTML = rows.map(e => `
      <div class="flex items-start gap-3 px-4 py-2.5 border-b border-rose-50 hover:bg-rose-50/40">
        <div class="text-lg leading-none mt-0.5">${ICONS[e.action] || '•'}</div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-ink">${escapeHtml(e.detail)}</div>
          <div class="text-[11px] text-gray-400 mt-0.5">
            <span class="font-semibold text-sage">${escapeHtml(e.action)}</span>
            • ${escapeHtml(e.who)} • <span title="${_absTime(e.ts)}">${_relTime(e.ts)}</span>
          </div>
        </div>
      </div>`).join('');
  };

  const open = () => {
    renderList();
    document.getElementById('auditModal')?.classList.add('modal-open');
  };
  const close = () => document.getElementById('auditModal')?.classList.remove('modal-open');

  // ---------- boot -------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    wireStore();
    document.getElementById('auditSearch')?.addEventListener('input', renderList);
    document.getElementById('auditClearBtn')?.addEventListener('click', async () => {
      const ok = typeof confirmAction === 'function'
        ? await confirmAction({
            title: 'Clear activity log?',
            message: 'This erases the local activity history. Your bookings & clients are NOT affected.',
            icon: '🧹', confirmText: 'Yes, Clear Log',
          })
        : confirm('Clear activity log?');
      if (ok) { clear(); if (typeof toast === 'function') toast('Activity log cleared'); }
    });
  });

  return { record, entries, clear, open, close, wireStore };
})();
window.AuditLog = AuditLog;
