/* ==========================================================
 *  data-io.js  —  JSON file export / import + optional
 *  auto-sync to a real file on disk via the File System Access
 *  API (Chrome / Edge / Brave). Safari/Firefox fall back to
 *  manual Export/Import buttons.
 *
 *  Data-safety guarantees (per user request):
 *    1. SCHEMA-VERSIONED + additive migrations only.
 *    2. Before any Import REPLACE, current data is auto-downloaded
 *       as a safety snapshot — old data is never lost silently.
 *    3. Import supports "Merge" mode (default) which only adds
 *       missing clients/seasons; nothing is overwritten or removed.
 *
 *  Depends on globals: Store, toast, confirmAction.
 * ========================================================== */

const DataIO = (() => {
  const FILE_HANDLE_DB = 'makeover_data_io';
  const FILE_HANDLE_KEY = 'syncFileHandle';

  let _fileHandle = null;     // FileSystemFileHandle when auto-sync is active
  let _syncTimer = null;

  const supportsFS = () => 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;

  // ---------- IndexedDB tiny helper (only to persist the file handle) ----
  const _idb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const _idbGet = async (key) => {
    const db = await _idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('handles', 'readonly');
      const r = tx.objectStore('handles').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  };
  const _idbSet = async (key, val) => {
    const db = await _idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  };
  const _idbDel = async (key) => {
    const db = await _idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete(key);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  };

  // ---------- pure helpers ----------------------------------------------
  const _stamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };

  const _payload = () => ({
    ...Store.snapshot(),
    exportedAt: new Date().toISOString(),
    appName: 'Makeover By Radhika',
  });

  const _downloadBlob = (blob, filename) => NativeIO.saveBlob(blob, filename);

  // ---------- EXPORT (manual download) ----------------------------------
  const exportJson = () => {
    const json = JSON.stringify(_payload(), null, 2);
    _downloadBlob(new Blob([json], { type: 'application/json' }), `makeover-data-${_stamp()}.json`);
    toast('Data exported 💾');
  };

  // ---------- IMPORT (manual file pick) ---------------------------------
  /** Read a File → parsed JSON object (throws on invalid). */
  const _readFile = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { try { res(JSON.parse(r.result)); } catch (e) { rej(e); } };
    r.onerror = () => rej(r.error);
    r.readAsText(file);
  });

  /** Merge mode: only ADD missing items (by id). Never overwrites or removes. */
  const _merge = async (incoming) => {
    const cur = Store.snapshot();
    const existingClients = new Set(cur.clients.map(c => c.id));
    const existingSeasons = new Set(cur.seasons.map(s => s.id));

    let addedC = 0, addedS = 0, mergedB = 0;
    (incoming.clients || []).forEach(ic => {
      if (!existingClients.has(ic.id)) {
        cur.clients.push(ic);
        addedC++;
      } else {
        // Merge bookings only (don't touch top-level client fields).
        const target = cur.clients.find(c => c.id === ic.id);
        const known = new Set((target.bookings || []).map(b => b.id));
        (ic.bookings || []).forEach(b => {
          if (!known.has(b.id)) { target.bookings.push(b); mergedB++; }
        });
      }
    });
    (incoming.seasons || []).forEach(is => {
      if (!existingSeasons.has(is.id)) { cur.seasons.push(is); addedS++; }
    });
    await Store.replaceAll(cur);
    return { addedClients: addedC, addedSeasons: addedS, addedBookings: mergedB };
  };

  const importJson = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      let incoming;
      try { incoming = await _readFile(file); }
      catch (e) { toast('❌ Invalid JSON file.'); return; }

      // Ask MERGE vs REPLACE (replace is destructive, so confirm hard).
      const mode = await _askImportMode(incoming);
      if (!mode) return;

      if (mode === 'merge') {
        const r = await _merge(incoming);
        toast(`Merged: +${r.addedClients} clients, +${r.addedSeasons} seasons, +${r.addedBookings} bookings`);
      } else {
        // SAFETY: download current data first so nothing is ever lost silently.
        // On iOS the store already auto-snapshots before every write (see 🛡️ Backups),
        // so skip popping the share sheet mid-import.
        if (!NativeIO.isNative()) exportJson();
        await Store.replaceAll(incoming);
        toast(NativeIO.isNative()
          ? '✅ Data replaced. Previous data is in 🛡️ Backups.'
          : '✅ Data replaced. Your previous data was downloaded as backup.');
      }
      if (typeof render === 'function') render();
      if (typeof Seasons !== 'undefined') Seasons.renderSelector();
    };
    input.click();
  };

  /** Prompt user for merge vs replace via the existing confirm dialog. */
  const _askImportMode = async (incoming) => {
    const inCount = (incoming.clients || []).length;
    const curCount = Store.snapshot().clients.length;
    // Two-step confirm: first ask if they want to merge, decline → replace prompt.
    const wantMerge = await confirmAction({
      title: 'How should we import?',
      message: `Incoming: ${inCount} client(s). Current: ${curCount}. Choose MERGE to add only new items (safest). Cancel to choose REPLACE.`,
      icon: '🔀',
      confirmText: 'Merge (safe)',
      cancelText: 'Replace…',
      danger: false,
    });
    if (wantMerge) return 'merge';
    const wantReplace = await confirmAction({
      title: 'Replace all current data?',
      message: `This will REPLACE your ${curCount} client(s) with the ${inCount} from the file. Your current data will be auto-downloaded as a safety backup first.`,
      icon: '⚠️',
      confirmText: 'Yes, Replace All',
      cancelText: 'Cancel',
      danger: true,
    });
    return wantReplace ? 'replace' : null;
  };

  // ---------- AUTO-SYNC (File System Access API) ------------------------
  const _verifyPermission = async (handle, write = true) => {
    const opts = { mode: write ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  };

  const _writeToHandle = async () => {
    if (!_fileHandle) return;
    try {
      if (!(await _verifyPermission(_fileHandle, true))) {
        toast('⚠️ File permission denied — auto-sync paused.');
        return;
      }
      const writable = await _fileHandle.createWritable();
      await writable.write(JSON.stringify(_payload(), null, 2));
      await writable.close();
      _renderStatus();
    } catch (e) {
      console.error('Auto-sync write failed:', e);
      toast('⚠️ Auto-sync failed — see console.');
    }
  };

  /** Debounced write so a burst of edits collapses into one file save. */
  const _scheduleSync = () => {
    if (!_fileHandle) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_writeToHandle, 400);
  };

  const connectFile = async () => {
    if (!supportsFS()) {
      toast('Your browser does not support file auto-sync. Use Export/Import.');
      return;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `makeover-data-${_stamp()}.json`,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      _fileHandle = handle;
      await _idbSet(FILE_HANDLE_KEY, handle);
      await _writeToHandle();        // initial write
      toast(`📁 Auto-sync connected to ${handle.name}`);
      _renderStatus();
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('Could not connect file.'); }
    }
  };

  const openExistingFile = async () => {
    if (!supportsFS()) { toast('Not supported in this browser. Use Import.'); return; }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      if (!(await _verifyPermission(handle, true))) { toast('Permission denied.'); return; }
      const file = await handle.getFile();
      const incoming = JSON.parse(await file.text());

      // Always download current data first as a safety snapshot.
      exportJson();
      await Store.replaceAll(incoming);

      _fileHandle = handle;
      await _idbSet(FILE_HANDLE_KEY, handle);
      toast(`📁 Loaded & auto-sync connected to ${handle.name}`);
      if (typeof render === 'function') render();
      if (typeof Seasons !== 'undefined') Seasons.renderSelector();
      _renderStatus();
    } catch (e) {
      if (e.name !== 'AbortError') { console.error(e); toast('Could not open file.'); }
    }
  };

  const disconnectFile = async () => {
    _fileHandle = null;
    await _idbDel(FILE_HANDLE_KEY);
    toast('📁 Auto-sync disconnected.');
    _renderStatus();
  };

  const _renderStatus = () => {
    const badge = document.getElementById('dataSyncBadge');
    if (!badge) return;
    if (_fileHandle) {
      badge.innerHTML = `<span class="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px] font-semibold">● Synced to ${_fileHandle.name}</span>`;
    } else if (supportsFS()) {
      badge.innerHTML = `<span class="inline-flex items-center gap-1 text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full text-[11px]">○ Not connected</span>`;
    } else {
      badge.innerHTML = `<span class="text-gray-400 text-[11px] italic">Auto-sync unsupported in this browser</span>`;
    }

    // Toggle visibility of connect vs disconnect buttons.
    const connectBtn = document.getElementById('dataConnectBtn');
    const disconnectBtn = document.getElementById('dataDisconnectBtn');
    if (connectBtn && disconnectBtn) {
      const isFs = supportsFS();
      connectBtn.style.display    = isFs && !_fileHandle ? '' : 'none';
      disconnectBtn.style.display = isFs &&  _fileHandle ? '' : 'none';
    }
  };

  // ---------- boot ------------------------------------------------------
  const init = async () => {
    // Restore persisted file handle (Chrome remembers across reloads, but
    // user must re-grant permission once per session).
    if (supportsFS()) {
      try {
        const handle = await _idbGet(FILE_HANDLE_KEY);
        if (handle) {
          _fileHandle = handle;
          // Don't auto-prompt for permission — wait until first save.
        }
      } catch (e) { console.warn('Could not restore file handle:', e); }
    }

    // Subscribe to every Store save → schedule a debounced file write.
    Store.subscribe(() => _scheduleSync());

    // Wire toolbar buttons (if present).
    document.getElementById('dataExportBtn')?.addEventListener('click', exportJson);
    document.getElementById('dataImportBtn')?.addEventListener('click', importJson);
    document.getElementById('dataConnectBtn')?.addEventListener('click', connectFile);
    document.getElementById('dataDisconnectBtn')?.addEventListener('click', disconnectFile);
    document.getElementById('dataOpenFileBtn')?.addEventListener('click', openExistingFile);

    _renderStatus();
  };

  return { init, exportJson, importJson, connectFile, openExistingFile, disconnectFile, supportsFS };
})();
