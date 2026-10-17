/* ==========================================================
 *  bookings-table.js  —  Renders the "All Bookings" section:
 *  month groupings, slot-density coloring (matches calendar),
 *  per-month subtotals.
 *  Depends on app.js globals: Store, Filters, escapeHtml, fdate,
 *  inr, priceDisplay, startPriceEdit, openClientDrawer,
 *  quickMarkDone.
 * ========================================================== */

const MONTH_LABEL = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

// Slot-density row tint (background only — no left border bar). Counts across
// ALL clients, just like the calendar, so two brides sharing a date+timing
// slot color-group together.
const SLOT_BG = ['', 'bg-emerald-50/60', 'bg-amber-50/70', 'bg-red-50/70'];
const slotDensity = (n) => SLOT_BG[Math.min(n, 3)];
const withSlotCounts = (rows) => {
  const counts = new Map();
  const keyOf = ({ b }) => `${b.date || ''}|${b.timing || ''}`;
  rows.forEach(r => { if (r.b.date && r.b.timing) counts.set(keyOf(r), (counts.get(keyOf(r)) || 0) + 1); });
  return rows.map(r => ({ ...r, _slotN: counts.get(keyOf(r)) || 1 }));
};

const bookingRowHTML = (b, c, slotCount = 1) => `
  <tr class="${slotDensity(slotCount)}" data-cid="${c.id}" data-bid="${b.id}">
    <td class="px-2 py-3 text-center bulk-cell">
      <input type="checkbox" class="bulk-check accent-rose-500 w-4 h-4 cursor-pointer"
             data-cid="${c.id}" data-bid="${b.id}" aria-label="Select booking"
             onclick="event.stopPropagation()" onchange="BulkActions.onRowToggle()"/>
    </td>
    <td class="px-4 py-3 font-medium text-wine">${escapeHtml(c.name)}</td>
    <td class="px-4 py-3">${escapeHtml(c.phone)}</td>
    <td class="px-4 py-3">${fdate(b.date)}</td>
    <td class="px-4 py-3">${escapeHtml(b.makeupType)}</td>
    <td class="px-4 py-3 whitespace-nowrap">${escapeHtml(b.timing)}</td>
    <td class="px-4 py-3 text-right font-semibold" data-cid="${c.id}" data-bid="${b.id}">
      <span onclick="startPriceEdit(this)" title="Click to edit price"
            class="cursor-pointer hover:bg-rose-100 px-2 py-1 rounded-md inline-block min-w-[70px] border border-transparent hover:border-rose-300 transition">${priceDisplay(b.price)}</span>
    </td>
    <td class="px-4 py-3 text-center"><span class="pill ${b.status === 'Done' ? 'pill-done' : 'pill-scheduled'}">${b.status}</span></td>
    <td class="px-4 py-3 text-center">
      <button onclick="openClientDrawer('${c.id}')" class="text-wine hover:underline text-xs">Open</button>
      ${b.status !== 'Done'
        ? `<button onclick="quickMarkDone('${c.id}','${b.id}')" class="text-emerald-600 hover:underline text-xs ml-2">Mark Done</button>`
        : ''}
    </td>
  </tr>`;

const monthSectionHTML = (key, rows) => {
  const subtotal = rows.reduce((s, { b }) => s + (Number(b.price) || 0), 0);
  const tbody = withSlotCounts(rows).map(({ b, c, _slotN }) => bookingRowHTML(b, c, _slotN)).join('');
  return `
    <div class="bg-white rounded-2xl shadow-soft border border-rose-100 overflow-hidden">
      <div class="flex items-center justify-between bg-gradient-to-r from-rose-100 to-amber-100 px-5 py-3">
        <div class="flex items-center gap-3">
          <span class="text-xl">🗓️</span>
          <h4 class="font-serif text-lg font-bold text-wine">${MONTH_LABEL(key)}</h4>
          <span class="pill bg-white text-wine border border-rose-200">${rows.length} booking${rows.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="text-sm text-wine font-semibold">Subtotal: ${inr(subtotal)}</div>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead class="text-wine bg-rose-50/60">
            <tr>
              <th class="px-2 py-2 text-center font-semibold bulk-cell">
                <input type="checkbox" class="bulk-check-all accent-rose-500 w-4 h-4 cursor-pointer"
                       title="Select all in this month" aria-label="Select all in this month"
                       onchange="BulkActions.onSelectAll(this)"/>
              </th>
              <th class="px-4 py-2 text-left font-semibold">Client</th>
              <th class="px-4 py-2 text-left font-semibold">Phone</th>
              <th class="px-4 py-2 text-left font-semibold">Date</th>
              <th class="px-4 py-2 text-left font-semibold">Makeup Type</th>
              <th class="px-4 py-2 text-left font-semibold">Timing</th>
              <th class="px-4 py-2 text-right font-semibold">Price (₹)</th>
              <th class="px-4 py-2 text-center font-semibold">Slot Status</th>
              <th class="px-4 py-2 text-center font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-rose-50">${tbody}</tbody>
        </table>
      </div>
    </div>`;
};

