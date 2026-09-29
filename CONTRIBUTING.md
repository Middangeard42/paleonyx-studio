# Contributing to Paleonyx Studio

Read [CLAUDE.md](CLAUDE.md) first. It sets the architecture rules, the
testing bar, and what a change must run before it is done.

## Sign your commits (DCO)

Paleonyx Studio uses the [Developer Certificate of Origin](https://developercertificate.org/).
By signing off a commit you certify that you wrote the change, or have the
right to submit it, under the project's licence,
LGPL-3.0-or-later. You keep your copyright.

Add a `Signed-off-by` line with your real name and email by committing
with `-s`:

```sh
git commit -s -m "Describe the change"
```

That adds a line like this to the message:

```
Signed-off-by: Your Name <you@example.com>
```

The `dco` check on every pull request fails when a commit in it has no
sign-off. Merge commits are skipped, and history from before the policy is
not judged. To fix the last commit, run `git commit --amend -s`; for a
whole branch, `git rebase --signoff main`.

Commits an AI agent makes in this repository are signed off with the
repository's own identity, which `git commit -s` picks up from the git
configuration.

## Before you open a pull request

Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. For changes to the Rust
shell in `apps/desktop/src-tauri`, also run `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings` and `cargo test`.
