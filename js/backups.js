/* ==========================================================
 *  backups.js  —  Server-side backup browser + restore.
 *
 *  Uses the existing backup API:
 *    GET    /api/backups               → list
 *    POST   /api/backups               → snapshot now
 *    GET    /api/backups/{name}        → fetch one's JSON
 *
 *  Depends on globals: $, toast, confirmAction, escapeHtml, fdate,
 *  ApiClient, Store, render.
 * ========================================================== */

const Backups = (() => {
  const _modalId = 'backupsModal';

  // ---------- helpers ----------------------------------------------------
  const _humanSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const _humanTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  // ---------- modal scaffolding -----------------------------------------
  const _ensureModal = () => {
    if (document.getElementById(_modalId)) return;
    const modal = document.createElement('div');
    modal.id = _modalId;
    modal.className = 'fixed inset-0 z-[70] hidden items-center justify-center bg-black/50 p-4';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="bg-gradient-to-r from-amber-400 to-wine text-white px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <h2 class="font-cinzel text-2xl">🛡️ Server Backups</h2>
          <button type="button" onclick="Backups.close()" class="text-white text-3xl leading-none hover:text-rose-200">×</button>
        </div>
        <div class="p-6">
          <p class="text-sm text-gray-600 mb-3">
            Every save automatically snapshots the data file. Click <b>Restore</b> on any backup to revert
            your dashboard to that point in time. A safety snapshot is taken before any restore.
          </p>
          <div class="flex gap-2 mb-3">
            <button onclick="Backups.snapshotNow()" class="px-3 py-2 bg-wine text-white text-sm rounded-lg hover:bg-rose-800">📸 Snapshot Now</button>
            <button onclick="Backups.refresh()" class="px-3 py-2 border border-wine text-wine text-sm rounded-lg hover:bg-rose-50">🔄 Refresh</button>
          </div>
          <div id="backupsList" class="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
            <div class="text-center py-8 text-gray-500 italic">Loading…</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  // ---------- actions ----------------------------------------------------
  const open = async () => {
    if (!ApiClient.isOnline()) { toast('🔌 Backend offline.'); return; }
    _ensureModal();
    document.getElementById(_modalId).classList.add('modal-open');
    await refresh();
  };

  const close = () => document.getElementById(_modalId)?.classList.remove('modal-open');

  const refresh = async () => {
    const list = document.getElementById('backupsList');
    list.innerHTML = '<div class="text-center py-8 text-gray-500 italic">Loading…</div>';
    try {
      const all = await ApiClient.listBackups();
      // Show newest first.
      all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      if (all.length === 0) {
        list.innerHTML = '<div class="text-center py-8 text-gray-500 italic">No backups yet.</div>';
        return;
      }
      list.innerHTML = all.map(b => `
        <div class="flex items-center justify-between gap-3 p-3 bg-rose-50/50 border border-rose-100 rounded-xl">
          <div class="min-w-0">
            <div class="font-mono text-sm text-wine truncate">${escapeHtml(b.name)}</div>
            <div class="text-xs text-gray-600">${_humanTime(b.createdAt)} &nbsp;•&nbsp; ${_humanSize(b.size || 0)}</div>
          </div>
          <div class="flex gap-1 shrink-0">
            <button onclick="Backups.download('${b.name}')"
               class="text-xs border border-wine text-wine px-3 py-1.5 rounded-lg hover:bg-rose-50">⬇ Download</button>
            <button onclick="Backups.restore('${b.name}')"
               class="text-xs bg-wine text-white px-3 py-1.5 rounded-lg hover:bg-rose-800">↺ Restore</button>
          </div>
        </div>
      `).join('');
    } catch (e) {
      list.innerHTML = `<div class="text-center py-8 text-rose-600">❌ ${escapeHtml(e.message)}</div>`;
    }
  };

  const snapshotNow = async () => {
    try {
      const info = await ApiClient.createBackup();
      toast(`📸 Snapshot created: ${info.name || 'OK'}`);
      await refresh();
    } catch (e) {
      toast('❌ Snapshot failed: ' + e.message);
    }
  };

  const restore = async (name) => {
    const cur = Store.snapshot();
    const ok = await confirmAction({
      title: `Restore from "${name}"?`,
      message: `This will REPLACE all current data (${cur.clients.length} clients, ${cur.seasons.length} seasons) with the contents of this backup. A safety snapshot will be created automatically before the restore.`,
      icon: '🛡️',
      confirmText: 'Yes, Restore',
    });
    if (!ok) return;
    try {
      // 1. Safety snapshot of current state (so we can undo this restore too).
      await ApiClient.createBackup();
      // 2. Fetch backup contents.
      const data = await ApiClient.getBackup(name);
      // 3. Replace everything via the normal flow (PUT /api/data → file + cache).
      await Store.replaceAll(data);
      toast(`✅ Restored from ${name}.`);
      close();
      if (typeof Seasons !== 'undefined') Seasons.renderSelector();
    } catch (e) {
      console.error(e);
      toast('❌ Restore failed: ' + e.message);
    }
  };

  const download = async (name) => {
    try {
      const data = await ApiClient.getBackup(name);
      await NativeIO.saveText(JSON.stringify(data, null, 2), name);
    } catch (e) { toast('❌ Download failed: ' + e.message); }
  };

  return { open, close, refresh, snapshotNow, restore, download };
})();
