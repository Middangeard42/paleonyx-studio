import type {
  McpProblem,
  McpServerApproval,
  McpToolInfo,
  ToolDefinition,
} from "@paleonyx/shared-types";
import { isToolEnabled } from "./approval.js";
import type { McpClient } from "./client.js";
import { modelToolName } from "./tools.js";
import type { ToolCallOutcome } from "./tools.js";

export interface RunningServer {
  serverId: string;
  client: Pick<McpClient, "callTool">;
  tools: readonly McpToolInfo[];
  approval: McpServerApproval;
}

/**
 * A tool ready to hand to the agent. The same shape as agent-core's
 * `ConnectedTool`, which this package does not import: the agent layer
 * should not depend on how a tool is reached.
 */
export interface OfferedTool {
  definition: ToolDefinition;
  source: string;
  toolName: string;
  call(args: Record<string, unknown>): Promise<ToolCallOutcome>;
}

export interface OfferedTools {
  tools: OfferedTool[];
  problems: McpProblem[];
}

/**
 * The tools the agent may be offered: enabled ones, from running,
 * approved servers, under names the model can call.
 *
 * Two tools can end up with one model-facing name — through the
 * dot-to-underscore swap, or the length cap. Rather than let one silently
 * receive the other's calls, the later one is left out and reported.
 */
export function offeredTools(
  servers: readonly RunningServer[],
  timeoutMs?: number
): OfferedTools {
  const tools: OfferedTool[] = [];
  const problems: McpProblem[] = [];
  const taken = new Map<string, string>();

  for (const { serverId, client, tools: listed, approval } of servers) {
    for (const tool of listed) {
      if (!isToolEnabled(approval, tool.name)) continue;
      const name = modelToolName(serverId, tool.name);
      const holder = taken.get(name);
      if (holder) {
        problems.push({
          serverId,
          message: `"${tool.name}" would reach the agent under the same name as ${holder}, so it was left out.`,
        });
        continue;
      }
      taken.set(name, `"${tool.name}" from ${serverId}`);
      tools.push({
        definition: {
          name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
        source: serverId,
        toolName: tool.name,
        call: (args) => client.callTool(tool.name, args, timeoutMs),
      });
    }
  }

  return { tools, problems };
}
