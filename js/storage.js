/* ==========================================================
 *  storage.js  —  In-memory cache + granular API persistence
 *
 *  Architecture:
 *    • Source of truth      = backend file (data/bookings.json)
 *    • In-memory cache      = synchronous reads for UI
 *    • localStorage         = READ-ONLY fallback if backend is offline
 *    • Every MUTATION       = awaits the matching REST endpoint,
 *                             then updates the cache from the
 *                             authoritative server response.
 *
 *  Reads are sync. Writes are ASYNC — callers must `await`.
 * ========================================================== */

const STORAGE_KEY        = 'glamour_bookings_v1';   // offline read cache only
const FIRST_SYNC_KEY     = 'glamour_synced_v1';      // marks first successful backend sync
const SCHEMA_VERSION     = 3;

/** Fixed display/sort order for timing slots. */
const TIMING_RANK = { Morning: 0, Day: 1, Evening: 2, Night: 3 };

const Store = (() => {
  // ===== in-memory cache (the only thing reads see) ======================
  let _cache = { schemaVersion: SCHEMA_VERSION, clients: [], seasons: [] };
  let _online = false;                            // backend reachable?
  let _readOnly = false;                          // true when offline
  const _subscribers = new Set();

  // ===== migrations (additive — never drop fields) =======================
  const _migrate = (raw) => {
    const data = raw && typeof raw === 'object' ? raw : {};
    if (!Array.isArray(data.clients)) data.clients = [];
    if (!Array.isArray(data.seasons)) data.seasons = [];
    data.clients = data.clients.map(c => ({
      bookings: [], services: [], advance: 0, notes: '', createdAt: new Date().toISOString(),
      ...c,
      bookings: (c.bookings || []).map(b => ({
        status: 'Scheduled', notes: '', createdAt: new Date().toISOString(), ...b,
      })),
      services: (c.services || []).map(s => ({
        status: 'Pending', notes: '', createdAt: new Date().toISOString(), ...s,
      })),
    }));
    data.schemaVersion = SCHEMA_VERSION;
    return data;
  };

  // ===== cache I/O =======================================================
  /** Replace cache + persist a read-only mirror to localStorage. Notifies subscribers. */
  const _set = (data) => {
    _cache = _migrate(data);
    _cache.updatedAt = new Date().toISOString();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache)); } catch {/* quota */}
    _subscribers.forEach(fn => { try { fn(_cache); } catch (e) { console.error(e); } });
  };

  /** Splice a single item back into the cache (after a granular API mutation). */
  const _upsertClient = (client) => {
    const i = _cache.clients.findIndex(c => c.id === client.id);
    // Preserve nested bookings if server doesn't echo them (PATCH responses may not).
    const merged = { bookings: i >= 0 ? _cache.clients[i].bookings : [], ...client };
    if (i >= 0) _cache.clients[i] = merged; else _cache.clients.push(merged);
    _set(_cache);
  };
  const _removeClient = (cid) => {
    _cache.clients = _cache.clients.filter(c => c.id !== cid);
    _set(_cache);
  };
  const _upsertBooking = (cid, booking) => {
    const c = _cache.clients.find(x => x.id === cid);
    if (!c) return;
    c.bookings = c.bookings || [];
    const i = c.bookings.findIndex(b => b.id === booking.id);
    if (i >= 0) c.bookings[i] = booking; else c.bookings.push(booking);
    _set(_cache);
  };
  const _removeBooking = (cid, bid) => {
    const c = _cache.clients.find(x => x.id === cid);
    if (!c) return;
    c.bookings = (c.bookings || []).filter(b => b.id !== bid);
    _set(_cache);
  };
  const _upsertSeason = (season) => {
    const i = _cache.seasons.findIndex(s => s.id === season.id);
    if (i >= 0) _cache.seasons[i] = season; else _cache.seasons.push(season);
    _set(_cache);
  };
  const _removeSeason = (sid) => {
    _cache.seasons = _cache.seasons.filter(s => s.id !== sid);
    _set(_cache);
  };
  const _upsertService = (cid, service) => {
    const c = _cache.clients.find(x => x.id === cid);
    if (!c) return;
    c.services = c.services || [];
    const i = c.services.findIndex(s => s.id === service.id);
    if (i >= 0) c.services[i] = service; else c.services.push(service);
    _set(_cache);
  };
  const _removeService = (cid, sid) => {
    const c = _cache.clients.find(x => x.id === cid);
    if (!c) return;
    c.services = (c.services || []).filter(s => s.id !== sid);
    _set(_cache);
  };

  // ===== offline-write guard ============================================
  const _requireOnline = (action) => {
    if (_readOnly) {
      const msg = `🔌 Backend offline — cannot ${action}. Start the server with ./start.sh`;
      if (typeof toast === 'function') toast(msg); else console.warn(msg);
      throw new Error(`Backend offline; ${action} blocked.`);
    }
  };

  // ===== derived helpers (unchanged from before) =========================
  const clientStatus = (client) => (Number(client.advance) > 0 ? 'Confirmed' : 'Tentative');
  const clientTotals = (client) => {
    const bookingsTotal = (client.bookings || []).reduce((s, b) => s + (Number(b.price) || 0), 0);
    const servicesTotal = (client.services || []).reduce((s, x) => s + (Number(x.price) || 0), 0);
    const grossTotal      = bookingsTotal + servicesTotal;
    const discount        = Number(client.discount || 0);
    const total           = Math.max(grossTotal - discount, 0);
    const advance         = Number(client.advance || 0);
    const paymentReceived = Number(client.paymentReceived || 0);
    const totalPaid       = advance + paymentReceived;
    return {
      grossTotal, discount, total, bookingsTotal, servicesTotal,
      advance, paymentReceived, totalPaid,
      balance: Math.max(total - totalPaid, 0),
    };
  };
  const compareByDateAndTiming = (a, b) => {
    const da = a.date || '', db = b.date || '';
    if (da !== db) return da.localeCompare(db);
    return (TIMING_RANK[a.timing] ?? 99) - (TIMING_RANK[b.timing] ?? 99);
  };

  // =====================================================================
  //  PUBLIC API
  // =====================================================================
  return {
    // ----- bootstrap (called once at boot from app.js) -----------------
    /** Try backend → seed cache from server. Fall back to localStorage. */
    async bootstrap() {
      _online = typeof ApiClient !== 'undefined' && await ApiClient.ping();
      if (_online) {
        const remote = await ApiClient.getSnapshot();
        const alreadySynced = !!localStorage.getItem(FIRST_SYNC_KEY);
        const localRaw = localStorage.getItem(STORAGE_KEY);
        const local = localRaw ? _migrate(JSON.parse(localRaw)) : null;
        const remoteEmpty = !remote.clients?.length && !remote.seasons?.length;
        const localHasData = local && (local.clients.length + local.seasons.length) > 0;

        // First-ever install only: if backend has nothing but localStorage has
        // data, lift the local cache up to the server (don't lose your data).
        // After the first sync, the SERVER is always the source of truth —
        // an empty server stays empty, even if localStorage still has stale data.
        if (!alreadySynced && remoteEmpty && localHasData) {
          await ApiClient.putSnapshot(local);
          _set(local);
          if (typeof toast === 'function') toast('📤 Local cache migrated to backend.');
        } else {
          _set(remote);
        }
        localStorage.setItem(FIRST_SYNC_KEY, '1');     // mark first sync done forever
        _readOnly = false;
      } else {
        // Backend down → READ-ONLY mode from last known localStorage cache.
        _readOnly = true;
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) _set(_migrate(JSON.parse(raw)));
        } catch (e) { console.error('Cache parse failed:', e); }
      }
      return { online: _online, readOnly: _readOnly };
    },

    isOnline()  { return _online; },
    isReadOnly() { return _readOnly; },
    schemaVersion: SCHEMA_VERSION,

    // ----- CLIENTS (reads sync, writes async) --------------------------
    all() { return _cache.clients; },
    get(id) { return _cache.clients.find(c => c.id === id) || null; },

    async addClient(payload) {
      _requireOnline('add client');
      const c = await ApiClient.createClient({
        name: payload.name.trim(),
        phone: payload.phone.trim(),
        type: payload.type,
        advance: Number(payload.advance) || 0,
        paymentReceived: Number(payload.paymentReceived) || 0,
        notes: (payload.notes || '').trim(),
      });
      _upsertClient(c);
      return c;
    },

    async updateClient(id, patch) {
      _requireOnline('update client');
      const cleaned = { ...patch };
      if ('advance' in cleaned) cleaned.advance = Number(cleaned.advance) || 0;
      if ('paymentReceived' in cleaned) cleaned.paymentReceived = Number(cleaned.paymentReceived) || 0;
      const c = await ApiClient.updateClient(id, cleaned);
      _upsertClient(c);
      return c;
    },

    async deleteClient(id) {
      _requireOnline('delete client');
      await ApiClient.deleteClient(id);
      _removeClient(id);
    },

    // ----- BOOKINGS ---------------------------------------------------
    async addBooking(clientId, booking) {
      _requireOnline('add booking');
      const b = await ApiClient.addBooking(clientId, {
        date: booking.date,
        makeupType: booking.makeupType,
        timing: booking.timing,
        price: booking.price === '' || booking.price == null ? null : Number(booking.price),
        status: booking.status || 'Scheduled',
      });
      _upsertBooking(clientId, b);
      return b;
    },

    async updateBooking(clientId, bookingId, patch) {
      _requireOnline('update booking');
      const cleaned = { ...patch };
      if ('price' in cleaned) {
        cleaned.price = cleaned.price === '' || cleaned.price == null ? null : Number(cleaned.price);
      }
      const b = await ApiClient.updateBooking(clientId, bookingId, cleaned);
      _upsertBooking(clientId, b);
      return b;
    },

    async deleteBooking(clientId, bookingId) {
      _requireOnline('delete booking');
      await ApiClient.deleteBooking(clientId, bookingId);
      _removeBooking(clientId, bookingId);
    },

    async markBookingDone(clientId, bookingId) {
      return this.updateBooking(clientId, bookingId, { status: 'Done' });
    },

    // ----- SEASONS ----------------------------------------------------
    seasons() {
      return _cache.seasons.slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    },
    getSeason(id) { return _cache.seasons.find(s => s.id === id) || null; },

    async addSeason({ label, startDate, endDate }) {
      _requireOnline('add season');
      const s = await ApiClient.createSeason({ label: label.trim(), startDate, endDate });
      _upsertSeason(s);
      return s;
    },

    async updateSeason(id, patch) {
      _requireOnline('update season');
      const s = await ApiClient.updateSeason(id, patch);
      _upsertSeason(s);
      return s;
    },

    async deleteSeason(id) {
      _requireOnline('delete season');
      await ApiClient.deleteSeason(id);
      _removeSeason(id);
    },

    // ----- SERVICES (non-date-bound add-ons) --------------------------
    async addService(clientId, service) {
      _requireOnline('add service');
      const s = await ApiClient.addService(clientId, {
        name: service.name.trim(),
        price: service.price === '' || service.price == null ? null : Number(service.price),
        status: service.status || 'Pending',
        notes: (service.notes || '').trim(),
      });
      _upsertService(clientId, s);
      return s;
    },

    async updateService(clientId, serviceId, patch) {
      _requireOnline('update service');
      const cleaned = { ...patch };
      if ('price' in cleaned) {
        cleaned.price = cleaned.price === '' || cleaned.price == null ? null : Number(cleaned.price);
      }
      const s = await ApiClient.updateService(clientId, serviceId, cleaned);
      _upsertService(clientId, s);
      return s;
    },

    async deleteService(clientId, serviceId) {
      _requireOnline('delete service');
      await ApiClient.deleteService(clientId, serviceId);
      _removeService(clientId, serviceId);
    },

    async markServiceDone(clientId, serviceId) {
      return this.updateService(clientId, serviceId, { status: 'Done' });
    },

    // ----- BULK ACTIONS -----------------------------------------------
    /**
     * Mark every booking AND service for a client as Done in ONE backend
     * call (single auto-backup, single atomic file write).
     * Returns { changed } so the UI can show a meaningful toast.
     */
    async markAllDone(clientId) {
      _requireOnline('mark all done');
      const { client, changed } = await ApiClient.markAllDone(clientId);
      _upsertClient(client);
      return { changed };
    },

    /** Seed default Nov-Apr seasons from existing booking years (one POST each). */
    async ensureSeasons() {
      if (_cache.seasons.length > 0) return;
      _requireOnline('seed seasons');
      const startYears = new Set();
      const bucketYear = (iso) => {
        const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7));
        if (m >= 11) return y; if (m <= 4) return y - 1; return y;
      };
      for (const c of _cache.clients) {
        for (const b of (c.bookings || [])) if (b.date) startYears.add(bucketYear(b.date));
      }
      startYears.add(bucketYear(new Date().toISOString().slice(0, 10)));
      for (const y of [...startYears].sort()) {
        await this.addSeason({
          label: `${y}-${y + 1}`,
          startDate: `${y}-11-01`,
          endDate:   `${y + 1}-04-30`,
        });
      }
    },

    // ----- DERIVED HELPERS --------------------------------------------
    clientStatus, clientTotals, compareByDateAndTiming, TIMING_RANK,

    allBookings() {
      const out = [];
      for (const c of _cache.clients) {
        for (const b of (c.bookings || [])) {
          out.push({ ...b, clientId: c.id, clientName: c.name, clientPhone: c.phone, clientType: c.type });
        }
      }
      return out;
    },

    years() {
      const set = new Set();
      for (const c of _cache.clients) {
        for (const b of (c.bookings || [])) if (b.date) set.add(new Date(b.date).getFullYear());
      }
      return [...set].sort((a, b) => b - a);
    },

    // ----- BULK SNAPSHOT (used by data-io export/import) --------------
    snapshot() { return JSON.parse(JSON.stringify(_cache)); },

    async replaceAll(raw) {
      _requireOnline('replace all data');
      const replaced = await ApiClient.putSnapshot(raw);
      _set(replaced);
      return replaced;
    },

    subscribe(fn) { _subscribers.add(fn); return () => _subscribers.delete(fn); },

    reset() { localStorage.removeItem(STORAGE_KEY); },
  };
})();
