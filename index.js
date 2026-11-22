/**
 * Tenant switcher — host half.
 *
 * **A tenant is a workspace, not a preset.** The first version registered one
 * agent preset per tenant, which read well until it met a real session: a preset
 * is one dimension, so binding a tenant took the official mode dropdown away, and
 * the memory plugin — a root-scope singleton that injects for every agent — kept
 * feeding the global memory library to every tenant. Tenants are workspaces now:
 *
 *  - the official presets are untouched (mode and tenant are orthogonal again);
 *  - a tenant's identity rides on the session's working directory, which the Host
 *    sees on `agent/created`, so injection can be decided per agent;
 *  - a tenant that does not inherit the global memory library gets its session
 *    switched off in `dsh-plugin-memory` through that plugin's own route, before
 *    the first turn — suppression has to go through the owner, not around it.
 *
 * Three read-only routes stay: the tenant table (also answered for a specific
 * session, so the chip can say "this session belongs to X"), the tenant.json
 * template, and the preset roster (kept for the older preset-based installs).
 *
 * Failure is meant to be visible: a broken tenant.json is a row with its reason,
 * a workspace that cannot be created is a row with its reason, and a memory
 * switch that could not be thrown is a warning in the log — never a silent
 * "looks fine".
 */

import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  discoverTenants,
  readTenantMaterial,
  resolveIn,
  tenantIdForPath,
  tenantPaths,
} from './tenants.js';

const TENANTS_PATH = '/dsh-tenant-switcher/tenants';
const ROSTER_PATH = '/dsh-tenant-switcher/presets';
const TEMPLATE_PATH = '/dsh-tenant-switcher/tenant-template';
const TEMPLATE_FILE = new URL('./templates/tenant.json', import.meta.url);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

function messageOf(error) {
  return String((error && error.message) || error);
}

function readOnly(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  sendJson(res, 405, { error: 'method not allowed' });
  return false;
}

function tenantsDirOf(config) {
  const configured = config && typeof config.tenantsDir === 'string' ? config.tenantsDir.trim() : '';
  if (configured) return configured;
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return join(home || join(homedir(), '.dsh'), 'tenants');
}

