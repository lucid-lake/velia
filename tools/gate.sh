#!/usr/bin/env bash
# The per-merge gates in one command (refactor round 3, D pulled forward): test:v2, goldens:v2, build:v2 + scrub,
# v1's fast tests (tests/ and classic/tests/) and goldens when src/, classic/ or tests/ changed, optional page tests. Logs to renders/postmerge-NNN.log (next free number)
# and ends with one summary line: each gate PASS/FAIL with its wall seconds.
#   bash tools/gate.sh [--base <rev>] [--twice] [--v1|--no-v1] [--pages "name1 name2"] [--skip-goldens]
#   --base   the rev to diff for "did src/, classic/ or tests/ change" (default HEAD~1, i.e. the merge's first parent when run after a merge)
#   --twice  goldens:v2 --twice (when re-blessing)
set -u
cd "$(dirname "$0")/.."
BASE=HEAD~1 TWICE= V1=auto PAGES= SKIPG=
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift ;;
    --twice) TWICE=--twice ;;
    --v1) V1=yes ;;
    --no-v1) V1=no ;;
    --pages) PAGES="$2"; shift ;;
    --skip-goldens) SKIPG=1 ;;
    *) echo "gate: unknown argument $1"; exit 2 ;;
  esac
  shift
done
if [ "$V1" = auto ]; then
  if git diff --quiet "$BASE" HEAD -- src/ classic/ tests/; then V1=no; else V1=yes; fi
fi
n=$(ls renders/postmerge-[0-9][0-9][0-9].log 2>/dev/null | sed -E 's/.*-([0-9]{3})\.log/\1/' | sort -n | tail -1)
n=$(printf '%03d' $((10#${n:-0} + 1)))
LOG="renders/postmerge-$n.log"
echo "gate: $(git log --oneline -1 | cut -c1-80) (v1: $V1) → $LOG"
echo "== gate $(date '+%F %T') $(git rev-parse --short HEAD) base $BASE v1 $V1" > "$LOG"
SUMMARY= FAILED=0
run() {  # run <name> <command...>
  local name="$1"; shift
  local t0=$SECONDS
  echo "== $name" >> "$LOG"
  if "$@" >> "$LOG" 2>&1; then r=PASS; else r=FAIL; FAILED=1; fi
  SUMMARY="$SUMMARY $name $r $((SECONDS - t0))s ·"
  echo "  $name $r $((SECONDS - t0))s"
}
run test:v2 npm run -s test:v2
[ -z "$SKIPG" ] && run goldens:v2 node tools/goldens.mjs --app v2 $TWICE
run build:v2 npm run -s build:v2
run scrub bash tools/scrub_dist.sh dist-v2
if [ "$V1" = yes ]; then
  run v1 npm run -s test
  run classic npm run -s test:classic
  [ -z "$SKIPG" ] && run goldens:v1 node tools/goldens.mjs
fi
[ -n "$PAGES" ] && run pages node tools/test_pages.mjs --app v2 $PAGES
line="gate $(git rev-parse --short HEAD):${SUMMARY% ·} → $LOG"
echo "$line" >> "$LOG"
echo "$line"
exit $FAILED
