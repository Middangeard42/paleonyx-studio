import type { FileSystemReader, ToolCall, ToolDefinition } from "@paleonyx/shared-types";

export const READ_FILE_TOOL_NAME = "readFile";

/**
 * The one tool v0's agent loop uses. Per CLAUDE.md §2/§6, this is the
 * auditable surface the agent reads through — run-task.ts never calls
 * `fs.readFile` (or the FileSystemReader) directly outside of this
 * function, so every file the agent sees is a logged, named tool call.
 */
export const readFileToolDefinition: ToolDefinition = {
  name: READ_FILE_TOOL_NAME,
  description: "Read the contents of a single project file by its path.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project-relative file path.",
      },
    },
    required: ["path"],
  },
};

export async function executeReadFile(
  fs: FileSystemReader,
  call: ToolCall
): Promise<string> {
  const path = call.arguments.path;
  if (typeof path !== "string") {
    throw new Error("readFile tool call is missing a string 'path' argument");
  }
  return fs.readFile(path);
}
