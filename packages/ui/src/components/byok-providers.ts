import type { ByokProviderDescriptor } from "@paleonyx/shared-types";

/**
 * The BYOK providers v1 offers, as user-facing copy.
 *
 * Lives in `ui` rather than `runtime` on purpose (CLAUDE.md §4.2): these
 * are labels, links, and explanations. If a provider rewrites its
 * signup flow or renames a plan, that is a copy change — the adapter
 * should not have to move.
 *
 * Ids must match the allowlist in the desktop shell's credential
 * commands; anything else is refused there rather than silently writing
 * to an unexpected credential-store entry.
 */
export const BYOK_PROVIDERS: readonly ByokProviderDescriptor[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModelId: "anthropic/claude-3.5-sonnet",
    keyUrl: "https://openrouter.ai/keys",
    description:
      "One key for models from many providers. Useful for trying several without separate accounts.",
    freeTierNote: "Some models are free to use; others are pay-as-you-go.",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModelId: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
    description: "Fast inference for a smaller set of open models.",
    freeTierNote: "Has a free tier with rate limits.",
  },
];
