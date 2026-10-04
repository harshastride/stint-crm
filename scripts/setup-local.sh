#!/bin/bash
# One-time setup on your own machine: starts Supabase in Docker, creates the tables, writes .env.local, adds demo data.
set -e
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker is not installed. Install Docker Desktop, open it, then run this again."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Open Docker Desktop, wait for it to start, then run this again."; exit 1; }
command -v supabase >/dev/null || { echo "The Supabase CLI is not installed. Run:  brew install supabase/tap/supabase"; exit 1; }
command -v node >/dev/null || { echo "Node.js is not installed. Install it from nodejs.org (version 20 or newer)."; exit 1; }

echo "1/4  Starting Supabase (the first time downloads images and takes a few minutes)…"
supabase start

echo "2/4  Writing .env.local…"
STATUS="$(supabase status -o env)"
get() { echo "$STATUS" | grep -E "^$1=" | head -1 | cut -d= -f2- | tr -d '"'; }
API_URL="$(get API_URL)"
ANON="$(get ANON_KEY)";            [ -z "$ANON" ] && ANON="$(get PUBLISHABLE_KEY)"
SERVICE="$(get SERVICE_ROLE_KEY)"; [ -z "$SERVICE" ] && SERVICE="$(get SECRET_KEY)"
[ -z "$API_URL" ] || [ -z "$ANON" ] || [ -z "$SERVICE" ] && { echo "Could not read the keys from 'supabase status'. Run 'supabase status' and copy the API URL, anon key and service_role key into .env.local by hand (see .env.example)."; exit 1; }
cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
ENV

echo "3/4  Installing the app’s packages…"
npm install --no-audit --no-fund

echo "4/4  Adding demo logins and sample people…"
node scripts/seed-demo.mjs

echo
echo "Done. Start the app with:   npm run dev"
echo "Then open http://localhost:3100 and sign in as harsha@demo.stint.local / stint-demo-1234"
