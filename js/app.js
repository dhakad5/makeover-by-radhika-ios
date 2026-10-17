/* ==========================================================
 *  app.js  —  UI Controller for Makeover By Radhika
 *  Handles rendering, modals, filters, and event wiring.
 * ========================================================== */

// ===== Tiny DOM helpers =====
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

/** Display helper: price is `null` when not entered yet — show a friendly hint. */
const priceDisplay = (p) => (p === null || p === undefined || p === '')
  ? '<span class="text-amber-700 italic text-xs">Pending</span>'
  : inr(p);
const fdate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const toast = (msg) => {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2400);
};


// ===== Filter state =====
const Filters = {
  name: '', phone: '', search: '', year: '', type: '', status: '', from: '', to: '',

  match(client) {
    // Unified smart search: matches name OR phone (single field, single source of truth)
    if (this.search) {
      const q = this.search.toLowerCase();
      const nameHit  = (client.name  || '').toLowerCase().includes(q);
      const phoneHit = (client.phone || '').includes(this.search.replace(/\s+/g, ''));
      if (!nameHit && !phoneHit) return false;
    }
    // Legacy individual filters (still supported for active-filter chips)
    if (this.name   && !client.name.toLowerCase().includes(this.name.toLowerCase())) return false;
    if (this.phone  && !client.phone.includes(this.phone)) return false;
    if (this.type   && client.type !== this.type) return false;
    if (this.status && Store.clientStatus(client) !== this.status) return false;
    // Season + year + date-range narrow by booking dates: client passes if ANY booking matches.
    // EXCEPTION: brand-new clients with zero bookings ALWAYS pass date filters (nothing to filter on).
    const dateFilters = this.year || this.from || this.to || this._seasonActive();
    const bookings = client.bookings || [];
    if (dateFilters && bookings.length > 0) {
      if (!bookings.some(b => this._dateMatches(b.date))) return false;
    }
    return true;
  },

  _seasonActive() {
    return typeof Seasons !== 'undefined' && !Seasons.isAllMode() && !!Seasons.getActive();
  },

  _dateMatches(date) {
    if (!date) return false;
    if (this._seasonActive() && !Seasons.dateInActive(date)) return false;
    if (this.year && String(new Date(date).getFullYear()) !== this.year) return false;
    if (this.from && date < this.from) return false;     // ISO YYYY-MM-DD compares lexicographically
    if (this.to   && date > this.to)   return false;
    return true;
  },

  matchBooking(b, client) {
    if (!this.match(client)) return false;
    if (this.year || this.from || this.to || this._seasonActive()) return this._dateMatches(b.date);
    return true;
  },

  read() {
    this.search = ($('#topSearch')?.value || '').trim();
    this.name   = $('#filterName').value.trim();
    this.phone  = $('#filterPhone').value.trim();
    this.year   = $('#filterYear').value;
    this.type   = $('#filterType').value;
    this.status = $('#filterStatus').value;
    this.from   = $('#filterFrom').value;
    this.to     = $('#filterTo').value;
  },
};

const clearFilters = () => {
  ['#filterName', '#filterPhone', '#filterYear', '#filterType', '#filterStatus', '#filterFrom', '#filterTo', '#topSearch']
    .forEach(s => { const el = $(s); if (el) el.value = ''; });
  Filters.read();
  render();
  renderActiveFilterChips();
  // Also clear calendar's selected-day highlight + status pill (single source of truth)
  if (typeof Calendar !== 'undefined' && Calendar.clearDayUI) Calendar.clearDayUI();
  toast('Filters cleared');
};

