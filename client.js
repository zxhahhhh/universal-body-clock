window.__ModuleLoader__.load({
  id: 'universal-body-clock',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ENDPOINT = '/api/body-clock';
    const POLL_MS = 3000;
    const PANEL = 'body-clock';

    // ---------------------------------------------------------------- 小零件

    /* 白字配细黑边，贴在壁纸上也认得出。text-shadow 往下继承，一处钉全页。 */
    const INK = '#ffffff';
    const OUTLINE = '0 0 1.5px rgba(0,0,0,.92), 0 0 3px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.75)';

    const PAGE = {
      height: '100%',
      boxSizing: 'border-box',
      overflowY: 'auto',
      padding: '24px 24px 48px',
      color: INK,
      textShadow: OUTLINE,
      font: 'inherit',
    };

    /* 两页共用一套字和条。条长钉死在这里，哪儿都一样长。 */
    const BAR_W = 76;
    const BAR_H = 6;
    const VALUE_W = 34;
    /* 一组＝小标签＋条＋数，三列共用这个宽，表头才对得齐。 */
    const GROUP_W = 14 + 5 + BAR_W + 5 + VALUE_W;

    const INNER = {
      width: '100%',
      maxWidth: 580,
      margin: '0 auto',
      fontSize: 15,
      lineHeight: '22px',
    };

    const HAIR = 'rgba(0,0,0,.55)';

    function btn(active) {
      return {
        font: 'inherit',
        fontSize: 13,
        lineHeight: '22px',
        height: 28,
        padding: '0 11px',
        borderRadius: 7,
        border: '1px solid ' + HAIR,
        background: active ? 'rgba(127,127,127,.16)' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        opacity: active ? 1 : 0.85,
        whiteSpace: 'nowrap',
      };
    }

    function bar(value) {
      const v = Math.max(0, Math.min(100, value || 0));
      return h('span', {
        style: {
          position: 'relative',
          display: 'inline-block',
          width: BAR_W,
          height: BAR_H,
          borderRadius: 3,
          background: 'rgba(0,0,0,.38)',
          overflow: 'hidden',
          verticalAlign: 'middle',
        },
      }, h('span', {
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: v + '%',
          borderRadius: 3,
          background: 'currentColor',
        },
      }));
    }

    // 温度是偏移量，不是绝对数。条以中间为基准，往右偏热，往左偏凉。
    function tempBar(t) {
      const v = Math.max(-1.2, Math.min(1.2, t || 0));
      const pct = (Math.abs(v) / 1.2) * 50;
      const left = v >= 0 ? 50 : 50 - pct;
      return h('span', {
        style: {
          position: 'relative',
          display: 'inline-block',
          width: BAR_W,
          height: BAR_H,
          borderRadius: 3,
          background: 'rgba(0,0,0,.38)',
          overflow: 'hidden',
          verticalAlign: 'middle',
        },
      }, [
        h('span', {
          key: 'mid',
          style: {
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 1,
            background: 'currentColor',
            opacity: 0.84,
          },
        }),
        h('span', {
          key: 'fill',
          style: {
            position: 'absolute',
            left: left + '%',
            top: 0,
            bottom: 0,
            width: pct + '%',
            borderRadius: 3,
            background: 'currentColor',
          },
        }),
      ]);
    }

    /* 两秒半拿不到就断，别让面板一直等着。 */
    function fetchShort(url, init) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var opts = { cache: 'no-store' };
      if (init) for (var k in init) opts[k] = init[k];
      if (ctrl) opts.signal = ctrl.signal;
      var timer = 0;
      if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 2500);
      var p = fetch(url, opts);
      return p.then(
        function (r) { clearTimeout(timer); return r; },
        function (e) { clearTimeout(timer); throw e; }
      );
    }

    function post(payload) {
      return fetchShort(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      });
    }

    function num(v, signed) {
      if (signed) {
        if (!v) return '—';
        return (v > 0 ? '+' : '') + v.toFixed(1) + '°';
      }
      return String(Math.round(v || 0));
    }

    // ---------------------------------------------------------------- 面板

    function BodyPanel() {
      const [state, setState] = React.useState(null);
      const [down, setDown] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [tab, setTab] = React.useState('dims');

      const pull = React.useCallback(function () {
        return fetchShort(ENDPOINT)
          .then(function (res) {
            if (!res.ok) throw new Error('status ' + res.status);
            return res.json();
          })
          .then(function (data) {
            setState(data);
            setDown(false);
          })
          .catch(function () { setDown(true); });
      }, []);

      React.useEffect(function () {
        let live = true;
        let timer = 0;
        const tick = function () {
          if (!live) return;
          fetchShort(ENDPOINT)
            .then(function (res) {
              if (!res.ok) throw new Error('status ' + res.status);
              return res.json();
            })
            .then(function (data) {
              if (!live) return;
              setState(data);
              setDown(false);
            })
            .catch(function () { if (live) setDown(true); });
        };
        tick();
        timer = setInterval(tick, POLL_MS);
        return function () { live = false; clearInterval(timer); };
      }, []);

      const send = function (payload) {
        setBusy(true);
        return post(payload)
          .then(function () { return pull(); })
          .catch(function () {})
          .then(function () { setBusy(false); });
      };

      if (down) {
        return h('div', { style: PAGE }, h('div', { style: INNER },
          h('div', { style: { opacity: 0.82 } }, '身体时钟没接上。')));
      }
      if (!state) {
        return h('div', { style: PAGE }, h('div', { style: INNER },
          h('div', { style: { opacity: 0.76 } }, '…')));
      }

      const on = state.enabled !== false;
      const zones = state.zones || [];
      const dims = state.dims || {};

      const head = h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 20,
          flexWrap: 'wrap',
        },
      }, [
        h('span', { key: 't', style: { fontSize: 17, fontWeight: 600, marginRight: 6 } }, '身体时钟'),
        h('button', {
          key: 'sw',
          type: 'button',
          style: btn(on),
          disabled: busy,
          onClick: function () { send({ action: 'enabled', enabled: !on }); },
        }, h('span', {
          style: {
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: 4,
            marginRight: 6,
            verticalAlign: 'middle',
            background: 'currentColor',
            opacity: on ? 1 : 0.72,
          },
        }), on ? '开着' : '关着'),
        h('span', { key: 'sp', style: { flex: 1 } }),
        h('button', {
          key: 'rs',
          type: 'button',
          style: btn(false),
          disabled: busy,
          onClick: function () { send({ action: 'reset' }); },
        }, '清零'),
      ]);

      /* 常驻行：欲望、场、距离，加最近动过的两格。 */
      const recent = zones
        .filter(function (z) { return z.quietSec !== null && z.quietSec !== undefined; })
        .sort(function (a, b) { return a.quietSec - b.quietSec; })
        .slice(0, 2);

      const gauge = h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          marginBottom: 10,
          border: '1px solid ' + HAIR,
          borderRadius: 10,
          opacity: on ? 1 : 0.72,
          flexWrap: 'wrap',
        },
      }, [
        h('span', { key: 'l', style: { opacity: 0.8, fontSize: 13 } }, '欲望'),
        h('span', {
          key: 'n',
          style: { fontVariantNumeric: 'tabular-nums', fontSize: 19, fontWeight: 600, minWidth: 30 },
        }, String(state.libido)),
        bar(state.libido),
        h('span', { key: 'sp', style: { flex: 1 } }),
        h('span', {
          key: 'sc',
          style: { opacity: (state.scene && state.scene !== '平静') ? 0.9 : 0.62, fontSize: 13 },
        }, '场 ' + (state.scene || '平静')),
        h('span', { key: 'd', style: { opacity: 0.66, fontSize: 13 } },
          '距 ' + (state.distance || '隐没')),
      ]);

      const recentLine = h('div', {
        key: 'rl',
        style: { fontSize: 12.5, opacity: 0.78, lineHeight: '1.9', marginBottom: 16 },
      }, recent.length
        ? '最近 ' + recent.map(function (z) {
          return z.name + ' 压' + z.press + ' 红' + z.flush;
        }).join('　')
        : '哪里都没动过');

      const gaugeNote = h('div', {
        key: 'gn',
        style: { fontSize: 12, opacity: 0.62, lineHeight: '1.9', marginTop: 0, marginBottom: 16 },
      }, '今天还能涨 ' + (state.gainLeft ?? '—') + '　离顶还剩 ' + (state.toCap ?? '—')
        + '　' + (state.atFloor ? '已经掉到底了' : '没到底'));

      /* 一行三样：名字、数、一条。 */
      function row(name, valueText, fill, mid, key) {
        let inner;
        if (mid) {
          const v = Math.max(-1, Math.min(1, Number(fill) || 0));
          const w = Math.abs(v) * 50;
          inner = [
            h('span', { key: 'z', style: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: '1px', background: 'rgba(127,127,127,.42)' } }),
            h('span', {
              key: 'f',
              style: Object.assign(
                { position: 'absolute', top: 0, bottom: 0, width: w + '%', background: 'currentColor', opacity: 0.84 },
                v >= 0 ? { left: '50%' } : { right: '50%' },
              ),
            }),
          ];
        } else {
          const v = Math.max(0, Math.min(100, Number(fill) || 0));
          inner = [h('span', { key: 'f', style: { position: 'absolute', top: 0, bottom: 0, left: 0, width: v + '%', background: 'currentColor', opacity: 0.84 } })];
        }
        return h('div', {
          key: key || name,
          style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' },
        }, [
          h('span', { key: 'n', style: { width: 72, fontSize: 14, opacity: 0.76, whiteSpace: 'nowrap', flexShrink: 0 } }, name),
          h('span', { key: 'v', style: { width: 44, fontSize: 14, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.95, flexShrink: 0 } }, valueText),
          h('span', { key: 'b', style: { width: BAR_W, position: 'relative', height: BAR_H, borderRadius: 3, background: 'rgba(0,0,0,.38)', overflow: 'hidden' } }, inner),
        ]);
      }

      const order = ['亲密', '信任', '警觉', '疲惫', '自制', '敏感', '羞', '放松'];
      const dimRows = order.map(function (k) {
        const v = Number(dims[k]) || 0;
        return row(k, String(Math.round(v)), v, false, 'dim-' + k);
      });

      const header = h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 2px 7px',
          fontSize: 12,
          opacity: 0.66,
          borderBottom: '1px solid ' + HAIR,
        },
      }, [
        h('span', { key: 'n', style: { width: 82, flex: '0 0 auto' } }, ''),
        h('span', { key: 'a', style: { width: GROUP_W, paddingLeft: 19, boxSizing: 'border-box' } }, '压'),
        h('span', { key: 'b', style: { width: GROUP_W, paddingLeft: 19, boxSizing: 'border-box' } }, '红'),
        h('span', { key: 'c', style: { width: GROUP_W, paddingLeft: 19, boxSizing: 'border-box' } }, '温'),
      ]);

      const rows = zones.map(function (z) {
        const mark = z.quietSec !== null && z.quietSec <= 30;
        return h('div', {
          key: z.id,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 2px',
            borderBottom: '1px solid ' + HAIR,
            opacity: on ? 1 : 0.72,
          },
        }, [
          h('span', {
            key: 'n',
            style: {
              width: 82,
              flex: '0 0 auto',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: 0.95,
            },
          }, z.name + (mark ? ' ·' : '')),
          h('span', { key: 'b1', style: { display: 'inline-flex', alignItems: 'center', gap: 5, width: GROUP_W } }, [
            h('span', { key: 'l', style: { fontSize: 12, opacity: 0.88, width: 14 } }, '压'),
            bar(z.press),
            h('span', {
              key: 'v',
              style: { fontSize: 12, fontVariantNumeric: 'tabular-nums', width: VALUE_W, textAlign: 'right', opacity: 0.88 },
            }, num(z.press)),
          ]),
          h('span', { key: 'b2', style: { display: 'inline-flex', alignItems: 'center', gap: 5, width: GROUP_W } }, [
            h('span', { key: 'l', style: { fontSize: 12, opacity: 0.88, width: 14 } }, '红'),
            bar(z.flush),
            h('span', {
              key: 'v',
              style: { fontSize: 12, fontVariantNumeric: 'tabular-nums', width: VALUE_W, textAlign: 'right', opacity: 0.88 },
            }, num(z.flush)),
          ]),
          h('span', { key: 'b3', style: { display: 'inline-flex', alignItems: 'center', gap: 5, width: GROUP_W } }, [
            h('span', { key: 'l', style: { fontSize: 12, opacity: 0.88, width: 14 } }, '温'),
            tempBar(z.temp),
            h('span', {
              key: 'v',
              style: {
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
                width: VALUE_W,
                textAlign: 'right',
                opacity: Math.abs(z.temp) > 0.05 ? 0.95 : 0.6,
              },
            }, ((state.baseTemp || 37) + (z.temp || 0)).toFixed(1) + '°'),
          ]),
        ]);
      });

      const tabs = h('div', { style: { display: 'flex', gap: 8, marginBottom: 18 } }, [
        h('button', {
          key: 'd', type: 'button', style: btn(tab === 'dims'),
          onClick: function () { setTab('dims'); },
        }, '八维'),
        h('button', {
          key: 'z', type: 'button', style: btn(tab === 'zones'),
          onClick: function () { setTab('zones'); },
        }, '十二格'),
      ]);

      const foot = h('div', {
        style: { marginTop: 18, fontSize: 12, opacity: 0.66, lineHeight: '20px' },
      }, tab === 'zones'
        ? '压＝按下去的印子退没退　红＝红晕　温＝此刻的温度。跟着秒、分、小时自己走，不用手动。'
        : '八维是底色，按天走；欲望是总闸，推着敏感和场往前走。数只是刻度，不用手动改。');

      /* 情绪只报一句，放在八维页顶上，不另开一页。 */
      const moodBits = (function () {
        const em = state.emotion || {};
        const live = (em.live || []).slice(0, 2);
        if (!live.length) return '情绪 无';
        return '情绪 ' + live.map(function (c) { return c.label + ' ' + c.value; }).join('　')
          + '　最狠 ' + (em.fierce || 0);
      })();

      const moodLine = h('div', {
        key: 'mo',
        style: { fontSize: 12.5, opacity: 0.72, marginBottom: 10 },
      }, moodBits);

      const bodyView = tab === 'dims'
        ? [moodLine].concat(dimRows)
        : [header].concat(rows);

      return h('div', { style: PAGE }, h('div', { style: INNER },
        [head, gauge, recentLine, tabs]
          .concat(bodyView)
          .concat([gaugeNote, foot])));
    }

    // ---------------------------------------------------------------- 图标

    function BodyIcon(props) {
      const size = (props && props.size) || 18;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, [
        h('path', { key: 'a', d: 'M8.6 21c-.4-4 1.3-6.6 3.9-8.4C15.3 10.6 17.4 8.4 17.6 5' }),
        h('path', { key: 'b', d: 'M17.6 5c1.4.5 2.5 1.7 3 3.1' }),
        h('path', { key: 'c', d: 'M17.6 5c-.9.8-1.5 1.9-1.7 3.1' }),
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 左边栏那一排：插件(0) · 记忆(5) · 身体(7) · 自动化任务(10) · 更多
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL,
          inject: () => ({}),
        }, BodyPanel));

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL,
          order: 7,
          label: () => '身体时钟',
        }, BodyIcon));
      },
    };
  },
});