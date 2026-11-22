import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  discoverTenants,
  parseTenant,
  presetDefinitionOf,
  presetIdOf,
  readTenantMaterial,
  tenantIdOfPreset,
} from '../tenants.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tenants-'));
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

function writeTenant(root, id, raw, extra = {}) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tenant.json'), typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
  for (const [name, content] of Object.entries(extra)) {
    const path = join(dir, name);
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

test('missing directory is reported, not thrown', () => {
  const dir = join(tmpdir(), 'dsh-tenants-does-not-exist-000');
  const result = discoverTenants(dir);
  assert.equal(result.missing, true);
  assert.equal(result.tenants.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /不存在或读不了/);
});

test('good tenants are parsed and ordered', () => {
  const { root, done } = fixture();
  try {
    writeTenant(root, 'b-later', { name: '乙', order: 20 });
    writeTenant(root, 'a-first', { name: '甲', order: 10 });
    writeTenant(root, 'c-default', {});

    const result = discoverTenants(root);
    assert.equal(result.missing, false);
    assert.deepEqual(result.tenants.map((t) => t.id), ['a-first', 'b-later', 'c-default']);
    assert.equal(result.tenants[0].name, '甲');
    assert.equal(result.tenants[2].order, 500);
    assert.equal(result.tenants[0].presetId, 'tenant-a-first');
    assert.equal(result.errors.length, 0);
  } finally {
    done();
  }
});

test('broken json and id mismatch become errors, neighbours survive', () => {
  const { root, done } = fixture();
  try {
    writeTenant(root, 'ok', { name: '好' });
    writeTenant(root, 'bad-json', '{ nope');
    writeTenant(root, 'mismatch', { id: 'other', name: '错' });
    writeTenant(root, 'Bad-ID', { name: '大写' });

    const result = discoverTenants(root);
    assert.deepEqual(result.tenants.map((t) => t.id), ['ok']);
    const ids = result.errors.map((e) => e.id).sort();
    assert.deepEqual(ids, ['Bad-ID', 'bad-json', 'mismatch']);
    assert.match(result.errors.find((e) => e.id === 'mismatch').reason, /不一致/);
  } finally {
    done();
  }
});

test('non-directory entries and dotfiles are skipped silently', () => {
  const { root, done } = fixture();
  try {
    writeFileSync(join(root, 'notes.md'), 'ignore me');
    mkdirSync(join(root, '.cache'));
    writeTenant(root, 'real', { name: '真的' });

    const result = discoverTenants(root);
    assert.deepEqual(result.tenants.map((t) => t.id), ['real']);
    assert.equal(result.errors.length, 0);
  } finally {
    done();
  }
});

test('parseTenant defaults and explicit paths', () => {
  const ok = parseTenant('x', { name: ' X ', description: 'd' }, { dir: '/tmp/x' });
  assert.equal(ok.tenant.name, 'X');
  assert.equal(ok.tenant.personaFile, 'persona.md');
  assert.equal(ok.tenant.memoryDir, 'memory');
  assert.equal(ok.tenant.workspaceDir, 'workspace');
  assert.equal(ok.tenant.readOnly, false);

  const custom = parseTenant('y', { persona: 'p.md', memoryDir: 'mem', memory: { readOnly: true, schema: 'other' } }, { dir: '/tmp/y' });
  assert.equal(custom.tenant.personaFile, 'p.md');
  assert.equal(custom.tenant.memoryDir, 'mem');
  assert.equal(custom.tenant.readOnly, true);
  assert.equal(custom.tenant.schema, 'other');

  assert.match(parseTenant('x', [], { dir: '/tmp/x' }).error, /不是一个 JSON 对象/);
  assert.match(parseTenant('', {}, { dir: '/tmp/x' }).error, /不是合法租户 id/);
});

test('preset ids round-trip and official ids are not tenants', () => {
  assert.equal(presetIdOf('research'), 'tenant-research');
  assert.equal(tenantIdOfPreset('tenant-research'), 'research');
  assert.equal(tenantIdOfPreset('standard'), null);
  assert.equal(tenantIdOfPreset('tenant-'), null);
  assert.equal(tenantIdOfPreset('tenant-Bad'), null);
});

test('preset definition points the row at this plugin with the tenant id', () => {
  const { root, done } = fixture();
  try {
    const dir = writeTenant(root, 'deep', { name: '深海', description: '只看代码', order: 7 });
    const result = discoverTenants(root);
    const definition = presetDefinitionOf(result.tenants[0], { pluginName: '@local/dsh-tenant-switcher' });

    assert.equal(definition.id, 'tenant-deep');
    assert.equal(definition.name, '深海');
    assert.equal(definition.description, '只看代码');
    assert.equal(definition.order, 7);
    assert.deepEqual(definition.plugins, [
      { name: '@local/dsh-tenant-switcher', config: { tenant: 'deep', tenantDir: dir } },
    ]);
  } finally {
    done();
  }
});

test('material reads persona, soul and index, and truncates with a marker', () => {
  const { root, done } = fixture();
  try {
    writeTenant(root, 'm', { name: '材料' }, {
      'persona.md': '  人格正文  ',
      'memory/SOUL.md': 'S'.repeat(50),
      'memory/index.md': '# index\n\n- 一页',
    });
    const tenant = discoverTenants(root).tenants[0];
    const material = readTenantMaterial(tenant, { personaLimit: 100, soulLimit: 10, indexLimit: 100 });

    assert.equal(material.persona, '  人格正文  ');
    assert.equal(material.soul, `${'S'.repeat(10)}\n…`);
    assert.match(material.index, /一页/);
  } finally {
    done();
  }
});

test('missing material files read as empty strings', () => {
  const { root, done } = fixture();
  try {
    writeTenant(root, 'bare', { name: '空' });
    const tenant = discoverTenants(root).tenants[0];
    assert.deepEqual(readTenantMaterial(tenant), { persona: '', soul: '', index: '' });
  } finally {
    done();
  }
});