/** Apply filters on demand (button click or Enter). Also scrolls to results. */
const applyFilters = () => {
  Filters.read();
  render();
  renderActiveFilterChips();
  const matched = $('#bookingsCount').textContent;
  toast(`Showing ${matched} booking${matched === '1' ? '' : 's'}`);
  // Scroll the bookings list into view (use the merged Calendar tab's bookingsSection,
  // fall back gracefully if it's not on the page).
  const target = document.getElementById('bookingsSection') || document.getElementById('bookingsByMonth');
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** Render small removable chips showing what's currently filtered. */
const renderActiveFilterChips = () => {
  const labels = {
    search: v => `Search: “${v}”`,
    name:   v => `Name: “${v}”`,
    phone:  v => `Phone: ${v}`,
    from:   v => `From: ${v}`,
    to:     v => `To: ${v}`,
    year:   v => `Year: ${v}`,
    type:   v => `Type: ${v}`,
    status: v => `Status: ${v}`,
  };
  const fieldFor = { search: 'topSearch', name: 'filterName', phone: 'filterPhone', from: 'filterFrom', to: 'filterTo', year: 'filterYear', type: 'filterType', status: 'filterStatus' };
  const active = Object.entries(labels)
    .map(([k, fn]) => Filters[k] ? { k, text: fn(Filters[k]) } : null)
    .filter(Boolean);

  const badge = $('#activeFilterBadge');
  badge.textContent = active.length;
  badge.classList.toggle('hidden', active.length === 0);

  $('#activeFilterChips').innerHTML = active.map(({ k, text }) => `
    <span class="inline-flex items-center gap-1 bg-white border border-rose-200 text-wine text-xs px-2.5 py-1 rounded-full">
      ${escapeHtml(text)}
      <button onclick="removeFilter('${fieldFor[k]}')" class="text-rose-400 hover:text-wine font-bold leading-none" title="Remove">×</button>
    </span>
  `).join('');
};

/** Clear one specific filter and re-apply. */
const removeFilter = (inputId) => {
  $('#' + inputId).value = '';
  applyFilters();
};

// ===== Render: Dashboard, Clients grid, Bookings table, Year dropdown =====
const renderDashboard = (clients) => {
  // Respect the active season + filters so stats reflect what the user is viewing.
  const visibleClients = clients.filter(c => Filters.match(c));
  const visibleBookings = [];
  visibleClients.forEach(c => (c.bookings || []).forEach(b => {
    if (Filters.matchBooking(b, c)) visibleBookings.push(b);
  }));
  const confirmed = visibleClients.filter(c => Store.clientStatus(c) === 'Confirmed').length;
  // Revenue = sum of Total Package (bookings + services) across the visible client set.
  // Uses the canonical Store.clientTotals() so this number matches the per-client cards,
  // the PDF "Total Package" line and the Excel summary (DRY — one source of truth).
  const revenue = visibleClients.reduce((s, c) => s + Store.clientTotals(c).total, 0);
  // Money received — sum across the SAME filtered client set so the cards stay in sync
  // with everything else on the page (single source of truth: Filters.match).
  const totalAdvance = visibleClients.reduce((s, c) => s + Number(c.advance || 0), 0);
  const totalPayment = visibleClients.reduce((s, c) => s + Number(c.paymentReceived || 0), 0);

  $('#statClients').textContent   = visibleClients.length;
  $('#statBookings').textContent  = visibleBookings.length;
  $('#statConfirmed').textContent = confirmed;
  // Revenue + Advance are privacy-masked by default (press & hold to reveal) —
  // routed through PrivacyMode instead of a raw textContent write so there's
  // one source of truth for "masked vs revealed" (see js/privacy-mode.js).
  PrivacyMode.setValue('statRevenue', inr(revenue));
  PrivacyMode.setValue('statAdvance', inr(totalAdvance));
  $('#statPayment').textContent   = inr(totalPayment);

  // Sidebar badges — mirror the same filtered counts so they update
  // when the season, search, or any filter changes.
  const sideClients  = $('#sideClientsCount');
  const sideBookings = $('#sideBookingsCount');
  if (sideClients)  sideClients.textContent  = visibleClients.length;
  if (sideBookings) sideBookings.textContent = visibleBookings.length;
};

const renderYears = () => {
  const sel = $('#filterYear');
  const current = sel.value;
  const years = Store.years();
  sel.innerHTML = '<option value="">All Years</option>' + years.map(y => `<option ${String(y)===current?'selected':''}>${y}</option>`).join('');
};

const clientCardHTML = (c) => {
  const status     = Store.clientStatus(c);
  const totals     = Store.clientTotals(c);
  const bookings   = c.bookings || [];
  const services   = c.services || [];
  const count      = bookings.length;
  const doneCount  = bookings.filter(b => b.status === 'Done').length;
  const servicesDone = services.filter(s => s.status === 'Done').length;
  const pendingTotal = (count - doneCount) + (services.length - servicesDone);
  const progressPc = count ? Math.round((doneCount / count) * 100) : 0;
  const initials   = c.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const today      = new Date().toISOString().slice(0, 10);
  const upcoming   = bookings.filter(b => b.status !== 'Done' && b.date && b.date >= today)
                              .sort((a, b) => a.date.localeCompare(b.date))[0];
  const isBride    = c.type === 'Bride';
  const bannerGrad = isBride ? 'from-rose-300 via-rose-400 to-wine' : 'from-purple-300 via-pink-400 to-rose-500';
  const typeIcon   = isBride ? '👰' : '✨';
  const accentBar  = status === 'Confirmed' ? 'bg-emerald-400' : 'bg-amber-400';
  const statusPill = status === 'Confirmed'
    ? '<span class="pill pill-confirmed">✓ Confirmed</span>'
    : '<span class="pill pill-tentative">○ Tentative</span>';

  return `
    <div class="client-card group" data-id="${c.id}" onclick="openClientDrawer('${c.id}')">
      <!-- Top status accent strip -->
      <div class="h-1.5 ${accentBar}"></div>

      <!-- Banner header (full-width, no negative margins) -->
      <div class="relative h-20 bg-gradient-to-br ${bannerGrad}">
        <div class="absolute inset-0 opacity-25" style="background-image: radial-gradient(circle at 20% 50%, rgba(255,255,255,0.6) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.4) 0%, transparent 40%);"></div>
        <div class="absolute top-3 right-4 text-white/85 text-2xl drop-shadow">${typeIcon}</div>
      </div>

      <!-- Content section -->
      <div class="px-5 pb-5 pt-0 relative flex-1 flex flex-col">
        <!-- Avatar floats up to overlap banner -->
        <div class="w-16 h-16 -mt-8 mb-2 rounded-full bg-gradient-to-br from-cream to-rose-100 text-wine font-serif font-bold text-2xl flex items-center justify-center shadow-soft ring-4 ring-white">${initials || '💄'}</div>

        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h4 class="font-serif text-xl font-bold text-wine truncate">${escapeHtml(c.name)}</h4>
            <a href="tel:${escapeHtml(c.phone)}" onclick="event.stopPropagation()" class="text-xs text-gray-500 hover:text-wine inline-flex items-center gap-1"><span>📞</span> ${escapeHtml(c.phone)}</a>
          </div>
          ${statusPill}
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <span class="pill ${isBride ? 'pill-bride' : 'pill-party'}">${c.type}</span>
          <span class="pill bg-rose-50 text-rosegold border border-rose-100">${count} booking${count !== 1 ? 's' : ''}</span>
          ${upcoming ? `<span class="pill bg-sky-50 text-sky-700 border border-sky-100" title="Next session">📅 ${fdate(upcoming.date)}</span>` : ''}
        </div>

        ${count ? `<div class="mt-4">
          <div class="flex items-center justify-between text-xs mb-1"><span class="text-gray-500">Sessions completed</span><span class="font-semibold text-wine">${doneCount} / ${count}</span></div>
          <div class="h-2 bg-rose-100 rounded-full overflow-hidden"><div class="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all" style="width: ${progressPc}%"></div></div>
        </div>` : ''}

        <div class="mt-4 pt-3 border-t border-dashed border-rose-200 flex items-center justify-between gap-2">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Package</div>
            <div class="font-bold text-wine text-lg leading-tight">${inr(totals.total)}</div>
          </div>
          <div class="flex flex-col items-end gap-0.5">
            ${totals.advance > 0
              ? `<span class="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">✓ Advance ${inr(totals.advance)}</span>`
              : '<span class="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold">No advance yet</span>'}
            ${totals.balance > 0
              ? `<span class="text-xs text-amber-700">Balance: <b>${inr(totals.balance)}</b></span>`
              : (totals.total > 0 ? '<span class="text-xs text-emerald-700">✓ Fully paid</span>' : '')}
          </div>
        </div>

        <div class="mt-3 text-right opacity-0 group-hover:opacity-100 transition-opacity"><span class="text-xs text-wine font-semibold">View details →</span></div>

        ${pendingTotal > 0 ? `
          <button onclick="event.stopPropagation(); markAllDoneForClient('${c.id}')"
            class="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 shadow-soft"
            title="Mark ALL ${pendingTotal} pending booking${pendingTotal !== 1 ? 's' : ''} + service${pendingTotal !== 1 ? 's' : ''} as Done">
            ✅ Mark All Done <span class="text-xs opacity-80">(${pendingTotal} pending)</span>
          </button>` : (count + services.length > 0 ? `
          <div class="mt-3 text-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg py-2 font-semibold">
            ✨ All bookings &amp; services completed
          </div>` : '')}
      </div>
    </div>`;
};

const renderClients = (clients) => {
  const grid = $('#clientsGrid');
  const empty = $('#emptyClients');
  const badge = $('#clientsCount');
  let filtered = clients.filter(c => Filters.match(c));
  // Quick filter: "Balance Due > 0" — set by ui-quick.js chip
  if (window.__quickPendingDueOnly) {
    filtered = filtered.filter(c => Store.clientTotals(c).balance > 0);
  }
  badge.textContent = filtered.length;
  badge.classList.toggle('hidden', filtered.length === 0);
  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    if (clients.length > 0) {
      // Data exists but filters hid it all — give a clear escape hatch.
      const seasonActive = typeof Seasons !== 'undefined' && !Seasons.isAllMode() && Seasons.getActive();
      const seasonNote = seasonActive ? ` (current season: <b>${escapeHtml(seasonActive.label)}</b>)` : '';
      empty.innerHTML = `
        <p class="text-gray-600 mb-3">✨ ${clients.length} client(s) exist but are hidden by your current filters${seasonNote}.</p>
        <div class="flex flex-wrap gap-2 justify-center">
          <button onclick="clearFilters()" class="px-4 py-2 bg-wine text-white rounded-full text-sm hover:bg-rose-800">🧹 Clear All Filters</button>
          ${seasonActive ? `<button onclick="Seasons.setActive('ALL')" class="px-4 py-2 border border-wine text-wine rounded-full text-sm hover:bg-rose-50">🌐 Show All Seasons</button>` : ''}
        </div>`;
    } else {
      empty.innerHTML = '<p class="text-gray-500 italic">No clients yet. Add your first beautiful bride!</p>';
    }
  } else {
    empty.classList.add('hidden');
    grid.innerHTML = filtered.map(clientCardHTML).join('');
  }
};

