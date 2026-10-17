/**
 * GitSync — single-click backend → GitHub upload.
 *
 * Wires the "Upload" button in the data drawer to POST /api/git/sync.
 * The endpoint copies the live data file to its canonical location, then runs
 * git add → commit → push. Token lives server-side in ~/.makeover-git-token.
 *
 * Reuses ApiClient's base-URL logic so it works whether the page is served by
 * Spring Boot (relative URL → same-origin) OR opened directly via file://
 * (absolute URL → http://127.0.0.1:8000).
 *
 * UX: disable the button + show spinner while in flight, toast the outcome.
 */
window.GitSync = (() => {
  const BTN_ID = 'gitSyncBtn';
  const ORIGINAL_LABEL = '⬆️ Upload';
  const SPINNER_LABEL = '⏳ Uploading…';
  const LOG_PREFIX = '[git-sync]';

  /**
   * Resolve API base the same way ApiClient does. Falls back to 127.0.0.1:8000
   * when the page is opened from file:// (no origin to attach relative URLs to).
   */
  const apiBase = () => (window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '');
  const url = (path) => apiBase() + path;

  console.log(`${LOG_PREFIX} module loaded`, {
    pageOrigin: location.origin,
    apiBase: apiBase() || '(same-origin)',
  });

  /** Show a toast using the app's existing helper if available, else alert. */
  const notify = (msg, kind = 'info') => {
    if (typeof toast === 'function') return toast(msg);
    if (typeof window.toast === 'function') return window.toast(msg);
    if (kind === 'error') alert('❌ ' + msg); else console.log(LOG_PREFIX, msg);
  };

  /** Convert any error into a human-friendly hint. */
  const explainFetchError = (e) => {
    const msg = String(e?.message || e);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return 'Backend unreachable at ' + (apiBase() || location.origin)
           + '. Make sure Spring Boot is running, or try a hard reload (Cmd+Shift+R).';
    }
    return msg;
  };

  /** Click handler — wraps fetch in a clean enable/disable cycle. */
  const upload = async () => {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = SPINNER_LABEL;

    const endpoint = url('/api/git/sync');
    console.log(`${LOG_PREFIX} POST ${endpoint}`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      });
      console.log(`${LOG_PREFIX} response status:`, res.status);
      const data = await res.json().catch(() => ({ ok: false, error: 'Non-JSON response (HTTP ' + res.status + ')' }));
      console.log(`${LOG_PREFIX} response body:`, data);

      if (data.ok) {
        notify(`✅ ${data.commitMessage || 'Pushed to GitHub'}`);
      } else {
        notify(`❌ Upload failed: ${data.error || ('HTTP ' + res.status)}`, 'error');
        console.warn(`${LOG_PREFIX} failure details`, data);
      }
    } catch (e) {
      const hint = explainFetchError(e);
      notify(`❌ Upload failed: ${hint}`, 'error');
      console.error(`${LOG_PREFIX} fetch threw`, e);
    } finally {
      btn.disabled = false;
      btn.textContent = ORIGINAL_LABEL;
    }
  };

  /** Quick connectivity probe — useful for debugging from the console. */
  const ping = async () => {
    try {
      const res = await fetch(url('/api/git/status'));
      const data = await res.json();
      console.log(`${LOG_PREFIX} status:`, data);
      return data;
    } catch (e) {
      console.error(`${LOG_PREFIX} status fetch failed:`, e);
      return null;
    }
  };

  return { upload, ping };
})();
