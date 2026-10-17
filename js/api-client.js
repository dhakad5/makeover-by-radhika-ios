/* ==========================================================
 *  api-client.js  —  Thin fetch wrapper for the backend.
 *
 *  Auto-detects the backend on boot via GET /api/health.
 *  When available, Store routes ALL mutations through here
 *  AND mirrors them to localStorage as an offline cache.
 *  When unavailable, the app silently falls back to
 *  localStorage-only (i.e. opens index.html directly works).
 * ========================================================== */

const RemoteApi = (() => {
  // Same-origin if served by FastAPI, else default to localhost:8000.
  const BASE = (() => {
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:8000';
    return ''; // same origin
  })();

  let _online = false;

  const _url  = (p) => `${BASE}${p}`;
  const _opts = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const _fetch = async (path, init) => {
    const res = await fetch(_url(path), init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${init?.method || 'GET'} ${path} → ${res.status} ${text}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };

  // ---------- health / detection ----------------------------------------
  // ---------- health / detection ----------------------------------------
  let _backendInfo = null;     // populated by ping() so the UI can show "java" vs "python"

  const ping = async () => {
    try {
      const r = await fetch(_url('/api/health'), { method: 'GET' });
      _online = r.ok;
      if (r.ok) {
        // Cache the health payload so renderBadge() can show backend identity
        try { _backendInfo = await r.clone().json(); } catch { _backendInfo = null; }
      }
      return _online;
    } catch {
      _online = false;
      _backendInfo = null;
      return false;
    }
  };
  const isOnline = () => _online;
  const baseUrl  = () => BASE || window.location.origin;
  const backendInfo = () => _backendInfo;

  // ---------- snapshot ---------------------------------------------------
  const getSnapshot = ()      => _fetch('/api/data');
  const putSnapshot = (data)  => _fetch('/api/data', _opts('PUT', data));

  // ---------- clients ----------------------------------------------------
  const listClients   = ()              => _fetch('/api/clients');
  const createClient  = (payload)       => _fetch('/api/clients', _opts('POST', payload));
  const getClient     = (cid)           => _fetch(`/api/clients/${cid}`);
  const updateClient  = (cid, patch)    => _fetch(`/api/clients/${cid}`, _opts('PATCH', patch));
  const deleteClient  = (cid)           => _fetch(`/api/clients/${cid}`, _opts('DELETE'));

  // ---------- bookings ---------------------------------------------------
  const addBooking    = (cid, b)        => _fetch(`/api/clients/${cid}/bookings`, _opts('POST', b));
  const updateBooking = (cid, bid, p)   => _fetch(`/api/clients/${cid}/bookings/${bid}`, _opts('PATCH', p));
  const deleteBooking = (cid, bid)      => _fetch(`/api/clients/${cid}/bookings/${bid}`, _opts('DELETE'));

  // ---------- services (non-date-bound add-ons) -------------------------
  const addService    = (cid, s)        => _fetch(`/api/clients/${cid}/services`, _opts('POST', s));
  const updateService = (cid, sid, p)   => _fetch(`/api/clients/${cid}/services/${sid}`, _opts('PATCH', p));
  const deleteService = (cid, sid)      => _fetch(`/api/clients/${cid}/services/${sid}`, _opts('DELETE'));

  // ---------- bulk actions ----------------------------------------------
  const markAllDone   = (cid)           => _fetch(`/api/clients/${cid}/mark-all-done`, _opts('POST'));

  // ---------- seasons ----------------------------------------------------
  const listSeasons   = ()              => _fetch('/api/seasons');
  const createSeason  = (payload)       => _fetch('/api/seasons', _opts('POST', payload));
  const updateSeason  = (sid, patch)    => _fetch(`/api/seasons/${sid}`, _opts('PATCH', patch));
  const deleteSeason  = (sid)           => _fetch(`/api/seasons/${sid}`, _opts('DELETE'));

  // ---------- backups ----------------------------------------------------
  const listBackups   = ()              => _fetch('/api/backups');
  const createBackup  = ()              => _fetch('/api/backups', _opts('POST'));
  const getBackup     = (name)          => _fetch(`/api/backups/${encodeURIComponent(name)}`);
  const downloadBackupUrl = (name)      => _url(`/api/backups/${encodeURIComponent(name)}`);

  return {
    ping, isOnline, baseUrl, backendInfo,
    getSnapshot, putSnapshot,
    listClients, createClient, getClient, updateClient, deleteClient,
    addBooking, updateBooking, deleteBooking,
    addService, updateService, deleteService,
    markAllDone,
    listSeasons, createSeason, updateSeason, deleteSeason,
    listBackups, createBackup, getBackup, downloadBackupUrl,
  };
})();

// iOS app (Capacitor) or ?local=1 test mode → everything runs on-device via LocalApi.
// Otherwise talk to the FastAPI / Spring Boot server as before.
const ApiClient = (window.LocalApi &&
  (window.Capacitor?.isNativePlatform?.() || /[?&]local=1\b/.test(window.location.search)))
  ? window.LocalApi
  : RemoteApi;