/**
 * Re-paint EVERYTHING from the current Store cache. Idempotent.
 * Also refreshes the client drawer if it's open, so any mutation
 * (add/edit/delete client OR booking) is visible immediately
 * without needing manual openClientDrawer() calls at every callsite.
 */
const render = () => {
  const clients = Store.all();
  renderDashboard(clients);
  renderYears();
  renderClients(clients);
  renderBookingsTable(clients);
  if (typeof Calendar !== 'undefined') Calendar.render();

  // Auto-refresh the drawer if it's open and the client still exists.
  if (_activeClientId && $('#clientDrawer')?.classList.contains('drawer-open')) {
    if (Store.get(_activeClientId)) {
      openClientDrawer(_activeClientId);
    } else {
      // The active client got deleted — close the now-stale drawer.
      closeClientDrawer();
    }
  }
};

// ===== Client modal =====
const openClientModal = (id = null) => {
  $('#clientId').value = id || '';
  if (id) {
    const c = Store.get(id);
    if (!c) return;
    $('#clientModalTitle').textContent = 'Edit Client';
    $('#clientName').value    = c.name;
    $('#clientPhone').value   = c.phone;
    $('#clientType').value    = c.type;
    $('#clientAdvance').value = c.advance;
    $('#clientPaymentReceived').value = c.paymentReceived || 0;
    $('#clientDiscount').value = c.discount || 0;
    $('#clientNotes').value   = c.notes || '';
  } else {
    $('#clientModalTitle').textContent = 'Add New Client';
    $('#clientForm').reset();
    $('#clientAdvance').value = 0;
    $('#clientPaymentReceived').value = 0;
    $('#clientDiscount').value = 0;
  }
  $('#clientModal').classList.add('modal-open');
};

