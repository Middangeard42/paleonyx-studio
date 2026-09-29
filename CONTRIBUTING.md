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

A pull request with an unsigned commit will be asked to add the sign-off
before it is merged. To fix the last commit, run `git commit --amend -s`.

## Before you open a pull request

Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. For changes to the Rust
shell in `apps/desktop/src-tauri`, also run `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings` and `cargo test`.
