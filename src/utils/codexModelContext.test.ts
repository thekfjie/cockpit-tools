import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEffectiveModelContexts, validateModelContext } from './codexModelContext';

test('model context follows metadata unless both overrides are explicitly configured', () => {
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
