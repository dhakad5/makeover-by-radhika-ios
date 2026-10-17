/* ==========================================================
 *  services.js  —  Add-On Services (Facial, Wax, Threading, etc.)
 *
 *  Non-date-bound, count toward the client's total package.
 *  Renders inside the client drawer + handles the add/edit modal.
 *
 *  Depends on globals: $, $$, inr, toast, escapeHtml, confirmAction,
 *  render, Store, openClientDrawer.
 * ========================================================== */

const SERVICE_PRESETS = [
  'Facial', 'Clean-up', 'Bleach', 'De-Tan',
  'Threading', 'Upper Lip', 'Eyebrows',
  'Full Body Wax', 'Half Body Wax', 'Hand Wax', 'Leg Wax',
  'Manicure', 'Pedicure',
  'Hair Spa', 'Hair Wash', 'Hair Cut', 'Hair Color',
  'Other',
];
const SERVICE_STATUSES = ['Pending', 'Done'];

const Services = (() => {
  // ---------- modal scaffolding (built lazily on first open) -----------
  const _ensureModal = () => {
    if (document.getElementById('serviceModal')) return;
    const m = document.createElement('div');
    m.id = 'serviceModal';
    // Match the existing booking modal pattern: hidden by default, flex when .modal-open is added.
    m.className = 'fixed inset-0 z-[70] hidden items-center justify-center bg-black/50 p-4';
    m.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div class="bg-gradient-to-r from-amber-400 to-wine text-white px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <h2 id="serviceModalTitle" class="font-cinzel text-2xl">💆 Add-On Service</h2>
          <button type="button" onclick="Services.closeModal()" class="text-white text-3xl leading-none hover:text-rose-200">×</button>
        </div>
        <form id="serviceForm" class="p-6 space-y-4">
          <input type="hidden" id="serviceClientId" />
          <input type="hidden" id="serviceId" />

          <div id="serviceRows" class="space-y-2"></div>

          <button type="button" id="addServiceRowBtn"
            class="w-full text-sm text-wine border border-dashed border-rose-300 rounded-lg py-2 hover:bg-rose-50">
            + Add another service
          </button>

          <div class="flex items-center justify-between pt-3 border-t border-rose-100">
            <div class="text-sm text-gray-600">Total: <b id="servicesFormTotal" class="text-wine">₹0</b></div>
            <div class="flex gap-2">
              <button type="button" onclick="Services.closeModal()"
                class="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" id="serviceSaveBtn"
                class="px-4 py-2 bg-wine text-white rounded-lg hover:bg-rose-800">Save Service(s)</button>
            </div>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(m);
    document.getElementById('addServiceRowBtn').addEventListener('click', () => _addRow());
    document.getElementById('serviceForm').addEventListener('submit', _submit);
  };

  // ---------- session-row builder --------------------------------------
  const _opts = (list, selected) =>
    list.map(v => `<option ${v === selected ? 'selected' : ''}>${v}</option>`).join('');

  const _rowHTML = (data = {}) => {
    const name = data.name && !SERVICE_PRESETS.includes(data.name) ? 'Other' : (data.name || 'Facial');
    const customName = SERVICE_PRESETS.includes(data.name) ? '' : (data.name || '');
    const price = data.price ?? '';
    const status = data.status || 'Pending';
    const notes = data.notes || '';
    return `
      <div class="service-row bg-rose-50/40 border border-rose-100 rounded-xl p-3 space-y-2">
        <div class="grid grid-cols-12 gap-2 items-end">
          <div class="col-span-12 sm:col-span-5">
            <label class="block text-xs font-semibold text-wine mb-1">Service *</label>
            <select class="sr-name pretty-select w-full px-2 py-2 border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-400 focus:outline-none" required>
              ${_opts(SERVICE_PRESETS, name)}
            </select>
            <input type="text" class="sr-custom mt-1 w-full px-2 py-1.5 border border-rose-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none ${name === 'Other' ? '' : 'hidden'}"
              placeholder="Custom service name…" value="${escapeHtml(customName)}" />
          </div>
          <div class="col-span-6 sm:col-span-3">
            <label class="block text-xs font-semibold text-wine mb-1">Price (₹)</label>
            <input type="number" min="0" placeholder="Set later" value="${price}"
              class="sr-price w-full px-2 py-2 border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-400 focus:outline-none" />
          </div>
          <div class="col-span-5 sm:col-span-3">
            <label class="block text-xs font-semibold text-wine mb-1">Status</label>
            <select class="sr-status pretty-select w-full px-2 py-2 border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-400 focus:outline-none">
              ${_opts(SERVICE_STATUSES, status)}
            </select>
          </div>
          <div class="col-span-1 flex justify-end">
            <button type="button" class="sr-remove text-rose-600 hover:bg-rose-100 rounded-lg w-9 h-9 flex items-center justify-center" title="Remove">✕</button>
          </div>
        </div>
        <input type="text" class="sr-notes w-full px-2 py-1.5 border border-rose-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none"
          placeholder="Notes (optional) — e.g., before haldi, bridal kit, etc." value="${escapeHtml(notes)}" />
      </div>
    `;
  };

  const _refreshRemoveButtons = () => {
    const rows = $$('#serviceRows .service-row');
    rows.forEach(r => r.querySelector('.sr-remove').style.visibility = rows.length > 1 ? 'visible' : 'hidden');
  };

  const _recalcTotal = () => {
    const sum = $$('#serviceRows .sr-price').reduce((s, el) => s + (Number(el.value) || 0), 0);
    document.getElementById('servicesFormTotal').textContent = inr(sum);
  };

  const _addRow = (data) => {
    const container = document.getElementById('serviceRows');
    container.insertAdjacentHTML('beforeend', _rowHTML(data));
    const row = container.lastElementChild;

    row.querySelector('.sr-name').addEventListener('change', (e) => {
      row.querySelector('.sr-custom').classList.toggle('hidden', e.target.value !== 'Other');
    });
    row.querySelector('.sr-remove').addEventListener('click', () => {
      row.remove();
      _refreshRemoveButtons();
      _recalcTotal();
    });
    row.querySelector('.sr-price').addEventListener('input', _recalcTotal);
    _refreshRemoveButtons();
    _recalcTotal();
  };

  // ---------- public actions -------------------------------------------
  const openModal = (clientId, serviceId = null) => {
    _ensureModal();
    document.getElementById('serviceClientId').value = clientId;
    document.getElementById('serviceId').value = serviceId || '';
    document.getElementById('serviceRows').innerHTML = '';

    if (serviceId) {
      const c = Store.get(clientId);
      const s = (c?.services || []).find(x => x.id === serviceId);
      if (!s) return;
      document.getElementById('serviceModalTitle').textContent = '✏️ Edit Service';
      _addRow({ ...s, price: s.price ?? '' });
      document.getElementById('addServiceRowBtn').classList.add('hidden');
      document.getElementById('serviceSaveBtn').textContent = 'Save Changes';
    } else {
      document.getElementById('serviceModalTitle').textContent = '💆 Add Service(s)';
      _addRow();
      document.getElementById('addServiceRowBtn').classList.remove('hidden');
      document.getElementById('serviceSaveBtn').textContent = 'Save Service(s)';
    }

    document.getElementById('serviceModal').classList.add('modal-open');
  };

  const closeModal = () => document.getElementById('serviceModal')?.classList.remove('modal-open');

  // ---------- form submit ----------------------------------------------
  const _submit = async (e) => {
    e.preventDefault();
    const clientId = document.getElementById('serviceClientId').value;
    const serviceId = document.getElementById('serviceId').value;

    const rows = $$('#serviceRows .service-row').map(r => {
      const dropdown = r.querySelector('.sr-name').value;
      const custom = r.querySelector('.sr-custom').value.trim();
      const name = dropdown === 'Other' ? custom : dropdown;
      return {
        name,
        price: r.querySelector('.sr-price').value,
        status: r.querySelector('.sr-status').value,
        notes: r.querySelector('.sr-notes').value,
      };
    });

    if (rows.length === 0) { toast('Add at least one service.'); return; }
    for (const r of rows) {
      if (!r.name) { toast('Service name is required.'); return; }
      if (r.price !== '' && isNaN(Number(r.price))) { toast('Price must be a number.'); return; }
    }

    try {
      if (serviceId) {
        await Store.updateService(clientId, serviceId, rows[0]);
        toast('Service updated 💆');
      } else {
        for (const r of rows) await Store.addService(clientId, r);
        toast(rows.length === 1 ? 'Service added ✨' : `${rows.length} services added ✨`);
      }
      closeModal();
      // Store subscriber will re-render everything including the open drawer.
    } catch (err) {
      console.error('[services] save failed:', err);
      toast('❌ Save failed: ' + err.message);
    }
  };

  // ---------- inline actions (called from drawer HTML) -----------------
  const markDone = async (clientId, serviceId) => {
    try { await Store.markServiceDone(clientId, serviceId); toast('Service done ✅'); }
    catch (e) { toast('❌ ' + e.message); }
  };

  const remove = async (clientId, serviceId) => {
    const c = Store.get(clientId);
    const s = (c?.services || []).find(x => x.id === serviceId);
    const label = s ? `"${s.name}"` : 'this service';
    const ok = await confirmAction({
      title: 'Delete this service?',
      message: `${label} will be permanently removed from the package. This cannot be undone.`,
      icon: '🗑️',
      confirmText: 'Yes, Delete Service',
    });
    if (!ok) return;
    try { await Store.deleteService(clientId, serviceId); toast('Service deleted.'); }
    catch (e) { toast('❌ ' + e.message); }
  };

  // ---------- drawer render --------------------------------------------
  /** Returns the HTML block for the services section inside the drawer. */
  const renderDrawerSection = (client) => {
    const services = client.services || [];
    const total = services.reduce((s, x) => s + (Number(x.price) || 0), 0);
    const doneCount = services.filter(s => s.status === 'Done').length;

    const header = `
      <div class="flex items-center justify-between gap-3 mb-3">
        <h3 class="font-cinzel text-xl text-wine">💆 Add-On Services
          <span class="text-xs font-normal text-gray-500 ml-1">${services.length} • ${doneCount} done • ${inr(total)}</span>
        </h3>
        <button onclick="Services.openModal('${client.id}')"
          class="px-3 py-1.5 bg-wine text-white text-xs rounded-full hover:bg-rose-800 shadow-soft">+ Add Service</button>
      </div>`;

    if (services.length === 0) {
      return header + `
        <div class="text-center py-4 px-3 bg-rose-50/40 border border-dashed border-rose-200 rounded-xl text-sm text-gray-500 italic">
          No add-on services yet. Click <b>+ Add Service</b> for facials, waxing, threading, etc.
        </div>`;
    }

    return header + `
      <div class="space-y-2">
        ${services.map(s => `
          <div class="flex items-start justify-between gap-3 p-3 bg-rose-50/50 border border-rose-100 rounded-xl">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-wine">${escapeHtml(s.name)}</span>
                <span class="pill ${s.status === 'Done' ? 'pill-done' : 'pill-scheduled'}">${s.status}</span>
              </div>
              ${s.notes ? `<div class="text-xs text-gray-600 mt-1">${escapeHtml(s.notes)}</div>` : ''}
            </div>
            <div class="text-right shrink-0">
              <div class="font-bold text-wine">${s.price == null || s.price === '' ? '<span class="text-gray-400 italic text-sm">Pending</span>' : inr(Number(s.price))}</div>
              <div class="flex gap-1 mt-1 justify-end">
                ${s.status !== 'Done'
                  ? `<button onclick="Services.markDone('${client.id}','${s.id}')" class="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full hover:bg-emerald-700">✓</button>`
                  : ''}
                <button onclick="Services.openModal('${client.id}','${s.id}')" class="text-xs border border-wine text-wine px-2 py-0.5 rounded-full hover:bg-rose-50">Edit</button>
                <button onclick="Services.remove('${client.id}','${s.id}')" class="text-xs text-rose-700 px-2 py-0.5 rounded-full hover:bg-rose-50">🗑</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>`;
  };

  return { openModal, closeModal, markDone, remove, renderDrawerSection };
})();
