import type { FileSystemReader, ToolDefinition } from "@paleonyx/shared-types";

export const LIST_FILES_TOOL_NAME = "listFiles";

/**
 * Lets the agent see what the project contains.
 *
 * Without this it can only read paths it already knows, so any question
 * about what exists — is there a test suite, where do the tests live,
 * what is this project built with — can only be answered by guessing
 * filenames. Observed behaviour was exactly that: guess one plausible
 * path, then give up when it was not there.
 */
export const listFilesToolDefinition: ToolDefinition = {
  name: LIST_FILES_TOOL_NAME,
  description:
    "List the files in this project. Use it to find out what exists before reading or guessing at paths — for example to check whether the project has tests, or what it is built with.",
  parameters: {
    type: "object",
    properties: {},
  },
};

/**
 * Files beyond this are summarised rather than listed in full. A large
 * repository would otherwise spend the whole context window on paths and
 * leave no room for the code they point at.
 */
const MAX_LISTED = 300;

export async function executeListFiles(fs: FileSystemReader): Promise<string> {
  const files = await fs.listFiles();
  if (files.length === 0) return "The project contains no readable files.";

  const paths = files.map((file) => file.path).sort();
  if (paths.length <= MAX_LISTED) {
    return `${paths.length} files:\n${paths.join("\n")}`;
  }
  return [
    `${paths.length} files. Showing the first ${MAX_LISTED}:`,
    paths.slice(0, MAX_LISTED).join("\n"),
    `(${paths.length - MAX_LISTED} more not shown.)`,
  ].join("\n");
}
