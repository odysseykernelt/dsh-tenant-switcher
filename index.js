/**
 * Tenant switcher — host half.
 *
 * Two jobs, one file, because a preset row and the bundle row are the same
 * package with different config:
 *
 *  - **Root instance** (no `config.tenant`): reads `<tenantsDir>/<id>/tenant.json`
 *    for every directory, registers one agent preset per tenant, and serves three
 *    read-only routes — the preset roster, the tenant.json template, and a tenant
 *    diagnostics table.
 *  - **Tenant instance** (`config.tenant` set, mounted inside that tenant's preset
 *    scope): contributes the tenant's persona and a memory boot block to the
 *    system prompt, and records that it actually mounted.
 *
 * Why a same-origin route instead of the Remote facade: the browser half cannot
 * reach `agentPresets.list()` — `@deepseek-ai/dsh-api-remotes` mounts a fixed,
 * build-time allowlist of namespaces and agent presets is not one of them, with no
 * runtime discovery. A route sits behind the GUI's own web authentication, needs
 * no token of our own, and turns every failure into an HTTP status the panel can
 * print instead of a silent empty list.
 *
 * Failure is meant to be visible: a tenant whose tenant.json is broken is listed
 * with its reason, a preset that failed to register is listed as not registered,
 * and a preset that registered but whose plugin never mounted shows as such.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  discoverTenants,
  presetDefinitionOf,
  readTenantMaterial,
} from './tenants.js';

const ROSTER_PATH = '/dsh-tenant-switcher/presets';
const TEMPLATE_PATH = '/dsh-tenant-switcher/tenant-template';
const TENANTS_PATH = '/dsh-tenant-switcher/tenants';
const TEMPLATE_FILE = new URL('./templates/tenant.json', import.meta.url);

const PLUGIN_NAME = '@local/dsh-tenant-switcher';

/** Tenant ids whose preset instance actually ran `apply`. Read by the diagnostics route. */
const mounted = new Set();

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

/** `agentPresets.list()` rows, narrowed to what the panel can paint. */
function rosterRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row.id === 'string' && row.id.length > 0)
    .map((row) => ({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : undefined,
      description: typeof row.description === 'string' ? row.description : undefined,
      order: typeof row.order === 'number' ? row.order : undefined,
      broken: row.broken === true,
    }));
}

function tenantsDirOf(config) {
  const configured = config && typeof config.tenantsDir === 'string' ? config.tenantsDir.trim() : '';
  if (configured) return configured;
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return join(home || join(homedir(), '.dsh'), 'tenants');
}

/** Per-tenant on-disk facts, cheap enough to recompute on every diagnostics request. */
function tenantReport(dir, registered) {
  const discovered = discoverTenants(dir);
  const byId = new Map(discovered.tenants.map((tenant) => [tenant.id, tenant]));
  const rows = [];

  for (const tenant of discovered.tenants) {
    const presetRegistered = registered.has(tenant.presetId);
    rows.push({
      id: tenant.id,
      name: tenant.name,
      presetId: tenant.presetId,
      dir: tenant.dir,
      order: tenant.order,
      status: !presetRegistered ? 'not-registered' : (mounted.has(tenant.id) ? 'live' : 'registered'),
      files: {
        persona: existsSync(join(tenant.dir, tenant.personaFile)),
        soul: existsSync(join(tenant.dir, tenant.memoryDir, 'SOUL.md')),
        index: existsSync(join(tenant.dir, tenant.memoryDir, 'index.md')),
      },
    });
  }

  // A missing directory is not a tenant with a problem: it is an empty install.
  // Keep it out of the row list and hand the reason over separately, so a fresh
  // checkout does not look broken in the menu.
  const broken = discovered.missing
    ? []
    : discovered.errors.map((row) => ({ id: row.id, status: 'error', reason: row.reason }));
  return {
    dir: discovered.dir,
    exists: !discovered.missing,
    tenants: rows.concat(broken),
    parsed: byId.size,
  };
}

