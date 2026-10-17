/* ==========================================================
 *  booking-modal.js  —  Add/Edit booking modal with multi-session
 *  rows. Depends on globals from app.js ($, $$, inr, toast, render,
 *  openClientDrawer) and Store.
 * ========================================================== */

const MAKEUP_TYPES = ['Haldi','Mehandi','Mataji Poojan','Ganga Jal','Mandap','Bridal','Party','Engagement','Reception','Sangeet','Other'];
const TIMINGS      = ['Morning','Day','Evening','Night'];
const STATUSES     = ['Scheduled','Done'];

const _opts = (list, selected) => list.map(v => `<option ${v===selected?'selected':''}>${v}</option>`).join('');

/** Build one session row. `data` = optional initial values. */
const sessionRowHTML = (data = {}) => {
  const t  = data.makeupType || 'Bridal';
  const tm = data.timing     || 'Morning';
  const p  = data.price ?? '';
  const s  = data.status     || 'Scheduled';
  const n  = data.notes      || '';
  // Escape any pre-existing notes so quotes/HTML don't break the value attr.
  const safeNotes = String(n).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `
    <div class="session-row bg-rose-50/40 border border-rose-100 rounded-xl p-3 space-y-2">
      <div class="grid grid-cols-12 gap-2 items-end">
        <div class="col-span-12 sm:col-span-3">
          <label class="block text-xs font-semibold text-wine mb-1 whitespace-nowrap">Makeup Type *</label>
          <select class="sr-type pretty-select w-full px-2 py-2 border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-400 focus:outline-none" required>${_opts(MAKEUP_TYPES, t)}</select>
        </div>
        <div class="col-span-6 sm:col-span-3">
          <label class="block text-xs font-semibold text-wine mb-1 whitespace-nowrap">Timing *</label>
          <select class="sr-timing pretty-select w-full px-2 py-2 border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-400 focus:outline-none" required>${_opts(TIMINGS, tm)}</select>
        </div>
        <div class="col-span-6 sm:col-span-2">
          <label class="block text-xs font-semibold text-wine mb-1 whitespace-nowrap">Price (₹)</label>
          <input type="number" min="0" placeholder="Set later" value="${p}" class="sr-price w-full px-2 py-2 border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-400 focus:outline-none"/>
        </div>
        <div class="col-span-9 sm:col-span-3">
          <label class="block text-xs font-semibold text-wine mb-1 whitespace-nowrap">Status</label>
          <select class="sr-status pretty-select w-full px-2 py-2 border border-rose-200 rounded-lg focus:ring-2 focus:ring-rose-400 focus:outline-none">${_opts(STATUSES, s)}</select>
        </div>
        <div class="col-span-3 sm:col-span-1 flex justify-end">
          <button type="button" class="sr-remove text-rose-600 hover:bg-rose-100 rounded-lg w-9 h-9 flex items-center justify-center" title="Remove session">✕</button>
        </div>
      </div>
      <input type="text" class="sr-notes w-full px-2 py-1.5 border border-rose-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none"
        placeholder="Notes (optional) — e.g., venue, requested look, references, etc." value="${safeNotes}" />
    </div>
  `;
};

const recalcSessionsTotal = () => {
  const sum = $$('#sessionRows .sr-price').reduce((s, el) => s + (Number(el.value) || 0), 0);
  $('#sessionsTotal').textContent = inr(sum);
};

const refreshRemoveButtons = () => {
  const rows = $$('#sessionRows .session-row');
  rows.forEach(r => r.querySelector('.sr-remove').style.visibility = rows.length > 1 ? 'visible' : 'hidden');
};

const addSessionRow = (data) => {
  const container = $('#sessionRows');
  container.insertAdjacentHTML('beforeend', sessionRowHTML(data));
  const row = container.lastElementChild;
  row.querySelector('.sr-remove').addEventListener('click', () => {
    row.remove();
    refreshRemoveButtons();
    recalcSessionsTotal();
  });
  row.querySelector('.sr-price').addEventListener('input', recalcSessionsTotal);
  refreshRemoveButtons();
  recalcSessionsTotal();
};

const openBookingModal = (clientId, bookingId = null) => {
  $('#bookingClientId').value = clientId;
  $('#bookingId').value = bookingId || '';
  $('#sessionRows').innerHTML = '';

  if (bookingId) {
    // EDIT mode — populate existing row, allow adding more sessions
    const c = Store.get(clientId);
    const b = (c.bookings || []).find(x => x.id === bookingId);
    if (!b) return;
    $('#bookingModalTitle').textContent = 'Edit Booking';
    $('#bookingDate').value = b.date;
    addSessionRow({ ...b, price: b.price ?? '' });   // blank input for pending prices
    $('#addSessionRowBtn').classList.remove('hidden');
    $('#bookingSaveBtn').textContent = 'Save Changes';
  } else {
    // ADD mode — start with one empty row, allow more
    $('#bookingModalTitle').textContent = 'Add Booking(s)';
    $('#bookingDate').value = '';
    addSessionRow();
    $('#addSessionRowBtn').classList.remove('hidden');
    $('#bookingSaveBtn').textContent = 'Save Booking(s)';
  }

  $('#bookingModal').classList.add('modal-open');
};

const closeBookingModal = () => $('#bookingModal').classList.remove('modal-open');

$('#addSessionRowBtn').addEventListener('click', () => addSessionRow());

$('#bookingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clientId  = $('#bookingClientId').value;
  const bookingId = $('#bookingId').value;
  const date      = $('#bookingDate').value;
  if (!date) { toast('Date is required.'); return; }

  const rows = $$('#sessionRows .session-row').map(r => ({
    date,
    makeupType: r.querySelector('.sr-type').value,
    timing:     r.querySelector('.sr-timing').value,
    price:      r.querySelector('.sr-price').value,
    status:     r.querySelector('.sr-status').value,
    notes:      r.querySelector('.sr-notes').value,
  }));

  if (rows.length === 0) { toast('Add at least one session.'); return; }
  for (const r of rows) {
    if (r.price !== '' && isNaN(Number(r.price))) { toast('Price must be a number.'); return; }
  }

  try {
    if (bookingId) {
      await Store.updateBooking(clientId, bookingId, rows[0]);
      // Any extra rows added during edit become new bookings
      for (let i = 1; i < rows.length; i++) await Store.addBooking(clientId, rows[i]);
      const extra = rows.length - 1;
      toast(extra ? `Booking updated + ${extra} new session${extra > 1 ? 's' : ''} added 💄` : 'Booking updated 💄');
    } else {
      for (const r of rows) await Store.addBooking(clientId, r);
      toast(rows.length === 1 ? 'Booking added ✨' : `${rows.length} bookings added ✨`);
    }

    // Diagnostic: confirm the booking actually landed in the cache.
    const after = Store.get(clientId);
    console.log('[booking-modal] after save — client has', (after?.bookings || []).length, 'bookings:', after?.bookings);

    closeBookingModal();
    // If the booking date is outside the active season, auto-switch so the
    // user actually SEES what they just saved (otherwise it'd be filtered out).
    if (typeof Seasons !== 'undefined') Seasons.ensureVisibleFor(date);
    render();
    openClientDrawer(clientId); // refresh drawer
  } catch (err) {
    console.error('[booking-modal] save failed:', err);
    toast('❌ Save failed: ' + err.message);
  }
});
