/* ==========================================================
 *  privacy-mode.js  —  Press-and-hold price reveal for
 *  sensitive stat cards (Total Revenue, Advance Received).
 *
 *  UX contract:
 *    • Quick tap/click  → card behaves EXACTLY as before
 *                          (data-jump navigation in ui-shell.js).
 *    • Press & hold      → reveals the real ₹ value while held,
 *                          re-masks the instant you release.
 *
 *  Mechanics: a hold is just a pointerdown that's still active
 *  after HOLD_MS. Releasing early = ordinary click, nothing
 *  special happens. Releasing late (post-reveal) sets a one-shot
 *  window.__suppressCardJump flag that ui-shell.js's click
 *  handler checks, so the inevitable click-after-mouseup never
 *  ALSO triggers the tab-jump.
 *
 *  Values are pushed in by app.js via PrivacyMode.setValue(id, text)
 *  instead of a raw textContent write — single source of truth for
 *  "what should this card show right now" (masked vs revealed).
 * ========================================================== */

const PrivacyMode = (() => {
  const MASK    = '₹••••••';
  const HOLD_MS = 400;
  const IDS     = ['statRevenue', 'statAdvance'];

  const _real     = {};   // id -> latest real formatted value (e.g. "₹6,02,800")
  const _revealed = {};   // id -> bool
  const _timers   = {};   // id -> pending reveal timeout handle

  const _numEl  = (id) => document.getElementById(id);
  const _cardEl = (id) => _numEl(id)?.closest('.stat-card') || null;

  const _paint = (id) => {
    const el = _numEl(id);
    if (!el) return;
    el.textContent = _revealed[id] ? (_real[id] ?? MASK) : MASK;
    _cardEl(id)?.classList.toggle('stat-peeking', !!_revealed[id]);
  };

  const _startHold = (id) => {
    clearTimeout(_timers[id]);
    _timers[id] = setTimeout(() => {
      _revealed[id] = true;
      _paint(id);
      window.__suppressCardJump = true;   // consumed once by ui-shell.js's click handler
    }, HOLD_MS);
  };

  const _endHold = (id) => {
    clearTimeout(_timers[id]);
    if (_revealed[id]) { _revealed[id] = false; _paint(id); }
  };

  const _wireCard = (id) => {
    const card = _cardEl(id);
    if (!card) return;

    // Pointer events cover mouse + touch + pen in one API.
    card.addEventListener('pointerdown', () => _startHold(id));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      card.addEventListener(ev, () => _endHold(id))
    );

    // Keyboard equivalent: Space/Enter held down = same gesture.
    // e.repeat filters out the auto-repeat keydowns browsers fire while held.
    card.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) _startHold(id);
    });
    card.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') _endHold(id);
    });

    // Safety nets — never leave a value revealed if focus/window is lost mid-hold.
    card.addEventListener('blur', () => _endHold(id));
    window.addEventListener('blur', () => _endHold(id));
  };

  return {
    init() { IDS.forEach(_wireCard); },

    /** Called from renderDashboard() instead of a direct textContent write. */
    setValue(id, formattedText) {
      _real[id] = formattedText;
      _paint(id);
    },
  };
})();

document.addEventListener('DOMContentLoaded', () => PrivacyMode.init());
