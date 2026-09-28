#!/usr/bin/env bash
# Installs the JavaScript dependencies in a Claude Code cloud session.
#
# Run from the SessionStart hook in .claude/settings.json. The hook only
# calls this in a cloud session, and the check below repeats that so the
# script is safe to run by hand: on a developer's machine it does nothing.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"

# The pnpm version comes from package.json's "packageManager" field, so
# there is one place to change it. Asking for it by name, rather than
# using whatever the image ships, is what the rest of the repo does too.
pnpm_spec="$(node -p "require('./package.json').packageManager")"

npx --yes "$pnpm_spec" install --frozen-lockfile
