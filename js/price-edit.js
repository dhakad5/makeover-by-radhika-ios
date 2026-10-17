/* ==========================================================
 *  price-edit.js  —  Click-to-edit price cells in the
 *  All Bookings table. Avoids round-trips through the drawer
 *  for a common, low-friction edit.
 * ========================================================== */

const startPriceEdit = (span) => {
  const td  = span.closest('td');
  const cid = td.dataset.cid;
  const bid = td.dataset.bid;
  const booking = (Store.all().find(c => c.id === cid)?.bookings || []).find(b => b.id === bid);
  const current = (booking && booking.price != null) ? booking.price : '';
  td.innerHTML = `<input type="number" min="0" value="${current}" placeholder="Price"
    class="w-24 px-2 py-1 border-2 border-rose-400 rounded-md text-right focus:outline-none focus:ring-2 focus:ring-rose-300"
    onblur="savePriceEdit(this, '${cid}', '${bid}')"
    onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();} else if(event.key==='Escape'){this.dataset.cancel='1';this.blur();}"/>`;
  const inp = td.querySelector('input');
  inp.focus(); inp.select();
};

const savePriceEdit = async (input, cid, bid) => {
  if (input.dataset.cancel) { render(); return; }
  const val = input.value.trim();
  try {
    await Store.updateBooking(cid, bid, { price: val === '' ? null : Number(val) });
    render();
    toast(val === '' ? 'Price cleared' : `Price updated to ₹${Number(val).toLocaleString('en-IN')}`);
  } catch (e) {
    console.error(e);
    toast('❌ ' + e.message);
    render();
  }
};