const closeClientModal = () => $('#clientModal').classList.remove('modal-open');

$('#clientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id      = $('#clientId').value;
  const payload = {
    name:            $('#clientName').value,
    phone:           $('#clientPhone').value,
    type:            $('#clientType').value,
    advance:         $('#clientAdvance').value,
    paymentReceived: $('#clientPaymentReceived').value,
    discount:        $('#clientDiscount').value,
    notes:           $('#clientNotes').value,
  };
  if (!payload.name.trim() || !payload.phone.trim()) {
    toast('Name & phone are required.');
    return;
  }
  try {
    if (id) {
      await Store.updateClient(id, payload);
      toast('Client updated 💕');
      closeClientModal();
      render();
      if ($('#clientDrawer').classList.contains('drawer-open')) openClientDrawer(id);
    } else {
      const c = await Store.addClient(payload);
      toast('Client added ✨');
      closeClientModal();
      render();
      openClientDrawer(c.id);
    }
  } catch (e) {
    console.error(e);
    toast('❌ Save failed: ' + e.message);
  }
});


// ===== Client drawer (detail view) =====
let _activeClientId = null;

const openClientDrawer = (id) => {
  const c = Store.get(id);
  if (!c) return;
  _activeClientId = id;

  const status = Store.clientStatus(c);
  const totals = Store.clientTotals(c);
  const count = (c.bookings || []).length;
  const doneCount = (c.bookings || []).filter(b => b.status === 'Done').length;

  $('#drawerName').textContent = c.name;
  $('#drawerSub').innerHTML = `📞 ${escapeHtml(c.phone)} &nbsp;•&nbsp; ${c.type} &nbsp;•&nbsp; <b>${status}</b>`;

  const summaryCard = (bg, border, label, valueHtml, valueColor) =>
    `<div class="${bg} rounded-xl p-3 border ${border}"><div class="text-xs text-gray-500 uppercase">${label}</div><div class="text-xl font-bold ${valueColor}">${valueHtml}</div></div>`;
  // Total Package label shows the breakdown if there are services or discount.
  const breakdownParts = [];
  if (totals.servicesTotal > 0) breakdownParts.push(`${inr(totals.bookingsTotal)} bookings + ${inr(totals.servicesTotal)} services`);
  if (totals.discount > 0)     breakdownParts.push(`${inr(totals.discount)} discount`);
  const totalLabelHtml = breakdownParts.length
    ? `${inr(totals.total)} <span class="block text-[10px] font-normal text-gray-500 normal-case">${breakdownParts.join(' − ')}</span>`
    : inr(totals.total);
  const cards = [
    summaryCard('bg-rose-50', 'border-rose-100', 'Total Package', totalLabelHtml, 'text-wine'),
    summaryCard('bg-emerald-50', 'border-emerald-100', 'Advance Paid', inr(totals.advance), 'text-emerald-700'),
    summaryCard('bg-teal-50', 'border-teal-100', 'Payment Received', inr(totals.paymentReceived), 'text-teal-700'),
    summaryCard('bg-amber-50', 'border-amber-100', 'Balance Due', inr(totals.balance), 'text-amber-700'),
  ];
  if (totals.discount > 0) {
    cards.push(summaryCard('bg-purple-50', 'border-purple-100', 'Discount', inr(totals.discount), 'text-purple-700'));
  }
  cards.push(summaryCard('bg-sky-50', 'border-sky-100', 'Bookings', `${count} <span class="text-xs font-normal text-gray-500">(${doneCount} done)</span>`, 'text-sky-700'));
  $('#drawerSummary').innerHTML = cards.join('');

  // Notes block — prominent callout if present, gentle prompt if not.
  $('#drawerNotes').innerHTML = c.notes && c.notes.trim()
    ? `<div class="bg-amber-50 border-l-4 border-amber-400 rounded-xl p-4">
         <div class="flex items-start justify-between gap-2 mb-1">
           <div class="flex items-center gap-2 text-amber-800 font-semibold text-sm">
             <span>📝</span> <span>Notes</span>
           </div>
           <button onclick="openClientModal('${c.id}')" class="text-xs text-amber-700 hover:text-amber-900 underline">Edit</button>
         </div>
         <p class="text-sm text-gray-700 whitespace-pre-wrap">${escapeHtml(c.notes)}</p>
       </div>`
    : `<button onclick="openClientModal('${c.id}')" class="w-full text-left bg-rose-50/50 border border-dashed border-rose-200 rounded-xl p-3 text-sm text-rosegold hover:bg-rose-50 hover:border-rose-300 transition">
         📝 <span class="italic">No notes yet — click to add a note for ${escapeHtml(c.name)}…</span>
       </button>`;

  const bookings = (c.bookings || []).slice().sort(Store.compareByDateAndTiming);
  const empty = $('#drawerEmpty');
  const list  = $('#drawerBookings');
  if (bookings.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = bookings.map(b => `
      <div class="booking-card">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-bold text-wine">${escapeHtml(b.makeupType)} <span class="text-xs text-gray-500 font-normal">• ${b.timing}</span></div>
            <div class="text-sm text-gray-600">${fdate(b.date)}</div>
            ${b.notes ? `<div class="text-xs text-gray-600 mt-1 italic">📝 ${escapeHtml(b.notes)}</div>` : ''}
          </div>
          <div class="text-right shrink-0">
            <div class="font-bold text-wine">${priceDisplay(b.price)}</div>
            <span class="pill ${b.status === 'Done' ? 'pill-done' : 'pill-scheduled'}">${b.status}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 pt-1">
          ${b.status !== 'Done'
            ? `<button onclick="markDone('${b.id}')" class="text-xs bg-emerald-600 text-white px-3 py-1 rounded-full hover:bg-emerald-700">✓ Mark Done</button>`
            : `<button onclick="markScheduled('${b.id}')" class="text-xs bg-sky-600 text-white px-3 py-1 rounded-full hover:bg-sky-700">↺ Mark Scheduled</button>`}
          <button onclick="openBookingModal('${c.id}','${b.id}')" class="text-xs border border-wine text-wine px-3 py-1 rounded-full hover:bg-rose-50">Edit</button>
          <button onclick="deleteBooking('${b.id}')" class="text-xs text-rose-700 px-3 py-1 rounded-full hover:bg-rose-50 ml-auto">Delete</button>
        </div>
      </div>
    `).join('');
  }

  // Render Add-On Services (Facial, Wax, Threading, etc.)
  const svcEl = $('#drawerServices');
  if (svcEl && typeof Services !== 'undefined') {
    svcEl.innerHTML = Services.renderDrawerSection(c);
  }

  // Wire drawer-level actions
  $('#drawerAddBookingBtn').onclick = () => openBookingModal(c.id);
  $('#drawerEditClientBtn').onclick = () => openClientModal(c.id);
  $('#drawerExportPdfBtn').onclick  = () => { PDFExport.clientPackage(Store.get(c.id)); toast('PDF downloaded 📄'); };
  $('#drawerPreviewPdfBtn').onclick = () => {
    const res = PDFExport.clientPackage(Store.get(c.id), { preview: true });
    if (res?.opened) toast('👁️ PDF preview opened in a new tab');
    else toast('⚠️ Pop-up blocked — allow pop-ups to preview PDFs');
  };
  $('#drawerDeleteBtn').onclick     = async () => {
    const ok = await confirmAction({
      title: `Delete “${c.name}”?`,
      message: `This will permanently delete the client and all ${(c.bookings || []).length} of their booking(s). This cannot be undone.`,
      icon: '🗑️',
      confirmText: 'Yes, Delete Client',
    });
    if (!ok) return;
    try {
      await Store.deleteClient(c.id);
      closeClientDrawer();
      render();
      toast('Client deleted.');
    } catch (e) {
      console.error(e);
      toast('❌ Delete failed: ' + e.message);
    }
  };

  $('#clientDrawer').classList.add('drawer-open');
};
window.openClientDrawer = openClientDrawer;  // expose for ui-shell.js widget click handlers