const renderBookingsTable = (clients) => {
  const container = document.getElementById('bookingsByMonth');
  const empty = document.getElementById('bookingsEmpty');
  const countEl = document.getElementById('bookingsCount');

  const collected = [];
  clients.forEach(c => (c.bookings || []).forEach(b => {
    if (Filters.matchBooking(b, c)) collected.push({ b, c });
  }));
  countEl.textContent = collected.length;

  if (collected.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    // Smarter empty state: distinguish "no data" from "filtered out".
    const totalBookings = clients.reduce((s, c) => s + (c.bookings || []).length, 0);
    if (totalBookings > 0) {
      const seasonActive = typeof Seasons !== 'undefined' && !Seasons.isAllMode() && Seasons.getActive();
      const note = seasonActive ? ` (current season: <b>${seasonActive.label}</b>)` : '';
      empty.innerHTML = `
        <p class="text-gray-600 mb-3">✨ ${totalBookings} booking(s) exist but are hidden by your current filters${note}.</p>
        <div class="flex flex-wrap gap-2 justify-center">
          <button onclick="clearFilters()" class="px-4 py-2 bg-wine text-white rounded-full text-sm hover:bg-rose-800">🧹 Clear All Filters</button>
          ${seasonActive ? `<button onclick="Seasons.setActive('ALL')" class="px-4 py-2 border border-wine text-wine rounded-full text-sm hover:bg-rose-50">🌐 Show All Seasons</button>` : ''}
        </div>`;
    } else {
      empty.innerHTML = '<p class="text-gray-500 italic">No bookings yet. Click a client card to add one!</p>';
    }
    return;
  }
  empty.classList.add('hidden');

  // Group by YYYY-MM (undated bookings → 'no-date')
  const groups = new Map();
  collected.forEach(({ b, c }) => {
    const key = b.date ? b.date.slice(0, 7) : 'no-date';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ b, c });
  });

  // Months chronological ascending (next upcoming at top), undated last.
  const sortedKeys = [...groups.keys()].sort((a, z) => {
    if (a === 'no-date') return 1;
    if (z === 'no-date') return -1;
    return a.localeCompare(z);
  });
  // Within a month: by date+timing, then by client name so same-slot rows cluster.
  sortedKeys.forEach(k => groups.get(k).sort((a, z) => {
    const dt = Store.compareByDateAndTiming(a.b, z.b);
    return dt !== 0 ? dt : a.c.name.localeCompare(z.c.name);
  }));

  container.innerHTML = sortedKeys.map(k => {
    if (k === 'no-date') {
      const rows = groups.get(k);
      const tbody = withSlotCounts(rows).map(({ b, c, _slotN }) => bookingRowHTML(b, c, _slotN)).join('');
      return `
        <div class="bg-white rounded-2xl shadow-soft border border-rose-100 overflow-hidden">
          <div class="bg-amber-50 px-5 py-3 font-serif text-lg font-bold text-amber-800">📝 Undated</div>
          <div class="overflow-x-auto"><table class="min-w-full text-sm"><tbody class="divide-y divide-rose-50">${tbody}</tbody></table></div>
        </div>`;
    }
    return monthSectionHTML(k, groups.get(k));
  }).join('');
};
