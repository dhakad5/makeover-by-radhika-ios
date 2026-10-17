# iOS app (Capacitor)

The web app is wrapped in a native iOS shell. **No server needed** — `js/local-api.js`
replaces the FastAPI/Spring backend and stores `data/bookings.json` + 50 rolling backups
in the app's private storage on the device.

## Prerequisites
- Full **Xcode** (App Store) — Command Line Tools alone are not enough
- `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
- Apple ID in Xcode → Settings → Accounts (free account OK for your own iPhone, 7-day signing)

## Build & run
```bash
npm install
npm run ios          # copies frontend → www/, syncs into ios/, opens Xcode
```
In Xcode: select the **App** target → *Signing & Capabilities* → pick your Team →
choose a simulator or your iPhone → ▶ Run.

Optional — bundle your existing data on first launch (do NOT commit/share the IPA if it contains client data):
```bash
SEED=backend-java/data/bookings.json npm run sync
```
Otherwise use **💾 → ⬆ Import** inside the app (Files picker) to load a JSON export.

## Browser smoke-test (no Xcode)
Serve `www/` and open `index.html?local=1` — runs the on-device backend on localStorage.

## What changed vs. the web version
| Web | iOS |
|---|---|
| FastAPI/Java backend | `js/local-api.js` (same API surface, same semantics) |
| `<a download>`, `doc.save`, `XLSX.writeFile`, `window.open` | `js/native-io.js` → iOS Share sheet |
| ⬆ Upload (git push) | removed |
| Open/Connect File (File System Access API) | not supported in WKWebView; use Export/Import |
| Layout | `css/ios.css` (safe areas, 16px inputs, dvh) |

Data lives only on the device (+ your iPhone/iCloud backup). Use **⬇ Export** regularly.
