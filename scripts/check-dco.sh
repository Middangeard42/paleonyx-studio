#!/usr/bin/env bash
# Fails when a commit in BASE..HEAD carries no Signed-off-by trailer.
#
# The Developer Certificate of Origin (CONTRIBUTING.md) is a sign-off on
# each commit: `git commit -s` adds it. Merge commits are skipped, since
# they add no content of their own. Only the range given is looked at, so
# history from before the policy is never judged.
#
# Usage: scripts/check-dco.sh BASE HEAD
set -euo pipefail

base="${1:?usage: check-dco.sh BASE HEAD}"
head="${2:?usage: check-dco.sh BASE HEAD}"

# A trailer is `Signed-off-by: Name <address>` in the message's last
# paragraph, which is what `git interpret-trailers` reads. Text further up
# that only looks like one is not a sign-off.
signed='^Signed-off-by: .+ <[^<> ]+@[^<> ]+>$'

unsigned=0
while read -r sha; do
  [ -n "$sha" ] || continue
  if ! git log -1 --format=%B "$sha" | git interpret-trailers --parse | grep -Eiq "$signed"; then
    echo "No Signed-off-by: $(git log -1 --format='%h %s' "$sha")"
    unsigned=$((unsigned + 1))
  fi
done < <(git rev-list --no-merges "$base..$head")

if [ "$unsigned" -gt 0 ]; then
  echo
  echo "$unsigned commit(s) need a sign-off. See CONTRIBUTING.md."
  echo "For the last commit: git commit --amend -s"
  echo "For a whole branch:  git rebase --signoff <base branch>"
  exit 1
fi
