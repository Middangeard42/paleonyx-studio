import type { FileSystemReader } from "@paleonyx/shared-types";

/**
 * Files a project uses to state its own conventions.
 *
 * Ordered by how specific each is to instructing an assistant. AGENTS.md
 * and CLAUDE.md exist for exactly this; a README is about the project
 * for humans, which is still useful context but weaker guidance, so it
 * is included last and only when nothing better is present.
 */
const CONVENTIONAL_NAMES: readonly string[] = [
  ".paleonyx/context.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONVENTIONS.md",
  "CONTRIBUTING.md",
  "README.md",
];

/**
 * Total budget across all context documents.
 *
 * A real repository's CLAUDE.md can run to tens of kilobytes — this
 * project's does — and pasting all of it in front of every request would
 * crowd out the code the user actually asked about. Each document is
 * truncated to fit rather than dropped, because the opening of a
 * conventions file is where the conventions usually are.
 */
const TOTAL_BUDGET_BYTES = 12_000;
const PER_DOC_BUDGET_BYTES = 6_000;

export interface ContextDocument {
  path: string;
  content: string;
  /** True when the file was longer than its share of the budget. */
  truncated: boolean;
}

/**
 * Finds the documents a project uses to describe itself.
 *
 * Matching is case-insensitive on the basename, since `Agents.md` and
 * `agents.md` are the same intent, and only at the project root —
 * a CLAUDE.md three directories down governs that subtree, not the
 * project, and treating it as global guidance would be wrong.
 */
export async function findContextDocuments(
  fs: FileSystemReader
): Promise<ContextDocument[]> {
  const files = await fs.listFiles();
  const byLowerPath = new Map(files.map((file) => [file.path.toLowerCase(), file.path]));

  const found: ContextDocument[] = [];
  let remaining = TOTAL_BUDGET_BYTES;

  for (const name of CONVENTIONAL_NAMES) {
    if (remaining <= 0) break;
    const actualPath = byLowerPath.get(name.toLowerCase());
    if (!actualPath) continue;

    let content: string;
    try {
      content = await fs.readFile(actualPath);
    } catch {
      // A listed file that will not read is not worth failing a task
      // over; the rest of the context is still useful.
      continue;
    }

    const allowance = Math.min(PER_DOC_BUDGET_BYTES, remaining);
    const truncated = content.length > allowance;
    const kept = truncated ? `${content.slice(0, allowance)}\n…(truncated)` : content;

    found.push({ path: actualPath, content: kept, truncated });
    remaining -= kept.length;
  }

  return found;
}
