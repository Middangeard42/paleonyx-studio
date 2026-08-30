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

  // A refused command that was trying to edit the project is worth
  // naming as such. "Not in the allowed commands" is true but reads as
  // a list that needs widening, when the right answer is that changes
  // belong in a reviewable diff and never in a command at all.
  if (looksLikeAnEdit(request)) {
    return {
      allowed: false,
      reason: `The model tried to edit your files by running "${formatCommand(
        request
      )}". That is refused whatever the allowlist says: a change made by command would skip the diff, leave no history, and could not be undone. It should propose the change instead.`,
    };
  }

  // Reaching for `cat` when readFile is already offered is not a gap in
  // the allowlist, so saying "add it in Settings" points at the wrong
  // remedy — the agent has a better way and should use it.
  if (looksLikeReadingAFile(request)) {
    return {
      allowed: false,
      reason: `The model tried to read a file by running "${formatCommand(
        request
      )}". It already has a tool for that and does not need a command, so this is refused rather than something to permit.`,
    };
  }

  return {
    allowed: false,
    reason: `"${formatCommand(request)}" is not in this project's allowed commands.`,
  };
}

/** Programs whose whole job is printing a file the read tool can fetch. */
const FILE_READING_PROGRAMS = new Set([
  "cat",
  "type",
  "head",
  "tail",
  "less",
  "more",
  "bat",
  "nl",
]);

function looksLikeReadingAFile(request: CommandRequest): boolean {
  return FILE_READING_PROGRAMS.has(normalizeProgram(request.program));
}

/**
 * Whether a command was an attempt to modify the project.
 *
 * Recognition only — the command is refused either way, and this picks
 * which explanation is true. Deliberately not a security boundary: the
 * allowlist is what refuses, and a user who permits `sed` gets `sed`
 * (CLAUDE.md §6). Observed after Ornith gained tool calling and reached
 * for `sed -i` to restyle a button rather than proposing a diff.
 */
const EDITING_PROGRAMS = new Set([
  "sed",
  "tee",
  "truncate",
  "dd",
  "patch",
  "install",
  "rm",
  "mv",
  "cp",
  "touch",
  "chmod",
  "mkdir",
]);

function looksLikeAnEdit(request: CommandRequest): boolean {
  const program = normalizeProgram(request.program);
  if (EDITING_PROGRAMS.has(program)) return true;
  // In-place flags are the giveaway for editors that also read.
  return request.args.some((arg) => arg === "-i" || arg.startsWith("--in-place"));
}

export function formatCommand(request: CommandRequest): string {
  return [request.program, ...request.args].join(" ");
}
