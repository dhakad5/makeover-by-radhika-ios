/* ==========================================================
 *  local-api.js  —  On-device replacement for the FastAPI/Spring backend.
 *
 *  Exposes the SAME surface as ApiClient (see api-client.js) and ports the
 *  semantics of backend/store.py 1:1:
 *    • single JSON snapshot  (data/bookings.json)
 *    • auto-backup before every write, keep last MAX_BACKUPS
 *    • additive migrations, PATCH merge rules, mark-all-done, etc.
 *
 *  Storage:
 *    • iOS (Capacitor)   → @capacitor/filesystem, Directory.Data  (survives
 *                          WebView cache purges, included in iCloud/iTunes backup)
 *    • Browser (?local=1) → localStorage  (dev/testing only)
 * ========================================================== */

window.LocalApi = (() => {
  const SCHEMA_VERSION = 3;
  const MAX_BACKUPS = 50;
  const DATA_FILE = 'data/bookings.json';
  const BACKUP_DIR = 'data/backups';

  // ---------- environment ------------------------------------------------
  const isNative = () => !!(window.Capacitor?.isNativePlatform?.());
  const Fs = () => window.Capacitor?.Plugins?.Filesystem;

  // ---------- storage adapter (read/write/list/remove text files) --------
  const LS_PREFIX = 'localapi:';
  const storage = {
    async read(path) {
      if (isNative()) {
        try {
          const r = await Fs().readFile({ path, directory: 'DATA', encoding: 'utf8' });
          return r.data;
        } catch { return null; }              // file missing
      }
      return localStorage.getItem(LS_PREFIX + path);
    },
    async write(path, text) {
      if (isNative()) {
        await Fs().writeFile({ path, directory: 'DATA', encoding: 'utf8', data: text, recursive: true });
      } else {
        localStorage.setItem(LS_PREFIX + path, text);
      }
    },
    async list(dir) {                          // → [{ name, size, mtime(ms) }]
      if (isNative()) {
        try {
          const r = await Fs().readdir({ path: dir, directory: 'DATA' });
          return (r.files || []).map(f => ({ name: f.name, size: f.size || 0, mtime: f.mtime || 0 }));
        } catch { return []; }
      }
      const pre = LS_PREFIX + dir + '/';
      return Object.keys(localStorage).filter(k => k.startsWith(pre)).map(k => {
        const name = k.slice(pre.length);
        const v = localStorage.getItem(k) || '';
        return { name, size: v.length, mtime: Number(localStorage.getItem(LS_PREFIX + 'mtime:' + name)) || 0 };
      });
    },
    async remove(path) {
      if (isNative()) { try { await Fs().deleteFile({ path, directory: 'DATA' }); } catch {/* ignore */} }
      else localStorage.removeItem(LS_PREFIX + path);
    },
  };

  // ---------- helpers ----------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };
  const nowIso = () => new Date().toISOString();
  const uid = () => `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const httpErr = (status, msg) => Object.assign(new Error(`API ${status} ${msg}`), { status });

  // Serialise every operation so read-modify-write cycles never interleave
  // (the Python backend uses an RLock for the same reason).
  let _chain = Promise.resolve();
  const tx = (fn) => {
    const run = _chain.then(fn, fn);
    _chain = run.catch(() => {});
    return run;
  };

  const migrate = (raw) => {
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (!Array.isArray(data.clients)) data.clients = [];
    if (!Array.isArray(data.seasons)) data.seasons = [];
    for (const c of data.clients) {
      c.bookings = Array.isArray(c.bookings) ? c.bookings : [];
      c.services = Array.isArray(c.services) ? c.services : [];
      c.advance ??= 0;
      c.paymentReceived ??= 0;
      c.notes ??= '';
      c.createdAt ??= nowIso();
      for (const b of c.bookings) { b.status ??= 'Scheduled'; b.notes ??= ''; b.createdAt ??= nowIso(); }
      for (const s of c.services) { s.status ??= 'Pending';   s.notes ??= ''; s.createdAt ??= nowIso(); }
    }
    data.schemaVersion = SCHEMA_VERSION;
    return data;
  };

  const emptyDb = () => migrate({ updatedAt: nowIso() });

  // ---------- low-level persistence -------------------------------------
  const prune = async () => {
    const files = (await storage.list(BACKUP_DIR))
      .filter(f => f.name.startsWith('bookings-')).map(f => f.name).sort();
    for (const old of files.slice(0, Math.max(files.length - MAX_BACKUPS, 0))) {
      await storage.remove(`${BACKUP_DIR}/${old}`);
    }
  };

  const autoBackup = async () => {
    const cur = await storage.read(DATA_FILE);
    if (!cur) return null;
    const name = `bookings-${stamp()}.json`;
    await storage.write(`${BACKUP_DIR}/${name}`, cur);
    if (!isNative()) localStorage.setItem(`${LS_PREFIX}mtime:${name}`, String(Date.now()));
    await prune();
    return { name, size: cur.length, createdAt: nowIso() };
  };

  const writeDb = async (data) => {
    data.schemaVersion = SCHEMA_VERSION;
    data.updatedAt = nowIso();
    await storage.write(DATA_FILE, JSON.stringify(data, null, 2));
  };

  const loadDb = async () => {
    const text = await storage.read(DATA_FILE);
    if (text) {
      try { return migrate(JSON.parse(text)); } catch { /* corrupt → fall through */ }
    }
    // First launch: optional bundled seed (scripts/build-www.sh with SEED=…), else empty.
    let seed = null;
    try {
      const r = await fetch('seed.json');
      if (r.ok) seed = await r.json();
    } catch {/* no seed bundled */}
    const db = migrate(seed || {});
    await writeDb(db);
    return db;
  };

  /** read → mutate → (backup + write). `fn(db)` returns [result, shouldWrite=true]. */
  const mutate = (fn) => tx(async () => {
    const db = await loadDb();
    const out = fn(db);
    const [result, write = true] = Array.isArray(out) && out.__tuple ? out : [out, true];
    if (write) { await autoBackup(); await writeDb(db); }
    return clone(result);
  });
  const tuple = (result, write) => Object.assign([result, write], { __tuple: true });

  const findClient = (db, cid) => db.clients.find(c => c.id === cid);
  const notFound = (what) => { throw httpErr(404, `${what} not found`); };

  // ---------- health -----------------------------------------------------
  let _info = null;
  const ping = async () => {
    try {
      const db = await tx(loadDb);
      _info = {
        status: 'ok', schemaVersion: SCHEMA_VERSION,
        dataFile: isNative() ? 'App data/bookings.json' : 'localStorage',
        clientCount: db.clients.length, seasonCount: db.seasons.length,
        backend: 'ios-local', backendVersion: isNative() ? 'On-device (Capacitor)' : 'On-device (browser test mode)',
      };
      return true;
    } catch (e) {
      console.error('[LocalApi] ping failed', e);
      return false;
    }
  };

  // ---------- snapshot ---------------------------------------------------
  const getSnapshot = () => tx(async () => clone(await loadDb()));
  const putSnapshot = (data) => tx(async () => {
    await autoBackup();
    const migrated = migrate(clone(data));
    await writeDb(migrated);
    return clone(migrated);
  });

  // ---------- clients ----------------------------------------------------
  const listClients = () => tx(async () => clone((await loadDb()).clients));
  const getClient = (cid) => tx(async () => {
    const c = findClient(await loadDb(), cid);
    return c ? clone(c) : notFound(`Client ${cid}`);
  });
  const createClient = (p) => mutate((db) => {
    const client = {
      id: uid(), name: String(p.name).trim(), phone: String(p.phone).trim(), type: p.type,
      advance: Number(p.advance) || 0, paymentReceived: Number(p.paymentReceived) || 0,
      notes: (p.notes || '').trim(), createdAt: nowIso(), bookings: [], services: [],
    };
    db.clients.push(client);
    return client;
  });
  const updateClient = (cid, patch) => mutate((db) => {
    const c = findClient(db, cid) || notFound(`Client ${cid}`);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) continue;
      c[k] = k === 'advance' ? Number(v) : v;
    }
    return c;
  });
  const deleteClient = (cid) => mutate((db) => {
    const before = db.clients.length;
    db.clients = db.clients.filter(c => c.id !== cid);
    if (db.clients.length === before) notFound(`Client ${cid}`);
    return null;
  }).then(() => null);

  // ---------- nested collections (bookings / services) ------------------
  // `nullableKeys`: keys for which an explicit null is meaningful (price=null → "pending").
  const nestedApi = (key, label, build) => ({
    add: (cid, p) => mutate((db) => {
      const c = findClient(db, cid) || notFound(`Client ${cid}`);
      const item = build(p);
      (c[key] ||= []).push(item);
      return item;
    }),
    update: (cid, iid, patch) => mutate((db) => {
      const c = findClient(db, cid) || notFound(`Client ${cid}`);
      const item = (c[key] || []).find(x => x.id === iid) || notFound(`${label} ${iid} (client ${cid})`);
      for (const [k, v] of Object.entries(patch)) {
        if ((v === null || v === undefined) && k !== 'price') continue;
        item[k] = v === undefined ? null : v;
      }
      return item;
    }),
    remove: (cid, iid) => mutate((db) => {
      const c = findClient(db, cid) || notFound(`Client ${cid}`);
      const before = (c[key] || []).length;
      c[key] = (c[key] || []).filter(x => x.id !== iid);
      if (c[key].length === before) notFound(`${label} ${iid} (client ${cid})`);
      return null;
    }).then(() => null),
  });

  const bookings = nestedApi('bookings', 'Booking', (p) => ({
    id: uid(), date: p.date, makeupType: p.makeupType, timing: p.timing,
    price: p.price ?? null, status: p.status || 'Scheduled',
    notes: (p.notes || '').trim(), createdAt: nowIso(),
  }));
  const services = nestedApi('services', 'Service', (p) => ({
    id: uid(), name: String(p.name).trim(), price: p.price ?? null,
    status: p.status || 'Pending', notes: (p.notes || '').trim(), createdAt: nowIso(),
  }));

  const markAllDone = (cid) => mutate((db) => {
    const c = findClient(db, cid) || notFound(`Client ${cid}`);
    let changed = 0;
    for (const b of c.bookings || []) if (b.status !== 'Done') { b.status = 'Done'; changed++; }
    for (const s of c.services || []) if (s.status !== 'Done') { s.status = 'Done'; changed++; }
    return tuple({ client: c, changed }, changed > 0);
  });

  // ---------- seasons ----------------------------------------------------
  const listSeasons = () => tx(async () => clone((await loadDb()).seasons));
  const createSeason = (p) => mutate((db) => {
    const s = { id: uid(), label: String(p.label).trim(), startDate: p.startDate, endDate: p.endDate };
    db.seasons.push(s);
    return s;
  });
  const updateSeason = (sid, patch) => mutate((db) => {
    const s = db.seasons.find(x => x.id === sid) || notFound(`Season ${sid}`);
    for (const [k, v] of Object.entries(patch)) if (v !== null && v !== undefined) s[k] = v;
    return s;
  });
  const deleteSeason = (sid) => mutate((db) => {
    const before = db.seasons.length;
    db.seasons = db.seasons.filter(s => s.id !== sid);
    if (db.seasons.length === before) notFound(`Season ${sid}`);
    return null;
  }).then(() => null);

  // ---------- backups ----------------------------------------------------
  const listBackups = () => tx(async () => {
    const files = (await storage.list(BACKUP_DIR)).filter(f => f.name.startsWith('bookings-'));
    return files
      .sort((a, b) => b.name.localeCompare(a.name))
      .map(f => ({ name: f.name, size: f.size, createdAt: f.mtime ? new Date(f.mtime).toISOString() : parseStampName(f.name) }));
  });
  // bookings-YYYYMMDD-HHMMSS.json → ISO (fallback when the FS gives no mtime)
  const parseStampName = (name) => {
    const m = /bookings-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : nowIso();
  };
  const createBackup = () => tx(async () => {
    const info = await autoBackup();
    if (!info) throw httpErr(400, 'Data file is empty — nothing to back up.');
    return info;
  });
  const getBackup = (name) => tx(async () => {
    if (/[\\/]/.test(name) || !name.startsWith('bookings-')) notFound(`Backup ${name}`);
    const text = await storage.read(`${BACKUP_DIR}/${name}`);
    return text ? JSON.parse(text) : notFound(`Backup ${name}`);
  });

  return {
    ping, isOnline: () => true, baseUrl: () => 'On this device', backendInfo: () => _info,
    getSnapshot, putSnapshot,
    listClients, createClient, getClient, updateClient, deleteClient,
    addBooking: bookings.add, updateBooking: bookings.update, deleteBooking: bookings.remove,
    addService: services.add, updateService: services.update, deleteService: services.remove,
    markAllDone,
    listSeasons, createSeason, updateSeason, deleteSeason,
    listBackups, createBackup, getBackup,
    downloadBackupUrl: () => '#',          // unused on-device; Backups.download() uses NativeIO
    _isNative: isNative,
  };
})();
