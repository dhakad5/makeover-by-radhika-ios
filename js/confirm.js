/* ==========================================================
 *  confirm.js  —  Styled themed confirmation dialog.
 *  Replaces window.confirm() with a nicer Promise-based modal.
 *  Depends on the #confirmModal markup in index.html and
 *  on the $() helper from app.js (loaded first).
 * ========================================================== */

/**
 * Show a custom confirm dialog and resolve with true/false.
 * @param {Object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.message]
 * @param {string} [opts.confirmText]
 * @param {string} [opts.cancelText]
 * @param {string} [opts.icon]        — emoji shown in the icon bubble
 * @param {boolean} [opts.danger]     — red destructive button styling
 * @returns {Promise<boolean>}
 */
const confirmAction = ({
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  confirmText = 'Yes, Delete',
  cancelText = 'Cancel',
  icon = '⚠️',
  danger = true,
} = {}) => {
  return new Promise((resolve) => {
    const modal  = document.getElementById('confirmModal');
    const okBtn  = document.getElementById('confirmOkBtn');
    const cancel = document.getElementById('confirmCancelBtn');

    document.getElementById('confirmTitle').textContent   = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmIcon').textContent    = icon;
    okBtn.textContent  = confirmText;
    cancel.textContent = cancelText;
    okBtn.className = `px-5 py-2 rounded-lg text-white shadow-soft font-semibold ${
      danger ? 'bg-red-600 hover:bg-red-700' : 'bg-wine hover:bg-rose-800'
    }`;

    const close = (result) => {
      modal.classList.remove('modal-open');
      okBtn.onclick  = null;
      cancel.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };

    okBtn.onclick  = () => close(true);
    cancel.onclick = () => close(false);
    document.addEventListener('keydown', onKey);

    modal.classList.add('modal-open');
    // Focus cancel by default — safer (don't accidentally Enter-delete).
    setTimeout(() => cancel.focus(), 50);
  });
};