const closeClientDrawer = () => {
  $('#clientDrawer').classList.remove('drawer-open');
  _activeClientId = null;
};

// In-drawer booking actions
const markDone      = async (bid) => {
  if (!_activeClientId) return;
  try { await Store.markBookingDone(_activeClientId, bid); render(); openClientDrawer(_activeClientId); toast('Marked as done ✅'); }
  catch (e) { toast('❌ ' + e.message); }
};
const markScheduled = async (bid) => {
  if (!_activeClientId) return;
  try { await Store.updateBooking(_activeClientId, bid, { status: 'Scheduled' }); render(); openClientDrawer(_activeClientId); toast('Marked scheduled.'); }
  catch (e) { toast('❌ ' + e.message); }
};
const deleteBooking = async (bid) => {
  if (!_activeClientId) return;
  const c = Store.get(_activeClientId);
  const b = (c?.bookings || []).find(x => x.id === bid);
  const label = b ? `${b.makeupType} (${b.timing}) on ${fdate(b.date)}` : 'this booking';
  const ok = await confirmAction({
    title: 'Delete this booking?',
    message: `${label} will be permanently removed. This cannot be undone.`,
    icon: '🗑️',
    confirmText: 'Yes, Delete Booking',
  });
  if (!ok) return;
  try {
    await Store.deleteBooking(_activeClientId, bid);
    render();
    openClientDrawer(_activeClientId);
    toast('Booking deleted.');
  } catch (e) { toast('❌ ' + e.message); }
};

