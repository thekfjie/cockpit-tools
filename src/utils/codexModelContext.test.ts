import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEffectiveModelContexts, validateModelContext } from './codexModelContext';

test('model context accepts complete and empty overrides', () => {
  assert.equal(validateModelContext({}), null);
  assert.equal(validateModelContext({ context_window: 516000, auto_compact_token_limit: 460000 }), null);
  assert.equal(validateModelContext({ context_window: 1000000, auto_compact_token_limit: 900000 }), null);
  assert.equal(validateModelContext({ context_window: 32768, auto_compact_token_limit: 30000 }), null);
});

test('model context accepts independent overrides and rejects invalid values', () => {
  assert.equal(validateModelContext({ context_window: 100 }), null);
  assert.equal(validateModelContext({ auto_compact_token_limit: 50 }), null);
  for (const model of [
    { context_window: 0, auto_compact_token_limit: 1 },
    { context_window: 1.5, auto_compact_token_limit: 1 },
    { context_window: Infinity, auto_compact_token_limit: 1 },
    { context_window: Number.MAX_SAFE_INTEGER + 1, auto_compact_token_limit: 1 },
    { context_window: 100, auto_compact_token_limit: NaN },
    { context_window: 100, auto_compact_token_limit: -1 },
    { context_window: 100, auto_compact_token_limit: 100 },
    { context_window: 100, auto_compact_token_limit: 101 },
  ]) assert.ok(validateModelContext(model), JSON.stringify(model));
});

test('effective context applies global values to models without overrides', () => {
  const models = [{ model_id: 'gpt-6-sol', display_name: 'GPT-6 Sol' }];
  assert.equal(validateEffectiveModelContexts(models, 2_760_000, 2_750_000), null);
  assert.match(
    validateEffectiveModelContexts([{ ...models[0], context_window: 1_050_000 }], 2_760_000, 2_750_000) ?? '',
    /gpt-6-sol.*2750000.*1050000/,
  );
});

test('source metadata is used after per-model and instance values', () => {
  const model = { model_id: 'model-x', display_name: 'Model X' };
  const metadata = { 'model-x': { contextWindow: 1_050_000, autoCompactTokenLimit: 900_000 } };
  assert.equal(validateEffectiveModelContexts([model], undefined, undefined, metadata), null);
  assert.equal(validateEffectiveModelContexts([model], 2_760_000, 2_750_000, metadata), null);
  assert.match(
    validateEffectiveModelContexts([{ ...model, context_window: 1_050_000 }],
      2_760_000, 2_750_000, metadata) ?? '', /model-x.*2750000.*1050000/,
  );
});
