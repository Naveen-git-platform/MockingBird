/* Progress view: stats, per-type averages, trend, saved interviews. */
(function () {
  const MB = window.MB;
  const { el } = MB;
  const SVG = 'http://www.w3.org/2000/svg';

  const MODE_LABELS = { dsa: 'Algorithms', 'system-design': 'System design', behavioral: 'Behavioral', sql: 'SQL' };

  function sparkline(points) {
    const w = 300;
    const h = 70;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Score trend');
    if (points.length === 0) return svg;
    const x = (i) => (points.length === 1 ? w / 2 : 8 + (i * (w - 16)) / (points.length - 1));
    const y = (v) => h - 8 - (v / 10) * (h - 16);
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.averageScore).toFixed(1)}`).join(' '));
    svg.append(path);
    points.forEach((p, i) => {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('cx', x(i).toFixed(1));
      c.setAttribute('cy', y(p.averageScore).toFixed(1));
      c.setAttribute('r', '3.5');
      svg.append(c);
    });
    return svg;
  }

  function sessionDetail(snap, onDelete) {
    const r = snap.report || {};
    return el(
      'div',
      { class: 'card' },
      el('div', { class: 'view-head' }, el('h2', { text: `${MODE_LABELS[snap.mode] || snap.mode} interview` }), el('div', { class: 'row' },
        el('button', { class: 'btn', type: 'button', text: 'Export', onclick: async () => { const res = await MB.call('history:export', snap.id); if (res && res.path) MB.toast('Report saved', 'good'); } }),
        el('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: onDelete }))),
      el('p', { class: 'sub', text: `${MB.formatDate(snap.finishedAt)} · average ${r.averageScore == null ? 'n/a' : `${r.averageScore}/10`}` }),
      r.summary ? el('p', { text: r.summary }) : null,
      ...snap.questions.map((q) =>
        el('div', { class: 'row' }, q.evaluation ? el('span', { class: `badge ${q.evaluation.score >= 5 ? 'good' : 'bad'}`, text: `${q.evaluation.score}/10` }) : el('span', { class: 'badge', text: 'skipped' }), el('span', { class: 'grow', text: q.text.split('\n')[0].slice(0, 140) }))
      )
    );
  }

  MB.views.history = {
    async mount(host) {
      const root = el('section', { class: 'view' });
      host.append(root);

      async function load() {
        const [stats, sessions] = await Promise.all([MB.call('history:stats'), MB.call('history:list')]);
        root.replaceChildren();
        root.append(el('div', { class: 'view-head' }, el('div', {}, el('h1', { text: 'Progress' }), el('p', { class: 'sub', text: 'Finished mock interviews are saved on this computer.' }))));
        if (!stats || !sessions) return root.append(el('div', { class: 'card', text: 'History is not available.' }));
        if (stats.sessions === 0) {
          return root.append(el('div', { class: 'empty' }, el('h2', { text: 'No interviews yet' }), el('p', { text: 'Finish a mock interview and your scores, trend and streak will show up here.' }), el('button', { class: 'btn primary', type: 'button', text: 'Start a mock interview', onclick: () => MB.show('interview') })));
        }

        root.append(
          el(
            'div',
            { class: 'stats' },
            el('div', { class: 'stat' }, el('b', { text: String(stats.sessions) }), el('span', { text: 'Interviews' })),
            el('div', { class: 'stat' }, el('b', { text: stats.overallAverage == null ? '—' : `${stats.overallAverage}/10` }), el('span', { text: 'Average score' })),
            el('div', { class: 'stat' }, el('b', { text: `${stats.streakDays} day${stats.streakDays === 1 ? '' : 's'}` }), el('span', { text: 'Practice streak' })),
            el('div', { class: 'stat' }, el('b', { text: stats.improvement == null ? '—' : `${stats.improvement > 0 ? '+' : ''}${stats.improvement}` }), el('span', { text: 'Recent improvement' }))
          )
        );

        const bars = el('div', { class: 'bars' });
        for (const [mode, m] of Object.entries(stats.byMode)) {
          const fill = el('i');
          fill.style.width = `${((m.averageScore || 0) / 10) * 100}%`;
          bars.append(el('div', { class: 'bar' }, el('span', { text: `${MODE_LABELS[mode] || mode} (${m.sessions})` }), el('div', { class: 'track' }, fill), el('span', { text: m.averageScore == null ? '—' : String(m.averageScore) })));
        }
        root.append(el('div', { class: 'card' }, el('h3', { text: 'Score trend' }), sparkline(stats.trend), el('h3', { text: 'By interview type' }), bars));

        const detail = el('div');
        const items = el('div', { class: 'list' });
        for (const s of sessions) {
          items.append(
            el(
              'div',
              {
                class: 'list-item',
                role: 'button',
                tabindex: 0,
                onclick: async () => {
                  const snap = await MB.call('history:get', s.id);
                  if (!snap) return;
                  detail.replaceChildren(sessionDetail(snap, async () => {
                    if (!MB.confirm('Delete this interview from your history?')) return;
                    await MB.call('history:delete', s.id);
                    load();
                  }));
                  detail.scrollIntoView({ block: 'nearest' });
                },
              },
              el('span', { class: 'badge', text: MODE_LABELS[s.mode] || s.mode }),
              el('span', { class: 'grow', text: `${MB.formatDate(s.finishedAt)}${s.role ? ` · ${s.role}` : ''}` }),
              el('span', { text: s.averageScore == null ? '—' : `${s.averageScore}/10` })
            )
          );
        }
        root.append(
          el('div', { class: 'card' }, el('div', { class: 'view-head' }, el('h3', { text: 'Past interviews' }), el('button', {
            class: 'btn danger', type: 'button', text: 'Clear all',
            onclick: async () => {
              if (!MB.confirm(`Delete all ${sessions.length} saved interviews? This cannot be undone.`)) return;
              await MB.call('history:clear');
              load();
            },
          })), items),
          detail
        );
      }
      await load();
    },
  };
})();
