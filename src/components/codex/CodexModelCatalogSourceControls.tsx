import { RefreshCw } from "lucide-react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listCodexModelCatalogSourceModels,
  type CodexModelCatalogSource,
} from "../../services/codexModelCatalogSourceService";
import type { CodexExperimentalModelDefinition } from "../../types/codex";

type Props = {
  accountId?: string | null;
  instanceId?: string | null;
  onReplace: (models: CodexExperimentalModelDefinition[], source: CodexModelCatalogSource) => void;
  onFetchUpstream?: () => Promise<CodexExperimentalModelDefinition[]>;
  hasExistingModels: boolean;
  disabled?: boolean;
};

export function CodexModelCatalogSourceControls({
  accountId,
  instanceId,
  onReplace,
  onFetchUpstream,
  hasExistingModels,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<CodexModelCatalogSource | null>(null);
  const [source, setSource] = useState<CodexModelCatalogSource | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const replaceFrom = async (nextSource: CodexModelCatalogSource) => {
    if (busy || disabled) return;
    if (hasExistingModels) {
      const confirmed = await confirmDialog(
        t(
          "codex.modelManagement.sourceReplaceConfirm",
          "刷新将覆盖当前模型列表，以及逐模型上下文和压缩阈值。是否继续？",
        ),
        {
          title: t("codex.modelManagement.sourceReplaceTitle", "覆盖模型配置？"),
          okLabel: t("common.confirm", "继续"),
          cancelLabel: t("common.cancel", "取消"),
          kind: "warning",
        },
      );
      if (!confirmed) return;
    }
    setBusy(nextSource);
    setError(null);
    try {
      const models = nextSource === "upstream"
        ? await onFetchUpstream?.()
        : await listCodexModelCatalogSourceModels({
            source: nextSource,
            accountId,
            instanceId,
          });
      if (!models?.length) {
        throw new Error(
          t("codex.modelManagement.sourceEmpty", "来源没有返回可用模型，已保留当前列表。"),
        );
      }
      onReplace(models, nextSource);
      setSource(nextSource);
      setUpdatedAt(Date.now());
    } catch (fetchError) {
      setError(String(fetchError).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  };

  const sourceLabel = source === "codex"
    ? t("codex.modelManagement.sourceCodex", "Codex 端 model/list")
    : source === "upstream"
      ? t("codex.modelManagement.sourceUpstream", "上游 /v1/models")
      : source === "cockpit"
        ? t("codex.modelManagement.sourceCockpit", "Cockpit 预设")
        : t("codex.modelManagement.sourceUnknown", "来源未知");

  return (
    <div className="codex-model-catalog-source-controls">
      <div className="codex-model-catalog-source-controls__buttons">
        {(["codex", "upstream", "cockpit"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void replaceFrom(item)}
            disabled={disabled || busy !== null || (item === "upstream" && !onFetchUpstream)}
          >
            <RefreshCw size={14} className={busy === item ? "loading-spinner" : undefined} />
            {item === "codex"
              ? t("codex.modelManagement.sourceCodexAction", "从 Codex 端刷新获取")
              : item === "upstream"
                ? t("codex.modelManagement.sourceUpstreamAction", "从上游获取")
                : t("codex.modelManagement.sourceCockpitAction", "使用 Cockpit 预设模型")}
          </button>
        ))}
      </div>
      <small className="codex-model-catalog-source-controls__status">
        {t("codex.modelManagement.sourceStatus", "当前来源：{{source}}", { source: sourceLabel })}
        {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ""}
      </small>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
