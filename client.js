/**
 * Tenant switcher — browser half.
 *
 * One chip in the composer tool row (`conversation.input.left`), same slot, size,
 * font and menu geometry as dsh-plugin-memory's `memory-session-toggle`.
 *
 * What it is now: the tenant surface, not a second preset picker. The official
 * mode dropdown already picks the preset for a session, so this chip does not
 * duplicate it. It shows who this session is, and offers one action — add a
 * tenant — which opens the tenant.json template to copy.
 *
 * Why it cannot "switch": the registry refuses `select()` once a session has run
 * a turn (`agent-preset/locked`), so a preset is bound when the session is
 * created. Nothing here pretends otherwise.
 *
 * Where data comes from: the host half's read-only routes
 * `GET /dsh-tenant-switcher/presets` (the name behind the id) and
 * `GET /dsh-tenant-switcher/tenant-template` (the shipped template file). The
 * app's Remote facade mounts a fixed build-time allowlist of namespaces,
 * agent presets is not among them, and there is no runtime discovery.
 *
 * Hook budget: the browser React surface exposes ONLY createElement, useState
 * and useEffect (client Builtin catalogue). useRef / useCallback / useMemo are
 * absent — calling one throws during render and the host blanks the cell.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-tenant-switcher',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const CHIP_SLOT = 'conversation.input.left';
    const ROSTER_URL = '/dsh-tenant-switcher/presets';
    const TEMPLATE_URL = '/dsh-tenant-switcher/tenant-template';
    const TENANTS_URL = '/dsh-tenant-switcher/tenants';
    const NS = 'tenant-switcher';

    /* Chip + menu geometry mirror dsh-plugin-memory: 13px chip on the composer
       tool row, 12px menu items, 8px panel radius. Tokens only — a renamed token
       costs looks, never a crash. */
    const CSS = `
.dts-root { position: relative; display: inline-flex; }
.dts-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px;
  font-size: 13px; line-height: 18px; border-radius: 6px; border: none;
  background: transparent; color: var(--dsw-alias-label-secondary, #888);
  font-family: inherit; cursor: pointer; white-space: nowrap; max-width: 180px; opacity: 1;
}
.dts-chip:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); }
.dts-chip[aria-expanded="true"] { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.16)); }
.dts-chip:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4c8dff); outline-offset: 1px; }
.dts-chip-label { overflow: hidden; text-overflow: ellipsis; }
.dts-glyph { flex: none; opacity: .9; }
.dts-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--dsw-alias-brand-primary, #4c8dff); }
.dts-dot[data-tone="broken"] { background: var(--dsw-alias-state-error-primary, #e5484d); }
.dts-dot[data-tone="idle"] { background: var(--dsw-alias-state-idle-primary, #9aa0a6); }
.dts-panel {
  position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 40;
  min-width: 220px; max-width: 300px; padding: 6px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2));
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
  display: flex; flex-direction: column; gap: 2px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dts-panel--wide { width: 380px; max-width: 380px; }
.dts-head { padding: 4px 8px 2px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary, #888); }
.dts-current {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  font-size: 12px; line-height: 16px;
}
.dts-current-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dts-current-tag { margin-left: auto; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #888); flex: none; }
.dts-item {
  display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
  padding: 5px 8px; font-size: 12px; line-height: 16px; border-radius: 5px;
  border: none; background: transparent; color: inherit; font-family: inherit; cursor: pointer;
}
.dts-item:hover { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.12)); }
.dts-item:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4c8dff); outline-offset: -2px; }
.dts-plus { flex: none; width: 12px; text-align: center; color: var(--dsw-alias-label-secondary, #888); }
.dts-divider { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l1, rgba(128,128,128,.2)); }
.dts-tenant {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px;
  font-size: 12px; line-height: 16px;
}
.dts-tenant-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dts-tenant-tag { margin-left: auto; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #888); flex: none; }
.dts-tenant-reason {
  padding: 0 8px 4px 20px; font-size: 10px; line-height: 14px;
  color: var(--dsw-alias-state-error-primary, #e5484d); word-break: break-word;
}
.dts-foot { padding: 2px 8px 4px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary, #888); }
.dts-note { padding: 6px 8px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary, #666); }
.dts-error { padding: 4px 8px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-state-error-primary, #e5484d); word-break: break-word; }
.dts-code {
  margin: 2px 6px; padding: 8px; max-height: 260px; overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; line-height: 15px; white-space: pre;
  border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06));
  color: var(--dsw-alias-label-primary, inherit);
}
.dts-actions { display: flex; align-items: center; gap: 8px; padding: 4px 6px 0; }
.dts-action {
  padding: 4px 10px; font-size: 12px; line-height: 16px; border-radius: 5px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25));
  background: transparent; color: inherit; font-family: inherit; cursor: pointer;
}
.dts-action:hover { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.12)); }
.dts-action:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4c8dff); outline-offset: 1px; }
.dts-action-hint { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary, #888); }
`;

    const DICTS = {
      zh: {
        title: '租户',
        unbound: '未绑定',
        current: '当前租户',
        addTenant: '添加新租户',
        templateTitle: 'tenant.json 模板',
        copy: '复制',
        copied: '已复制',
        copyFailed: '复制失败，手动选中',
        back: '返回',
        loading: '读取中…',
        loadFailed: '读不到模板',
        boundHint: '租户在开会话时绑定，跑过一轮之后不能换。',
        whereHint: '放到 ~/.dsh/tenants/<租户id>/tenant.json',
        restartHint: '放好后重启 DSH，它会出现在官方的模式下拉里。',
        tenantsHead: '租户目录',
        noTenants: '还没有租户。点下面添加，复制一份模板。',
        statusLive: '已生效',
        statusRegistered: '已注册',
        statusPending: '等重启',
        brokenTag: '装不起来',
      },
      en: {
        title: 'Tenants',
        unbound: 'Unbound',
        current: 'Current tenant',
        addTenant: 'Add a tenant',
        templateTitle: 'tenant.json template',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Copy failed — select it manually',
        back: 'Back',
        loading: 'Loading…',
        loadFailed: 'Cannot read the template',
        boundHint: 'A preset is bound when the session is created; it cannot change after the first turn.',
        whereHint: 'Put it at ~/.dsh/tenants/<tenant-id>/tenant.json',
        restartHint: 'Restart DSH afterwards and it shows up in the official mode dropdown.',
        tenantsHead: 'Tenant directories',
        noTenants: 'No tenants yet. Add one below and copy the template.',
        statusLive: 'live',
        statusRegistered: 'registered',
        statusPending: 'restart to load',
        brokenTag: 'broken',
      },
    };

    function toRows(payload) {
      const list = payload && Array.isArray(payload.presets) ? payload.presets : [];
      return list
        .filter((row) => row && typeof row.id === 'string' && row.id.length > 0)
        .map((row) => ({
          id: row.id,
          label: typeof row.name === 'string' && row.name.length > 0 ? row.name : row.id,
          broken: Boolean(row.broken),
        }));
    }

    /** `/tenants` rows → what the menu paints. `status` decides the dot and the tag. */
    function toTenantRows(payload) {
      const list = payload && Array.isArray(payload.tenants) ? payload.tenants : [];
      const rows = [];
      for (const row of list) {
        if (!row || typeof row !== 'object') continue;
        const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : null;
        const status = typeof row.status === 'string' ? row.status : 'not-registered';
        const name = typeof row.name === 'string' && row.name.length > 0 ? row.name : id || '?';
        rows.push({
          key: `${id || 'error'}:${status}`,
          id,
          name,
          status,
          reason: typeof row.reason === 'string' ? row.reason : '',
        });
      }
      return rows;
    }

    function toneOf(status) {
      if (status === 'live' || status === 'registered') return 'ok';
      if (status === 'error') return 'broken';
      return 'idle';
    }


    /** 16px mark: two tenants, one arc between them (same stroke weight as the memory chip). */
    function TenantGlyph() {
      return h(
        'svg',
        {
          className: 'dts-glyph',
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 3.6, cy: 5.4, r: 1.8 }),
        h('circle', { cx: 12.4, cy: 5.4, r: 1.8 }),
        h('path', { d: 'M1.6 12.4c.9-2 3-3.1 5.3-3.1' }),
        h('path', { d: 'M14.4 12.4c-.9-2-3-3.1-5.3-3.1' }),
      );
    }

    function TenantChip(props) {
      const t = props.locale || ((key) => key);
      const [open, setOpen] = React.useState(false);
      const [view, setView] = React.useState('menu');
      const [rows, setRows] = React.useState([]);
      const [template, setTemplate] = React.useState({ status: 'idle', content: '', error: '' });
      const [tenants, setTenants] = React.useState({ status: 'idle', rows: [], error: '', dirError: '' });
      const [copied, setCopied] = React.useState('');

      // Session projection: null on root slots, a preset id here.
      let boundId = null;
      if (typeof props.useProjection === 'function') {
        try {
          const value = props.useProjection('agentPreset');
          if (typeof value === 'string' && value.length > 0) boundId = value;
          else if (value && typeof value.agentPreset === 'string') boundId = value.agentPreset;
        } catch (error) {
          boundId = null;
        }
      }

      React.useEffect(() => {
        fetch(ROSTER_URL, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((payload) => setRows(toRows(payload)))
          .catch(() => setRows([]));
      }, []);

      // Re-read the directory every time the menu opens: the point of this list is
      // to show what is on disk now, including a tenant.json that is broken.
      React.useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        setTenants((prev) => ({ status: 'loading', rows: prev.rows, error: '', dirError: prev.dirError }));
        fetch(TENANTS_URL, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((payload) => {
            if (cancelled) return;
            setTenants({
              status: 'ready',
              rows: toTenantRows(payload),
              error: '',
              dirError: payload && typeof payload.dirError === 'string' ? payload.dirError : '',
            });
          })
          .catch((error) => {
            if (cancelled) return;
            const detail = String((error && error.message) || error);
            setTenants({ status: 'error', rows: [], error: `${t('loadFailed')} — ${detail}`, dirError: '' });
          });
        return () => {
          cancelled = true;
        };
      }, [open]);

      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined;
        const onDown = (event) => {
          const target = event.target;
          if (target && typeof target.closest === 'function' && target.closest('.dts-root')) return;
          setOpen(false);
          setView('menu');
        };
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            setView('menu');
          }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const openTemplate = () => {
        setView('template');
        if (template.status === 'ready' || template.status === 'loading') return;
        setTemplate({ status: 'loading', content: '', error: '' });
        fetch(TEMPLATE_URL, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((payload) => {
            setTemplate({ status: 'ready', content: String(payload.content || ''), error: '' });
          })
          .catch((error) => {
            const detail = String((error && error.message) || error);
            setTemplate({ status: 'error', content: '', error: `${t('loadFailed')} — ${detail}` });
          });
      };

      const copy = () => {
        const text = template.content;
        if (!text) return;
        const done = () => setCopied(t('copied'));
        const fail = () => setCopied(t('copyFailed'));
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(fail);
        } else {
          fail();
        }
      };

      const boundRow = boundId ? rows.find((row) => row.id === boundId) : null;
      const label = boundRow ? boundRow.label : boundId || t('title');
      const tone = boundRow && boundRow.broken ? 'broken' : boundId ? 'ok' : 'idle';

      let panel;
      if (!open) {
        panel = null;
      } else if (view === 'template') {
        let code;
        if (template.status === 'error') {
          code = h('div', { className: 'dts-error', role: 'alert' }, template.error);
        } else if (template.status !== 'ready') {
          code = h('div', { className: 'dts-note' }, t('loading'));
        } else {
          code = h('pre', { className: 'dts-code' }, template.content);
        }
        panel = h(
          'div',
          { className: 'dts-panel dts-panel--wide', role: 'dialog', 'aria-label': t('templateTitle') },
          h('div', { className: 'dts-head' }, t('templateTitle')),
          code,
          h(
            'div',
            { className: 'dts-actions' },
            h('button', { type: 'button', className: 'dts-action', onClick: copy, disabled: template.status !== 'ready' }, t('copy')),
            h('span', { className: 'dts-action-hint' }, copied || t('whereHint')),
          ),
          h(
            'div',
            { className: 'dts-actions' },
            h('button', { type: 'button', className: 'dts-action', onClick: () => setView('menu') }, t('back')),
            h('span', { className: 'dts-action-hint' }, t('restartHint')),
          ),
        );
      } else {
        const statusText = (status) => {
          if (status === 'live') return t('statusLive');
          if (status === 'registered') return t('statusRegistered');
          if (status === 'error') return t('brokenTag');
          return t('statusPending');
        };
        const tenantNodes = [];
        if (tenants.status === 'error') {
          tenantNodes.push(h('div', { className: 'dts-error', role: 'alert', key: 'tenants-error' }, tenants.error));
        } else {
          // No directory yet is a normal first run, not a failure: say where it
          // will look instead of painting a red line.
          if (tenants.dirError) {
            tenantNodes.push(h('div', { className: 'dts-note', key: 'tenants-dir' }, tenants.dirError));
          }
          if (tenants.rows.length === 0) {
            if (!tenants.dirError) {
              tenantNodes.push(h('div', { className: 'dts-note', key: 'tenants-empty' }, tenants.status === 'loading' ? t('loading') : t('noTenants')));
            }
          } else {
            for (const row of tenants.rows) {
              tenantNodes.push(h(
                'div',
                { className: 'dts-tenant', key: row.key },
                h('span', { className: 'dts-dot', 'data-tone': toneOf(row.status) }),
                h('span', { className: 'dts-tenant-name' }, row.name),
                h('span', { className: 'dts-tenant-tag' }, statusText(row.status)),
              ));
              if (row.reason) {
                tenantNodes.push(h('div', { className: 'dts-tenant-reason', key: `${row.key}:reason` }, row.reason));
              }
            }
          }
        }

        panel = h(
          'div',
          { className: 'dts-panel', role: 'menu', 'aria-label': t('title') },
          h('div', { className: 'dts-head' }, t('current')),
          h(
            'div',
            { className: 'dts-current' },
            h('span', { className: 'dts-dot', 'data-tone': tone }),
            h('span', { className: 'dts-current-name' }, label),
            boundRow && boundRow.broken ? h('span', { className: 'dts-current-tag' }, t('brokenTag')) : null,
          ),
          h('div', { className: 'dts-head' }, t('tenantsHead')),
          ...tenantNodes,
          h('div', { className: 'dts-divider' }),
          h(
            'button',
            { type: 'button', role: 'menuitem', className: 'dts-item', onClick: openTemplate },
            h('span', { className: 'dts-plus' }, '＋'),
            h('span', null, t('addTenant')),
          ),
          h('div', { className: 'dts-foot' }, t('boundHint')),
        );
      }

      return h(
        'div',
        { className: 'dts-root' },
        h(
          'button',
          {
            type: 'button',
            className: 'dts-chip',
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            title: boundId ? `${t('current')}: ${label}` : t('title'),
            onClick: () => {
              setCopied('');
              if (open) {
                setOpen(false);
                setView('menu');
              } else {
                setOpen(true);
              }
            },
          },
          h(TenantGlyph, null),
          h('span', { className: 'dts-chip-label' }, label),
        ),
        panel,
      );
    }

    /** Same shape as the shipped plugins: one style node, removed with the plugin. */
    function insertStyles(css) {
      const node = document.createElement('style');
      node.textContent = css;
      node.setAttribute('data-dsh-tenant-switcher', '');
      document.head.appendChild(node);
      return () => {
        node.remove();
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => insertStyles(CSS));
        ctx.effect(() => ctx.locale.register(NS, DICTS));

        const t = ctx.locale.bind(NS);

        // Old hosts may not declare the composer slot: losing the chip must not
        // take the host half (the read-only routes) down with it.
        try {
          ctx.slots.inject(CHIP_SLOT, () => ctx.slots.register(
            { name: CHIP_SLOT, id: 'tenant-chip', order: 110, locale: NS },
            (props) => h(TenantChip, { ...props, locale: t }),
          ));
        } catch (error) {
          // no composer slot on this host
        }
      },
    };
  },
});
