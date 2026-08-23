/**
 * Which commands the agent may run.
 *
 * Matching is on a *prefix of the argument list*, not on the program
 * name alone, and that distinction is the whole design. Allowing bare
 * `node` or `python` allows `node -e "..."` and `python -c "..."`, which
 * is arbitrary code execution wearing a familiar name. Allowing bare
 * `npm` allows `npm run` of any script the project happens to define.
 * `cargo test` allows running the tests.
 *
 * This is a real reduction in what a model can reach for, not a sandbox.
 * A user who adds a broad entry gets broad behaviour, which is why the
 * settings copy says so plainly rather than implying the list makes
 * command execution safe.
 */

/** Sensible starting set: read-only checks, tests, linters, builds. */
export const DEFAULT_COMMAND_ALLOWLIST: readonly string[] = [
  // JS/TS
  "npm test",
  "npm run build",
  "npm run lint",
  "npm run test",
  "npm run typecheck",
  "pnpm test",
  "pnpm build",
  "pnpm lint",
  "pnpm typecheck",
  "yarn test",
  "yarn lint",
  "yarn build",
  "npx tsc --noEmit",
  "npx vitest run",
  "npx eslint",
  // Rust
  "cargo test",
  "cargo check",
  "cargo clippy",
  "cargo build",
  "cargo fmt --check",
  // Python
  "pytest",
  "python -m pytest",
  "ruff check",
  // Go
  "go test",
  "go build",
  "go vet",
];

export interface CommandRequest {
  program: string;
  args: string[];
}

export type AllowlistDecision =
  | { allowed: true; matched: string }
  | { allowed: false; reason: string };

/**
 * Windows resolves `npm` to `npm.cmd` and so on. Comparing the bare stem
 * keeps one allowlist working across platforms without duplicate
 * entries per extension.
 */
function normalizeProgram(program: string): string {
  const base = program.split(/[\\/]/).pop() ?? program;
  return base.replace(/\.(cmd|bat|exe|ps1)$/i, "").toLowerCase();
}

function tokenize(entry: string): string[] {
  return entry.trim().split(/\s+/).filter(Boolean);
}

export function checkAllowlist(
  request: CommandRequest,
  allowlist: readonly string[]
): AllowlistDecision {
  const program = normalizeProgram(request.program);
  if (program.length === 0) {
    return { allowed: false, reason: "No command was given." };
  }

  for (const entry of allowlist) {
    const tokens = tokenize(entry);
    const [entryProgram, ...entryArgs] = tokens;
    if (entryProgram === undefined) continue;
    if (normalizeProgram(entryProgram) !== program) continue;

    // Every token after the program must appear, in order, at the front
    // of the request's arguments. Extra trailing arguments are fine —
    // `cargo test` permits `cargo test --lib my_test`, which is the same
    // operation more narrowly scoped.
    const prefixMatches = entryArgs.every((token, index) => request.args[index] === token);
    if (prefixMatches) {
      return { allowed: true, matched: entry };
    }
  }

  return {
    allowed: false,
    reason: `"${formatCommand(request)}" is not in this project's allowed commands.`,
  };
}

export function formatCommand(request: CommandRequest): string {
  return [request.program, ...request.args].join(" ");
}
