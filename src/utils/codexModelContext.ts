import type { CodexExperimentalModelDefinition } from '../types/codex';
import type { CodexModelSourceMetadata } from '../services/codexModelCatalogSourceService';

type ContextValueSource = 'model' | 'global' | 'source' | 'builtin';

export function resolveEffectiveModelContext(
  model: CodexExperimentalModelDefinition,
  globalContextWindow?: number,
  globalAutoCompactTokenLimit?: number,
  sourceMetadata?: CodexModelSourceMetadata,
) {
  const contextWindow = model.context_window ?? globalContextWindow ?? sourceMetadata?.contextWindow;
  const autoCompactTokenLimit = model.auto_compact_token_limit ?? globalAutoCompactTokenLimit ?? sourceMetadata?.autoCompactTokenLimit;
  const contextSource: ContextValueSource = model.context_window !== undefined ? 'model'
    : globalContextWindow !== undefined ? 'global' : sourceMetadata?.contextWindow !== undefined ? 'source' : 'builtin';
  const compactSource: ContextValueSource = model.auto_compact_token_limit !== undefined ? 'model'
    : globalAutoCompactTokenLimit !== undefined ? 'global' : sourceMetadata?.autoCompactTokenLimit !== undefined ? 'source' : 'builtin';
  return { contextWindow, autoCompactTokenLimit, contextSource, compactSource };
}

export function validateModelContext(model: Pick<CodexExperimentalModelDefinition,
  'context_window' | 'auto_compact_token_limit'>): string | null {
  const context = model.context_window;
  const compact = model.auto_compact_token_limit;
  const prefix = 'codex.experimentalModelCatalog.models.validation.';
  if (context === undefined && compact === undefined) return null;
  if (context !== undefined && (!Number.isSafeInteger(context) || context <= 0)) return prefix + 'contextWindow';
  if (compact !== undefined && (!Number.isSafeInteger(compact) || compact <= 0)) return prefix + 'autoCompact';
  if (context !== undefined && compact !== undefined && compact >= context) return prefix + 'autoCompactRange';
  return null;
}

export function validateEffectiveModelContexts(
  models: CodexExperimentalModelDefinition[],
  globalContextWindow?: number,
  globalAutoCompactTokenLimit?: number,
  sourceMetadata?: Record<string, CodexModelSourceMetadata>,
): string | null {
  for (const model of models) {
    const { contextWindow: window, autoCompactTokenLimit: limit } = resolveEffectiveModelContext(
      model, globalContextWindow, globalAutoCompactTokenLimit, sourceMetadata?.[model.model_id],
    );
    if (window !== undefined && limit !== undefined && limit >= window) {
      return `模型 ${model.model_id} 的自动压缩阈值 ${limit} 必须小于上下文窗口 ${window}`;
    }
  }
  return null;
}
