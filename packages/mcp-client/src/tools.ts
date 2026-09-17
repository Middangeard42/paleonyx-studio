import type { McpToolInfo, ToolParameterSchema } from "@paleonyx/shared-types";
import { isRecord } from "./json-rpc.js";

/**
 * Tool names MCP recommends. Anything else is refused rather than
 * rewritten: the name has to survive into a model's function-calling
 * format, and silently renaming a tool makes its calls hard to trace.
 */
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * A server's description goes into the model's prompt word for word, so
 * it is capped. A long one crowds out the project, and "description" is
 * where a hostile server would put instructions.
 */
export const MAX_DESCRIPTION_CHARS = 1024;

/** A schema this large is almost certainly not meant for a model to read. */
export const MAX_SCHEMA_CHARS = 16_000;

/** What the model is shown of a result. The rest is cut, with a note. */
export const MAX_RESULT_CHARS = 32_000;

export type ToolParseResult =
  | { ok: true; tool: McpToolInfo }
  | { ok: false; name?: string; error: string };

export function parseTool(value: unknown): ToolParseResult {
  if (!isRecord(value)) return { ok: false, error: "A tool entry is not an object." };

  const { name } = value;
  if (typeof name !== "string") return { ok: false, error: "A tool has no name." };
  if (!TOOL_NAME.test(name)) {
    return {
      ok: false,
      name,
      error: `The tool "${name.slice(0, 64)}" has a name with characters other than letters, digits, "_", "-" and ".".`,
    };
  }

  const description = typeof value.description === "string" ? value.description : "";
  const title = typeof value.title === "string" ? value.title : undefined;

  const schema = parseInputSchema(value.inputSchema);
  if (typeof schema === "string") return { ok: false, name, error: `The tool "${name}" ${schema}` };

  return {
    ok: true,
    tool: {
      name,
      ...(title ? { title } : {}),
      description:
        description.length > MAX_DESCRIPTION_CHARS
          ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…`
          : description,
      inputSchema: schema,
    },
  };
}

/** Returns the schema, or why it cannot be used. */
function parseInputSchema(value: unknown): ToolParameterSchema | string {
  if (!isRecord(value)) return "has no input schema.";
  if (value.type !== "object") return "takes input that is not an object.";

  const size = JSON.stringify(value).length;
  if (size > MAX_SCHEMA_CHARS) return "describes its input at a length no model could use.";

  // A reference to anything but this same document could be fetched by
  // something downstream; MCP forbids following them automatically, and
  // refusing the tool is simpler than proving nothing will.
  const remote = findRemoteRef(value, 0);
  if (remote) return `refers to a schema outside itself (${remote.slice(0, 80)}).`;

  const properties = value.properties ?? {};
  if (!isRecord(properties)) return "has an input schema whose properties are not an object.";

  const required = value.required;
  if (
    required !== undefined &&
    !(Array.isArray(required) && required.every((entry) => typeof entry === "string"))
  ) {
    return "has an input schema whose required list is not a list of names.";
  }

  const schema: ToolParameterSchema = { type: "object", properties };
  if (required) schema.required = required as string[];
  if (isRecord(value.$defs)) schema.$defs = value.$defs;
  if (typeof value.additionalProperties === "boolean" || isRecord(value.additionalProperties)) {
    schema.additionalProperties = value.additionalProperties;
  }
  return schema;
}

/** Depth-limited, since the schema came from another program. */
function findRemoteRef(value: unknown, depth: number): string | undefined {
  if (depth > 32) return "(nested too deeply to check)";
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRemoteRef(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "$ref" || key === "$dynamicRef") && typeof entry === "string" && !entry.startsWith("#")) {
      return entry;
    }
    const found = findRemoteRef(entry, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export interface ToolCallOutcome {
  /** What the model is given. */
  text: string;
  /** The tool ran and reported failure — information the model can act on. */
  isError: boolean;
}

/**
 * Turns a `tools/call` result into text for the model.
 *
 * Returns undefined when the result is not one this client can read,
 * which the caller treats as a protocol failure rather than as output.
 */
export function describeToolResult(result: Record<string, unknown>): ToolCallOutcome | undefined {
  const resultType = result.resultType ?? "complete";

  if (resultType === "input_required") {
    // MCP 2026-07-28 lets a tool pause and ask the user something. There
    // is no way to answer yet, so the model is told plainly instead of
    // being left to guess why nothing came back.
    return {
      text: "This tool asked for more information from the user before it could finish, which Paleonyx Studio cannot provide yet. Continue without it.",
      isError: true,
    };
  }
  // MCP: an unrecognised result type must be treated as invalid.
  if (resultType !== "complete") return undefined;

  const content = result.content ?? [];
  if (!Array.isArray(content)) return undefined;

  const parts = content.map(describeContent);
  if (!parts.some((part) => part.isText) && result.structuredContent !== undefined) {
    parts.push({ text: JSON.stringify(result.structuredContent), isText: true });
  }

  let text = parts.map((part) => part.text).join("\n\n");
  if (text.trim().length === 0) text = "The tool returned nothing.";
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n\n(The result was cut short; ${
      text.length - MAX_RESULT_CHARS
    } more characters were not shown.)`;
  }

  return { text, isError: result.isError === true };
}

function describeContent(item: unknown): { text: string; isText: boolean } {
  if (!isRecord(item)) return { text: "[An unreadable part of the result was left out.]", isText: false };

  switch (item.type) {
    case "text":
      return typeof item.text === "string"
        ? { text: item.text, isText: true }
        : { text: "[A text part with no text was left out.]", isText: false };
    case "image":
    case "audio":
      return {
        text: `[The tool returned ${item.type === "image" ? "an image" : "audio"}${
          typeof item.mimeType === "string" ? ` (${item.mimeType})` : ""
        }, which is not passed to the model.]`,
        isText: false,
      };
    case "resource_link":
      return {
        text: `Link: ${typeof item.name === "string" ? `${item.name} ` : ""}${
          typeof item.uri === "string" ? item.uri : "(no address)"
        }`,
        isText: true,
      };
    case "resource": {
      const resource = isRecord(item.resource) ? item.resource : {};
      const uri = typeof resource.uri === "string" ? resource.uri : "(no address)";
      return typeof resource.text === "string"
        ? { text: `${uri}:\n${resource.text}`, isText: true }
        : { text: `[The binary content of ${uri} is not passed to the model.]`, isText: false };
    }
    default:
      return {
        text: `[A part of type "${String(item.type).slice(0, 40)}" was left out.]`,
        isText: false,
      };
  }
}

/**
 * The name a tool is offered to the model under.
 *
 * `mcp__<server>__<tool>` is the convention other MCP clients use, so a
 * model may already recognise it, and it cannot collide with the
 * built-in tools. Dots are not allowed in OpenAI-style function names,
 * and those are capped at 64 characters; either change can make two
 * names equal, which the caller checks for.
 */
export function modelToolName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName.replace(/\./g, "_")}`.slice(0, 64);
}