// Used from the All-Bookings table for one-click "Mark Done"
const quickMarkDone = async (clientId, bookingId) => {
  try { await Store.markBookingDone(clientId, bookingId); render(); toast('Booking marked done ✅'); }
  catch (e) { toast('❌ ' + e.message); }
};

/**
 * Card-level shortcut: mark every booking + service for a client as Done
 * in a single atomic backend call. Confirms first since this is bulk.
 */
const markAllDoneForClient = async (clientId) => {
  const c = Store.get(clientId);
  if (!c) return;
  const pendingB = (c.bookings || []).filter(b => b.status !== 'Done').length;
  const pendingS = (c.services || []).filter(s => s.status !== 'Done').length;
  const total = pendingB + pendingS;
  if (total === 0) { toast('Everything is already done ✨'); return; }

  const ok = await confirmAction({
    title: `Mark all done for ${c.name}?`,
    message: `This will mark <b>${pendingB} booking${pendingB !== 1 ? 's' : ''}</b> and <b>${pendingS} service${pendingS !== 1 ? 's' : ''}</b> as Done in one shot. You can still edit individual items afterwards.`,
    icon: '✅',
    confirmText: 'Yes, Mark All Done',
  });
  if (!ok) return;

  try {
    const { changed } = await Store.markAllDone(clientId);
    toast(`✅ ${changed} item${changed !== 1 ? 's' : ''} marked done`);
  } catch (e) {
    console.error(e);
    toast('❌ ' + e.message);
  }
};


