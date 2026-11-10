#!/usr/bin/env bash
# Build the Cloud Run source folder from a built hub folder.
#   ./make_bundle.sh HUB_DIR OUT_DIR
# HUB_DIR holds index.html, pipeline.html, pos.html, dsr.html, history.html and their data files.
# They contain customer data: OUT_DIR must stay outside this (public) repo.
set -euo pipefail
hub=$(cd "$1" && pwd); out=$2
here=$(cd "$(dirname "$0")" && pwd)
case "$(cd "$(dirname "$out")" && pwd)/" in "$(cd "$here/../.." && pwd)/"*) echo "OUT_DIR must be outside the repo (customer data)"; exit 1;; esac
rm -rf "$out"; mkdir -p "$out/public"
cp "$here/server.js" "$here/package.json" "$here/Dockerfile" "$here/.dockerignore" "$out/"
for f in index.html pipeline.html pos.html dsr.html history.html engine.js initial-data.js history-pos.csv tw-ppl.json; do
  [ -f "$hub/$f" ] && cp "$hub/$f" "$out/public/"
done
cp "$here/claude-shim.js" "$out/public/"
# the hub page asks window.claude for its database: load the shim before any of its scripts
python3 - "$out/public/index.html" <<'PY'
import sys
p = sys.argv[1]; t = open(p, encoding='utf-8').read()
tag = '<script src="claude-shim.js"></script>\n'
if tag not in t:
    i = t.index('<meta charset="utf-8">') + len('<meta charset="utf-8">\n')
    t = t[:i] + tag + t[i:]
open(p, 'w', encoding='utf-8').write(t)
PY
echo "bundle: $out ($(du -sh "$out" | cut -f1))"
