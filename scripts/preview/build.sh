#!/usr/bin/env bash
# Build the working tree in a scratch copy so the live out/ is not touched.
set -euo pipefail
rm -rf /tmp/gocash-preview/src && mkdir -p /tmp/gocash-preview/src
rsync -a --exclude out --exclude .next --exclude node_modules --exclude .git /home/zether/gocash-app/ /tmp/gocash-preview/src/
ln -s /home/zether/gocash-app/node_modules /tmp/gocash-preview/src/node_modules
cd /tmp/gocash-preview/src && NEXT_TELEMETRY_DISABLED=1 pnpm exec next build 2>&1 | grep -E 'Compiled|rror|Exporting \(2' || true
