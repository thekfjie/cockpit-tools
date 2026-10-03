const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

async function inspectCatalog(executable, filename) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-catalog-contract-'));
  const source = JSON.parse(await fs.readFile(filename, 'utf8'));
  const active = source.models.filter(model => model.visibility !== 'hide');
  assert.ok(active.length > 0, 'fixture must have current Key models');
  const catalogPath = path.join(home, 'cockpit-model-catalog.json');
  await fs.writeFile(catalogPath, JSON.stringify(source));
  await fs.writeFile(path.join(home, 'config.toml'), [
    `model = ${JSON.stringify(active[0].slug)}`,
    'model_provider = "catalog_contract"',
    `model_catalog_json = ${JSON.stringify(catalogPath.replaceAll('\\', '/'))}`,
    '[model_providers.catalog_contract]',
    'name = "Catalog Contract"',
    'base_url = "http://127.0.0.1:9/v1"',
    'wire_api = "responses"',
    'env_key = "COCKPIT_CONTRACT_API_KEY"',
    'requires_openai_auth = false',
    '',
  ].join('\n'));
  const child = spawn(executable, ['app-server'], {
    cwd: home,
    env: { ...process.env, CODEX_HOME: home, COCKPIT_CONTRACT_API_KEY: 'contract-test-key' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const fail = error => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`Codex app-server exited ${code}: ${stderr}`)));
  let id = 0;
  const request = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${method} timed out: ${stderr}`));
    }, 30_000);
    pending.set(requestId, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
  const list = async includeHidden => {
    let cursor = null;
    const models = [];
    do {
      const result = await request('model/list', { cursor, includeHidden, limit: 100 });
      assert.ok(Array.isArray(result.data));
      models.push(...result.data);
      cursor = result.nextCursor ?? null;
    } while (cursor !== null);
    return models;
  };
  try {
    await request('initialize', { clientInfo: { name: 'cockpit_catalog_contract', version: '1' }, capabilities: null });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const visible = await list(false);
    const all = await list(true);
    assert.deepEqual(visible.map(model => model.model).sort(), active.map(model => model.slug).sort(), 'picker must contain only this Key models');
    for (const model of source.models) {
      const actual = all.find(item => item.model === model.slug);
      assert.ok(actual, `model/list must retain ${model.slug}`);
      assert.equal(actual.displayName, model.display_name, `display name for ${model.slug}`);
      assert.equal(actual.hidden, model.visibility === 'hide', `visibility for ${model.slug}`);
      // Desktop includes the selected model in additionalAvailableModels; it can
      // resolve a hidden historical ID without listing every old Key model.
      const selectedModels = all.filter(item => !item.hidden || item.model === model.slug);
      assert.equal(selectedModels.find(item => item.model === model.slug)?.displayName, model.display_name);
    }
    console.log(`PASS ${path.basename(filename)}: ${visible.length} current models, ${all.length} resolvable identities`);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function main() {
  const [executable, fixtureDir] = process.argv.slice(2);
  assert.ok(executable && fixtureDir, 'usage: check-codex-model-catalog.cjs executable fixture-dir');
  for (const filename of ['key-third.json', 'key-oai.json', 'key-third-restored.json']) {
    await inspectCatalog(executable, path.join(fixtureDir, filename));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
