/* ==========================================================
 *  calendar.js  —  Month-view booking calendar with per-slot density.
 *  Each day cell shows 4 colored squares (M D E N) where the color
 *  encodes the # of bookings in that timing slot:
 *    0 = gray, 1 = green, 2 = amber, 3+ = red.
 *  Click a day to filter All Bookings to just that date.
 * ========================================================== */

const Calendar = (() => {
  const TIMING_KEYS = ['Morning', 'Day', 'Evening', 'Night'];
  const TIMING_INITIALS = { Morning: 'M', Day: 'D', Evening: 'E', Night: 'N' };
  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Cursor month — first of month, local time.
  let cursor = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let pickersInitialised = false;

  // ----- helpers ---------------------------------------------------------
  /** YYYY-MM-DD in local time (avoids the UTC drift of toISOString). */
  const isoLocal = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  /** Color class for a slot's count. */
  const densityClass = (n) => {
    if (n === 0) return 'bg-gray-200';
    if (n === 1) return 'bg-emerald-500';
    if (n === 2) return 'bg-amber-500';
    return 'bg-red-500';
  };

  /** Build a Map<YYYY-MM-DD, {Morning:n, Day:n, Evening:n, Night:n}> from all bookings. */
  const buildDensityMap = () => {
    const map = new Map();
    Store.allBookings().forEach(b => {
      if (!b.date) return;
      if (!map.has(b.date)) map.set(b.date, { Morning: 0, Day: 0, Evening: 0, Night: 0 });
      const bucket = map.get(b.date);
      if (b.timing in bucket) bucket[b.timing] += 1;
    });
    return map;
  };

  /** Compute year range = min(book years, currentYear-2) .. max(book years, currentYear+5). */
  const yearRange = () => {
    const years = new Set();
    Store.allBookings().forEach(b => { if (b.date) years.add(Number(b.date.slice(0, 4))); });
    const now = new Date().getFullYear();
    years.add(now);
    const min = Math.min(...years, now - 2);
    const max = Math.max(...years, now + 5);
    const out = [];
    for (let y = min; y <= max; y++) out.push(y);
    return out;
  };

  /** Populate month + year selects once, then keep selected values synced to cursor. */
  const syncPickers = () => {
    const mSel = document.getElementById('calendarMonthPicker');
    const ySel = document.getElementById('calendarYearPicker');
    if (!mSel || !ySel) return;
    if (!pickersInitialised) {
      mSel.innerHTML = MONTHS.map((n, i) => `<option value="${i}">${n}</option>`).join('');
      mSel.addEventListener('change', () => { cursor = new Date(cursor.getFullYear(), Number(mSel.value), 1); render(); });
      ySel.addEventListener('change', () => { cursor = new Date(Number(ySel.value), cursor.getMonth(), 1); render(); });
      pickersInitialised = true;
    }
    // Refresh year options to include any newly-added booking years.
    const years = yearRange();
    ySel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    mSel.value = cursor.getMonth();
    ySel.value = cursor.getFullYear();
  };

  // ----- rendering -------------------------------------------------------
  let selectedISO = null;  // tracks the currently filter-selected day for visual highlight

  const cellHTML = (date, inMonth, density, isToday) => {
    const iso = isoLocal(date);
    const total = density ? Object.values(density).reduce((a, b) => a + b, 0) : 0;
    const dim   = inMonth ? '' : 'opacity-40';
    const isSelected = inMonth && iso === selectedISO;
    const todayRing = isSelected
      ? 'ring-2 ring-clay-500 ring-offset-2 shadow-glow'
      : (isToday ? 'ring-2 ring-wine ring-offset-1' : 'ring-1 ring-rose-100');
    const clickable = inMonth ? `onclick="Calendar.openDay('${iso}')"` : '';
    const cursor    = inMonth ? 'cursor-pointer hover:shadow-soft hover:border-rose-300' : 'cursor-default';

    const slotPills = TIMING_KEYS.map(k => {
      const n = density ? density[k] : 0;
      return `<div class="flex-1 flex flex-col items-center justify-center rounded text-[9px] font-bold text-white py-0.5 ${densityClass(n)}"
                title="${k}: ${n} booking${n!==1?'s':''}">
                <span class="leading-none">${TIMING_INITIALS[k]}</span>
                <span class="leading-none">${n || ''}</span>
              </div>`;
    }).join('');

    return `
      <div class="${dim} ${cursor} bg-white rounded-lg ${todayRing} border border-transparent p-1.5 min-h-[78px] flex flex-col gap-1 transition" ${clickable}>
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold ${isToday ? 'text-wine' : 'text-gray-700'}">${date.getDate()}</span>
          ${total ? `<span class="text-[10px] bg-wine text-white px-1.5 rounded-full font-bold">${total}</span>` : ''}
        </div>
        <div class="flex gap-0.5 mt-auto">${slotPills}</div>
      </div>
    `;
  };

  const render = () => {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;

    syncPickers();

    const density = buildDensityMap();
    const todayIso = isoLocal(new Date());

    // Weekday header row
    const header = WEEKDAYS.map(w => `<div class="text-[10px] font-semibold text-rosegold uppercase tracking-wider text-center py-1">${w}</div>`).join('');

    // First cell = the Sunday on or before the 1st of the month
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());

    // Always render 6 weeks = 42 cells (stable layout)
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const inMonth = d.getMonth() === cursor.getMonth();
      const iso = isoLocal(d);
      cells.push(cellHTML(d, inMonth, density.get(iso), iso === todayIso));
    }

    grid.innerHTML = header + cells.join('');
  };

  // ----- public API ------------------------------------------------------
  return {
    render,
    prev() { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); render(); },
    next() { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); render(); },
    today() {
      const d = new Date();
      cursor = new Date(d.getFullYear(), d.getMonth(), 1);
      render();
    },
    /** Click a day → set date filters + highlight selected cell + reveal bookings list.
     *  applyFilters() takes care of the smooth-scroll into the bookings section. */
    openDay(iso) {
      selectedISO = iso;
      document.getElementById('filterFrom').value = iso;
      document.getElementById('filterTo').value   = iso;
      render();  // re-render to show the selected-cell highlight FIRST

      // Show "Clear date filter" pill + update subtitle
      const clearBtn = document.getElementById('clearDayFilterBtn');
      const sub = document.getElementById('bookingsListSub');
      if (clearBtn) clearBtn.style.display = '';
      if (sub) {
        const d = new Date(iso);
        const pretty = isNaN(d) ? iso : d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        sub.textContent = `Showing bookings for ${pretty}`;
      }

      // applyFilters() will render + smooth-scroll into #bookingsSection.
      applyFilters();
    },
    /** Clear the single-day filter and go back to showing all bookings. */
    clearDay() {
      const wasSelected = !!selectedISO;
      this.clearDayUI();
      if (wasSelected) {
        document.getElementById('filterFrom').value = '';
        document.getElementById('filterTo').value   = '';
        applyFilters();
      }
    },
    /** Just clear the calendar's visual selection + status pill, without
     *  touching filter inputs or re-applying filters. Used when another
     *  module is already orchestrating a filter change. */
    clearDayUI() {
      selectedISO = null;
      render();
      const clearBtn = document.getElementById('clearDayFilterBtn');
      const sub = document.getElementById('bookingsListSub');
      if (clearBtn) clearBtn.style.display = 'none';
      if (sub) sub.textContent = 'Grouped by month — newest first';
    },
  };
})();