/** The directory a session is running in — the one fact tenant binding is derived from. */
function cwdOf(agent) {
  const candidates = [
    agent?.session?.header?.cwd,
    agent?.session?.cwd,
    agent?.options?.cwd,
    agent?.cwd,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function sessionIdOf(agent) {
  const candidates = [agent?.session?.id, agent?.session?.header?.id, agent?.id];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Ask `dsh-plugin-memory` to switch this session off.
 *
 * The memory plugin owns its own gate: `memory-sessions.json` is read once into
 * memory at startup, so writing the file would be theatre. Its `/api/memory/session`
 * route is the supported way in, and it is a Host route (no SPA authentication).
 */
async function muteGlobalMemory(host, sessionId, log) {
  let origin;
  try {
    origin = host.webServer.getOrigin();
  } catch (error) {
    log?.warn?.(`dsh-tenant-switcher: 拿不到 web 服务地址，跳过记忆开关：${messageOf(error)}`);
    return false;
  }
  if (!origin) {
    log?.warn?.('dsh-tenant-switcher: 拿不到 web 服务地址，跳过记忆开关');
    return false;
  }
  try {
    const response = await fetch(`${origin}/api/memory/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'off' }),
    });
    if (!response.ok) {
      log?.warn?.(`dsh-tenant-switcher: 关记忆失败 HTTP ${response.status}（会话 ${sessionId}）`);
      return false;
    }
    const payload = await response.json().catch(() => null);
    if (payload && payload.ok === true) return true;
    log?.warn?.(`dsh-tenant-switcher: 记忆开关没生效（会话 ${sessionId}）：${JSON.stringify(payload)}`);
    return false;
  } catch (error) {
    log?.warn?.(`dsh-tenant-switcher: 调记忆开关失败（会话 ${sessionId}）：${messageOf(error)}`);
    return false;
  }
}

/** Root instance: discovery, per-agent tenant binding, routes. */
function applyRoot(ctx, config) {
  const dir = tenantsDirOf(config);
  const registerPresets = config.registerPresets === true;
  const muteMemory = config.muteGlobalMemory !== false;
  const state = {
    dir,
    startedAt: new Date().toISOString(),
    // Session id → tenant id, for the diagnostics route.
    bound: new Map(),
    errors: [],
    registered: new Map(),
  };

  const needs = ['agents', 'systemPrompt', 'webServer'];
  if (registerPresets) needs.push('agentPresets');

  ctx.inject(needs, (host) => {
    let discovered;
    try {
      discovered = discoverTenants(dir);
    } catch (error) {
      discovered = { dir, tenants: [], errors: [{ id: null, reason: messageOf(error) }], missing: true };
    }

    const log = host.logger;

    for (const row of discovered.errors) {
      state.errors.push(row);
      log?.warn?.(`dsh-tenant-switcher: 跳过租户 ${row.id ?? '(未知)'}：${row.reason}`);
    }

    // Old installs registered one preset per tenant. Off by default now; kept
    // behind a config flag so an existing session bound to `tenant-*` still has a
    // preset to resolve to.
    if (registerPresets) {
      for (const tenant of discovered.tenants) {
        try {
          const dispose = host.agentPresets.register({
            id: tenant.presetId,
            name: tenant.name,
            description: tenant.description || `租户 ${tenant.id}`,
            order: tenant.order,
            plugins: [{ name: '@local/dsh-tenant-switcher', config: { tenant: tenant.id } }],
          });
          state.registered.set(tenant.presetId, { id: tenant.id, dispose });
        } catch (error) {
          const reason = `注册 preset 失败：${messageOf(error)}`;
          state.errors.push({ id: tenant.id, reason });
          log?.warn?.(`dsh-tenant-switcher: ${tenant.id} ${reason}`);
          continue;
        }
      }
      host.effect(() => () => {
        for (const entry of state.registered.values()) {
          try {
            entry.dispose?.();
          } catch {
            // Registry owns the lifecycle; a disposed preset needs no second dispose.
          }
        }
        state.registered.clear();
      }, 'dsh-tenant-switcher: tenant presets');
    }

    // A tenant's workspace is the binding key, so it has to exist before a session
    // can be started in it. Creating it is idempotent and cheap.
    const workspaces = new Map();
    for (const tenant of discovered.tenants) {
      const path = tenantPaths(tenant).workspaceDir;
      workspaces.set(path, tenant);
      mkdir(path, { recursive: true }).catch((error) => {
        const reason = `建不了租户工作区 ${path}：${messageOf(error)}`;
        state.errors.push({ id: tenant.id, reason });
        log?.warn?.(`dsh-tenant-switcher: ${tenant.id} ${reason}`);
      });
    }

    const materials = new Map();
    for (const tenant of discovered.tenants) {
      try {
        materials.set(tenant.id, readTenantMaterial(tenant));
      } catch (error) {
        log?.warn?.(`dsh-tenant-switcher: 租户 ${tenant.id} 读人格/记忆失败：${messageOf(error)}`);
        materials.set(tenant.id, { persona: '', soul: '', index: '' });
      }
    }

    const bound = new WeakSet();

    /** Delegated sessions inherit the parent's cwd; they are workers, not tenants. */
    function isSubagent(agent) {
      const header = agent?.session?.header ?? {};
      return header.origin === 'subagent'
        || header.parentSession !== undefined
        || (header.delegationDepth ?? 0) > 0
        || (agent?.options?.subagentDepth ?? 0) > 0;
    }

    const bind = (agent) => {
      if (!agent || bound.has(agent) || isSubagent(agent)) return;
      const cwd = cwdOf(agent);
      if (!cwd) return;
      const tenantId = tenantIdForPath(discovered.tenants, cwd);
      if (!tenantId) return;
      const tenant = discovered.tenants.find((row) => row.id === tenantId);
      if (!tenant) return;
      bound.add(agent);

      const sessionId = sessionIdOf(agent);
      if (sessionId) state.bound.set(sessionId, tenant.id);

      const material = materials.get(tenant.id) || { persona: '', soul: '', index: '' };
      // `inheritGlobalMemory` means the memory plugin already carries this tenant's
      // SOUL/index for the session: injecting them again would be a second copy.
      const injectSoul = !tenant.inheritGlobalMemory;

      agent.ctx.inject(['systemPrompt'], (scope) => {
        if (material.persona) {
          scope.systemPrompt.section({
            name: `tenant:${tenant.id}:persona`,
            order: 300,
            interpolate: false,
            text: material.persona,
          });
        }
        if (injectSoul && (material.soul || material.index)) {
          const parts = [`# 租户记忆（${tenant.id}）`];
          if (material.soul) parts.push(`## SOUL\n\n${material.soul}`);
          if (material.index) parts.push(`## index\n\n${material.index}`);
          parts.push('这部分现在只读：工具有限，改动会丢。');
          scope.systemPrompt.context({
            name: `tenant:${tenant.id}:memory`,
            order: 310,
            interpolate: false,
            text: parts.join('\n\n'),
          });
        }
      });

      if (muteMemory && !tenant.inheritGlobalMemory && sessionId) {
        muteGlobalMemory(host, sessionId, log).catch(() => {});
      }
    };

    for (const agent of host.agents.list()) bind(agent);
    host.on('agent/created', bind);

    host.effect(
      () => host.webServer.register({
        kind: 'exact',
        path: TENANTS_PATH,
        handler: (req, res) => {
          if (!readOnly(req, res)) return;
          let fresh;
          try {
            fresh = discoverTenants(state.dir);
          } catch (error) {
            sendJson(res, 500, { error: messageOf(error) });
            return;
          }

          const rows = fresh.tenants.map((tenant) => {
            const paths = tenantPaths(tenant);
            return {
              id: tenant.id,
              name: tenant.name,
              description: tenant.description,
              order: tenant.order,
              dir: tenant.dir,
              workspace: paths.workspaceDir,
              workspaceExists: existsSync(paths.workspaceDir),
              inheritGlobalMemory: tenant.inheritGlobalMemory,
              files: {
                persona: existsSync(paths.persona),
                soul: existsSync(join(paths.memoryDir, 'SOUL.md')),
                index: existsSync(join(paths.memoryDir, 'index.md')),
              },
              persona: paths.persona,
              memoryDir: paths.memoryDir,
            };
          });

          const broken = fresh.missing
            ? []
            : fresh.errors.map((row) => ({ id: row.id, status: 'error', reason: row.reason }));

          // Which tenant owns the session that is asking, if any.
          let requestUrl;
          try {
            requestUrl = new URL(req.url || '', 'http://localhost');
          } catch {
            requestUrl = null;
          }
          const askedSession = requestUrl?.searchParams.get('sessionId') || '';
          const current = askedSession ? (state.bound.get(askedSession) || null) : null;

          sendJson(res, 200, {
            dir: fresh.dir,
            exists: !fresh.missing,
            dirError: fresh.missing ? (fresh.errors[0]?.reason || '') : '',
            startedAt: state.startedAt,
            current,
            tenants: rows.concat(broken),
            errors: state.errors,
          });
        },
      }),
      'dsh-tenant-switcher: tenant table route',
    );

    host.effect(
      () => host.webServer.register({
        kind: 'exact',
        path: ROSTER_PATH,
        handler: (req, res) => {
          if (!readOnly(req, res)) return;
          let rows;
          try {
            rows = host.agentPresets ? host.agentPresets.list() : [];
          } catch (error) {
            sendJson(res, 500, { error: messageOf(error) });
            return;
          }
          Promise.resolve(rows)
            .then((value) => sendJson(res, 200, { presets: Array.isArray(value) ? value.map((row) => ({
              id: row.id,
              name: typeof row.name === 'string' ? row.name : undefined,
              broken: row.broken === true,
            })) : [] }))
            .catch((error) => sendJson(res, 500, { error: messageOf(error) }));
        },
      }),
      'dsh-tenant-switcher: preset roster route',
    );

    host.effect(
      () => host.webServer.register({
        kind: 'exact',
        path: TEMPLATE_PATH,
        handler: (req, res) => {
          if (!readOnly(req, res)) return;
          readFile(TEMPLATE_FILE, 'utf8')
            .then((content) => sendJson(res, 200, { file: 'templates/tenant.json', content }))
            .catch((error) => sendJson(res, 500, { error: messageOf(error) }));
        },
      }),
      'dsh-tenant-switcher: tenant template route',
    );

    ctx.on('dispose', () => state.bound.clear());
  });
}

