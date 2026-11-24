#!/usr/bin/env bash
# Pre-upload check: grep a build (default dist/) for words that must not ship: "owner", "notes/", "research/", "lakeshore" (case-insensitive),
# in the text files and inside every .glb / .glb.gz JSON chunk (tools/build/scrub.mjs --glb).
# Exit 1 on any hit that is not allow-listed (tools/scrub_dist.allow: one extended regex per line, matched against the hit text;
# only third-party library text may be listed there, with a comment saying which library).
#   bash tools/scrub_dist.sh [dist-dir]
set -u
cd "$(dirname "$0")/.."
D="${1:-dist}"
[ -d "$D" ] || { echo "scrub_dist: no $D (run npm run build)"; exit 2; }
ALLOW=tools/scrub_dist.allow
hits=$(grep -rIiEo --exclude='*.woff2' --exclude='*.webp' --exclude='*.jpg' --exclude='*.glb' ".{0,40}(owner|notes/|research/|lakeshore).{0,40}" "$D" 2>/dev/null || true)
# inside the GLBs: the JSON chunk of every .glb and .glb.gz (grep skips binaries), same words (tools/build/scrub.mjs § 7)
glb=$(node tools/build/scrub.mjs --glb "$D") || { echo "scrub_dist: the GLB scan failed"; exit 2; }
hits=$(printf '%s\n%s\n' "$hits" "$glb" | grep -v '^$' || true)
if [ -f "$ALLOW" ] && [ -n "$hits" ]; then
  pats=$(grep -v '^[[:space:]]*#' "$ALLOW" | grep -v '^[[:space:]]*$' || true)
  if [ -n "$pats" ]; then hits=$(printf '%s\n' "$hits" | grep -viE "$(printf '%s\n' "$pats" | paste -sd'|' -)" || true); fi
fi
if [ -n "$hits" ]; then
  echo "scrub_dist: FAIL, $(printf '%s\n' "$hits" | wc -l | tr -d ' ') hit(s):"
  printf '%s\n' "$hits" | head -60
  exit 1
fi
echo "scrub_dist: clean ($D)"
