#!/usr/bin/env bash
#
# Check a running deployment from the outside.
#
# Exercises the paths that are easy to get wrong in a vhost and impossible to
# cover from a unit test: routing, the origin allowlist, input validation, and
# whether anything sensitive leaks into a response body.
#
#   bin/smoke.sh https://api.example.com carlos-portfolio https://carlosrendonduque.github.io
#
# Exits non-zero on the first unexpected status, so it works as a deploy gate.

set -euo pipefail

BASE="${1:?usage: smoke.sh <base-url> <site-id> <allowed-origin>}"
SITE="${2:?usage: smoke.sh <base-url> <site-id> <allowed-origin>}"
ORIGIN="${3:?usage: smoke.sh <base-url> <site-id> <allowed-origin>}"

BASE="${BASE%/}"
failures=0

check() {
  local label="$1" expected="$2" actual="$3"

  if [ "$actual" = "$expected" ]; then
    printf '  ok   %-44s %s\n' "$label" "$actual"
  else
    printf '  FAIL %-44s got %s, want %s\n' "$label" "$actual" "$expected"
    failures=$((failures + 1))
  fi
}

status() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

echo "Smoke test: $BASE (site: $SITE)"
echo

echo "Routing"
check "health responds" 200 "$(status "$BASE/health")"
check "unknown route is 404" 404 "$(status "$BASE/nope")"

echo
echo "Origin allowlist"
check "allowed origin passes preflight" 204 "$(status -X OPTIONS "$BASE/chat?site=$SITE" \
  -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST')"
check "disallowed origin is refused" 403 "$(status -X POST "$BASE/chat?site=$SITE" \
  -H 'Origin: https://not-allowed.invalid' -H 'Content-Type: application/json' \
  -d '{"message":"hi"}')"
check "missing origin is refused" 403 "$(status -X POST "$BASE/chat?site=$SITE" \
  -H 'Content-Type: application/json' -d '{"message":"hi"}')"
check "unknown site is refused" 403 "$(status -X POST "$BASE/chat?site=no-such-site" \
  -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"message":"hi"}')"

echo
echo "Input validation"
check "GET is rejected" 405 "$(status "$BASE/chat?site=$SITE" -H "Origin: $ORIGIN")"
check "malformed JSON is rejected" 400 "$(status -X POST "$BASE/chat?site=$SITE" \
  -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d 'not json')"
check "empty message is rejected" 400 "$(status -X POST "$BASE/chat?site=$SITE" \
  -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"message":"   "}')"

echo
echo "Exposure"

root_probe=$(status "$BASE/.env")
check ".env is not served" 404 "$root_probe"

body=$(curl -s -X POST "$BASE/chat?site=$SITE" \
  -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{"message":"hola"}')

if printf '%s' "$body" | grep -qiE 'sk-ant|api[_-]?key|/home/|/srv/|vendor/'; then
  printf '  FAIL %-44s response body leaks internals\n' "no secrets in response"
  failures=$((failures + 1))
else
  printf '  ok   %-44s clean\n' "no secrets in response"
fi

if printf '%s' "$body" | grep -q '"score"'; then
  printf '  FAIL %-44s score reached the browser\n' "score stays server-side"
  failures=$((failures + 1))
else
  printf '  ok   %-44s clean\n' "score stays server-side"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$failures check(s) failed."
  exit 1
fi
