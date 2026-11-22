/**
 * Host-half wiring tests with a fake Cordis context: no DSH, no HTTP server, no
 * restart. What this proves is that `apply()` registers one preset per readable
 * tenant, skips a broken one *visibly*, and that the diagnostics route tells the
 * truth about each of them.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { apply } from '../index.js';

function writeTenant(root, id, raw, extra = {}) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tenant.json'), typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
  for (const [name, content] of Object.entries(extra)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function fakeHost() {
  const routes = new Map();
  const registered = [];
  const disposers = [];
  const logs = { warn: [], info: [] };

  const host = {
    logger: {
      info: (line) => logs.info.push(line),
      warn: (line) => logs.warn.push(line),
    },
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
    agentPresets: {
      register(definition) {
        if (registered.some((row) => row.id === definition.id)) {
          throw new Error(`Duplicate agent preset: ${definition.id}`);
        }
        registered.push(definition);
        return () => {
          const index = registered.findIndex((row) => row.id === definition.id);
          if (index >= 0) registered.splice(index, 1);
        };
      },
      list: () => registered.map((row) => ({ id: row.id, name: row.name, order: row.order })),
    },
  };

  const ctx = {
    logger: host.logger,
    inject(_names, callback) {
      callback(host);
      return { dispose() {} };
    },
    effect: host.effect,
    on() {},
  };

  const call = (path, method = 'GET') => {
    const handler = routes.get(path);
    assert.ok(handler, `route ${path} is not registered`);
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(key, value) {
        this.headers[key] = value;
      },
      end(body) {
        this.body = String(body ?? '');
      },
    };
    handler({ method }, res);
    return res;
  };

  return { ctx, host, routes, registered, disposers, logs, call };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tenant-host-'));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Routes that read files answer asynchronously; wait for `end()` instead of guessing a tick. */
async function waitForRes(res, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (res.statusCode === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return res;
}

const TENANTS = '/dsh-tenant-switcher/tenants';
const ROSTER = '/dsh-tenant-switcher/presets';
const TEMPLATE = '/dsh-tenant-switcher/tenant-template';

test('registers one preset per readable tenant and reports a broken one as an error', () => {
  const { root, done } = fixture();
  try {
    const dirA = writeTenant(root, 'alpha', { name: '阿尔法', order: 40 });
    writeTenant(root, 'beta', { name: '贝塔', order: 41 });
    writeTenant(root, 'broken', '{ not json');

    const fake = fakeHost();
    apply(fake.ctx, { tenantsDir: root });

    assert.deepEqual(fake.registered.map((row) => row.id), ['tenant-alpha', 'tenant-beta']);
    const alpha = fake.registered[0];
    assert.equal(alpha.name, '阿尔法');
    assert.equal(alpha.order, 40);
    assert.deepEqual(alpha.plugins, [
      {
        name: '@local/dsh-tenant-switcher',
        config: {
          tenant: 'alpha',
          tenantDir: dirA,
          persona: join(dirA, 'persona.md'),
          memoryDir: join(dirA, 'memory'),
        },
      },
    ]);

    const res = fake.call(TENANTS);
    assert.equal(res.statusCode, 200);
    const report = JSON.parse(res.body);
    assert.equal(report.dir, root);
    assert.equal(report.exists, true);
    assert.deepEqual(report.registered.sort(), ['alpha', 'beta']);

    const byId = new Map(report.tenants.map((row) => [row.id, row]));
    assert.equal(byId.get('alpha').status, 'registered');
    assert.equal(byId.get('alpha').presetId, 'tenant-alpha');
    assert.equal(byId.get('broken').status, 'error');
    assert.match(byId.get('broken').reason, /JSON/);
    assert.equal(report.errors.length, 1);
  } finally {
    done();
  }
});

test('a tenant preset whose plugin actually mounted shows up as live', () => {
  const { root, done } = fixture();
  try {
    const dir = writeTenant(root, 'live-one', { name: '活着' }, {
      'persona.md': '我是活着的那一个。',
      'memory/SOUL.md': 'SOUL 正文',
      'memory/index.md': '# index',
    });

    const fake = fakeHost();
    apply(fake.ctx, { tenantsDir: root });

    // Mount the tenant half the way the preset scope does.
    const sections = [];
    const contexts = [];
    const tenantCtx = {
      logger: fake.host.logger,
      effect(callback) {
        return callback();
      },
      inject(_names, callback) {
        callback({
          systemPrompt: {
            section: (row) => sections.push(row),
            context: (row) => contexts.push(row),
          },
        });
      },
    };
    apply(tenantCtx, { tenant: 'live-one', tenantDir: dir });

    assert.equal(sections.length, 1);
    assert.equal(sections[0].name, 'tenant:live-one:persona');
    assert.equal(sections[0].text, '我是活着的那一个。');
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].name, 'tenant:live-one:memory');
    assert.match(contexts[0].text, /SOUL 正文/);
    assert.match(contexts[0].text, /# index/);

    const report = JSON.parse(fake.call(TENANTS).body);
    const row = report.tenants.find((entry) => entry.id === 'live-one');
    assert.equal(row.status, 'live');
    assert.deepEqual(row.files, { persona: true, soul: true, index: true });
  } finally {
    done();
  }
});

test('missing tenant directory is reported instead of crashing the plugin', () => {
  const fake = fakeHost();
  const dir = join(tmpdir(), 'dsh-tenant-host-missing-000');
  apply(fake.ctx, { tenantsDir: dir });

  assert.equal(fake.registered.length, 0);
  const report = JSON.parse(fake.call(TENANTS).body);
  assert.equal(report.exists, false);
  assert.deepEqual(report.tenants, []);
  assert.match(report.dirError, /不存在或读不了/);
});

test('routes are read-only and the roster route forwards host rows', async () => {
  const { root, done } = fixture();
  try {
    writeTenant(root, 'one', { name: '一' });
    const fake = fakeHost();
    apply(fake.ctx, { tenantsDir: root });

    const post = fake.call(TENANTS, 'POST');
    assert.equal(post.statusCode, 405);

    const roster = fake.call(ROSTER);
    await waitForRes(roster);
    assert.equal(roster.statusCode, 200);
    const payload = JSON.parse(roster.body);
    assert.deepEqual(payload.presets.map((row) => row.id), ['tenant-one']);
    assert.equal(payload.presets[0].name, '一');
  } finally {
    done();
  }
});

test('the shipped template route serves the file the menu copies', async () => {
  const { root, done } = fixture();
  try {
    const fake = fakeHost();
    apply(fake.ctx, { tenantsDir: root });
    const res = fake.call(TEMPLATE);
    await waitForRes(res);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.file, 'templates/tenant.json');
    assert.match(payload.content, /"id"/);
  } finally {
    done();
  }
});
