/**
 * Tenant discovery — the parts of a tenant that can be decided without a host.
 *
 * A tenant lives in `<tenantsDir>/<id>/tenant.json` and nothing else about it is
 * authoritative: the directory name is the id, the file describes it, and every
 * derived thing (preset row, prompt sections) is rebuilt from those two on each
 * start. Discovery never throws — a broken tenant becomes a row with `status:
 * "error"` so the UI can show the reason instead of silently dropping it.
 *
 *   tenants/
 *     researcher/
 *       tenant.json
 *       persona.md
 *       memory/{SOUL.md,MEMORY.md,index.md,...}
 *       workspace/
 *
 * Kept dependency-free (node:fs only) so `test/tenants.test.js` can run it on a
 * fixture without a host.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const PRESET_PREFIX = 'tenant-';

/** Tenant id → preset id. Official presets are `standard|ptc|minimal|cordis`. */
export function presetIdOf(tenantId) {
  return `${PRESET_PREFIX}${tenantId}`;
}

export function tenantIdOfPreset(presetId) {
  if (typeof presetId !== 'string' || !presetId.startsWith(PRESET_PREFIX)) return null;
  const id = presetId.slice(PRESET_PREFIX.length);
  return ID_PATTERN.test(id) ? id : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve a path declared by tenant.json. Relative values live inside the tenant
 * directory; absolute values are taken as-is so a tenant can adopt a memory
 * library that already exists somewhere else (`.memory`, a shared checkout, a
 * synced folder) instead of being forced to copy it in. `join` would happily
 * produce `tenants/<id>/C:\Users\…` for an absolute value, which is why this
 * check comes first.
 */
export function resolveIn(tenant, value) {
  return isAbsolute(value) ? value : join(tenant.dir, value);
}

/** Where this tenant's persona and memory actually are, resolved once. */
export function tenantPaths(tenant) {
  return {
    persona: resolveIn(tenant, tenant.personaFile),
    memoryDir: resolveIn(tenant, tenant.memoryDir),
    workspaceDir: resolveIn(tenant, tenant.workspaceDir),
  };
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readTextFile(path, limit) {
  try {
    const raw = readFileSync(path, 'utf8');
    return limit && raw.length > limit ? `${raw.slice(0, limit)}\n…` : raw;
  } catch {
    return '';
  }
}

/**
 * Turn one parsed tenant.json into the record the host needs.
 * Returns `{ tenant }` or `{ error }` — no exceptions, no partial tenants.
 */
export function parseTenant(id, raw, { dir }) {
  if (!ID_PATTERN.test(id)) {
    return { error: `目录名 "${id}" 不是合法租户 id（只允许小写字母、数字、- 和 _，1–48 位）` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'tenant.json 不是一个 JSON 对象' };
  }
  if (raw.id !== undefined && raw.id !== id) {
    return { error: `tenant.json 里的 id "${String(raw.id)}" 和目录名 "${id}" 不一致；以目录名为准，请改成一致` };
  }
  const name = text(raw.name) || id;
  const description = text(raw.description);
  const order = numberOr(raw.order, 500);
  const personaFile = text(raw.persona) || 'persona.md';
  const memoryDir = text(raw.memoryDir) || 'memory';
  const workspaceDir = text(raw.workspaceDir) || 'workspace';

  const tenant = {
    id,
    presetId: presetIdOf(id),
    dir,
    name,
    description,
    order,
    personaFile,
    memoryDir,
    workspaceDir,
    readOnly: Boolean(raw.memory && raw.memory.readOnly),
    schema: text(raw.memory && raw.memory.schema) || 'soul-index-log',
    // Kept verbatim for diagnostics; nothing consumes these yet.
    raw,
  };
  return { tenant };
}

/** Every tenant under `dir`, in stable order, plus the reasons things were skipped. */
export function discoverTenants(dir) {
  const result = { dir, tenants: [], errors: [], missing: false };
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    result.missing = true;
    result.errors.push({
      id: null,
      reason: `租户目录不存在或读不了：${dir}（${String((error && error.message) || error)}）`,
    });
    return result;
  }

  for (const name of names.sort()) {
    if (name.startsWith('.')) continue;
    const tenantDir = join(dir, name);
    let stat;
    try {
      stat = statSync(tenantDir);
    } catch (error) {
      result.errors.push({ id: name, reason: `读不了目录：${String((error && error.message) || error)}` });
      continue;
    }
    if (!stat.isDirectory()) continue;

    const file = join(tenantDir, 'tenant.json');
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      const message = String((error && error.message) || error);
      result.errors.push({ id: name, reason: `tenant.json 读不了或不是合法 JSON：${message}` });
      continue;
    }

    const parsed = parseTenant(name, raw, { dir: tenantDir });
    if (parsed.error) {
      result.errors.push({ id: name, reason: parsed.error });
      continue;
    }
    result.tenants.push(parsed.tenant);
  }

  result.tenants.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  return result;
}

/** Prompt material for one tenant, read at install time. Missing files are empty, not fatal. */
export function readTenantMaterial(tenant, { soulLimit = 3000, indexLimit = 3000, personaLimit = 8000 } = {}) {
  const paths = tenantPaths(tenant);
  const persona = readTextFile(paths.persona, personaLimit);
  const soul = readTextFile(join(paths.memoryDir, 'SOUL.md'), soulLimit);
  const index = readTextFile(join(paths.memoryDir, 'index.md'), indexLimit);
  return { persona, soul, index };
}

/** The preset the host registers for one tenant. */
export function presetDefinitionOf(tenant, { pluginName }) {
  const paths = tenantPaths(tenant);
  return {
    id: tenant.presetId,
    name: tenant.name,
    description: tenant.description || `租户 ${tenant.id}`,
    order: tenant.order,
    plugins: [
      {
        name: pluginName,
        // Resolved paths, not file names: the tenant instance should not have to
        // re-derive them (and must not re-read tenant.json at mount time).
        config: {
          tenant: tenant.id,
          tenantDir: tenant.dir,
          persona: paths.persona,
          memoryDir: paths.memoryDir,
        },
      },
    ],
  };
}
