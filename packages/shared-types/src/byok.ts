/**
 * A remote provider the user can connect with their own API key
 * (CLAUDE.md §4.2).
 *
 * v1 ships aggregators rather than one adapter per lab: a single key
 * reaches many models, including free-tier ones, without maintenance
 * scaling with the number of labs (PRD.md §9 decision 6).
 */
export interface ByokProviderDescriptor {
  /** Matches the allowlist in the desktop shell's credential commands. */
  id: string;
  label: string;
  /** API root, OpenAI-compatible. */
  baseUrl: string;
  /** A sensible starting model, changeable later. */
  defaultModelId: string;
  /** Where the user creates a key. Opened in their browser, not in-app. */
  keyUrl: string;
  /** One line on what this provider is for. */
  description: string;
  /** Stated only where a provider genuinely offers one. */
  freeTierNote?: string;
}

/** Whether a key is currently stored for a provider. Never the key itself. */
export interface ByokKeyStatus {
  providerId: string;
  hasKey: boolean;
}
