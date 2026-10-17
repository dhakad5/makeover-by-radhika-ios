#!/usr/bin/env bash
# Copies ONLY the frontend into www/ (the Capacitor webDir). www/ is generated + gitignored.
# Optional: SEED=/path/to/bookings.json ./scripts/build-www.sh  → bundles a first-launch seed.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www && mkdir -p www/vendor
cp index.html www/
cp -R css js assets www/
cp -R vendor/web vendor/fonts www/vendor/
rm -f www/js/git-sync.js            # GitSync needs a local git repo — not available on iOS
sed -i '' '/js\/git-sync.js/d' www/index.html
if [[ -n "${SEED:-}" ]]; then cp "$SEED" www/seed.json && echo "Seed bundled: $SEED"; fi
echo "www/ ready ($(du -sh www | cut -f1))"
