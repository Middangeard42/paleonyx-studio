import type { ChatCompletionRequest } from "@paleonyx/shared-types";

/**
 * Canned responses matching agent-core's RESPONSE_CONTRACT, keyed off
 * the task-type marker text that packages/agent-core/src/prompt.ts's
 * buildSystemPrompt always includes. Only used when a local Ollama
 * instance isn't reachable (see App.tsx) — this is a stand-in for a real
 * model, not something a user would ever see labeled as one.
 */
const BUG_FIX_RESPONSE = `Here is my analysis.

\`\`\`json
{
  "summary": "Fix the off-by-one loop bound in sum() that reads past the end of the array.",
  "steps": [
    { "id": "1", "description": "Read src/sum.ts", "targetFiles": ["src/sum.ts"] },
    { "id": "2", "description": "Change the loop condition from <= to < so it stays in bounds", "targetFiles": ["src/sum.ts"] }
  ],
  "explanation": "The loop condition \\"i <= numbers.length\\" lets i reach an index equal to the array's length, which is one past the last valid index. Reading numbers[numbers.length] returns undefined, and undefined + total becomes NaN. Changing the condition to \\"i < numbers.length\\" keeps every access in bounds.",
  "diff": [
    {
      "filePath": "src/sum.ts",
      "hunks": [
        {
          "header": "@@ -1,6 +1,6 @@",
          "lines": [
            { "type": "context", "content": "export function sum(numbers: number[]): number {" },
            { "type": "context", "content": "  let total = 0;" },
            { "type": "remove", "content": "  for (let i = 0; i <= numbers.length; i++) {" },
            { "type": "add", "content": "  for (let i = 0; i < numbers.length; i++) {" },
            { "type": "context", "content": "    total += numbers[i];" },
            { "type": "context", "content": "  }" }
          ]
        }
      ]
    }
  ],
  "confidence": "high"
}
\`\`\``;

const EXPLAIN_RESPONSE = `\`\`\`json
{
  "summary": "Explain what the selected file does.",
  "steps": [
    { "id": "1", "description": "Read the target file and summarize its behavior." }
  ],
  "explanation": "This file exports a small, self-contained utility function. It takes its input, processes it with a straightforward loop, and returns the result — there's no external state, no side effects, and nothing asynchronous going on.",
  "diff": [],
  "confidence": "medium"
}
\`\`\``;

export function mockRespond(request: ChatCompletionRequest): string {
  const systemMessage = request.messages.find((message) => message.role === "system")?.content ?? "";
  return systemMessage.includes("Task type: Bug Fix") ? BUG_FIX_RESPONSE : EXPLAIN_RESPONSE;
}
