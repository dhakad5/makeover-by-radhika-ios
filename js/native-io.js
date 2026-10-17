/* ==========================================================
 *  native-io.js  —  Browser "download" / "open PDF" replacement.
 *
 *  WKWebView ignores <a download>, blob: URLs and window.open().
 *  On iOS we write the file to the cache dir and hand it to the native
 *  Share sheet (Save to Files, AirDrop, WhatsApp, Mail, Quick Look, …).
 *  In a normal browser it falls back to the classic download link.
 * ========================================================== */

window.NativeIO = (() => {
  const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  const browserDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  /** Save/share a Blob. Resolves true when handed off, false if user cancelled. */
  const saveBlob = async (blob, filename) => {
    if (!isNative()) { browserDownload(blob, filename); return true; }
    const { Filesystem, Share } = window.Capacitor.Plugins;
    try {
      const { uri } = await Filesystem.writeFile({
        path: `exports/${filename}`, directory: 'CACHE', data: await blobToBase64(blob), recursive: true,
      });
      await Share.share({ title: filename, url: uri, dialogTitle: filename });
      return true;
    } catch (e) {
      if (/cancel/i.test(String(e?.message || e))) return false;   // user dismissed the share sheet
      console.error('[NativeIO] share failed', e);
      if (typeof toast === 'function') toast('❌ Could not export: ' + (e?.message || e));
      return false;
    }
  };

  const saveText = (text, filename, mime = 'application/json') =>
    saveBlob(new Blob([text], { type: mime }), filename);

  return { isNative, saveBlob, saveText };
})();
