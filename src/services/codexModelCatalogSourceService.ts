import { invoke } from "@tauri-apps/api/core";
import type { CodexExperimentalModelDefinition } from "../types/codex";

export type CodexModelCatalogSource = "codex" | "upstream" | "cockpit";

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
