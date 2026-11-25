/* Reusable UI pieces: voice control, screen-capture picker with crop, and the composer. */
(function () {
  const { el } = window.MB;
  const MB = window.MB;

  const ICONS = {
    mic: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    clip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>',
  };
  const icon = (name, label) => el('span', { class: 'ico', html: ICONS[name] }, label);

  // ---------- voice ----------
  const voice = (MB.voice = {
    running: false,
    onText: null,
    listeners: new Set(),
    _wired: false,
    _wire() {
      if (this._wired) return;
      this._wired = true;
      MB.api.on('voice:transcript', (t) => voice.onText && voice.onText(t.text));
      MB.api.on('voice:error', (e) => MB.toast(`Voice: ${e.message}`, 'error'));
    },
    _emit() {
      this.listeners.forEach((fn) => fn(this.running));
    },
    async start(onText) {
      this._wire();
      if (this.running) return;
      const mode = MB.prefs.get('voiceMode', 'vad');
      const source = MB.prefs.get('voiceSource', 'mic');
      this.onText = onText;
      try {
        await MB.api.invoke('voice:start', { mode });
        await window.AudioCapture.start(source);
        this.running = true;
      } catch (err) {
        await window.AudioCapture.stop().catch(() => {});
        await MB.api.invoke('voice:stop').catch(() => {});
        MB.toast(MB.cleanError(err), 'error');
      }
      this._emit();
    },
    async stop() {
      if (!this.running) return;
      this.running = false;
      this._emit();
      await window.AudioCapture.stop().catch(() => {});
      await MB.call('voice:stop');
    },
  });

  // ---------- capture picker ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load the captured image'));
      img.src = src;
    });
  }

  /** Let the user drag a rectangle over an image. Resolves to a data URL or null. */
  function cropStage(dataUrl) {
    return new Promise(async (resolve) => {
      let img;
      try {
        img = await loadImage(dataUrl);
      } catch (err) {
        MB.toast(err.message, 'error');
        return resolve(null);
      }
      const canvas = el('canvas', { width: img.naturalWidth, height: img.naturalHeight });
      const ctx = canvas.getContext('2d');
      let sel = null;
      let start = null;

      const draw = () => {
        ctx.drawImage(img, 0, 0);
        if (!sel) return;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sel.x, sel.y, sel.w, sel.h, sel.x, sel.y, sel.w, sel.h);
        ctx.strokeStyle = '#7c9cff';
        ctx.lineWidth = Math.max(2, canvas.width / 600);
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      };
      const point = (e) => {
        const r = canvas.getBoundingClientRect();
        const k = canvas.width / r.width;
        return { x: Math.max(0, Math.min(canvas.width, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(canvas.height, (e.clientY - r.top) * k)) };
      };
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        start = point(e);
        sel = null;
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!start) return;
        const p = point(e);
        sel = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        draw();
      });
      canvas.addEventListener('pointerup', () => {
        start = null;
        if (sel && (sel.w < 8 || sel.h < 8)) {
          sel = null;
          draw();
        }
        useBtn.textContent = sel ? 'Use selection' : 'Use full image';
      });

      const finish = (value) => {
        back.remove();
        resolve(value);
      };
      const useBtn = el('button', {
        class: 'btn primary',
        type: 'button',
        text: 'Use full image',
        onclick: () => {
          if (!sel) return finish(dataUrl);
          const out = el('canvas', { width: Math.round(sel.w), height: Math.round(sel.h) });
          out.getContext('2d').drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, out.width, out.height);
          finish(out.toDataURL('image/png'));
        },
      });
      const back = el(
        'div',
        { class: 'modal-back' },
        el(
          'div',
          { class: 'modal', role: 'dialog', 'aria-label': 'Crop capture' },
          el('h3', { text: 'Drag to select the part you want (optional)' }),
          el('div', { class: 'stage' }, canvas),
          el('div', { class: 'row' }, useBtn, el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => finish(null) }))
        )
      );
      document.body.append(back);
      draw();
    });
  }

  /** Pick a screen or window, optionally crop it, and resolve to a data URL (or null). */
  MB.captureImage = function captureImage() {
    return new Promise(async (resolve) => {
      const sources = await MB.call('capture:sources');
      if (!sources) return resolve(null);
      const close = (v) => {
        back.remove();
        resolve(v);
      };
      const grid = el('div', { class: 'sources' });
      for (const s of sources) {
        grid.append(
          el(
            'button',
            {
              class: 'source',
              type: 'button',
              onclick: async () => {
                back.style.display = 'none';
                const full = await MB.call('capture:source', s.id);
                back.remove();
                if (!full) return resolve(null);
                resolve(await cropStage(full));
              },
            },
            el('img', { src: s.preview, alt: s.name }),
            el('span', { text: `${s.kind === 'screen' ? 'Screen' : 'Window'}: ${s.name}` })
          )
        );
      }
      const back = el(
        'div',
        { class: 'modal-back' },
        el(
          'div',
          { class: 'modal', role: 'dialog', 'aria-label': 'Choose what to capture' },
          el('h3', { text: 'What do you want to capture?' }),
          sources.length ? grid : el('p', { class: 'sub', text: 'Nothing available to capture.' }),
          el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => close(null) }))
        )
      );
      document.body.append(back);
    });
  };

  // ---------- composer ----------
  const MAX_IMAGES = 4;

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Text box with image attachments (paste, file, screen capture) and voice input.
   * onSubmit({ text, images: dataUrl[] }) may return a promise; the composer locks while it runs.
   */
  MB.composer = function composer({ placeholder, submitLabel = 'Send', onSubmit, allowEmpty = false }) {
    const images = [];
    const thumbs = el('div', { class: 'thumbs' });
    const textarea = el('textarea', { placeholder, rows: 2, 'aria-label': placeholder });
    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    const send = el('button', { class: 'btn primary', type: 'button', text: submitLabel });
    const mic = el('button', { class: 'btn icon', type: 'button', title: 'Speak your question' }, icon('mic', 'Voice'));
    let busy = false;

    function renderThumbs() {
      thumbs.replaceChildren(
        ...images.map((src, i) =>
          el(
            'div',
            { class: 'thumb' },
            el('img', { src, alt: `Attachment ${i + 1}` }),
            el('button', { type: 'button', 'aria-label': 'Remove image', text: '×', onclick: () => (images.splice(i, 1), renderThumbs()) })
          )
        )
      );
      thumbs.hidden = images.length === 0;
    }

    function addImage(dataUrl) {
      if (!dataUrl) return;
      if (images.length >= MAX_IMAGES) return MB.toast(`At most ${MAX_IMAGES} images`, 'error');
      images.push(dataUrl);
      renderThumbs();
    }

    async function submit() {
      if (busy) return;
      const text = textarea.value.trim();
      if (!text && images.length === 0 && !allowEmpty) return MB.toast('Type a question or attach an image first', 'error');
      if (MB.voice.running) await MB.voice.stop();
      api.setBusy(true);
      try {
        const keep = await onSubmit({ text, images: [...images] });
        if (keep !== false) api.clear();
      } finally {
        api.setBusy(false);
      }
    }

    const syncMic = (running) => {
      mic.classList.toggle('recording', running);
      mic.replaceChildren(icon('mic', running ? 'Stop' : 'Voice'));
    };
    MB.voice.listeners.add(syncMic);

    send.addEventListener('click', submit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    textarea.addEventListener('paste', async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      addImage(await fileToDataUrl(item.getAsFile()).catch(() => null));
    });
    fileInput.addEventListener('change', async () => {
      for (const file of fileInput.files) addImage(await fileToDataUrl(file).catch((err) => (MB.toast(err.message, 'error'), null)));
      fileInput.value = '';
    });
    mic.addEventListener('click', () => {
      if (MB.voice.running) return MB.voice.stop();
      MB.voice.start((text) => {
        textarea.value = `${textarea.value}${textarea.value && !/\s$/.test(textarea.value) ? ' ' : ''}${text}`;
      });
    });

    const tools = el(
      'div',
      { class: 'tools' },
      el('button', { class: 'btn icon', type: 'button', title: 'Attach an image', onclick: () => fileInput.click() }, icon('clip', 'Image')),
      el(
        'button',
        {
          class: 'btn icon',
          type: 'button',
          title: 'Capture a screen or window',
          onclick: async () => addImage(await MB.captureImage()),
        },
        icon('camera', 'Capture')
      ),
      mic,
      el('span', { class: 'grow' }),
      el('span', { class: 'sub', text: 'Ctrl+Enter to send' }),
      send,
      fileInput
    );
    const root = el('div', { class: 'composer' }, el('div', { class: 'box' }, thumbs, textarea, tools));
    renderThumbs();

    const api = {
      el: root,
      textarea,
      focus: () => textarea.focus(),
      clear() {
        textarea.value = '';
        images.length = 0;
        renderThumbs();
      },
      setBusy(value) {
        busy = value;
        send.disabled = value;
        textarea.disabled = value;
      },
      setPlaceholder(text) {
        textarea.placeholder = text;
      },
      destroy() {
        MB.voice.listeners.delete(syncMic);
      },
    };
    return api;
  };
})();
