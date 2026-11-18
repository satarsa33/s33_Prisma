/* S33 - Prisma · interfaccia, MIDI, campioni, salvataggio */
(async function () {
  const S33 = window.S33;
  const $ = (id) => document.getElementById(id);
  const P = S33.PARAMS;

  const engine = new S33.Engine(S33.TRACKS);
  let factory, pool, project;
  const seq = new S33.Sequencer(engine, () => project);

  const ui = {
    track: 0, page: 'SRC', stepPage: 0, selStep: null, heldStep: null, holdFired: false,
    follow: true, playG: -1, octave: 0, rec: false,
    lastNote: [60, 60, 60, 60], keysDown: new Set(), liveVoices: new Map(), recWrites: new Map(),
    hits: [], ledUntil: [0, 0, 0, 0], stopPressedAt: 0,
  };

  /* ---------- utilità ---------- */
  let toastT;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }
  let saveT;
  function dirty() {
    clearTimeout(saveT);
    saveT = setTimeout(() => S33.autosave(project, pool), 900);
  }
  const track = () => project.tracks[ui.track];
  const activeStepIdx = () => (ui.heldStep != null ? ui.heldStep : ui.selStep);
  const activeStep = () => {
    const i = activeStepIdx();
    return i == null ? null : track().steps[i];
  };
  const smpList = (t) => (t.machine === 'multi' ? pool.multis : pool.samples);

  function migrate(p) {
    p.tracks.forEach((t, i) => {
      t.params = Object.assign(S33.defaultParams(), t.params || {});
      t.trig = Object.assign(S33.defaultTrig(), t.trig || {});
      while (t.steps.length < S33.MAX_STEPS) t.steps.push(null);
      t.name = t.name || 'T' + (i + 1);
    });
    p.bpm = p.bpm || 120;
    p.swing = p.swing || 50;
    return p;
  }

  /* ---------- avvio ---------- */
  factory = await S33.buildFactory();
  const saved = await S33.autoload(factory);
  if (saved) {
    project = migrate(saved.project);
    pool = saved.pool;
  } else {
    project = S33.demoProject();
    pool = { samples: factory.samples.slice(), multis: factory.multis.slice() };
  }
  engine.pool = pool;

  /* ---------- valori dei parametri ---------- */
  function paramMax(k) {
    if (k === 'smp') return Math.max(0, smpList(track()).length - 1);
    return P[k].max;
  }
  function getVal(k) {
    const t = track();
    const st = activeStep();
    if (P[k].trig) {
      if (st) return k === 'note' ? st.notes[0] : st[k];
      return t.trig[k];
    }
    if (st && P[k].lock && st.locks[k] !== undefined) return st.locks[k];
    return t.params[k];
  }
  function isLocked(k) {
    const st = activeStep();
    return !!(st && !P[k].trig && st.locks[k] !== undefined);
  }
  function fmtVal(k, v) {
    if (k === 'smp') {
      const e = smpList(track())[v];
      return e ? e.name : '—';
    }
    if (k === 'lrate') return S33.fmtRate(v, getVal('lsync'));
    return P[k].fmt ? P[k].fmt(v) : String(Math.round(v));
  }
  function quant(k, v) {
    const d = P[k];
    v = S33.clamp(v, d.min, paramMax(k));
    return d.step >= 1 ? Math.round(v) : Math.round(v / d.step) * d.step;
  }

  function setVal(k, v, opts = {}) {
    v = quant(k, v);
    const t = track();
    const st = activeStep();
    if (P[k].trig) {
      if (st) {
        if (k === 'note') {
          const d = v - st.notes[0];
          st.notes = st.notes.map((n) => S33.clamp(n + d, 0, 127));
        } else st[k] = v;
      } else t.trig[k] = v;
      renderSteps();
    } else if (st && P[k].lock) {
      if (st.locks[k] === v) return;
      st.locks[k] = v;
      renderSteps();
      renderTabs();
    } else {
      if (t.params[k] === v) return;
      t.params[k] = v;
      if (st && !opts.quiet) toast('Parametro di traccia (non bloccabile)');
      if (k[0] === 'l') engine.updateLfo(ui.track, t.params, project.bpm);
      if (k === 'smp') renderTracks();
    }
    if (k === 'smp') renderPool();
    renderKnobs();
    renderInfo();
    dirty();
  }
  function resetVal(k) {
    const st = activeStep();
    if (st && !P[k].trig && st.locks[k] !== undefined) {
      delete st.locks[k];
      renderSteps();
      renderTabs();
      renderKnobs();
      dirty();
      return;
    }
    if (P[k].trig && k === 'note') return setVal(k, 60);
    setVal(k, k === 'smp' ? 0 : P[k].def, { quiet: true });
  }

  /* ---------- tracce ---------- */
  function renderTracks() {
    const box = $('tracks');
    if (!box.children.length) {
      project.tracks.forEach((_, i) => {
        const el = document.createElement('div');
        el.className = 'track';
        el.innerHTML = `
          <div class="row"><span class="num">T${i + 1}</span><span class="name"></span><span class="led"></span></div>
          <div class="smp"></div>
          <div class="ctl">
            <div class="seg"><button data-m="single">SINGLE</button><button data-m="multi">MULTI</button></div>
            <button class="ms m" title="Mute">M</button><button class="ms s" title="Solo">S</button>
          </div>
          <div class="meter"></div>`;
        el.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button')) return;
          selectTrack(i);
        });
        el.querySelector('.name').addEventListener('dblclick', (e) => {
          const n = e.target;
          n.contentEditable = 'true';
          n.focus();
          document.getSelection().selectAllChildren(n);
          const done = () => {
            n.contentEditable = 'false';
            project.tracks[i].name = (n.textContent.trim() || 'T' + (i + 1)).slice(0, 10).toUpperCase();
            renderTracks();
            dirty();
          };
          n.onblur = done;
          n.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); n.blur(); } ev.stopPropagation(); };
        });
        el.querySelectorAll('.seg button').forEach((b) =>
          b.addEventListener('click', () => {
            const t = project.tracks[i];
            if (t.machine === b.dataset.m) return;
            t.machine = b.dataset.m;
            t.params.smp = 0;
            t.steps.forEach((s) => s && delete s.locks.smp);
            selectTrack(i);
            dirty();
          })
        );
        el.querySelector('.ms.m').addEventListener('click', () => { project.tracks[i].mute = !project.tracks[i].mute; renderTracks(); dirty(); });
        el.querySelector('.ms.s').addEventListener('click', () => { project.tracks[i].solo = !project.tracks[i].solo; renderTracks(); dirty(); });
        box.appendChild(el);
      });
    }
    project.tracks.forEach((t, i) => {
      const el = box.children[i];
      el.classList.toggle('sel', i === ui.track);
      const nm = el.querySelector('.name');
      if (nm.contentEditable !== 'true') nm.textContent = t.name;
      const e = smpList(t)[t.params.smp];
      el.querySelector('.smp').textContent = (t.machine === 'multi' ? '◆ ' : '● ') + (e ? e.name : '—') + '  ·  ' + t.length + ' step';
      el.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === t.machine));
      el.querySelector('.ms.m').classList.toggle('on', t.mute);
      el.querySelector('.ms.s').classList.toggle('on', t.solo);
    });
  }
  function selectTrack(i) {
    ui.track = i;
    ui.selStep = null;
    ui.heldStep = null;
    ui.stepPage = Math.min(ui.stepPage, Math.ceil(track().length / 16) - 1);
    renderAll();
  }

  /* ---------- pagine parametri e manopole ---------- */
  function renderTabs() {
    const box = $('tabs');
    if (!box.children.length) {
      S33.PAGE_NAMES.forEach((n, i) => {
        const b = document.createElement('button');
        b.innerHTML = n + '<span class="lk"></span>';
        b.title = 'Tasto ⇧' + (i + 1);
        b.onclick = () => { ui.page = n; renderTabs(); renderKnobs(); };
        box.appendChild(b);
      });
    }
    const st = activeStep();
    S33.PAGE_NAMES.forEach((n, i) => {
      const b = box.children[i];
      b.classList.toggle('on', n === ui.page);
      b.classList.toggle('haslock', !!(st && S33.PAGES[n].some((k) => k && st.locks[k] !== undefined)));
    });
  }

  const ARC = 270, R = 22, CX = 29, CY = 29;
  function arcPath(a0, a1) {
    const p = (a) => {
      const r = ((a - 90) * Math.PI) / 180;
      return [CX + R * Math.cos(r), CY + R * Math.sin(r)];
    };
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} ${sweep} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }

  const knobEls = [];
  function buildKnobs() {
    const box = $('knobs');
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('div');
      el.className = 'knob';
      el.innerHTML = `<span class="cc">${i + 1}</span>
        <svg viewBox="0 0 58 58"><path class="bg" fill="none" stroke="#2a2e33" stroke-width="5" stroke-linecap="round"/>
        <path class="fg" fill="none" stroke="#ff7a1a" stroke-width="5" stroke-linecap="round"/>
        <circle cx="29" cy="29" r="15" fill="#1d2024" stroke="#33383e"/>
        <line class="ind" x1="29" y1="29" x2="29" y2="17" stroke="#e9e4d8" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="lab"></span><span class="val"></span>`;
      el.querySelector('.bg').setAttribute('d', arcPath(-ARC / 2, ARC / 2));
      attachKnob(el, i);
      knobEls.push(el);
      box.appendChild(el);
    }
  }
  function attachKnob(el, i) {
    let startY, startV, k;
    el.addEventListener('pointerdown', (e) => {
      k = S33.PAGES[ui.page][i];
      if (!k) return;
      el.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startV = getVal(k);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (startY == null || !k) return;
      const range = paramMax(k) - P[k].min;
      const dy = startY - e.clientY;
      let per = range <= 24 ? 1 / 10 : range / 200; // unità per pixel
      if (e.shiftKey) per /= 6;
      setVal(k, startV + dy * per);
    });
    const end = () => { startY = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      const kk = S33.PAGES[ui.page][i];
      if (!kk) return;
      e.preventDefault();
      const range = paramMax(kk) - P[kk].min;
      const inc = range <= 24 ? 1 : P[kk].step < 1 ? range / 100 : Math.max(1, Math.round(range / 64));
      setVal(kk, getVal(kk) + (e.deltaY < 0 ? inc : -inc) * (e.shiftKey ? 0.25 : 1));
    }, { passive: false });
    el.addEventListener('dblclick', () => {
      const kk = S33.PAGES[ui.page][i];
      if (kk) resetVal(kk);
    });
  }
  function renderKnobs() {
    const keys = S33.PAGES[ui.page];
    const st = activeStep();
    keys.forEach((k, i) => {
      const el = knobEls[i];
      el.classList.toggle('empty', !k);
      if (!k) {
        el.querySelector('.lab').textContent = '';
        el.querySelector('.val').textContent = '';
        el.querySelector('.fg').setAttribute('d', '');
        el.querySelector('.ind').setAttribute('transform', 'rotate(-135 29 29)');
        el.classList.remove('locked', 'nolock');
        return;
      }
      const v = getVal(k);
      const mn = P[k].min, mx = paramMax(k);
      const f = mx > mn ? (v - mn) / (mx - mn) : 0;
      const a = -ARC / 2 + f * ARC;
      const a0 = mn < 0 ? -ARC / 2 + ((0 - mn) / (mx - mn)) * ARC : -ARC / 2;
      const fg = el.querySelector('.fg');
      fg.setAttribute('d', Math.abs(a - a0) < 0.5 ? '' : arcPath(Math.min(a0, a), Math.max(a0, a)));
      const locked = isLocked(k);
      fg.setAttribute('stroke', locked ? '#ffd23f' : P[k].trig && st ? '#5fd0c4' : '#ff7a1a');
      el.querySelector('.ind').setAttribute('transform', `rotate(${a} 29 29)`);
      el.querySelector('.lab').textContent = P[k].label;
      let txt = fmtVal(k, v);
      if (k === 'note' && st && st.notes.length > 1) txt += ' +' + (st.notes.length - 1);
      el.querySelector('.val').textContent = txt;
      el.classList.toggle('locked', locked);
      el.classList.toggle('nolock', !!(st && !P[k].trig && !P[k].lock));
    });
  }

  /* ---------- step ---------- */
  const stepEls = [];
  function buildSteps() {
    const box = $('steps');
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('div');
      el.className = 'step';
      el.innerHTML = '<span class="n"></span><span class="cd"></span><span class="nt"></span><span class="vbar"></span>';
      attachStep(el, i);
      stepEls.push(el);
      box.appendChild(el);
    }
  }
  function attachStep(el, i) {
    let holdT = null, down = false;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      const idx = ui.stepPage * 16 + i;
      const t = track();
      if (idx >= t.length) return;
      engine.resume();
      if (e.shiftKey || e.button === 2) {
        if (ui.selStep === idx) ui.selStep = null;
        else {
          if (!t.steps[idx]) t.steps[idx] = S33.newStep(t.trig);
          ui.selStep = idx;
        }
        renderAll();
        dirty();
        return;
      }
      down = true;
      ui.holdFired = false;
      el.setPointerCapture(e.pointerId);
      holdT = setTimeout(() => {
        if (!down) return;
        if (!t.steps[idx]) { t.steps[idx] = S33.newStep(t.trig); dirty(); }
        ui.heldStep = idx;
        ui.holdFired = true;
        renderAll();
      }, 300);
    });
    const up = () => {
      if (!down) return;
      down = false;
      clearTimeout(holdT);
      const idx = ui.stepPage * 16 + i;
      if (ui.holdFired) {
        ui.heldStep = null;
        ui.holdFired = false;
        renderAll();
        return;
      }
      const t = track();
      if (t.steps[idx]) {
        t.steps[idx] = null;
        if (ui.selStep === idx) ui.selStep = null;
      } else {
        t.steps[idx] = S33.newStep(t.trig);
      }
      renderAll();
      dirty();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  function renderSteps() {
    const t = track();
    const sel = activeStepIdx();
    const pos = ui.playG >= 0 && seq.playing ? ui.playG % t.length : -1;
    stepEls.forEach((el, i) => {
      const idx = ui.stepPage * 16 + i;
      const s = idx < t.length ? t.steps[idx] : null;
      el.classList.toggle('out', idx >= t.length);
      el.classList.toggle('on', !!s);
      el.classList.toggle('cond', !!(s && s.cond));
      el.classList.toggle('sel', idx === sel);
      el.classList.toggle('ph', idx === pos);
      el.querySelector('.n').textContent = idx + 1;
      el.querySelector('.cd').textContent = s && s.cond ? S33.COND[s.cond].label : '';
      el.querySelector('.nt').textContent = s
        ? (s.notes.length > 1 ? S33.noteName(s.notes[0]) + ' ×' + s.notes.length : S33.noteName(s.notes[0])) + (s.micro ? ' ' + (s.micro > 0 ? '›' : '‹') : '')
        : '';
      el.querySelector('.vbar').style.width = s ? (s.vel / 127) * 100 + '%' : '0';
      let lk = el.querySelector('.lk');
      const has = s && Object.keys(s.locks).length;
      if (has && !lk) { lk = document.createElement('span'); lk.className = 'lk'; el.appendChild(lk); }
      if (!has && lk) lk.remove();
    });
    renderPages();
  }
  function renderPages() {
    const box = $('pages');
    if (!box.children.length) {
      for (let p = 0; p < 4; p++) {
        const b = document.createElement('button');
        b.innerHTML = p + 1 + '<span class="ph"></span>';
        b.onclick = () => {
          if (p * 16 >= track().length) return;
          ui.stepPage = p;
          renderSteps();
        };
        box.appendChild(b);
      }
    }
    const t = track();
    const pos = ui.playG >= 0 && seq.playing ? ui.playG % t.length : -1;
    [...box.children].forEach((b, p) => {
      b.classList.toggle('on', p === ui.stepPage);
      b.classList.toggle('off', p * 16 >= t.length);
      b.classList.toggle('play', pos >= 0 && Math.floor(pos / 16) === p);
    });
    $('trackLen').textContent = t.length;
  }

  /* ---------- pool campioni ---------- */
  function renderPool() {
    const t = track();
    const fill = (ul, list, kind) => {
      ul.innerHTML = '';
      list.forEach((e, i) => {
        const li = document.createElement('li');
        const cur = (kind === 'multi') === (t.machine === 'multi') && getVal('smp') === i;
        li.className = cur ? 'cur' : '';
        const meta = kind === 'multi'
          ? e.zones.length + 'z'
          : S33.noteName(e.root);
        li.innerHTML = `<span class="ix">${i + 1}</span><span class="nm"></span><span class="meta">${meta}</span><span class="aud" title="Ascolta">▶</span>`;
        li.querySelector('.nm').textContent = e.name;
        li.title = kind === 'multi' ? e.zones.map((z) => z.name).join(' ') : e.name;
        li.querySelector('.aud').addEventListener('click', (ev) => { ev.stopPropagation(); audition(kind, i); });
        li.addEventListener('click', () => assignToTrack(kind, i));
        ul.appendChild(li);
      });
    };
    fill($('sampleList'), pool.samples, 'single');
    fill($('multiList'), pool.multis, 'multi');
  }
  function assignToTrack(kind, i) {
    const t = track();
    const st = activeStep();
    if (st) {
      if (t.machine !== kind) return toast('La traccia è ' + t.machine.toUpperCase() + ': scegli dalla lista giusta');
      st.locks.smp = i;
      toast('P-lock sample sullo step ' + (activeStepIdx() + 1));
    } else {
      if (t.machine !== kind) {
        t.machine = kind;
        t.steps.forEach((s) => s && delete s.locks.smp);
      }
      t.params.smp = i;
    }
    renderAll();
    dirty();
  }
  function audition(kind, i) {
    engine.resume();
    const p = Object.assign(S33.defaultParams(), { smp: i, rel: 40 });
    const root = kind === 'multi' ? 60 : pool.samples[i].root;
    engine.play(ui.track, kind, p, root, 110, engine.ctx.currentTime + 0.01, kind === 'multi' ? 1.2 : 2);
  }

  async function decodeFiles(files) {
    const out = [];
    for (const f of files) {
      try {
        const buf = await engine.ctx.decodeAudioData(await f.arrayBuffer());
        out.push({ name: f.name.replace(/\.[a-z0-9]+$/i, ''), file: f.name, buffer: buf });
      } catch (e) {
        toast('Impossibile leggere ' + f.name);
      }
    }
    return out;
  }
  const uid = () => 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function addSamples(files) {
    const dec = await decodeFiles(files);
    if (!dec.length) return;
    const first = pool.samples.length;
    dec.forEach((d) => {
      const n = S33.parseNoteFromName(d.file);
      pool.samples.push({ id: uid(), name: d.name, root: n != null ? n : 60, buffer: d.buffer });
    });
    toast(dec.length + (dec.length > 1 ? ' campioni aggiunti' : ' campione aggiunto'));
    assignToTrackNoLock('single', first);
  }
  async function addMulti(files) {
    const dec = await decodeFiles(files);
    if (!dec.length) return;
    const zones = [];
    let guessed = 0;
    dec.forEach((d) => {
      let root = S33.parseNoteFromName(d.file);
      if (root == null) { root = S33.detectPitch(d.buffer); guessed++; }
      zones.push({ root, name: d.name, buffer: d.buffer });
    });
    // zone senza nota né intonazione riconoscibile: in sequenza cromatica da C3
    let next = 60;
    zones.forEach((z) => { if (z.root == null) z.root = next++; });
    zones.sort((a, b) => a.root - b.root);
    zones.forEach((z) => (z.name = S33.noteName(z.root)));
    const names = dec.map((d) => d.name);
    let prefix = names[0];
    names.forEach((n) => { while (prefix && !n.startsWith(prefix)) prefix = prefix.slice(0, -1); });
    prefix = prefix.replace(/[\s_\-.]+$/, '');
    const name = prefix.length >= 3 ? prefix : names[0];
    pool.multis.push({ id: uid(), name, zones });
    toast('Multicampione "' + name + '": ' + zones.length + ' zone' + (guessed ? ' (' + guessed + ' intonate a orecchio)' : ''));
    assignToTrackNoLock('multi', pool.multis.length - 1);
  }
  function assignToTrackNoLock(kind, i) {
    const keep = ui.selStep;
    ui.selStep = null;
    assignToTrack(kind, i);
    ui.selStep = keep;
    renderAll();
  }

  function setupDrops() {
    let overTarget = null;
    const zones = { dropSamples: $('dropSamples'), dropMulti: $('dropMulti') };
    const clear = () => Object.values(zones).forEach((z) => z.classList.remove('over'));
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      clear();
      overTarget = e.target.closest && e.target.closest('#dropMulti') ? 'multi' : 'single';
      (overTarget === 'multi' ? zones.dropMulti : zones.dropSamples).classList.add('over');
    });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) clear(); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      clear();
      const files = [...e.dataTransfer.files].filter((f) => /audio|\.(wav|aiff?|m4a|mp3|flac|caf)$/i.test(f.type + f.name));
      if (!files.length) {
        const pf = [...e.dataTransfer.files].find((f) => /\.(prisma|json)$/i.test(f.name));
        if (pf) openProjectFile(pf);
        return;
      }
      engine.resume();
      if (e.target.closest && e.target.closest('#dropMulti')) addMulti(files);
      else addSamples(files);
    });
    zones.dropSamples.onclick = () => $('fileSamples').click();
    zones.dropMulti.onclick = () => $('fileMulti').click();
    $('fileSamples').onchange = (e) => { addSamples([...e.target.files]); e.target.value = ''; };
    $('fileMulti').onchange = (e) => { addMulti([...e.target.files]); e.target.value = ''; };
  }

  /* ---------- forma d'onda ---------- */
  const peaksCache = new WeakMap();
  function peaks(buf, w) {
    let c = peaksCache.get(buf);
    if (c && c.w === w) return c.p;
    const d = buf.getChannelData(0);
    const d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d;
    const p = new Float32Array(w * 2);
    const per = d.length / w;
    for (let x = 0; x < w; x++) {
      let mn = 1, mx = -1;
      const a = Math.floor(x * per), b = Math.min(d.length, Math.floor((x + 1) * per));
      const stride = Math.max(1, Math.floor((b - a) / 200));
      for (let i = a; i < b; i += stride) {
        const v = (d[i] + d2[i]) / 2;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      p[x * 2] = mn;
      p[x * 2 + 1] = mx;
    }
    peaksCache.set(buf, { w, p });
    return p;
  }
  function currentEntry() {
    const t = track();
    const smp = getVal('smp');
    if (t.machine === 'multi') {
      const m = pool.multis[smp];
      if (!m) return null;
      const note = ui.lastNote[ui.track];
      let best = m.zones[0];
      m.zones.forEach((z) => { if (Math.abs(z.root - note) < Math.abs(best.root - note)) best = z; });
      return { buffer: best.buffer, label: m.name + ' · zona ' + best.name, multi: m };
    }
    const s = pool.samples[smp];
    return s ? { buffer: s.buffer, label: s.name + ' · root ' + S33.noteName(s.root) } : null;
  }
  function drawWave() {
    const cv = $('wave');
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const e = currentEntry();
    const top = 28, h = H - top - 10, mid = top + h / 2;
    g.strokeStyle = '#14181b';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += W / 16) { g.beginPath(); g.moveTo(x + 0.5, top); g.lineTo(x + 0.5, H - 10); g.stroke(); }
    if (!e) return;
    const st = getVal('start'), en = getVal('end'), loop = getVal('loop'), rev = getVal('rev');
    const p = peaks(e.buffer, Math.max(1, Math.floor(W)));
    const xs = st * W, xe = Math.max(xs + 1, en * W);
    for (let x = 0; x < W; x++) {
      const inside = x >= xs && x <= xe;
      g.fillStyle = inside ? '#ffb36b' : '#3a3f45';
      const mn = p[x * 2], mx = p[x * 2 + 1];
      const y0 = mid - mx * (h / 2) * 0.95, y1 = mid - mn * (h / 2) * 0.95;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    g.fillStyle = 'rgba(255,122,26,0.9)';
    g.fillRect(xs, top, 2, h);
    g.fillRect(xe - 2, top, 2, h);
    if (loop) {
      g.strokeStyle = '#5fd0c4';
      g.beginPath(); g.moveTo(xs, H - 6); g.lineTo(xe, H - 6); g.stroke();
      g.fillStyle = '#5fd0c4'; g.font = '9px ' + getComputedStyle(document.body).fontFamily;
      g.fillText('LOOP', xs + 4, H - 9);
    }
    if (rev) { g.fillStyle = '#5fd0c4'; g.font = '9px monospace'; g.fillText('REV ◀', W - 44, H - 9); }
    // playhead delle voci
    g.fillStyle = '#ffffff';
    engine.voicePositions(ui.track).forEach((v) => {
      if (v.buffer !== e.buffer && !rev) return;
      g.fillRect(v.x * W, top, 1.5, h);
    });
    // zone del multicampione
    if (e.multi) {
      const z = e.multi.zones;
      const lo = z[0].root, hi = z[z.length - 1].root;
      g.fillStyle = '#4a4f56';
      g.font = '9px monospace';
      g.fillText(z.length + ' ZONE · ' + S33.noteName(lo) + '–' + S33.noteName(hi), W / 2 - 50, H - 9);
    }
  }
  function renderInfo() {
    const t = track();
    const e = currentEntry();
    $('infoL').innerHTML = `<b>${t.name}</b> · ${t.machine === 'multi' ? 'MULTI PLAYER' : 'SINGLE PLAYER'} · ${e ? e.label : '—'}`;
    const idx = activeStepIdx();
    const st = activeStep();
    if (st) {
      const n = Object.keys(st.locks).length;
      const chord = st.notes.map(S33.noteName).join(' ');
      $('infoR').innerHTML = `<span class="lockTag">STEP ${idx + 1}${ui.heldStep != null ? ' (tenuto)' : ''} · ${n} LOCK</span> · ${chord}`;
    } else {
      $('infoR').textContent = ui.page === 'TRIG' ? 'VALORI PER I NUOVI TRIG' : 'PARAMETRI DI TRACCIA';
    }
  }

  /* ---------- trasporto ---------- */
  function togglePlay() {
    engine.resume();
    if (seq.playing) {
      seq.stop();
      engine.cancelFuture();
      const now = performance.now();
      if (now - ui.stopPressedAt < 400) engine.stopAll();
      ui.stopPressedAt = now;
      ui.playG = -1;
      ui.recWrites.clear();
    } else {
      project.tracks.forEach((t, i) => engine.updateLfo(i, t.params, project.bpm));
      seq.start();
    }
    $('play').classList.toggle('on', seq.playing);
    $('play').textContent = seq.playing ? '■' : '▶';
    renderSteps();
  }
  function setFill(on) {
    seq.fill = on;
    $('fill').classList.toggle('on', on);
  }
  function setupDragField(id, get, set, per, fmt) {
    const el = $(id);
    let y0 = null, v0;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      y0 = e.clientY; v0 = get();
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      set(v0 + (y0 - e.clientY) * per * (e.shiftKey ? 0.1 : 1));
    });
    el.addEventListener('pointerup', () => (y0 = null));
    el.addEventListener('wheel', (e) => { e.preventDefault(); set(get() + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    if (fmt) el.addEventListener('dblclick', () => {
      const span = el.querySelector('span');
      const inp = document.createElement('input');
      inp.value = get();
      span.replaceWith(inp);
      inp.focus(); inp.select();
      const done = () => { set(parseFloat(inp.value) || get()); inp.replaceWith(span); fmt(); };
      inp.onblur = done;
      inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = get(); inp.blur(); } };
    });
  }
  function renderTransport() {
    $('bpm').textContent = (Math.round(project.bpm * 10) / 10).toString();
    $('swing').textContent = Math.round(project.swing) + '%';
    $('rec').classList.toggle('on', ui.rec);
    $('follow').classList.toggle('on', ui.follow);
  }

  /* ---------- note (MIDI e tastiera del computer) ---------- */
  function noteOn(note, vel) {
    engine.resume();
    const t = track();
    const st = activeStep();
    const first = ui.keysDown.size === 0;
    ui.keysDown.add(note);
    ui.lastNote[ui.track] = note;
    const p = S33.resolveParams(t, st);
    const old = ui.liveVoices.get(note);
    if (old) engine.release(old, engine.ctx.currentTime);
    ui.liveVoices.set(note, engine.play(ui.track, t.machine, p, note, vel, engine.ctx.currentTime, null));
    flashTrack(ui.track);

    if (st) {
      // step selezionato/tenuto: suonare un accordo lo scrive nello step
      if (first) { st.notes = [note]; st.vel = vel; }
      else if (!st.notes.includes(note) && st.notes.length < 8) st.notes.push(note);
      renderSteps(); renderKnobs(); renderInfo(); dirty();
    } else if (ui.rec && seq.playing) {
      const g = seq.nearestG();
      if (g != null) {
        const pos = g % t.length;
        const prev = ui.recWrites.get(ui.track + ':' + pos);
        const s = t.steps[pos];
        if (prev === g && s) {
          if (!s.notes.includes(note) && s.notes.length < 8) s.notes.push(note);
        } else {
          const ns = S33.newStep(t.trig, [note]);
          ns.vel = vel;
          t.steps[pos] = ns;
          ui.recWrites.set(ui.track + ':' + pos, g);
        }
        renderSteps(); dirty();
      }
    } else if (!seq.playing) {
      t.trig.note = note;
      if (ui.page === 'TRIG') renderKnobs();
    }
  }
  function noteOff(note) {
    ui.keysDown.delete(note);
    const v = ui.liveVoices.get(note);
    if (v) engine.release(v, engine.ctx.currentTime);
    ui.liveVoices.delete(note);
  }
  function flashTrack(ti) {
    ui.ledUntil[ti] = performance.now() + 90;
  }

  // CC 1-8 (LPD8) e 70-77 → le 8 manopole della pagina visibile
  function cc(num, val) {
    let i = -1;
    if (num >= 1 && num <= 8) i = num - 1;
    else if (num >= 70 && num <= 77) i = num - 70;
    if (i < 0) return;
    const k = S33.PAGES[ui.page][i];
    if (!k) return;
    const mn = P[k].min, mx = paramMax(k);
    setVal(k, mn + (val / 127) * (mx - mn), { quiet: true });
  }

  function setupMidi() {
    const st = $('midiStatus');
    if (!navigator.requestMIDIAccess) { st.textContent = 'MIDI non supportato'; return; }
    navigator.requestMIDIAccess().then((access) => {
      const hook = () => {
        const names = [];
        access.inputs.forEach((inp) => {
          names.push(inp.name);
          inp.onmidimessage = (m) => {
            const [s, d1, d2] = m.data;
            const type = s & 0xf0;
            if (type === 0x90 && d2 > 0) noteOn(d1, d2);
            else if (type === 0x80 || (type === 0x90 && d2 === 0)) noteOff(d1);
            else if (type === 0xb0) cc(d1, d2);
            st.classList.add('flash');
            clearTimeout(st._t);
            st._t = setTimeout(() => st.classList.remove('flash'), 80);
          };
        });
        st.textContent = names.length ? 'MIDI · ' + names.join(', ') : 'MIDI · nessun dispositivo';
        st.title = names.join('\n');
        st.classList.toggle('ok', names.length > 0);
        st.classList.toggle('off', !names.length);
      };
      hook();
      access.onstatechange = hook;
    }, () => { st.textContent = 'MIDI negato'; });
  }

  const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };
  function setupKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 's') { e.preventDefault(); saveProject(); }
        return;
      }
      const key = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
      if (e.repeat) return;
      if (e.shiftKey && /^Digit[1-5]$/.test(e.code)) { ui.page = S33.PAGE_NAMES[+e.code.slice(5) - 1]; renderTabs(); renderKnobs(); return; }
      if (/^Digit[1-4]$/.test(e.code)) { selectTrack(+e.code.slice(5) - 1); return; }
      if (key in KEYMAP) { noteOn(S33.clamp(60 + ui.octave * 12 + KEYMAP[key], 0, 127), 100); return; }
      if (key === 'z') { ui.octave = Math.max(-4, ui.octave - 1); toast('Ottava ' + (ui.octave >= 0 ? '+' : '') + ui.octave); return; }
      if (key === 'x') { ui.octave = Math.min(4, ui.octave + 1); toast('Ottava ' + (ui.octave >= 0 ? '+' : '') + ui.octave); return; }
      if (e.key === '`' || e.key === '\\' || e.key === '<') { setFill(true); return; }
      if (key === 'r') { ui.rec = !ui.rec; ui.recWrites.clear(); renderTransport(); return; }
      if (e.key === 'Escape') { ui.selStep = null; renderAll(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const i = activeStepIdx();
        if (i != null) { track().steps[i] = null; ui.selStep = null; ui.heldStep = null; renderAll(); dirty(); }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const n = Math.ceil(track().length / 16);
        ui.stepPage = (ui.stepPage + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
        renderSteps();
      }
    });
    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key in KEYMAP) {
        // rilascia qualunque ottava sia stata usata per quel tasto
        for (let o = -4; o <= 4; o++) {
          const n = 60 + o * 12 + KEYMAP[key];
          if (ui.liveVoices.has(n) || ui.keysDown.has(n)) noteOff(n);
        }
      }
      if (e.key === '`' || e.key === '\\' || e.key === '<') setFill(false);
    });
  }

  /* ---------- salva / apri ---------- */
  async function saveProject() {
    const name = (project.name || 'Progetto').replace(/[^\w\- ]+/g, '');
    const text = S33.projectToFile(project, pool);
    try {
      if (window.showSaveFilePicker) {
        const h = await showSaveFilePicker({ suggestedName: name + '.prisma', types: [{ description: 'Progetto S33 Prisma', accept: { 'application/json': ['.prisma'] } }] });
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
        project.name = h.name.replace(/\.prisma$/i, '');
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.download = name + '.prisma';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      toast('Progetto salvato');
      dirty();
    } catch (e) {
      if (e.name !== 'AbortError') toast('Salvataggio non riuscito');
    }
  }
  async function openProjectFile(file) {
    try {
      const res = await S33.fileToProject(await file.text(), factory, engine.ctx);
      if (seq.playing) togglePlay();
      project = migrate(res.project);
      project.name = file.name.replace(/\.(prisma|json)$/i, '');
      pool = res.pool;
      engine.pool = pool;
      ui.track = 0; ui.selStep = null; ui.stepPage = 0;
      project.tracks.forEach((t, i) => engine.updateLfo(i, t.params, project.bpm));
      renderAll();
      dirty();
      toast('Aperto: ' + project.name);
    } catch (e) {
      console.error(e);
      toast('File di progetto non valido');
    }
  }
  async function openProject() {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await showOpenFilePicker({ types: [{ description: 'Progetto S33 Prisma', accept: { 'application/json': ['.prisma', '.json'] } }] });
        openProjectFile(await h.getFile());
      } catch (e) {}
    } else $('fileProject').click();
  }

  /* ---------- render complessivo e loop ---------- */
  function renderAll() {
    renderTracks();
    renderTabs();
    renderKnobs();
    renderSteps();
    renderPool();
    renderInfo();
    renderTransport();
  }

  function frame() {
    const now = engine.ctx.currentTime;
    let changed = false;
    while (seq.uiQueue.length && seq.uiQueue[0].t <= now) {
      ui.playG = seq.uiQueue.shift().g;
      changed = true;
    }
    if (changed && seq.playing) {
      const t = track();
      const pos = ui.playG % t.length;
      if (ui.follow && ui.heldStep == null && ui.selStep == null) {
        const pg = Math.floor(pos / 16);
        if (pg !== ui.stepPage) ui.stepPage = pg;
      }
      renderSteps();
    }
    // led attività
    while (ui.hits.length && ui.hits[0].t <= now) flashTrack(ui.hits.shift().ti);
    const pn = performance.now();
    const cards = $('tracks').children;
    for (let i = 0; i < cards.length; i++) {
      cards[i].querySelector('.led').classList.toggle('hit', pn < ui.ledUntil[i]);
      cards[i].querySelector('.meter').style.width = Math.min(100, engine.meterLevel(i) * 140) + '%';
    }
    drawWave();
    renderInfoThrottled();
    requestAnimationFrame(frame);
  }
  let infoT = 0;
  function renderInfoThrottled() {
    const n = performance.now();
    if (n - infoT > 150) { infoT = n; renderInfo(); }
  }
  seq.onStep = (ti, t) => {
    ui.hits.push({ ti, t });
    if (ui.hits.length > 64) ui.hits.shift();
  };

  /* ---------- collegamenti ---------- */
  buildKnobs();
  buildSteps();
  setupDrops();
  setupMidi();
  setupKeys();
  $('play').onclick = togglePlay;
  $('fill').addEventListener('pointerdown', () => setFill(!seq.fill));
  $('rec').onclick = () => { ui.rec = !ui.rec; ui.recWrites.clear(); renderTransport(); };
  $('follow').onclick = () => { ui.follow = !ui.follow; renderTransport(); };
  $('btnSave').onclick = saveProject;
  $('btnOpen').onclick = openProject;
  $('fileProject').onchange = (e) => { if (e.target.files[0]) openProjectFile(e.target.files[0]); e.target.value = ''; };
  $('btnNew').onclick = () => {
    if (!confirm('Caricare il progetto demo? Il lavoro non salvato su file andrà perso.')) return;
    if (seq.playing) togglePlay();
    project = S33.demoProject();
    pool = { samples: factory.samples.slice(), multis: factory.multis.slice() };
    engine.pool = pool;
    ui.track = 0; ui.selStep = null; ui.stepPage = 0;
    project.tracks.forEach((t, i) => engine.updateLfo(i, t.params, project.bpm));
    renderAll();
    dirty();
  };
  $('clearLocks').onclick = () => {
    const st = activeStep();
    if (st) st.locks = {};
    else track().steps.forEach((s) => s && (s.locks = {}));
    toast(st ? 'Lock dello step cancellati' : 'Lock della traccia cancellati');
    renderAll();
    dirty();
  };
  $('clearTrack').onclick = () => {
    if (!confirm('Cancellare tutti gli step di ' + track().name + '?')) return;
    track().steps.fill(null);
    ui.selStep = null;
    renderAll();
    dirty();
  };
  setupDragField('bpmField', () => project.bpm, (v) => {
    project.bpm = Math.round(S33.clamp(v, 30, 300) * 10) / 10;
    project.tracks.forEach((t, i) => engine.updateLfo(i, t.params, project.bpm));
    renderTransport(); dirty();
  }, 0.5, renderTransport);
  setupDragField('swingField', () => project.swing, (v) => { project.swing = Math.round(S33.clamp(v, 50, 80)); renderTransport(); dirty(); }, 0.25);
  setupDragField('lenField', () => track().length, (v) => {
    track().length = Math.round(S33.clamp(v, 1, 64));
    ui.stepPage = Math.min(ui.stepPage, Math.ceil(track().length / 16) - 1);
    if (ui.selStep != null && ui.selStep >= track().length) ui.selStep = null;
    renderSteps(); renderTracks(); dirty();
  }, 0.25);
  // un clic ovunque sblocca l'audio
  window.addEventListener('pointerdown', () => engine.resume(), { once: true });

  project.tracks.forEach((t, i) => engine.updateLfo(i, t.params, project.bpm));
  renderAll();
  requestAnimationFrame(frame);
  window.__prisma = { engine, seq, get project() { return project; }, get pool() { return pool; }, ui, noteOn, noteOff, setVal, togglePlay };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
