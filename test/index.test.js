/**
 * Host-half wiring tests with a fake Cordis context: no DSH, no HTTP server, no
 * restart. What this proves is the rule the whole plugin rests on — a session's
 * working directory decides its tenant, the injection follows that decision, and a
 * tenant that does not inherit the global memory library has its session switched
 * off through the memory plugin's own route.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/** One agent as the Host hands it over: a session with a cwd, and a scope to inject into. */
function fakeAgent(sessionId, cwd) {
  const sections = [];
  const contexts = [];
  const agent = {
    id: sessionId,
    session: { id: sessionId, header: { cwd } },
    sections,
    contexts,
    ctx: {
      inject(_names, callback) {
        callback({
          systemPrompt: {
            section: (row) => sections.push(row),
            context: (row) => contexts.push(row),
          },
        });
      },
    },
  };
  return agent;
}

function fakeHost(agents = []) {
  const routes = new Map();
  const disposers = [];
  const logs = { warn: [], info: [] };
  const created = [];
  const listeners = new Map();

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
    on(event, callback) {
      listeners.set(event, callback);
    },
    agents: {
      list: () => agents,
    },
    webServer: {
      getOrigin: () => 'http://127.0.0.1:1234',
      register({ path, handler }) {
        routes.set(path, handler);
        return () => routes.delete(path);
      },
    },
  };

  const ctx = {
    logger: host.logger,
    inject(_names, callback) {
      callback(host);
      return { dispose() {} };
    },
    effect: host.effect,
    on(event, callback) {
      if (event === 'dispose') created.push(callback);
    },
  };

  const call = (path, method = 'GET', url = path) => {
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
    handler({ method, url }, res);
    return res;
  };

  return { ctx, host, routes, disposers, logs, listeners, call };
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

/** Capture the memory plugin's session switch without starting the Host. */
function captureFetch() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const TENANTS = '/dsh-tenant-switcher/tenants';
const ROSTER = '/dsh-tenant-switcher/presets';
const TEMPLATE = '/dsh-tenant-switcher/tenant-template';

test('the session working directory decides the tenant, and only that tenant is injected', () => {
  const { root, done } = fixture();
  const fetchCalls = captureFetch();
  try {
    const alphaDir = writeTenant(root, 'alpha', { name: '阿尔法', order: 40 }, {
      'persona.md': '我是阿尔法。',
      'memory/SOUL.md': '阿尔法的 SOUL',
      'memory/index.md': '# alpha index',
    });
    writeTenant(root, 'beta', { name: '贝塔', order: 41 }, { 'persona.md': '我是贝塔。' });

    const inside = fakeAgent('sess-alpha', join(alphaDir, 'workspace', 'nested'));
    const outside = fakeAgent('sess-default', join(tmpdir(), 'some-other-place'));

    const fake = fakeHost([inside, outside]);
    apply(fake.ctx, { tenantsDir: root });

    assert.equal(inside.sections.length, 1);
    assert.equal(inside.sections[0].name, 'tenant:alpha:persona');
    assert.equal(inside.sections[0].text, '我是阿尔法。');
    assert.equal(inside.contexts.length, 1);
    assert.match(inside.contexts[0].text, /阿尔法的 SOUL/);

    // A session outside every tenant workspace is left alone — no section, no mute.
    assert.equal(outside.sections.length, 0);
    assert.equal(outside.contexts.length, 0);
    assert.equal(fetchCalls.calls.length, 1);
    assert.match(fetchCalls.calls[0].url, /\/api\/memory\/session$/);
    assert.deepEqual(JSON.parse(fetchCalls.calls[0].init.body), { sessionId: 'sess-alpha', action: 'off' });
  } finally {
    fetchCalls.restore();
    done();
  }
});

test('a tenant that inherits the global memory is injected once, and not muted', () => {
  const { root, done } = fixture();
  const fetchCalls = captureFetch();
  try {
    const dir = writeTenant(root, 'chan', {
      name: '湛',
      inheritGlobalMemory: true,
    }, {
      'persona.md': '我是湛。',
      'memory/SOUL.md': 'SOUL 已经在全局那一层了',
      'memory/index.md': '# index',
    });

    const agent = fakeAgent('sess-chan', join(dir, 'workspace'));
    const fake = fakeHost([agent]);
    apply(fake.ctx, { tenantsDir: root });

    assert.equal(agent.sections.length, 1);
    assert.equal(agent.sections[0].name, 'tenant:chan:persona');
    // The SOUL/index would be a second copy of what the memory plugin already sends.
    assert.equal(agent.contexts.length, 0);
    assert.equal(fetchCalls.calls.length, 0);
  } finally {
    fetchCalls.restore();
    done();
  }
});

test('the tenant table reports workspaces and answers which tenant owns a session', () => {
  const { root, done } = fixture();
  const fetchCalls = captureFetch();
  try {
    const dirA = writeTenant(root, 'alpha', { name: '阿尔法' }, { 'persona.md': '我是阿尔法。' });
    writeTenant(root, 'broken', '{ not json');

    const agent = fakeAgent('sess-alpha', join(dirA, 'workspace'));
    const fake = fakeHost([agent]);
    apply(fake.ctx, { tenantsDir: root });

    const res = fake.call(TENANTS, 'GET', `${TENANTS}?sessionId=sess-alpha`);
    assert.equal(res.statusCode, 200);
    const report = JSON.parse(res.body);
    assert.equal(report.dir, root);
    assert.equal(report.exists, true);
    assert.equal(report.current, 'alpha');

    const byId = new Map(report.tenants.map((row) => [row.id, row]));
    assert.equal(byId.get('alpha').workspace, join(dirA, 'workspace'));
    assert.equal(byId.get('alpha').workspaceExists, true);
    assert.equal(existsSync(join(dirA, 'workspace')), true, 'the workspace directory is created');
    assert.deepEqual(byId.get('alpha').files, { persona: true, soul: false, index: false });
    assert.equal(byId.get('broken').status, 'error');
    assert.match(byId.get('broken').reason, /JSON/);
    assert.equal(report.errors.length, 1);

    // Unknown session: no owner claimed, no guess made.
    const unknown = JSON.parse(fake.call(TENANTS, 'GET', `${TENANTS}?sessionId=sess-nope`).body);
    assert.equal(unknown.current, null);
  } finally {
    fetchCalls.restore();
    done();
  }
});

test('missing tenant directory is reported instead of crashing the plugin', () => {
  const fake = fakeHost();
  const dir = join(tmpdir(), 'dsh-tenant-host-missing-000');
  apply(fake.ctx, { tenantsDir: dir });

  const report = JSON.parse(fake.call(TENANTS).body);
  assert.equal(report.exists, false);
  assert.deepEqual(report.tenants, []);
  assert.match(report.dirError, /不存在或读不了/);
});

test('routes stay read-only', () => {
  const { root, done } = fixture();
  try {
    writeTenant(root, 'one', { name: '一' });
    const fake = fakeHost();
    apply(fake.ctx, { tenantsDir: root });

    assert.equal(fake.call(TENANTS, 'POST').statusCode, 405);
    assert.equal(fake.call(TEMPLATE, 'POST').statusCode, 405);
    assert.equal(fake.call(ROSTER, 'POST').statusCode, 405);
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
    assert.match(payload.content, /inheritGlobalMemory/);
  } finally {
    done();
  }
});
