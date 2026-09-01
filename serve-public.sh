#!/usr/bin/env bash
# Share TravelTimeline from this Mac so a friend can open it in a browser.
# You already use this pattern for Carriage (cloudflared quick tunnel).
#
# Usage: ./serve-public.sh
# Copy the https://….trycloudflare.com URL when it prints. Leave the window open.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Run: brew install cloudflared"
  exit 1
fi

if [[ ! -f client/.env.local ]]; then
  echo "Missing client/.env.local (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)."
  echo "Without it, a friend can open the globe but cannot sign in."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source client/.env.local
set +a
export SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_ANON_KEY:-}}"

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" ]]; then
  echo "client/.env.local has no Supabase keys. A friend cannot sign in."
  exit 1
fi

if [[ ! -f client/dist/index.html || ! -f server/dist/index.js ]]; then
  echo "Building the app (first run)…"
  npm run build
fi

echo "Keeping this Mac awake. Plug it in. Do not close the lid."
echo "Copy the trycloudflare.com URL when it appears. Leave this window open."
echo

keep_awake=(caffeinate -is)
if ! command -v caffeinate >/dev/null 2>&1; then
  keep_awake=()
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if curl -sf --max-time 2 "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
  echo "TravelTimeline is already running on port 3001."
else
  NODE_ENV=production PORT=3001 npm start &
  SERVER_PID=$!
  for _ in {1..40}; do
    if curl -sf --max-time 1 "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  if ! curl -sf --max-time 2 "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
    echo "Server did not start on port 3001."
    exit 1
  fi
fi

exec "${keep_awake[@]}" cloudflared tunnel --url "http://127.0.0.1:3001"
