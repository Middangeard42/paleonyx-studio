#!/usr/bin/env bash
# Tests for scripts/check-dco.sh, in a throwaway repository.
set -uo pipefail

check="$(cd "$(dirname "$0")" && pwd)/check-dco.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q -b main .
git config user.name "Test Author"
git config user.email "author@example.com"
git commit -q --allow-empty -m "base, never checked"
base="$(git rev-parse HEAD)"

failures=0
expect() { # expect <0|1> <description>
  local want="$1" what="$2" got=0
  "$check" "$base" HEAD >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok   - $what"
  else
    echo "FAIL - $what (exit $got, wanted $want)"
    failures=$((failures + 1))
  fi
}

expect 0 "no commits since the base passes"

git commit -q --allow-empty -m "signed" -s
expect 0 "a signed commit passes"

git commit -q --allow-empty -m "unsigned"
expect 1 "an unsigned commit fails"

git commit -q --allow-empty -m "signed after it" -s
expect 1 "one unsigned commit among signed ones still fails"

git reset -q --hard "$base"
git commit -q --allow-empty -m "with other trailers" -m "Co-Authored-By: Someone <a@b.c>
Signed-off-by: Test Author <author@example.com>
Claude-Session: https://example.com/x"
expect 0 "a sign-off among other trailers passes"

git commit -q --allow-empty -m "sign-off only in the body" -m "Signed-off-by: Test Author <author@example.com>

More text after it, so it is not a trailer."
expect 1 "a sign-off that is not in the trailer block fails"

git reset -q --hard "$base"
git commit -q --allow-empty -m "bad sign-off" -m "Signed-off-by: no email here"
expect 1 "a sign-off without an email address fails"

git reset -q --hard "$base"
git commit -q --allow-empty -m "signed" -s
git checkout -q -b side "$base"
git commit -q --allow-empty -m "side, signed" -s
git checkout -q main
git merge -q --no-ff side -m "merge, no sign-off"
expect 0 "a merge commit needs no sign-off"

exit "$failures"
