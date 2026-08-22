/**
 * Capability differences between providers are declared metadata
 * (CLAUDE.md §4), never discovered by trial and error at runtime.
 */
export interface ModelCapabilities {
  contextWindow: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  /** False only for providers the user has explicitly configured as remote. */
  isLocal: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Adapter id, e.g. "ollama", "ornith", "mock". */
  provider: string;
  capabilities: ModelCapabilities;
}
