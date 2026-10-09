#!/bin/bash
cd "/GlycoTank-web"
echo "Starting GlycoTank on http://localhost:8080 ..."
if command -v node >/dev/null 2>&1; then
  (open "http://localhost:8080" && npx --yes http-server . -p 8080 -c-1)
elif command -v python3 >/dev/null 2>&1; then
  (open "http://localhost:8080" && python3 -m http.server 8080)
else
  echo "Node/Python not found. Opening file directly (no service worker)."
  open "./index.html"
fi
