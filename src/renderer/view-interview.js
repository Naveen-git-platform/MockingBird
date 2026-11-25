/* Mock interview view: setup form, question/answer loop with hints, feedback, and the final report. */
(function () {
  const MB = window.MB;
  const { el } = MB;

  const list = (items) => el('ul', {}, items.map((t) => el('li', { text: t })));

  MB.views.interview = {
    unsub: null,
    composer: null,
    async mount(host) {
      const self = this;
      const options = (await MB.call('interview:options')) || { modes: [], difficulties: [], languages: [], questionCount: { min: 1, max: 20 } };
      const defaults = (await MB.call('config:get', 'interview')) || {};
      const practiceDefaults = (await MB.call('config:get', 'practice')) || {};
      let snapshot = await MB.call('interview:state');
      let lastEvaluation = null;
      let liveText = '';
      let liveTarget = null;

      const root = el('section', { class: 'view' });
      host.append(root);

      const paintLive = MB.frameThrottle(() => {
        if (liveTarget) liveTarget.innerHTML = MB.md(liveText);
      });
      this.unsub = MB.api.on('interview:delta', ({ text }) => {
        liveText += text;
        paintLive();
      });

      const withStream = async (target, fn) => {
        liveText = '';
        liveTarget = target;
        try {
          return await fn();
        } finally {
          liveTarget = null;
        }
      };

      function render() {
        if (self.composer) {
          self.composer.destroy();
          self.composer = null;
        }
        root.replaceChildren();
        if (!snapshot) return renderSetup();
        if (snapshot.status === 'finished') return renderReport();
        return renderActive();
      }
      const rerender = render;

      // ----- setup -----
      function renderSetup() {
        const f = {
          mode: options.modes[0]?.id || 'dsa',
          language: practiceDefaults.language || 'python',
          difficulty: defaults.difficulty || 'medium',
          role: defaults.role || '',
          questionCount: defaults.questionCount || 5,
        };
        const langField = MB.field('Language', MB.select(options.languages, f.language, (v) => (f.language = v)));
        const modeSel = MB.select(options.modes, f.mode, (v) => {
          f.mode = v;
          langField.hidden = !options.modes.find((m) => m.id === v).needsLanguage;
        });
        langField.hidden = !options.modes.find((m) => m.id === f.mode)?.needsLanguage;
        const role = el('input', { type: 'text', placeholder: 'e.g. Backend engineer (optional)', value: f.role, maxlength: 120 });
        const count = el('input', { type: 'number', min: options.questionCount.min, max: options.questionCount.max, value: f.questionCount });
        const start = el('button', { class: 'btn primary', type: 'button', text: 'Start interview' });
        start.addEventListener('click', async () => {
          start.disabled = true;
          start.textContent = 'Preparing your first question…';
          const body = {
            mode: f.mode,
            language: f.language,
            difficulty: f.difficulty,
            role: role.value,
            questionCount: Number(count.value),
          };
          snapshot = await MB.call('interview:start', body);
          lastEvaluation = null;
          rerender();
        });

        root.append(
          el('div', { class: 'view-head' }, el('div', {}, el('h1', { text: 'Mock interview' }), el('p', { class: 'sub', text: 'A realistic interview: questions, scored feedback, hints when you are stuck.' }))),
          el(
            'div',
            { class: 'card' },
            el(
              'div',
              { class: 'row' },
              MB.field('Interview type', modeSel),
              langField,
              MB.field('Difficulty', MB.select(options.difficulties.map((d) => ({ id: d, label: d[0].toUpperCase() + d.slice(1) })), f.difficulty, (v) => (f.difficulty = v))),
              MB.field('Questions', count)
            ),
            el('div', { class: 'row' }, el('div', { class: 'field grow' }, el('span', { text: 'Target role' }), role)),
            el('div', { class: 'row' }, start)
          )
        );
      }

      // ----- active -----
      function renderActive() {
        const q = snapshot.questions[snapshot.questions.length - 1];
        const total = snapshot.questionCount;
        const evaluated = snapshot.status === 'evaluated';

        const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': q.index + (evaluated ? 1 : 0) }, el('i'));
        bar.firstChild.style.width = `${((q.index + (evaluated ? 1 : 0)) / total) * 100}%`;

        const questionBody = el('div', { html: MB.md(q.text) });
        const hintsBox = el('div', { class: 'chat' }, q.hints.map((h, i) => el('div', { class: 'hint' }, el('b', { text: `Hint ${i + 1}: ` }), el('span', { html: MB.md(h) }))));

        const head = el(
          'div',
          { class: 'view-head' },
          el('div', {}, el('h1', { text: `Question ${q.index + 1} of ${total}` }), el('p', { class: 'sub', text: `${snapshot.mode} · ${snapshot.difficulty}${snapshot.language ? ` · ${snapshot.language}` : ''}` })),
          el('button', {
            class: 'btn danger',
            type: 'button',
            text: 'End interview',
            onclick: async () => {
              if (!MB.confirm('End the interview now and see your report?')) return;
              snapshot = await MB.call('interview:finish');
              rerender();
            },
          })
        );
        root.append(head, bar, el('div', { class: 'card' }, questionBody), hintsBox);

        if (!evaluated) {
          const hintsLeft = 3 - q.hints.length;
          const hintBtn = el('button', { class: 'btn', type: 'button', text: `Get a hint (${hintsLeft} left)`, disabled: hintsLeft <= 0 });
          hintBtn.addEventListener('click', async () => {
            hintBtn.disabled = true;
            const holder = el('div', { class: 'hint' }, el('b', { text: `Hint ${q.hints.length + 1}: ` }), el('span', { class: 'typing', text: 'thinking…' }));
            hintsBox.append(holder);
            const target = holder.querySelector('span');
            const res = await withStream(target, () => MB.call('interview:hint'));
            if (res) snapshot = res.state;
            rerender();
          });
          const skip = el('button', {
            class: 'btn',
            type: 'button',
            text: 'Skip',
            onclick: async () => {
              snapshot = (await MB.call('interview:skip')) || snapshot;
              lastEvaluation = null;
              rerender();
            },
          });
          const composer = MB.composer({
            placeholder: 'Type or speak your answer. You can attach a screenshot of your code too.',
            submitLabel: 'Submit answer',
            onSubmit: async ({ text, images }) => {
              const res = await MB.call('interview:answer', { text, images });
              if (!res) return false;
              snapshot = res.state;
              lastEvaluation = res.evaluation;
              rerender();
              return undefined;
            },
          });
          self.composer = composer;
          root.append(el('div', { class: 'row' }, hintBtn, skip), composer.el);
          composer.focus();
          return;
        }

        // evaluated or skipped
        if (q.skipped) {
          root.append(el('div', { class: 'card' }, el('p', { class: 'sub', text: 'Skipped.' })));
        } else {
          const e = lastEvaluation || q.evaluation;
          root.append(
            el(
              'div',
              { class: 'card' },
              el('div', { class: 'row' }, el('div', { class: `score ${MB.scoreClass(e.score)}`, text: String(e.score) }), el('div', { class: 'grow' }, el('h3', { text: 'Feedback' }), el('p', { text: e.summary }))),
              el('div', { class: 'feedback' }, el('div', {}, el('h4', { text: 'What went well' }), e.strengths.length ? list(e.strengths) : el('p', { class: 'sub', text: '—' })), el('div', {}, el('h4', { text: 'To improve' }), e.improvements.length ? list(e.improvements) : el('p', { class: 'sub', text: '—' }))),
              e.followUp ? el('p', {}, el('b', { text: 'Follow-up an interviewer might ask: ' }), e.followUp) : null
            )
          );
        }
        const next = el('button', { class: 'btn primary', type: 'button', text: snapshot.hasNext ? 'Next question' : 'Finish and see report' });
        next.addEventListener('click', async () => {
          next.disabled = true;
          if (snapshot.hasNext) {
            const holder = el('div', { class: 'card' }, el('span', { class: 'typing', text: 'Preparing the next question…' }));
            root.append(holder);
            snapshot = (await withStream(holder, () => MB.call('interview:next'))) || snapshot;
            lastEvaluation = null;
          } else {
            next.textContent = 'Writing your report…';
            snapshot = (await MB.call('interview:finish')) || snapshot;
          }
          rerender();
        });
        root.append(el('div', { class: 'row' }, next));
      }

      // ----- report -----
      function renderReport() {
        const r = snapshot.report;
        const avg = r.averageScore;
        root.append(
          el('div', { class: 'view-head' }, el('div', {}, el('h1', { text: 'Interview report' }), el('p', { class: 'sub', text: `${snapshot.mode} · ${snapshot.difficulty}` }))),
          el(
            'div',
            { class: 'stats' },
            el('div', { class: 'stat' }, el('b', { text: avg == null ? '—' : `${avg}/10` }), el('span', { text: 'Average score' })),
            el('div', { class: 'stat' }, el('b', { text: `${r.questionsAnswered}/${r.questionsAsked}` }), el('span', { text: 'Answered' })),
            el('div', { class: 'stat' }, el('b', { text: String(r.hintsUsed) }), el('span', { text: 'Hints used' })),
            el('div', { class: 'stat' }, el('b', { text: String(r.questionsSkipped) }), el('span', { text: 'Skipped' }))
          ),
          el('div', { class: 'card' }, el('h3', { text: 'Summary' }), el('p', { text: r.summary }), r.focusAreas.length ? el('div', {}, el('h4', { text: 'Practise next' }), list(r.focusAreas)) : null),
          ...snapshot.questions.map((q) =>
            el(
              'div',
              { class: 'card' },
              el('div', { class: 'row' }, q.evaluation ? el('div', { class: `score ${MB.scoreClass(q.evaluation.score)}`, text: String(q.evaluation.score) }) : el('span', { class: 'badge', text: 'skipped' }), el('h3', { class: 'grow', text: `Question ${q.index + 1}` })),
              el('div', { html: MB.md(q.text) }),
              q.evaluation ? el('p', { class: 'sub', text: q.evaluation.summary }) : null
            )
          ),
          el(
            'div',
            { class: 'row' },
            el('button', {
              class: 'btn primary',
              type: 'button',
              text: 'New interview',
              onclick: async () => {
                await MB.call('interview:discard');
                snapshot = null;
                rerender();
              },
            }),
            el('button', {
              class: 'btn',
              type: 'button',
              text: 'Export report',
              onclick: async () => {
                const res = await MB.call('history:export', snapshot.id);
                if (res && res.path) MB.toast('Report saved', 'good');
              },
            }),
            el('button', { class: 'btn', type: 'button', text: 'View progress', onclick: () => MB.show('history') })
          )
        );
      }

      rerender();
    },
    unmount() {
      if (this.unsub) this.unsub();
      if (this.composer) this.composer.destroy();
      this.unsub = null;
      this.composer = null;
    },
  };
})();