// ===== Exports (global filter aware) =====
const filteredClients = () => Store.all().filter(c => Filters.match(c));

const exportAllPDF = () => {
  const list = filteredClients();
  if (list.length === 0) { toast('Nothing to export.'); return; }
  const labelParts = [];
  if (Filters.name)   labelParts.push(`Name~${Filters.name}`);
  if (Filters.phone)  labelParts.push(`Phone~${Filters.phone}`);
  if (Filters.year)   labelParts.push(`Year=${Filters.year}`);
  if (Filters.type)   labelParts.push(`Type=${Filters.type}`);
  if (Filters.status) labelParts.push(`Status=${Filters.status}`);
  const label = labelParts.length ? `Filters: ${labelParts.join(', ')}` : 'All Records';
  PDFExport.allReport(list, label);
  toast('PDF report downloaded 📄');
};

const exportAllExcel = () => {
  const list = filteredClients();
  if (list.length === 0) { toast('Nothing to export.'); return; }
  ExcelExport.exportAll(list);
  toast('Excel downloaded 📊');
};

// ===== Misc =====
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Mobile menu
// Legacy nav button (old layout) — noop if not present in new app-shell layout.
$('#mobileMenuBtn')?.addEventListener('click', () => $('#mobileMenu')?.classList.toggle('hidden'));

// Filter inputs: Enter key triggers Apply (no live filtering — user must click Apply)
const FILTER_SELECTORS = ['#filterName', '#filterPhone', '#filterYear', '#filterType', '#filterStatus', '#filterFrom', '#filterTo'];
FILTER_SELECTORS.forEach(s => {
  $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyFilters(); } });
});

// ESC closes modals/drawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeClientModal(); closeBookingModal(); closeClientDrawer();
  }
});

// ===== Boot =====
// (Demo seed data was removed — this is your real production app now.
//  An empty database stays empty. Add clients via the UI or use
//  Import to bring in a JSON snapshot.)

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Hydrate Store cache from the backend file (or localStorage fallback).
  await Store.bootstrap();
  if (typeof ApiSync !== 'undefined') { ApiSync.renderBadge(); ApiSync.renderReadOnlyBanner(); }

  // 2. Wire features that depend on the cache.
  if (typeof Seasons !== 'undefined') await Seasons.init();
  if (typeof DataIO  !== 'undefined') DataIO.init();

  Filters.read();

  // 🔑 Auto-render on EVERY cache change. Single source of truth: the Store.
  // Any mutation (add/edit/delete client OR booking) immediately re-paints the
  // dashboard, client cards, bookings table, calendar, AND open drawer.
  Store.subscribe(() => render());

  render();
});
