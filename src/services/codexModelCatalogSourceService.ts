import { invoke } from "@tauri-apps/api/core";
import type { CodexExperimentalModelDefinition } from "../types/codex";

export type CodexModelCatalogSource = "codex" | "upstream" | "cockpit";

export type CodexModelCatalogSourceInfo = {
  source: CodexModelCatalogSource;
  fetchedAt: number;
  manuallyAdjusted?: boolean;
  cacheInfo?: string;
};

export function normalizeCodexModelCatalogSourceInfo(value: unknown): CodexModelCatalogSourceInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = (value as { source?: unknown }).source;
  const fetchedAt = (value as { fetchedAt?: unknown }).fetchedAt;
  if (source !== "codex" && source !== "upstream" && source !== "cockpit") return undefined;
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return undefined;
  return {
    source,
    fetchedAt,
    manuallyAdjusted: (value as { manuallyAdjusted?: unknown }).manuallyAdjusted === true,
    cacheInfo: typeof (value as { cacheInfo?: unknown }).cacheInfo === "string"
      ? (value as { cacheInfo: string }).cacheInfo
      : undefined,
  };
}

export type CodexModelCatalogSourceResult = {
  source: CodexModelCatalogSource;
  models: CodexExperimentalModelDefinition[];
};

/** Fetch the official Codex catalog through the bound OAuth app-server profile. */
export async function listCodexModelCatalogSourceModels(input: {
  source: "codex" | "cockpit";
  accountId?: string | null;
  instanceId?: string | null;
}): Promise<CodexExperimentalModelDefinition[]> {
  return await invoke<CodexExperimentalModelDefinition[]>(
    "codex_list_model_catalog_source_models",
    {
      source: input.source,
      accountId: input.accountId ?? null,
      instanceId: input.instanceId ?? null,
    },
  );
}