/**
 * Preset-mounted instance (only used when `registerPresets` is on).
 * Its own scope already isolates it; it injects for the agents of that preset only.
 */
function applyTenant(ctx, config) {
  const id = String(config.tenant);
  const dir = typeof config.tenantDir === 'string' && config.tenantDir.trim()
    ? config.tenantDir.trim()
    : join(tenantsDirOf(config), id);
  const personaFile = typeof config.persona === 'string' && config.persona.trim() ? config.persona.trim() : 'persona.md';
  const memoryDir = typeof config.memoryDir === 'string' && config.memoryDir.trim() ? config.memoryDir.trim() : 'memory';
  const material = { persona: '', soul: '', index: '' };

  try {
    Object.assign(material, readTenantMaterial({ dir, personaFile, memoryDir, workspaceDir: 'workspace' }));
  } catch (error) {
    ctx.logger?.warn?.(`dsh-tenant-switcher: 租户 ${id} 读人格/记忆失败：${messageOf(error)}`);
  }

  if (!material.persona && !material.soul && !material.index) return;

  ctx.inject(['systemPrompt'], (prompt) => {
    if (material.persona) {
      prompt.systemPrompt.section({
        name: `tenant:${id}:persona`,
        order: 300,
        interpolate: false,
        text: material.persona,
      });
    }
    if (material.soul || material.index) {
      const parts = [`# 租户记忆（${id}）`];
      if (material.soul) parts.push(`## SOUL\n\n${material.soul}`);
      if (material.index) parts.push(`## index\n\n${material.index}`);
      parts.push('这部分现在只读：工具有限，改动会丢。');
      prompt.systemPrompt.context({
        name: `tenant:${id}:memory`,
        order: 310,
        interpolate: false,
        text: parts.join('\n\n'),
      });
    }
  });
}

export function apply(ctx, config) {
  const tenant = config && typeof config.tenant === 'string' ? config.tenant.trim() : '';
  if (tenant) {
    applyTenant(ctx, config);
    return;
  }
  applyRoot(ctx, config ?? {});
}
