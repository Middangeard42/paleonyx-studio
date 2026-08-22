import type { FileSystemReader, ProjectFile } from "@paleonyx/shared-types";
import { inferLanguage } from "./language.js";

/**
 * v0's entire "index": list the project's files, tag each with a
 * best-guess language, sort for stable file-tree rendering. File
 * watching, AST parsing, and embeddings (CLAUDE.md §2) are v1+ growth
 * points on this same module, not present yet.
 */
export async function listProjectFiles(
  fs: FileSystemReader
): Promise<ProjectFile[]> {
  const files = await fs.listFiles();
  return files
    .map((file) => ({
      path: file.path,
      language: file.language ?? inferLanguage(file.path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