/** Root instance: discovery, preset registration, routes. */
function applyRoot(ctx, config) {
  const dir = tenantsDirOf(config);
  const state = { dir, startedAt: new Date().toISOString(), registered: new Map(), errors: [] };

  ctx.inject(['webServer', 'agentPresets'], (host) => {
    let discovered;
    try {
      discovered = discoverTenants(dir);
    } catch (error) {
      discovered = { dir, tenants: [], errors: [{ id: null, reason: messageOf(error) }], missing: true };
    }

    for (const row of discovered.errors) {
      state.errors.push(row);
      host.logger?.warn?.(`dsh-tenant-switcher: 跳过租户 ${row.id ?? '(未知)'}：${row.reason}`);
    }

    for (const tenant of discovered.tenants) {
      try {
        const dispose = host.agentPresets.register(presetDefinitionOf(tenant, { pluginName: PLUGIN_NAME }));
        state.registered.set(tenant.presetId, { id: tenant.id, dispose });
        host.logger?.info?.(`dsh-tenant-switcher: 注册租户 ${tenant.id} → preset ${tenant.presetId}`);
      } catch (error) {
        const reason = `注册 preset 失败：${messageOf(error)}`;
        state.errors.push({ id: tenant.id, reason });
        host.logger?.warn?.(`dsh-tenant-switcher: ${tenant.id} ${reason}`);
      }
    }

    host.effect(() => () => {
      for (const entry of state.registered.values()) {
        try {
          entry.dispose?.();
        } catch {
          // A preset that is already gone is not our problem; the registry owns its lifecycle.
        }
      }
      state.registered.clear();
    }, 'dsh-tenant-switcher: tenant presets');

    host.effect(
      () => host.webServer.register({
        kind: 'exact',
        path: ROSTER_PATH,
        handler: (req, res) => {
          if (!readOnly(req, res)) return;
          let rows;
          try {
            rows = host.agentPresets.list();
          } catch (error) {
            sendJson(res, 500, { error: messageOf(error) });
            return;
          }
          Promise.resolve(rows)
            .then((value) => sendJson(res, 200, { presets: rosterRows(value) }))
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

    host.effect(
      () => host.webServer.register({
        kind: 'exact',
        path: TENANTS_PATH,
        handler: (req, res) => {
          if (!readOnly(req, res)) return;
          let report;
          try {
            report = tenantReport(state.dir, new Map([...state.registered.keys()].map((key) => [key, true])));
          } catch (error) {
            sendJson(res, 500, { error: messageOf(error) });
            return;
          }
          sendJson(res, 200, {
            dir: report.dir,
            exists: report.exists,
            dirError: report.exists ? '' : (state.errors[0]?.reason || ''),
            startedAt: state.startedAt,
            registered: [...state.registered.values()].map((entry) => entry.id),
            tenants: report.tenants,
            errors: state.errors,
          });
        },
      }),
      'dsh-tenant-switcher: tenant diagnostics route',
    );

    ctx.on('dispose', () => mounted.clear());
  });
}

/** Tenant instance: persona + memory boot inside this tenant's preset scope. */
function applyTenant(ctx, config) {
  const id = String(config.tenant);
  const dir = typeof config.tenantDir === 'string' && config.tenantDir.trim()
    ? config.tenantDir.trim()
    : join(tenantsDirOf(config), id);

  mounted.add(id);
  ctx.effect(() => () => mounted.delete(id), `dsh-tenant-switcher: tenant ${id} mounted`);

  let material;
  try {
    material = readTenantMaterial({ dir, personaFile: 'persona.md', memoryDir: 'memory' });
  } catch (error) {
    ctx.logger?.warn?.(`dsh-tenant-switcher: 租户 ${id} 读人格/记忆失败：${messageOf(error)}`);
    material = { persona: '', soul: '', index: '' };
  }

  if (!material.persona && !material.soul && !material.index) {
    ctx.logger?.warn?.(`dsh-tenant-switcher: 租户 ${id} 没有 persona.md / memory/ 内容，只注册了空注入`);
    return;
  }

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
