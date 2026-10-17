/* ==========================================================
 *  excel-export.js  —  XLSX export via SheetJS
 *  Produces a workbook with 4 sheets: Summary, Clients, Bookings, Services.
 * ========================================================== */

const ExcelExport = (() => {

  const fdate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toISOString().slice(0, 10);
  };

  const _price = (p) => (p === null || p === undefined || p === '') ? 'Pending' : Number(p);

  const exportAll = (clients) => {
    // ---------- Clients sheet (one row per client) ----------
    const clientRows = clients.map(c => {
      const t = Store.clientTotals(c);
      return {
        Name: c.name,
        Phone: c.phone,
        'Booking For': c.type,
        Status: Store.clientStatus(c),
        'Advance (₹)': t.advance,
        'Payment Received (₹)': t.paymentReceived,
        'Bookings Total (₹)': t.bookingsTotal,
        'Services Total (₹)': t.servicesTotal,
        'Discount (₹)': t.discount,
        'Total Package (₹)': t.total,
        'Balance Due (₹)': t.balance,
        'Bookings Count': (c.bookings || []).length,
        'Services Count': (c.services || []).length,
        Notes: c.notes || '',
        'Created At': fdate(c.createdAt),
      };
    });

    // ---------- Bookings sheet (one row per date-bound session) ----------
    const bookingRows = [];
    clients.forEach(c => {
      (c.bookings || []).forEach(b => {
        bookingRows.push({
          'Client Name': c.name,
          Phone: c.phone,
          'Booking For': c.type,
          Date: fdate(b.date),
          Year: b.date ? new Date(b.date).getFullYear() : '',
          'Makeup Type': b.makeupType,
          Timing: b.timing,
          'Price (₹)': _price(b.price),
          'Slot Status': b.status,
          Notes: b.notes || '',
          'Client Status': Store.clientStatus(c),
        });
      });
    });
    bookingRows.sort((a, b) => {
      if (a.Date !== b.Date) return (a.Date || '').localeCompare(b.Date || '');
      return (Store.TIMING_RANK[a.Timing] ?? 99) - (Store.TIMING_RANK[b.Timing] ?? 99);
    });

    // ---------- Services sheet (one row per add-on) ----------
    const serviceRows = [];
    clients.forEach(c => {
      (c.services || []).forEach(s => {
        serviceRows.push({
          'Client Name': c.name,
          Phone: c.phone,
          'Booking For': c.type,
          Service: s.name,
          'Price (₹)': _price(s.price),
          Status: s.status,
          Notes: s.notes || '',
          'Created At': fdate(s.createdAt),
        });
      });
    });
    serviceRows.sort((a, b) =>
      a['Client Name'].localeCompare(b['Client Name']) || a.Service.localeCompare(b.Service)
    );

    // ---------- Summary (uses canonical Store.clientTotals so totals match the UI) ----------
    const totalBookingsRevenue = clients.reduce((s, c) => s + Store.clientTotals(c).bookingsTotal, 0);
    const totalServicesRevenue = clients.reduce((s, c) => s + Store.clientTotals(c).servicesTotal, 0);
    const totalRevenue = totalBookingsRevenue + totalServicesRevenue;
    const totalAdvance = clients.reduce((s, c) => s + Number(c.advance || 0), 0);
    const totalPaymentReceived = clients.reduce((s, c) => s + Number(c.paymentReceived || 0), 0);
    const totalCollected = totalAdvance + totalPaymentReceived;
    const summary = [
      { Metric: 'Total Clients',                Value: clients.length },
      { Metric: 'Total Bookings',               Value: bookingRows.length },
      { Metric: 'Total Add-On Services',        Value: serviceRows.length },
      { Metric: 'Confirmed Clients',            Value: clients.filter(c => Store.clientStatus(c) === 'Confirmed').length },
      { Metric: 'Tentative Clients',            Value: clients.filter(c => Store.clientStatus(c) === 'Tentative').length },
      { Metric: 'Bookings Done',                Value: bookingRows.filter(b => b['Slot Status'] === 'Done').length },
      { Metric: 'Bookings Scheduled',           Value: bookingRows.filter(b => b['Slot Status'] === 'Scheduled').length },
      { Metric: 'Services Done',                Value: serviceRows.filter(s => s.Status === 'Done').length },
      { Metric: 'Services Pending',             Value: serviceRows.filter(s => s.Status === 'Pending').length },
      { Metric: 'Bookings Revenue (₹)',         Value: totalBookingsRevenue },
      { Metric: 'Services Revenue (₹)',         Value: totalServicesRevenue },
      { Metric: 'Total Revenue (₹)',            Value: totalRevenue },
      { Metric: 'Advance Collected (₹)',        Value: totalAdvance },
      { Metric: 'Payment Received (₹)',         Value: totalPaymentReceived },
      { Metric: 'Total Collected (₹)',          Value: totalCollected },
      { Metric: 'Balance Outstanding (₹)',      Value: Math.max(totalRevenue - totalCollected, 0) },
      { Metric: 'Generated On',                 Value: new Date().toLocaleString('en-IN') },
    ];

    // ---------- Build workbook ----------
    const wb = XLSX.utils.book_new();
    const wsSummary  = XLSX.utils.json_to_sheet(summary);
    const wsClients  = XLSX.utils.json_to_sheet(clientRows);
    const wsBookings = XLSX.utils.json_to_sheet(bookingRows);
    const wsServices = XLSX.utils.json_to_sheet(serviceRows);

    const fit = (rows) => {
      if (!rows.length) return [];
      return Object.keys(rows[0]).map(k => ({
        wch: Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)) + 2,
      }));
    };
    wsSummary['!cols']  = fit(summary);
    wsClients['!cols']  = fit(clientRows);
    wsBookings['!cols'] = fit(bookingRows);
    wsServices['!cols'] = fit(serviceRows);

    XLSX.utils.book_append_sheet(wb, wsSummary,  'Summary');
    XLSX.utils.book_append_sheet(wb, wsClients,  'Clients');
    XLSX.utils.book_append_sheet(wb, wsBookings, 'Bookings');
    XLSX.utils.book_append_sheet(wb, wsServices, 'Services');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    NativeIO.saveBlob(
      new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Makeover_By_Radhika_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return { exportAll };
})();
