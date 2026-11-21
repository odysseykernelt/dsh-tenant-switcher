/**
 * Tenant switcher — browser half.
 *
 * One surface: a chip in the composer tool row, registered on
 * `conversation.input.left` — the same slot, size, font and menu geometry as
 * dsh-plugin-memory's `memory-session-toggle` chip. It answers "which preset is
 * this session bound to" and "start me a session as someone else".
 *
 * Why "new session" and not "switch": the registry refuses `select()` once a
 * session has run a turn (`agent-preset/locked`), so a tenant is bound at
 * creation time. The chip never pretends otherwise — the footer says it.
 *
 * Where the roster comes from: the host half's read-only route
 * `GET /dsh-tenant-switcher/presets`. The application's Remote facade mounts a
 * fixed build-time allowlist of namespaces, agent presets is not among them, and
 * there is no runtime discovery — so `ctx.remote.agentPresets` is not an option.
 * Sessions start through `ctx.get('uiWorkspace')`.
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
  min-width: 200px; max-width: 300px; padding: 6px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2));
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
  display: flex; flex-direction: column; gap: 2px;
  color: var(--dsw-alias-label-primary, inherit);
}
.dts-head { padding: 4px 8px 2px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary, #888); }
.dts-item {
  display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  padding: 5px 8px; font-size: 12px; line-height: 16px; border-radius: 5px;
  border: none; background: transparent; color: inherit; font-family: inherit; cursor: pointer;
}
.dts-item:hover { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.12)); }
.dts-item:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #4c8dff); outline-offset: -2px; }
.dts-item[disabled] { cursor: not-allowed; opacity: .5; }
.dts-item-row { display: flex; align-items: center; gap: 6px; }
.dts-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dts-item-tag { margin-left: auto; font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary, #888); flex: none; }
.dts-item-hint {
  font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary, #888);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 12px;
}
.dts-divider { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l1, rgba(128,128,128,.2)); }
.dts-foot { padding: 2px 8px 2px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary, #888); }
.dts-note { padding: 6px 8px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary, #666); }
.dts-error { padding: 4px 8px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-state-error-primary, #e5484d); word-break: break-word; }
`;

    const DICTS = {
      zh: {
        title: '租户',
        unbound: '未绑定',
        pick: '以哪个租户开会话',
        empty: '这台机器上还没有第二个 Agent 预设。',
        loadFailed: '读不到预设列表',
        noWorkspace: '打不开新会话：uiWorkspace 不可用',
        brokenTag: '装不起来',
        newSessionTag: '新会话',
        brokenHint: '这个预设的插件装载失败，先修预设再开会话。',
        currentHint: '跑过一轮之后不能换；换租户就是开新会话。',
        footer: '开了就跑不了回头：租户在开会话时绑定。',
      },
      en: {
        title: 'Tenants',
        unbound: 'Unbound',
        pick: 'Start a session as',
        empty: 'No second agent preset on this machine yet.',
        loadFailed: 'Cannot read the preset roster',
        noWorkspace: 'Cannot open a session: uiWorkspace is unavailable',
        brokenTag: 'broken',
        newSessionTag: 'new session',
        brokenHint: 'This preset failed to mount; fix it before starting a session.',
        currentHint: 'Bound at creation; it cannot change after the first turn.',
        footer: 'Bound when the session is created — not switchable afterwards.',
      },
    };

    function toRows(payload) {
      const list = payload && Array.isArray(payload.presets) ? payload.presets : [];
      return list
        .filter((row) => row && typeof row.id === 'string' && row.id.length > 0)
        .slice()
        .sort((a, b) => {
          const orderA = typeof a.order === 'number' ? a.order : 0;
          const orderB = typeof b.order === 'number' ? b.order : 0;
          if (orderA !== orderB) return orderA - orderB;
          return a.id.localeCompare(b.id);
        })
        .map((row) => ({
          id: row.id,
          label: typeof row.name === 'string' && row.name.length > 0 ? row.name : row.id,
          hint: typeof row.description === 'string' ? row.description : '',
          broken: Boolean(row.broken),
        }));
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
      const [state, setState] = React.useState({ status: 'loading', rows: [], error: '' });

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

      const load = () => {
        fetch(ROSTER_URL, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then((payload) => {
            setState({ status: 'ready', rows: toRows(payload), error: '' });
          })
          .catch((error) => {
            const detail = String((error && error.message) || error);
            setState({ status: 'error', rows: [], error: `${t('loadFailed')} — ${detail}` });
          });
      };

      React.useEffect(() => {
        load();
      }, []);

      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined;
        const onDown = (event) => {
          const target = event.target;
          if (target && typeof target.closest === 'function' && target.closest('.dts-root')) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const startAs = (presetId) => {
        const workspace = props.workspace || null;
        if (!workspace || typeof workspace.startSession !== 'function') {
          setState((previous) => ({ ...previous, error: t('noWorkspace') }));
          return;
        }
        setOpen(false);
        workspace.startSession(undefined, { agentPreset: presetId });
      };

      const boundRow = boundId ? state.rows.find((row) => row.id === boundId) : null;
      const label = boundRow ? boundRow.label : boundId || t('title');
      const tone = boundRow && boundRow.broken ? 'broken' : boundId ? 'ok' : 'idle';

      const items = state.rows
        .filter((row) => row.id !== boundId)
        .map((row) => h(
          'button',
          {
            key: row.id,
            type: 'button',
            role: 'menuitem',
            className: 'dts-item',
            disabled: row.broken,
            title: row.broken ? t('brokenHint') : row.hint || row.id,
            onClick: () => startAs(row.id),
          },
          h(
            'span',
            { className: 'dts-item-row' },
            h('span', { className: 'dts-dot', 'data-tone': row.broken ? 'broken' : 'ok' }),
            h('span', { className: 'dts-item-name' }, row.label),
            h('span', { className: 'dts-item-tag' }, row.broken ? t('brokenTag') : t('newSessionTag')),
          ),
          row.hint ? h('span', { className: 'dts-item-hint' }, row.hint) : null,
        ));

      let body;
      if (state.status === 'error') {
        body = h('div', { className: 'dts-error', role: 'alert' }, state.error);
      } else if (state.status === 'loading' && state.rows.length === 0) {
        body = h('div', { className: 'dts-note' }, '…');
      } else if (items.length === 0) {
        body = h('div', { className: 'dts-note' }, t('empty'));
      } else {
        body = items;
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
            title: boundId ? `${t('title')}: ${label} · ${t('currentHint')}` : t('title'),
            onClick: () => setOpen((value) => !value),
          },
          h(TenantGlyph, null),
          h('span', { className: 'dts-chip-label' }, label),
        ),
        open
          ? h(
            'div',
            { className: 'dts-panel', role: 'menu', 'aria-label': t('pick') },
            h('div', { className: 'dts-head' }, t('pick')),
            body,
            h('div', { className: 'dts-divider' }),
            h('div', { className: 'dts-foot' }, t('footer')),
          )
          : null,
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
        const workspace = ctx.get('uiWorkspace');

        // Old hosts may not declare the composer slot: losing the chip must not
        // take the host half (the roster route) down with it.
        try {
          ctx.slots.inject(CHIP_SLOT, () => ctx.slots.register(
            { name: CHIP_SLOT, id: 'tenant-chip', order: 110, locale: NS },
            (props) => h(TenantChip, { ...props, locale: t, workspace }),
          ));
        } catch (error) {
          // no composer slot on this host
        }
      },
    };
  },
});
