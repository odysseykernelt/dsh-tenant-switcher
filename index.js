/**
 * Tenant switcher — host half.
 *
 * Why this file exists at all: a bundle row must resolve to a host plugin before
 * the app will load the package's `./client` entry, so the browser half needs a
 * host counterpart even though the interesting work is in the page.
 *
 * What it does: two read-only routes. One answers with the agent-preset roster,
 * the other with the tenant.json template that ships alongside this package. The
 * browser half cannot reach `agentPresets.list()` — the app's Remote facade
 * (`@deepseek-ai/dsh-api-remotes`) mounts a fixed, build-time allowlist of
 * namespaces and agent presets is not one of them, and there is no runtime
 * discovery. A same-origin route is the cheapest honest seam: it is behind the
 * same web authentication as the GUI, it needs no token of our own, and a
 * failure is an HTTP status the panel can print instead of a silent empty list.
 */

import { readFile } from 'node:fs/promises';

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

export function apply(ctx) {
  ctx.inject(['webServer', 'agentPresets'], (host) => {
    host.effect(
      () => host.webServer.register({
        kind: 'exact',
        path: ROSTER_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
          }
          let rows;
          try {
            rows = host.agentPresets.list();
          } catch (error) {
            sendJson(res, 500, { error: String((error && error.message) || error) });
            return;
          }
          Promise.resolve(rows)
            .then((value) => sendJson(res, 200, { presets: rosterRows(value) }))
            .catch((error) => sendJson(res, 500, { error: String((error && error.message) || error) }));
        },
      }),
      'dsh-tenant-switcher: preset roster route',
    );

    host.effect(
      () => host.webServer.register({
        kind: 'exact',
        path: TEMPLATE_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
          }
          readFile(TEMPLATE_FILE, 'utf8')
            .then((content) => sendJson(res, 200, { file: 'templates/tenant.json', content }))
            .catch((error) => sendJson(res, 500, { error: String((error && error.message) || error) }));
        },
      }),
      'dsh-tenant-switcher: tenant template route',
    );
  });
}
