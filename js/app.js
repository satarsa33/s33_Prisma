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
    hits: [], ledUntil: [0, 0, 0, 0], stopPressedAt: 0, subSlot: 0,
    aux: null, kbd: false, kbdHeld: new Map(),
    recSrc: 'main', recBars: 0, recNorm: true, recMon: false, recCount: 0,
  };

  /* ---------- utilità ---------- */
  let toastT;
  function toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
  let saveT;
  function dirty() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { S33.syncPattern(project); S33.autosave(project, pool); }, 900);
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
      t.sub = t.sub || S33.defaultSub();
      while (t.steps.length < S33.MAX_STEPS) t.steps.push(null);
      t.name = t.name || 'T' + (i + 1);
    });
    p.bpm = p.bpm || 120;
    p.swing = p.swing || 50;
    const fx = S33.defaultFx();
    p.fx = p.fx || {};
    for (const g in fx) p.fx[g] = Object.assign(fx[g], p.fx[g] || {});
    p.root = p.root || 0;
    p.scale = p.scale || 0;
    p.snap = !!p.snap;
    S33.linkPatterns(p);
    return p;
  }

  /* ---------- avvio ---------- */
  factory = await S33.buildFactory();
  const saved = await S33.autoload(factory);
  if (saved) {
    project = migrate(saved.project);
    pool = saved.pool;
  } else {
    project = migrate(S33.demoProject());
    pool = { samples: factory.samples.slice(), multis: factory.multis.slice() };
  }
  engine.pool = pool;

  /* ---------- valori dei parametri ---------- */
  function paramMax(k) {
    if (k === 'smp' || k === 'ssmp') return Math.max(0, (k === 'ssmp' ? pool.samples : smpList(track())).length - 1);
    if (k === 'chord') return S33.CHORDS.length - 1;
    return P[k].max;
  }
  function getVal(k) {
    const t = track();
    if (P[k].ui) return ui.subSlot;
    if (P[k].sub) return t.sub[ui.subSlot][k];
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
    if (k === 'smp' || k === 'ssmp') {
      const e = (k === 'ssmp' ? pool.samples : smpList(track()))[v];
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
    if (P[k].ui) { if (ui.subSlot === v) return; ui.subSlot = v; renderKnobs(); renderPool(); return; }
    if (P[k].sub) {
      if (t.sub[ui.subSlot][k] === v) return;
      t.sub[ui.subSlot][k] = v;
      renderKnobs(); if (k === 'ssmp') { renderPool(); renderTracks(); }
      dirty();
      return;
    }
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
      if (k === 'out') engine.setRoute(ui.track, v);
      if (k === 'smp' || k === 'out' || k === 'chord') renderTracks();
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
  const THEME_TRACKS = {
    s33: ['#e0745a', '#a8862f', '#4a6aa8', '#7a5fb0'],
    carta: ['#c4553b', '#b8871f', '#3d63b0', '#6d4fa6'],
    neon: ['#ff3ea5', '#ff9a3c', '#31e1ff', '#a36bff'],
  };
  const THEME_NAMES = { s33: 'S33', carta: 'Carta', neon: 'Neon' };
  let theme = 's33';
  try { theme = localStorage.getItem('prisma-theme') || 's33'; } catch (e) {}
  if (!THEME_TRACKS[theme]) theme = 's33';
  const trackColors = () => THEME_TRACKS[theme];
  function applyTheme() {
    document.body.classList.remove('theme-carta', 'theme-neon');
    if (theme !== 's33') document.body.classList.add('theme-' + theme);
    tvCache.clear();
    const b = document.getElementById('btnTheme');
    if (b) b.textContent = THEME_NAMES[theme];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = { s33: '#121212', carta: '#ece6da', neon: '#08081a' }[theme];
  }
  function cycleTheme() {
    const order = ['s33', 'carta', 'neon'];
    theme = order[(order.indexOf(theme) + 1) % order.length];
    try { localStorage.setItem('prisma-theme', theme); } catch (e) {}
    applyTheme();
    renderAll();
  }
  function renderTracks() {
    const box = $('tracks');
    if (!box.children.length) {
      project.tracks.forEach((_, i) => {
        const el = document.createElement('div');
        el.className = 'trk';
        el.innerHTML = `<span class="pad">${i + 1}<span class="meter"></span></span>
          <div class="info"><span class="nm"></span><span class="sub"></span></div>
          <button class="ms m" title="Mute">M</button><button class="ms s" title="Solo">S</button>`;

        el.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button') || e.target.isContentEditable) return;
          selectTrack(i);
        });
        el.querySelector('.nm').addEventListener('dblclick', (e) => {
          const n = e.target;
          n.contentEditable = 'true';
          n.focus();
          document.getSelection().selectAllChildren(n);
          const done = () => {
            n.contentEditable = 'false';
            project.tracks[i].name = (n.textContent.trim() || 'T' + (i + 1)).slice(0, 10).toUpperCase();
            renderAll();
            dirty();
          };
          n.onblur = done;
          n.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); n.blur(); } ev.stopPropagation(); };
        });
        el.querySelector('.ms.m').addEventListener('click', () => { project.tracks[i].mute = !project.tracks[i].mute; renderTracks(); dirty(); });
        el.querySelector('.ms.s').addEventListener('click', () => { project.tracks[i].solo = !project.tracks[i].solo; renderTracks(); dirty(); });
        box.appendChild(el);
      });
      const grid = $('auxgrid');
      S33.AUX_IDS.forEach((id) => {
        const b = document.createElement('button');
        b.className = 'auxbtn ' + (id.startsWith('bus') ? 'bus' : id === 'mix' ? 'mixb' : 'fxs');
        b.dataset.id = id;
        b.innerHTML = '<span class="dt"></span>' + S33.AUX[id].title + '<span class="am"></span>';
        b.onclick = () => {
          ui.aux = ui.aux === id ? null : id;
          ui.focus = ui.aux ? 'aux' : ui.trackFocus;
          buildAuxKnobs();
          renderAll();
        };
        grid.appendChild(b);
      });
    }
    $('auxgrid').querySelectorAll('.auxbtn').forEach((b) => b.classList.toggle('on', b.dataset.id === ui.aux));
    project.tracks.forEach((t, i) => {
      const el = box.children[i];
      el.classList.toggle('sel', i === ui.track && !ui.aux);
      el.querySelector('.pad').style.background = trackColors()[i];
      const nm = el.querySelector('.nm');
      if (nm.contentEditable !== 'true') nm.textContent = t.name;
      const e = smpList(t)[t.params.smp];
      el.querySelector('.sub').textContent = (t.machine === 'sub' ? 'SUB ×8' : (t.machine === 'multi' ? '◆ ' : t.machine === 'grain' ? '≈ ' : '') + (e ? e.name : '—')) + ' · ' + t.length + ' st' +
        (t.params.out ? ' · → B' + t.params.out : '') + (t.params.chord ? ' · ♫ ' + S33.CHORDS[t.params.chord].label : '');
      el.querySelector('.ms.m').classList.toggle('on', t.mute);
      el.querySelector('.ms.s').classList.toggle('on', t.solo);
    });
    document.documentElement.style.setProperty('--tc', trackColors()[ui.track]);
  }
  function selectTrack(i) {
    ui.track = i;
    ui.aux = null;
    if (ui.focus === 'aux') ui.focus = ui.trackFocus;
    ui.selStep = null;
    ui.heldStep = null;
    ui.stepPage = Math.min(ui.stepPage, Math.ceil(track().length / 16) - 1);
    renderAll();
  }

  /* ---------- pannelli, manopole e controlli ---------- */
  const PANEL_KNOBS = {
    src: ['smp', 'tune', 'fine', 'start', 'end', 'level'],
    flt: ['freq', 'reso', 'fenv', 'fatk', 'fdec', 'ktrk', 'fvel'],
    amp: ['atk', 'dec', 'sus', 'rel', 'pan', 'vol', 'avel'],
    fx: ['drive', 'bits', 'sdly', 'srev', 'scho'],
    lfo: ['lrate', 'ldep'],
  };
  // cosa controllano i knob 1-8 dell'LPD8 per ogni pannello
  const FOCUS_KEYS = {
    src: ['smp', 'tune', 'fine', 'start', 'end', 'level', 'loop', 'rev'],
    flt: ['freq', 'reso', 'fenv', 'fatk', 'fdec', 'ktrk', 'fvel', 'ftype'],
    amp: ['atk', 'dec', 'sus', 'rel', 'pan', 'vol', 'avel'],
    fx: ['drive', 'bits', 'sdly', 'srev', 'scho', 'out'],
    lfo: ['lrate', 'ldep', 'lwave', 'ldest', 'lsync'],
    trig: ['note', 'vel', 'len', 'micro', 'cond', 'chord', 'inv', 'voic'],
  };
  const FOCUS_ORDER = ['src', 'flt', 'amp', 'fx', 'lfo', 'trig'];
  ui.focus = 'src';
  ui.trackFocus = 'src';
  const focusKeys = () => (ui.focus === 'aux' ? S33.AUX[ui.aux].keys : FOCUS_KEYS[ui.focus]);

  const auxGroup = () => project.fx[S33.AUX[ui.aux].group];
  const kDef = (k, aux) => (aux ? S33.AUXP[k] : P[k]);
  const kGet = (k, aux) => (aux ? auxGroup()[k] : getVal(k));
  const kMax = (k, aux) => (aux ? S33.AUXP[k].max : paramMax(k));
  const kFmt = (k, v, aux) => (aux ? (S33.AUXP[k].fmt ? S33.AUXP[k].fmt(v) : String(Math.round(v))) : fmtVal(k, v));
  const isAuxKey = (k) => !!(ui.aux && S33.AUXP[k] && !P[k]);
  let fxT = null;
  function applyFx() {
    clearTimeout(fxT);
    fxT = setTimeout(() => engine.applyFx(project.fx, project.bpm), 30);
  }
  function kSet(k, v, aux, opts) {
    if (!aux) return setVal(k, v, opts);
    const d = S33.AUXP[k];
    v = Math.round(S33.clamp(v, d.min, d.max));
    const g = auxGroup();
    if (g[k] === v) return;
    g[k] = v;
    applyFx();
    renderKnobs();
    dirty();
  }
  function kReset(k, aux) {
    if (!aux) return resetVal(k);
    kSet(k, S33.AUXP[k].def, true);
  }
  function setFocus(f) {
    if (ui.focus === f) return;
    ui.focus = f;
    if (f !== 'aux') ui.trackFocus = f;
    renderKnobs();
  }

  const ARC = 270, R = 19, CX = 23, CY = 23;
  function arcPath(a0, a1) {
    const p = (a) => {
      const r = ((a - 90) * Math.PI) / 180;
      return [CX + R * Math.cos(r), CY + R * Math.sin(r)];
    };
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  const BG_ARC = arcPath(-135, 135);

  const knobs = []; // {el, k, aux}
  function makeKnob(k, aux) {
    const el = document.createElement('div');
    el.className = 'knob';
    el.innerHTML = `<svg viewBox="0 0 46 46" aria-hidden="true"><path class="bg" d="${BG_ARC}" fill="none" stroke-width="4" stroke-linecap="round"/>
      <path class="fg" fill="none" stroke-width="4" stroke-linecap="round"/>
      <circle class="cap" cx="23" cy="23" r="13"/>
      <line class="ind" x1="23" y1="23" x2="23" y2="13" stroke-width="2.5" stroke-linecap="round"/></svg>
      <span class="kb"></span><span class="lab"></span><span class="val"></span>`;
    const o = { el, k, aux };
    if (!k) { el.classList.add('empty'); return o; }
    let y0 = null, v0 = 0;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      y0 = e.clientY;
      v0 = kGet(k, aux);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      const range = kMax(k, aux) - kDef(k, aux).min;
      // sensibilità: i parametri continui (es. POS, START, END) chiedono più corsa del mouse
      let per = kDef(k, aux).step < 1 ? range / 600 : range <= 40 ? 1 / 12 : range / 320;
      if (e.shiftKey || e.altKey) per /= 8;
      kSet(k, v0 + (y0 - e.clientY) * per, aux);
    });
    const end = () => { y0 = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const range = kMax(k, aux) - kDef(k, aux).min;
      const inc = kDef(k, aux).step < 1 ? range / 400 : 1;
      kSet(k, kGet(k, aux) + (e.deltaY < 0 ? inc : -inc) * (e.shiftKey ? 0.25 : 1), aux);
    }, { passive: false });
    el.addEventListener('dblclick', () => kReset(k, aux));
    return o;
  }
  // la SOURCE cambia manopole a seconda della machine
  const SRC_KNOBS = {
    single: ['smp', 'tune', 'fine', 'start', 'end', 'level'],
    multi: ['smp', 'tune', 'fine', 'start', 'end', 'level'],
    sub: ['slot', 'ssmp', 'stune', 'slvl', 'span', 'level'],
    grain: ['smp', 'tune', 'gpos', 'gsize', 'gdens', 'gspray', 'gjit', 'gscan', 'level'],
  };
  const SRC_FOCUS = {
    single: ['smp', 'tune', 'fine', 'start', 'end', 'level', 'loop', 'rev'],
    multi: ['smp', 'tune', 'fine', 'start', 'end', 'level', 'loop', 'rev'],
    sub: ['slot', 'ssmp', 'stune', 'slvl', 'span', 'level', 'rev'],
    grain: ['smp', 'tune', 'gpos', 'gsize', 'gdens', 'gspray', 'gjit', 'gscan'],
  };
  let srcMachine = null;
  function buildSrcKnobs() {
    const m = track().machine;
    if (m === srcMachine) return;
    srcMachine = m;
    const box = document.querySelector('[data-knobs="src"]');
    for (let i = knobs.length - 1; i >= 0; i--) if (knobs[i].panel === 'src') knobs.splice(i, 1);
    box.innerHTML = '';
    SRC_KNOBS[m].forEach((k) => {
      const o = makeKnob(k, false);
      o.panel = 'src';
      knobs.push(o);
      box.appendChild(o.el);
    });
    FOCUS_KEYS.src = SRC_FOCUS[m];
    box.className = 'kgrid ' + (m === 'grain' ? 'k5' : 'k3');
    document.querySelector('[data-tog="loop"]').hidden = m === 'grain' || m === 'sub';
  }
  function buildPanels() {
    document.querySelectorAll('[data-knobs]').forEach((box) => {
      const id = box.dataset.knobs;
      if (id === 'aux' || id === 'src') return;
      PANEL_KNOBS[id].forEach((k) => {
        const o = makeKnob(k, false);
        o.panel = id;
        knobs.push(o);
        box.appendChild(o.el);
      });
    });
    // segmenti e interruttori (anche loro bloccabili per step)
    document.querySelectorAll('[data-seg]').forEach((seg) => {
      const k = seg.dataset.seg;
      seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        if (k === 'machine') return setMachine(b.dataset.v);
        setVal(k, Number(b.dataset.v));
        renderAfterControl(k);
      }));
    });
    document.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.tog;
      setVal(k, getVal(k) ? 0 : 1);
      renderAfterControl(k);
    }));
    // clic in un pannello = l'LPD8 controlla quel pannello
    document.querySelectorAll('[data-panel]').forEach((p) => p.addEventListener('pointerdown', () => {
      setFocus(p.dataset.panel === 'aux' ? 'aux' : p.dataset.panel);
    }, true));
    // celle TRIG
    const tc = $('trigCells');
    FOCUS_KEYS.trig.forEach((k, i) => {
      const c = document.createElement('div');
      c.className = 'tc';
      c.dataset.k = k;
      c.innerHTML = `<small>${P[k].label}<span class="kb">K${i + 1}</span></small><span class="v"></span>`;
      let y0 = null, v0 = 0;
      c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = getVal(k); });
      c.addEventListener('pointermove', (e) => {
        if (y0 == null) return;
        const range = paramMax(k) - P[k].min;
        setVal(k, v0 + (y0 - e.clientY) * (range <= 40 ? 1 / 12 : range / 320) * (e.shiftKey || e.altKey ? 1 / 8 : 1));
      });
      c.addEventListener('pointerup', () => (y0 = null));
      c.addEventListener('wheel', (e) => { e.preventDefault(); setVal(k, getVal(k) + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
      c.addEventListener('dblclick', () => resetVal(k));
      tc.appendChild(c);
    });
  }
  function renderAfterControl(k) {
    if (k === 'out' || k === 'machine') renderTracks();
    renderKnobs();
  }
  function setMachine(m) {
    const t = track();
    if (t.machine === m) return;
    t.machine = m;
    t.params.smp = 0;
    t.steps.forEach((s) => s && delete s.locks.smp);
    renderAll();
    dirty();
  }
  function buildAuxKnobs() {
    const box = document.querySelector('[data-knobs="aux"]');
    knobs.splice(0, knobs.length, ...knobs.filter((o) => !o.aux));
    box.innerHTML = '';
    if (!ui.aux) return;
    S33.AUX[ui.aux].keys.forEach((k) => {
      const o = makeKnob(k, true);
      o.panel = 'aux';
      knobs.push(o);
      box.appendChild(o.el);
    });
  }
  const AUX_INFO = {
    bus1: 'filtro · drive · compressore → MAIN', bus2: 'filtro · drive · compressore → MAIN',
    dly: 'mandata A · delay ping-pong a tempo', rev: 'mandata B · riverbero', cho: 'mandata C · chorus stereo',
    mix: 'livelli di traccia e master',
  };
  function renderTabs() {
    // vista traccia o vista bus/fx/mix
    $('trackView').hidden = !!ui.aux;
    $('auxView').hidden = !ui.aux;
    if (ui.aux) {
      const p = $('auxPanel');
      p.className = 'panel aux' + (['dly', 'rev', 'cho'].includes(ui.aux) ? ' teal' : ui.aux === 'mix' ? ' mixc' : '');
      $('auxTitle').textContent = S33.AUX[ui.aux].title;
      const routed = project.tracks.filter((t) => (ui.aux === 'bus1' && t.params.out === 1) || (ui.aux === 'bus2' && t.params.out === 2));
      $('auxInfo').textContent = AUX_INFO[ui.aux] + (ui.aux.startsWith('bus') ? ' · IN: ' + (routed.length ? routed.map((t) => t.name).join(', ') : 'nessuna traccia') : '');
    }
  }
  function renderKnobs() {
    buildSrcKnobs();
    const st = activeStep();
    const fk = focusKeys();
    knobs.forEach((o) => {
      const { el, k, aux } = o;
      if (!k) return;
      if (aux && !ui.aux) return;
      const D = kDef(k, aux);
      const v = kGet(k, aux);
      const mn = D.min, mx = kMax(k, aux);
      const f = mx > mn ? (v - mn) / (mx - mn) : 0;
      const a = -135 + f * ARC;
      const a0 = mn < 0 ? -135 + ((0 - mn) / (mx - mn)) * ARC : -135;
      el.querySelector('.fg').setAttribute('d', Math.abs(a - a0) < 0.5 ? '' : arcPath(Math.min(a0, a), Math.max(a0, a)));
      el.querySelector('.ind').setAttribute('transform', `rotate(${a} 23 23)`);
      el.querySelector('.lab').textContent = D.label;
      el.querySelector('.val').textContent = kFmt(k, v, aux);
      el.classList.toggle('locked', !aux && isLocked(k));
      el.classList.toggle('nolock', !aux && !!(st && !D.lock));
      const focused = (aux && ui.focus === 'aux') || (!aux && ui.focus === o.panel);
      const idx = focused ? fk.indexOf(k) : -1;
      el.querySelector('.kb').textContent = idx >= 0 ? 'K' + (idx + 1) : '';
      el.querySelector('.kb').style.visibility = idx >= 0 ? '' : 'hidden';
    });
    document.querySelectorAll('[data-seg]').forEach((seg) => {
      const k = seg.dataset.seg;
      const v = k === 'machine' ? track().machine : String(getVal(k));
      const lk = k !== 'machine' && isLocked(k);
      seg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', b.dataset.v === String(v));
        b.classList.toggle('lk', lk && b.dataset.v === String(v));
      });
    });
    document.querySelectorAll('[data-tog]').forEach((b) => {
      const k = b.dataset.tog;
      b.classList.toggle('on', !!getVal(k));
      b.classList.toggle('lk', isLocked(k));
    });
    // pannelli: focus LPD8 e presenza di p-lock
    document.querySelectorAll('[data-panel]').forEach((p) => {
      const id = p.dataset.panel;
      p.classList.toggle('focus', id === ui.focus);
      const keys = FOCUS_KEYS[id] || [];
      p.classList.toggle('haslock', !!(st && id !== 'trig' && keys.some((k) => st.locks[k] !== undefined)));
    });
    $('trigLabel').innerHTML = st ? 'TRIG<br>STEP ' + (activeStepIdx() + 1) : 'TRIG<br>NUOVI';
    // celle TRIG
    document.querySelectorAll('#trigCells .tc').forEach((c) => {
      const k = c.dataset.k;
      let txt = fmtVal(k, getVal(k));
      if (k === 'note' && st && st.notes.length > 1) txt += ' ×' + st.notes.length;
      c.querySelector('.v').textContent = txt;
      c.classList.toggle('set', !!st && !!P[k].trig);
      c.classList.toggle('trk', !P[k].trig);
    });
    drawPanels();
    renderInfo();
  }

  /* ---------- step ---------- */
  const stepEls = [];
  function buildSteps() {
    const box = $('steps');
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('div');
      el.className = 'step';
      el.innerHTML = '<span class="led"></span><span class="vbar"></span><span class="n"></span><span class="cd"></span><span class="nt"></span>';
      attachStep(el, i);
      stepEls.push(el);
      box.appendChild(el);
    }
  }
  function attachStep(el, i) {
    let holdT = null, down = false;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (ui.kbd) {
        el.setPointerCapture(e.pointerId);
        const n = noteOn(kbdNote(i), 100, { raw: true });
        ui.kbdHeld.set(e.pointerId, n);
        el.classList.add('held');
        return;
      }
      const idx = ui.stepPage * 16 + i;
      const t = track();
      if (idx >= t.length) return;
      engine.resume();
      if (e.shiftKey || e.button === 2) {
        if (ui.selStep === idx) ui.selStep = null;
        else {
          if (!t.steps[idx]) t.steps[idx] = makeStep(t);
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
        if (!t.steps[idx]) { t.steps[idx] = makeStep(t); dirty(); }
        ui.heldStep = idx;
        ui.holdFired = true;
        renderAll();
      }, 300);
    });
    const up = (e) => {
      if (ui.kbdHeld.has(e.pointerId)) {
        noteOff(ui.kbdHeld.get(e.pointerId));
        ui.kbdHeld.delete(e.pointerId);
        el.classList.remove('held');
        return;
      }
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
        t.steps[idx] = makeStep(t);
      }
      renderAll();
      dirty();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  // keyboard mode: i 16 tasti diventano gradi della scala
  function kbdNote(i) {
    if (track().machine === 'sub') return 60 + i;
    const base = 48 + project.root + ui.octave * 12;
    return S33.clamp(S33.scaleDegree(base, i, project.root, project.scale), 0, 127);
  }
  function renderSteps() {
    const t = track();
    $('steps').classList.toggle('kbd', ui.kbd);
    if (ui.kbd) {
      stepEls.forEach((el, i) => {
        const n = kbdNote(i);
        el.className = 'step key' + ((((n - project.root) % 12) + 12) % 12 === 0 ? ' root' : '') + (ui.liveVoices.has(n) ? ' held' : '');
        el.querySelector('.n').textContent = t.machine === 'sub' ? 'S' + ((i % 8) + 1) + ' ' + ((pool.samples[t.sub[i % 8].ssmp] || {}).name || '') : S33.noteName(n);
        el.querySelector('.cd').textContent = '';
        el.querySelector('.nt').textContent = t.params.chord ? S33.CHORDS[t.params.chord].label : '';
        el.querySelector('.vbar').style.width = '0';
        const lk = el.querySelector('.lk');
        if (lk) lk.remove();
      });
      renderPages();
      return;
    }
    const sel = activeStepIdx();
    const pos = ui.playG >= 0 && seq.playing ? ui.playG % t.length : -1;
    stepEls.forEach((el, i) => {
      const idx = ui.stepPage * 16 + i;
      const s = idx < t.length ? t.steps[idx] : null;
      el.classList.remove('key', 'root', 'held');
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
      el.querySelector('.vbar').style.width = s ? Math.round((s.vel / 127) * 34) + 'px' : '0';
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
    $('seqTrack').textContent = 'T' + (ui.track + 1) + ' · ' + t.name;
  }

  /* ---------- pool campioni ---------- */
  function renderPool() {
    const t = track();
    const fill = (ul, list, kind) => {
      ul.innerHTML = '';
      list.forEach((e, i) => {
        const li = document.createElement('li');
        const cur = t.machine === 'sub' ? kind === 'single' && t.sub[ui.subSlot].ssmp === i : (kind === 'multi') === (t.machine === 'multi') && getVal('smp') === i;
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
    const sampleMachine = t.machine === 'sub' || t.machine === 'grain';
    if (kind === 'single' && t.machine === 'sub') {
      t.sub[ui.subSlot].ssmp = i;
      toast('Campione sulla sottotraccia ' + (ui.subSlot + 1));
      renderAll(); dirty();
      return;
    }
    if (kind === 'single' && sampleMachine) kind = t.machine;
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
    const out = [], bad = [];
    toast('Carico ' + files.length + (files.length > 1 ? ' file…' : ' file…'), 60000);
    for (const f of files) {
      try {
        const ab = await f.arrayBuffer();
        let buf = null;
        // AIFF/AIFC (comuni con Logic): letti a mano, Chrome non li decodifica
        if (S33.isAiff(ab)) buf = S33.decodeAiff(ab, engine.ctx.sampleRate);
        if (!buf) buf = await engine.ctx.decodeAudioData(ab.slice(0));
        out.push({ name: f.name.replace(/\.[a-z0-9]+$/i, ''), file: f.name, buffer: buf });
      } catch (e) {
        console.warn('Prisma: impossibile leggere', f.name, e);
        bad.push(f.name);
      }
    }
    if (bad.length) toast('Non riesco a leggere: ' + bad.join(', ') + ' (prova WAV o MP3)', 6000);
    else if (!out.length) toast('Nessun file audio caricato');
    return out;
  }
  const uid = () => 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function addSamples(files) {
    try { await addSamplesInner(files); } catch (e) { console.error(e); toast('Errore nel caricamento: ' + e.message, 6000); }
  }
  async function addMulti(files) {
    try { await addMultiInner(files); } catch (e) { console.error(e); toast('Errore nel caricamento: ' + e.message, 6000); }
  }
  async function addSamplesInner(files) {
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
  async function addMultiInner(files) {
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
      document.body.classList.add('dragging');
      overTarget = e.target.closest && e.target.closest('#dropMulti') ? 'multi' : 'single';
      (overTarget === 'multi' ? zones.dropMulti : zones.dropSamples).classList.add('over');
    });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { clear(); document.body.classList.remove('dragging'); } });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      clear();
      document.body.classList.remove('dragging');
      const files = [...e.dataTransfer.files].filter((f) => /audio|\.(wav|wave|aif|aiff|aifc|m4a|mp3|mp4|aac|flac|caf|ogg|opus)$/i.test(f.type + f.name));
      if (!files.length) {
        const pf = [...e.dataTransfer.files].find((f) => /\.(prisma|json)$/i.test(f.name));
        if (pf) openProjectFile(pf);
        else toast(e.dataTransfer.files.length ? 'Questi file non sembrano audio (WAV, AIFF, MP3, M4A, FLAC)' : 'Trascina dei file, non una cartella');
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

  /* ---------- grafici dei pannelli ---------- */
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
    if (t.machine === 'sub') {
      const sl = t.sub[ui.subSlot];
      const s = pool.samples[sl.ssmp];
      return s ? { buffer: s.buffer, label: 'SUB ' + (ui.subSlot + 1) + ' · ' + s.name + ' · ' + S33.noteName(60 + ui.subSlot), short: s.name, sub: true } : null;
    }
    const smp = getVal('smp');
    if (t.machine === 'multi') {
      const m = pool.multis[smp];
      if (!m) return null;
      const note = ui.lastNote[ui.track];
      let best = m.zones[0];
      m.zones.forEach((z) => { if (Math.abs(z.root - note) < Math.abs(best.root - note)) best = z; });
      return { buffer: best.buffer, label: m.name + ' · ZONA ' + best.name, short: m.name, zone: best, multi: m };
    }
    const s = pool.samples[smp];
    return s ? { buffer: s.buffer, label: s.name + ' · ROOT ' + S33.noteName(s.root), short: s.name } : null;
  }
  function prepCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return null;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    return { g, W, H };
  }
  // colori dei grafici presi dal tema (variabili CSS del pannello)
  const tvCache = new Map();
  function tv(id, name) {
    const k = id + name;
    if (!tvCache.has(k)) tvCache.set(k, getComputedStyle($(id)).getPropertyValue(name).trim() || '#efe6d6');
    return tvCache.get(k);
  }
  function drawWave() {
    const c = prepCanvas($('wave'));
    if (!c) return;
    const { g, W, H } = c;
    const e = currentEntry();
    $('waveLabel').textContent = e ? e.label : '—';
    const top = 26, bottom = e && (e.multi || e.sub) ? 28 : 10;
    const h = H - top - bottom, mid = top + h / 2;
    if (!e) return;
    const grain = track().machine === 'grain';
    const st = grain ? 0 : getVal('start'), en = grain ? 1 : getVal('end'), loop = !grain && getVal('loop'), rev = getVal('rev');
    const p = peaks(e.buffer, Math.max(1, Math.floor(W)));
    const waveIn = tv('wave', '--wave'), waveOut = tv('wave', '--waveOut');
    const xs = st * W, xe = Math.max(xs + 1, en * W);
    if (grain) {
      // posizione del granulatore e zona di spray
      const gp = getVal('gpos') * W;
      const sp = (getVal('gspray') / 127) * 0.2 * W;
      g.fillStyle = tv('wave', '--markerFill');
      g.fillRect(gp - sp, 0, sp * 2, H);
    }
    g.fillStyle = tv('wave', '--shade');
    g.fillRect(0, 0, xs, H);
    g.fillRect(xe, 0, W - xe, H);
    for (let x = 0; x < W; x++) {
      const inside = x >= xs && x <= xe;
      g.fillStyle = inside ? waveIn : waveOut;
      const mn = p[x * 2], mx = p[x * 2 + 1];
      const y0 = mid - mx * (h / 2) * 0.95, y1 = mid - mn * (h / 2) * 0.95;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    g.fillStyle = tv('wave', '--marker');
    if (grain) g.fillRect(getVal('gpos') * W - 1, 0, 2, H);
    else { g.fillRect(xs, 0, 2, H); g.fillRect(xe - 2, 0, 2, H); }
    if (loop) {
      g.fillStyle = tv('wave', '--loopCol');
      g.fillRect(xs, H - bottom + 2, xe - xs, 2);
    }
    if (rev) { g.fillStyle = tv('wave', '--curve'); g.font = '800 10px sans-serif'; g.fillText('◀ REV', W - 52, 18); }
    g.fillStyle = tv('wave', '--playhead');
    engine.voicePositions(ui.track).forEach((v) => {
      if (v.buffer !== e.buffer && !rev) return;
      g.fillRect(v.x * W, top, 1.5, h);
    });
  }
  function renderZones() {
    const e = currentEntry();
    const box = $('zones');
    const t = track();
    if (t.machine === 'sub') {
      const key = 'sub:' + ui.track + ':' + ui.subSlot + ':' + t.sub.map((x) => x.ssmp).join(',');
      if (box.dataset.key === key) return;
      box.dataset.key = key;
      box.style.pointerEvents = 'auto';
      box.innerHTML = t.sub.map((x, i) => `<span data-slot="${i}" class="${i === ui.subSlot ? 'on' : ''}" style="cursor:pointer">${i + 1} ${(pool.samples[x.ssmp] || { name: '—' }).name}</span>`).join('');
      box.querySelectorAll('span').forEach((sp) => sp.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); setVal('slot', +sp.dataset.slot); renderZones(); }));
      return;
    }
    box.style.pointerEvents = 'none';
    if (!e || !e.multi) { box.innerHTML = ''; box.dataset.key = ''; return; }
    const key = e.multi.id + ':' + e.zone.root;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = e.multi.zones.map((z) => `<span class="${z === e.zone ? 'on' : ''}">${z.name}</span>`).join('');
  }
  // curva reale del filtro (stessa formula del motore, nota C3 a velocity 100)
  const fProbe = engine.ctx.createBiquadFilter();
  const F_N = 160;
  const fFreqs = new Float32Array(F_N), fMag = new Float32Array(F_N), fPh = new Float32Array(F_N);
  for (let i = 0; i < F_N; i++) fFreqs[i] = 20 * Math.pow(1000, i / (F_N - 1));
  function drawFilter() {
    const c = prepCanvas($('fcurve'));
    if (!c) return;
    const { g, W, H } = c;
    const ftype = getVal('ftype'), freq = getVal('freq'), reso = getVal('reso'), fvel = getVal('fvel');
    let base = S33.cutoffHz(freq) * Math.pow(2, (100 / 127 - 1) * (fvel / 127) * 4);
    fProbe.type = ['lowpass', 'bandpass', 'highpass'][ftype];
    fProbe.frequency.value = S33.clamp(base, 20, 20000);
    fProbe.Q.value = ftype === 1 ? 0.7 + (reso / 127) * 12 : 0.5 + Math.pow(reso / 127, 2) * 22;
    fProbe.getFrequencyResponse(fFreqs, fMag, fPh);
    const y = (m) => {
      const db = 20 * Math.log10(Math.max(1e-5, m));
      return H * 0.42 - (db / 30) * H * 0.42;
    };
    g.strokeStyle = tv('fcurve', '--grid');
    [0.25, 0.5, 0.75].forEach((f) => { g.beginPath(); g.moveTo(W * f, 0); g.lineTo(W * f, H); g.stroke(); });
    g.beginPath();
    for (let i = 0; i < F_N; i++) {
      const xx = (i / (F_N - 1)) * W, yy = S33.clamp(y(fMag[i]), 2, H + 2);
      i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
    }
    g.lineTo(W, H + 2); g.lineTo(0, H + 2); g.closePath();
    g.fillStyle = tv('fcurve', '--curveFill');
    g.fill();
    g.beginPath();
    for (let i = 0; i < F_N; i++) {
      const xx = (i / (F_N - 1)) * W, yy = S33.clamp(y(fMag[i]), 2, H + 2);
      i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
    }
    g.strokeStyle = isLocked('freq') || isLocked('reso') ? tv('fcurve', '--lock') : tv('fcurve', '--curve');
    g.lineWidth = 2;
    g.stroke();
    // inviluppo del filtro: freccia verso dove arriva
    const fenv = getVal('fenv');
    if (fenv) {
      const peak = S33.clamp(base * Math.pow(2, (fenv / 64) * 7), 20, 20000);
      const x0 = (Math.log(base / 20) / Math.log(1000)) * W, x1 = (Math.log(peak / 20) / Math.log(1000)) * W;
      g.strokeStyle = tv('fcurve', '--curve'); g.globalAlpha = 0.5;
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x0, H - 8); g.lineTo(x1, H - 8); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = tv('fcurve', '--curve');
      g.beginPath(); g.arc(x1, H - 8, 3, 0, Math.PI * 2); g.fill();
    }
  }
  function drawAdsr() {
    const c = prepCanvas($('adsr'));
    if (!c) return;
    const { g, W, H } = c;
    const tw = (v) => 0.06 + Math.log10(1 + S33.envTime(v) * 30) / Math.log10(1 + 10 * 30);
    const a = tw(getVal('atk')), d = tw(getVal('dec')), r = tw(getVal('rel')), s = getVal('sus') / 127;
    const hold = 0.35, tot = a + d + hold + r, k = (W - 16) / tot;
    const top = H > 40 ? 8 : 3, bot = H - (H > 40 ? 6 : 3), hh = bot - top;
    const pts = [[8, bot], [8 + a * k, top], [8 + (a + d) * k, top + (1 - s) * hh], [8 + (a + d + hold) * k, top + (1 - s) * hh], [8 + tot * k, bot]];
    g.beginPath();
    pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy)));
    g.lineTo(pts[0][0], bot);
    g.fillStyle = tv('adsr', '--curveFill');
    g.fill();
    g.beginPath();
    pts.forEach(([x, yy], i) => (i ? g.lineTo(x, yy) : g.moveTo(x, yy)));
    g.strokeStyle = ['atk', 'dec', 'sus', 'rel'].some(isLocked) ? tv('adsr', '--lock') : tv('adsr', '--curve');
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = tv('adsr', '--curve');
    if (H > 40) pts.slice(1, 4).forEach(([x, yy]) => { g.beginPath(); g.arc(x, yy, 3, 0, Math.PI * 2); g.fill(); });
  }
  function drawLfo() {
    const c = prepCanvas($('lfoview'));
    if (!c) return;
    const { g, W, H } = c;
    const buf = engine.lfoBuffers[getVal('lwave')].getChannelData(0);
    const dep = 0.2 + 0.8 * (getVal('ldep') / 127);
    g.beginPath();
    for (let x = 0; x <= W; x++) {
      const ph = ((x / W) * 2) % 1;
      const v = buf[Math.floor(ph * (buf.length - 1))];
      const yy = H / 2 - v * dep * (H / 2 - 5);
      x ? g.lineTo(x, yy) : g.moveTo(x, yy);
    }
    g.strokeStyle = isLocked('ldep') ? tv('lfoview', '--lock') : tv('lfoview', '--curve');
    g.lineWidth = 2;
    g.stroke();
  }
  let panelsT = 0;
  function drawPanels() {
    // limita i ridisegni durante il trascinamento delle manopole
    cancelAnimationFrame(panelsT);
    panelsT = requestAnimationFrame(() => {
      if (ui.aux) return;
      drawFilter();
      drawAdsr();
      drawLfo();
      renderZones();
    });
  }
  const scopeBuf = new Float32Array(2048);
  function drawScope() {
    const c = prepCanvas($('scope'));
    if (!c) return;
    const { g, W, H } = c;
    const an = engine.auxAnalyser(ui.aux);
    const n = an.fftSize;
    const buf = scopeBuf.subarray(0, n);
    an.getFloatTimeDomainData(buf);
    const mid = H / 2;
    g.strokeStyle = tv('scope', '--grid');
    g.beginPath(); g.moveTo(0, mid + 0.5); g.lineTo(W, mid + 0.5); g.stroke();
    g.strokeStyle = tv('scope', '--curve');
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W, yy = mid - buf[i] * (H / 2) * 0.9;
      i ? g.lineTo(x, yy) : g.moveTo(x, yy);
    }
    g.stroke();
    if (ui.aux === 'mix') {
      const lv = [0, 1, 2, 3].map((i) => engine.meterLevel(i)).concat([engine.analyserLevel(engine.buses[0].meter), engine.analyserLevel(engine.buses[1].meter), engine.analyserLevel(engine.outMeter)]);
      const names = project.tracks.map((t) => t.name).concat(['BUS 1', 'BUS 2', 'OUT']);
      const cols = trackColors().concat([tv('scope', '--dimTxt'), tv('scope', '--dimTxt'), tv('scope', '--marker')]);
      const bw = W / lv.length;
      g.font = '800 10px Archivo, sans-serif';
      lv.forEach((v, i) => {
        const bh = Math.min(1, v) * (H - 40);
        g.fillStyle = v > 0.98 ? '#e8574a' : cols[i];
        g.fillRect(i * bw + bw * 0.32, H - 22 - bh, bw * 0.36, bh);
        g.fillStyle = tv('scope', '--dimTxt');
        g.fillText(names[i], i * bw + bw * 0.32, H - 6);
      });
    }
  }
  // display LCD in alto
  function renderInfo() {
    if (ui.aux) {
      $('lcdTrack').textContent = { bus1: 'B1', bus2: 'B2', dly: 'DL', rev: 'RV', cho: 'CH', mix: 'MX' }[ui.aux];
      $('lcdMain').textContent = S33.AUX[ui.aux].title;
      $('lcdSub').textContent = AUX_INFO[ui.aux].toUpperCase() + ' · ' + project.bpm + ' BPM';
      return;
    }
    const t = track();
    const e = currentEntry();
    $('lcdTrack').textContent = 'T' + (ui.track + 1);
    $('lcdMain').textContent = t.name + ' · ' + { single: 'SINGLE PLAYER', multi: 'MULTI PLAYER', sub: 'SUBTRACKS', grain: 'GRAINER' }[t.machine];
    const st = activeStep();
    const parts = [];
    if (st) {
      const n = Object.keys(st.locks).length;
      parts.push('<span class="lk">STEP ' + (activeStepIdx() + 1) + (ui.heldStep != null ? ' (TENUTO)' : '') + ' · ' + n + ' LOCK</span>');
      parts.push(st.notes.map(S33.noteName).join(' '));
    } else {
      parts.push(e ? e.label.toUpperCase() : '—');
      parts.push('TRIG ' + S33.noteName(t.trig.note));
    }
    if (project.scale) parts.push(S33.NOTE_NAMES[project.root] + ' ' + S33.SCALES[project.scale][0]);
    parts.push(project.bpm + ' BPM');
    $('lcdSub').innerHTML = parts.join(' · ');
  }
  function renderVoiceBars() {
    const box = $('voiceBars');
    if (!box.children.length) for (let i = 0; i < 8; i++) box.appendChild(document.createElement('span'));
    const n = ui.aux ? 0 : engine.tracks[ui.track].voices.filter((v) => !v.dead && engine.ctx.currentTime >= v.t).length;
    [...box.children].forEach((s, i) => {
      const on = i < n;
      s.classList.toggle('on', on);
      s.style.height = on ? 14 + ((i * 7) % 20) + 'px' : '3px';
    });
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
      if (project.songMode && project.song.length) {
        ui.songRow = 0; ui.songRep = 0; ui.nextPat = null;
        if (project.song[0].pat !== project.pat) { switchPattern(project.song[0].pat); renderAll(); }
      }
      seq.start();
    }
    $('play').classList.toggle('on', seq.playing);
    $('play').textContent = seq.playing ? '■ Stop' : '▶ Play';
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
    $('keyRoot').textContent = S33.NOTE_NAMES[project.root];
    $('keyScale').textContent = S33.SCALES[project.scale][0];
    $('snap').classList.toggle('on', project.snap);
    $('kbd').classList.toggle('on', ui.kbd);
  }

  /* ---------- note (MIDI e tastiera del computer) ---------- */
  // note di un accordo per la traccia (chord mode)
  const chordFor = (t, note) => S33.buildChord(note, t.params, project.root, project.scale);
  const makeStep = (t) => S33.newStep(t.trig, chordFor(t, t.trig.note));

  function noteOn(note, vel, opts = {}) {
    engine.resume();
    if (project.snap && !opts.raw) note = S33.snapToScale(note, project.root, project.scale);
    const t = track();
    const st = ui.aux ? null : activeStep();
    const first = ui.keysDown.size === 0;
    ui.keysDown.add(note);
    ui.lastNote[ui.track] = note;
    const notes = chordFor(t, note);
    const p = S33.resolveParams(t, st);
    const old = ui.liveVoices.get(note);
    if (old) old.forEach((v) => engine.release(v, engine.ctx.currentTime));
    ui.liveVoices.set(note, notes.map((n) => engine.play(ui.track, t.machine, p, n, vel, engine.ctx.currentTime, null)));
    flashTrack(ui.track);

    if (st) {
      // step selezionato/tenuto: suonare scrive nello step (accordo se chord mode, altrimenti accumula)
      if (first || t.params.chord) { st.notes = notes.slice(); st.vel = vel; }
      else notes.forEach((n) => { if (!st.notes.includes(n) && st.notes.length < 8) st.notes.push(n); });
      renderSteps(); renderKnobs(); renderInfo(); dirty();
    } else if (ui.rec && seq.playing) {
      const g = seq.nearestG();
      if (g != null) {
        const pos = g % t.length;
        const prev = ui.recWrites.get(ui.track + ':' + pos);
        const s = t.steps[pos];
        if (prev === g && s) {
          notes.forEach((n) => { if (!s.notes.includes(n) && s.notes.length < 8) s.notes.push(n); });
        } else {
          const ns = S33.newStep(t.trig, notes);
          ns.vel = vel;
          t.steps[pos] = ns;
          ui.recWrites.set(ui.track + ':' + pos, g);
        }
        renderSteps(); dirty();
      }
    } else if (!seq.playing) {
      t.trig.note = note;
      renderKnobs();
    }
    return note;
  }
  function noteOff(note) {
    if (project.snap && !ui.liveVoices.has(note)) note = S33.snapToScale(note, project.root, project.scale);
    ui.keysDown.delete(note);
    const v = ui.liveVoices.get(note);
    if (v) v.forEach((x) => engine.release(x, engine.ctx.currentTime));
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
    const k = focusKeys()[i];
    if (!k) return;
    const aux = ui.focus === 'aux';
    const mn = kDef(k, aux).min, mx = kMax(k, aux);
    kSet(k, mn + (val / 127) * (mx - mn), aux, { quiet: true });
  }

  let midiAccess = null;
  function setupMidi() {
    const st = $('midiStatus');
    if (!navigator.requestMIDIAccess) { st.textContent = 'MIDI non supportato'; return; }
    navigator.requestMIDIAccess().then((access) => {
      midiAccess = access;
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
      if (e.shiftKey && /^Digit[1-6]$/.test(e.code)) { if (ui.aux) { ui.aux = null; buildAuxKnobs(); } ui.focus = ui.trackFocus = FOCUS_ORDER[+e.code.slice(5) - 1]; renderAll(); return; }
      if (key === 'i') { toggleLibrary(); return; }
      if (key === 'p') { toggleDrawer('patDrawer'); return; }
      if (e.key === ',' || e.key === '.') { choosePattern((project.pat + (e.key === '.' ? 1 : S33.PATTERNS - 1)) % S33.PATTERNS); return; }
      if (/^Digit[1-4]$/.test(e.code)) { selectTrack(+e.code.slice(5) - 1); return; }
      if (key in KEYMAP) { noteOn(S33.clamp(60 + ui.octave * 12 + KEYMAP[key], 0, 127), 100); return; }
      if (key === 'z') { ui.octave = Math.max(-4, ui.octave - 1); toast('Ottava ' + (ui.octave >= 0 ? '+' : '') + ui.octave); renderSteps(); return; }
      if (key === 'x') { ui.octave = Math.min(4, ui.octave + 1); toast('Ottava ' + (ui.octave >= 0 ? '+' : '') + ui.octave); renderSteps(); return; }
      if (key === 'q') { ui.kbd = !ui.kbd; renderTransport(); renderSteps(); return; }
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
    S33.syncPattern(project);
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
      ui.track = 0; ui.selStep = null; ui.stepPage = 0; ui.aux = null;
      applyAllAudio();
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

  /* ---------- Recorder ---------- */
  let recorder = null;
  async function ensureRecorder() {
    if (recorder) return recorder;
    const r = new S33.Recorder(engine);
    await r.init();
    r.onState = updateRecUI;
    r.onDone = (buf, free) => {
      const take = S33.processTake(buf, { trim: free, normalize: ui.recNorm });
      if (!take) return toast('Registrazione vuota (silenzio)');
      ui.recCount++;
      const name = (ui.recSrc === 'in' ? 'IN ' : 'RS ') + String(ui.recCount).padStart(2, '0');
      pool.samples.push({ id: uid(), name, root: 60, buffer: take });
      toast(name + ' · ' + take.duration.toFixed(2) + ' s aggiunto ai campioni (clic per assegnarlo)');
      renderPool();
      dirty();
    };
    recorder = r;
    return r;
  }
  async function fillDevices() {
    const sel = $('recDev');
    try {
      const devs = await recorder.listInputs();
      sel.innerHTML = '';
      devs.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || 'Ingresso ' + (i + 1);
        sel.appendChild(o);
      });
      if (recorder.deviceId) sel.value = recorder.deviceId;
    } catch (e) {}
  }
  async function setRecSrc(src) {
    ui.recSrc = src;
    const r = await ensureRecorder();
    try {
      await r.setSource(src);
      if (src === 'in') await fillDevices();
    } catch (e) {
      toast('Accesso all\'ingresso audio negato');
      ui.recSrc = 'main';
      await r.setSource('main');
    }
    updateRecUI();
  }
  async function recGo() {
    engine.resume();
    const r = await ensureRecorder();
    if (r.state !== 'idle') { r.stop(); return; }
    if (ui.recSrc === 'in' && !r.inStream) await setRecSrc('in');
    if (!ui.recBars) { r.start(engine.ctx.currentTime + 0.01, 0); return; }
    const secs = ui.recBars * 16 * seq.stepDur();
    if (!seq.playing) {
      togglePlay();
      r.start(seq.t0, secs);
    } else {
      r.start(seq.nextBar().t, secs);
    }
  }
  function updateRecUI() {
    const st = recorder ? recorder.state : 'idle';
    const b = $('recGo');
    b.classList.toggle('arm', st === 'wait');
    b.classList.toggle('on', st === 'rec');
    b.title = st === 'idle' ? 'Campiona' : st === 'wait' ? 'In attesa della battuta' : 'Stop';
    $('recMeterBar').style.width = recorder ? Math.min(100, recorder.meter * 100) + '%' : '0';
    $('asMeter').style.width = recorder && AS.running ? Math.min(100, recorder.meter * 100) + '%' : '0';
    $('recMeterBar').classList.toggle('clip', !!(recorder && recorder.meter > 0.99));
    const secs = recorder && st === 'rec' ? (recorder.frames || 0) / engine.ctx.sampleRate : 0;
    $('recStatus').textContent = st === 'rec' ? 'REC ' + secs.toFixed(1) + ' s' : st === 'wait' ? 'parte alla prossima battuta' : ui.recSrc === 'in' ? 'ingresso audio' : 'ricampiona l\'uscita';
    $('recSrc').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.s === ui.recSrc));
    $('recLen').querySelectorAll('button').forEach((x) => x.classList.toggle('on', +x.dataset.b === ui.recBars));
    $('recDev').style.display = ui.recSrc === 'in' ? '' : 'none';
    $('recMon').classList.toggle('on', ui.recMon);
    $('recNorm').classList.toggle('on', ui.recNorm);
  }
  function setupRecorderUI() {
    $('recSrc').querySelectorAll('button').forEach((b) => (b.onclick = () => setRecSrc(b.dataset.s)));
    $('recLen').querySelectorAll('button').forEach((b) => (b.onclick = () => { ui.recBars = +b.dataset.b; updateRecUI(); }));
    $('recDev').onchange = async (e) => { try { await recorder.openInput(e.target.value); } catch (er) { toast('Ingresso non disponibile'); } };
    $('recMon').onclick = async () => { ui.recMon = !ui.recMon; (await ensureRecorder()).setMonitor(ui.recMon); updateRecUI(); };
    $('recNorm').onclick = () => { ui.recNorm = !ui.recNorm; updateRecUI(); };
    $('recGo').onclick = recGo;
    updateRecUI();
  }

  /* ---------- Auto Sampler ---------- */
  const AS = { ch: 1, from: 36, to: 84, step: 6, len: 2, tail: 1, vel: 100, running: false, abort: false };
  function renderAuto() {
    $('asCh').textContent = AS.ch;
    $('asFrom').textContent = S33.noteName(AS.from);
    $('asTo').textContent = S33.noteName(AS.to);
    $('asLen').textContent = AS.len.toFixed(1) + 's';
    $('asTail').textContent = AS.tail.toFixed(1) + 's';
    $('asVel').textContent = AS.vel;
    $('asStep').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === AS.step));
    const n = Math.floor((AS.to - AS.from) / AS.step) + 1;
    if (!AS.running) $('asInfo').textContent = n + ' note · circa ' + Math.round(n * (AS.len + AS.tail + 0.3)) + ' s';
    $('asGo').textContent = AS.running ? 'STOP' : 'AVVIA';
    $('asGo').classList.toggle('on', AS.running);
  }
  async function openAuto() {
    toggleDrawer('autoDrawer');
    if ($('autoDrawer').hidden) return;
    const outSel = $('asOut');
    outSel.innerHTML = '';
    if (midiAccess) midiAccess.outputs.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.id; op.textContent = o.name;
      outSel.appendChild(op);
    });
    if (!outSel.children.length) outSel.innerHTML = '<option value="">nessuna uscita MIDI</option>';
    const r = await ensureRecorder();
    try {
      if (!r.inStream) await r.openInput();
      const devs = await r.listInputs();
      const inSel = $('asIn');
      inSel.innerHTML = '';
      devs.forEach((d, i) => { const op = document.createElement('option'); op.value = d.deviceId; op.textContent = d.label || 'Ingresso ' + (i + 1); inSel.appendChild(op); });
      if (r.deviceId) inSel.value = r.deviceId;
    } catch (e) { toast('Serve l\'accesso all\'ingresso audio'); }
    renderAuto();
  }
  async function runAuto() {
    if (AS.running) { AS.abort = true; return; }
    const out = midiAccess && midiAccess.outputs.get($('asOut').value);
    if (!out) return toast('Scegli un\'uscita MIDI collegata al synth');
    engine.resume();
    const r = await ensureRecorder();
    try {
      await r.openInput($('asIn').value || undefined);
      await r.setSource('in');
      ui.recSrc = 'in';
    } catch (e) { return toast('Ingresso audio non disponibile'); }
    if (r.state !== 'idle') return toast('Il Recorder è già in uso');
    AS.running = true; AS.abort = false;
    renderAuto();
    const ch = (AS.ch - 1) & 15;
    const notes = [];
    for (let n = AS.from; n <= AS.to; n += AS.step) notes.push(n);
    const zones = [];
    for (let i = 0; i < notes.length && !AS.abort; i++) {
      const n = notes[i];
      $('asInfo').textContent = 'nota ' + (i + 1) + '/' + notes.length + ' · ' + S33.noteName(n);
      const at = engine.ctx.currentTime + 0.2;
      const msAt = performance.now() + 200 - (engine.ctx.outputLatency || 0) * 1000;
      const take = r.take(at, AS.len + AS.tail);
      out.send([0x90 | ch, n, AS.vel], msAt);
      out.send([0x80 | ch, n, 0], msAt + AS.len * 1000);
      const buf = await take;
      if (buf) zones.push({ root: n, name: S33.noteName(n), buffer: buf });
    }
    out.send([0xb0 | ((AS.ch - 1) & 15), 123, 0]); // all notes off
    AS.running = false;
    if (AS.abort && !zones.length) { renderAuto(); return toast('Auto Sampler interrotto'); }
    // taglia la latenza iniziale e normalizza tutte le zone con lo stesso guadagno
    let peak = 0;
    zones.forEach((z) => { for (let c = 0; c < z.buffer.numberOfChannels; c++) { const d = z.buffer.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); } });
    if (peak < 1e-4) { renderAuto(); return toast('Nessun segnale in ingresso: controlla il collegamento audio'); }
    const gain = 0.95 / peak, th = peak * 0.01;
    zones.forEach((z) => {
      const b = z.buffer, L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
      let a = 0;
      while (a < L.length && Math.abs(L[a]) < th && Math.abs(R[a]) < th) a++;
      a = Math.max(0, a - Math.round(b.sampleRate * 0.002));
      const len = Math.max(64, L.length - a);
      const nb = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: b.sampleRate });
      [L, R].forEach((d, c) => {
        const o = new Float32Array(len);
        for (let i = 0; i < len; i++) o[i] = (d[a + i] || 0) * gain;
        for (let i = 0; i < 256 && i < len; i++) o[len - 1 - i] *= i / 256;
        nb.copyToChannel(o, c);
      });
      z.buffer = nb;
    });
    const name = ($('asName').value.trim() || 'AUTO').slice(0, 20);
    pool.multis.push({ id: uid(), name, zones });
    assignToTrackNoLock('multi', pool.multis.length - 1);
    dirty();
    renderAuto();
    toast('Multicampione "' + name + '": ' + zones.length + ' zone');
  }
  function setupAutoUI() {
    $('asOpen').onclick = openAuto;
    $('asClose').onclick = () => toggleDrawer('autoDrawer');
    $('asGo').onclick = runAuto;
    $('asIn').onchange = async (e) => { try { (await ensureRecorder()).openInput(e.target.value); } catch (er) {} };
    $('asStep').querySelectorAll('button').forEach((b) => (b.onclick = () => { AS.step = +b.dataset.v; renderAuto(); }));
    dragNum($('asChF'), () => AS.ch, (v) => { AS.ch = S33.clamp(v, 1, 16); renderAuto(); });
    dragNum($('asFromF'), () => AS.from, (v) => { AS.from = S33.clamp(v, 0, AS.to); renderAuto(); }, 0.15);
    dragNum($('asToF'), () => AS.to, (v) => { AS.to = S33.clamp(v, AS.from, 127); renderAuto(); }, 0.15);
    dragNum($('asLenF'), () => Math.round(AS.len * 10), (v) => { AS.len = S33.clamp(v, 1, 100) / 10; renderAuto(); }, 0.3);
    dragNum($('asTailF'), () => Math.round(AS.tail * 10), (v) => { AS.tail = S33.clamp(v, 0, 100) / 10; renderAuto(); }, 0.3);
    dragNum($('asVelF'), () => AS.vel, (v) => { AS.vel = S33.clamp(v, 1, 127); renderAuto(); }, 0.3);
    $('asName').addEventListener('keydown', (e) => e.stopPropagation());
    renderAuto();
  }

  /* ---------- scala ---------- */
  function setupScaleUI() {
    setupDragField('rootField', () => project.root, (v) => { project.root = ((Math.round(v) % 12) + 12) % 12; renderTransport(); renderSteps(); dirty(); }, 0.1);
    setupDragField('scaleField', () => project.scale, (v) => { project.scale = Math.round(S33.clamp(v, 0, S33.SCALES.length - 1)); renderTransport(); renderSteps(); renderKnobs(); dirty(); }, 0.1);
    $('snap').onclick = () => { project.snap = !project.snap; renderTransport(); dirty(); };
    $('kbd').onclick = () => { ui.kbd = !ui.kbd; renderTransport(); renderSteps(); };
  }
  function applyAllAudio() {
    project.tracks.forEach((t, i) => { engine.updateLfo(i, t.params, project.bpm); engine.setRoute(i, t.params.out); });
    engine.applyFx(project.fx, project.bpm);
  }

  function toggleLibrary() {
    $('patDrawer').hidden = true;
    $('library').hidden = !$('library').hidden;
    $('btnLib').classList.toggle('on', !$('library').hidden);
    if (!$('library').hidden) renderPool();
  }
  function toggleDrawer(id) {
    const el = $(id);
    const show = el.hidden;
    document.querySelectorAll('.drawer, #library').forEach((d) => (d.hidden = true));
    $('btnLib').classList.remove('on');
    el.hidden = !show;
    if (show) renderPatterns();
  }

  /* ---------- pattern e song ---------- */
  ui.nextPat = null;
  ui.songRow = 0;
  ui.songRep = 0;
  let patClip = null;
  let boundaryFlag = false;
  function switchPattern(i) {
    S33.loadPattern(project, i);
    ui.selStep = null;
    ui.heldStep = null;
    ui.stepPage = 0;
  }
  function choosePattern(i) {
    if (seq.playing && project.songMode && project.song.length) return toast('In song mode i pattern li sceglie la catena');
    if (seq.playing) {
      ui.nextPat = i === project.pat ? null : i;
      renderPatterns();
      return;
    }
    switchPattern(i);
    renderAll();
    dirty();
  }
  // chiamata dal sequencer alla fine di ogni giro del pattern
  seq.onBoundary = () => {
    let target = null;
    if (project.songMode && project.song.length) {
      ui.songRep++;
      const row = project.song[ui.songRow];
      if (!row || ui.songRep >= row.rep) {
        ui.songRow = (ui.songRow + 1) % project.song.length;
        ui.songRep = 0;
        target = project.song[ui.songRow].pat;
      }
    } else if (ui.nextPat != null) {
      target = ui.nextPat;
      ui.nextPat = null;
    }
    boundaryFlag = true;
    if (target == null || target === project.pat) return false;
    switchPattern(target);
    return true;
  };
  function dragNum(el, get, set, per = 0.08) {
    let y0 = null, v0 = 0;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = get(); e.stopPropagation(); });
    el.addEventListener('pointermove', (e) => { if (y0 != null) set(Math.round(v0 + (y0 - e.clientY) * per)); });
    el.addEventListener('pointerup', () => (y0 = null));
    el.addEventListener('wheel', (e) => { e.preventDefault(); set(get() + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  }
  function buildPatternUI() {
    const grid = $('patGrid');
    for (let i = 0; i < S33.PATTERNS; i++) {
      const b = document.createElement('button');
      b.textContent = S33.patName(i);
      b.onclick = () => choosePattern(i);
      grid.appendChild(b);
    }
    $('ptnBtn').onclick = () => toggleDrawer('patDrawer');
    $('patClose').onclick = () => toggleDrawer('patDrawer');
    $('patCopy').onclick = () => { patClip = S33.copyPattern(project.tracks); toast('Pattern ' + S33.patName(project.pat) + ' copiato'); };
    $('patPaste').onclick = () => {
      if (!patClip) return toast('Niente da incollare: copia prima un pattern');
      S33.copyPattern(patClip).forEach((pt, k) => { project.tracks[k].steps = pt.steps; project.tracks[k].length = pt.length; });
      S33.syncPattern(project);
      ui.selStep = null;
      renderAll(); dirty();
      toast('Incollato nel pattern ' + S33.patName(project.pat));
    };
    $('patClear').onclick = () => {
      if (!confirm('Cancellare tutti gli step del pattern ' + S33.patName(project.pat) + '?')) return;
      project.tracks.forEach((t) => t.steps.fill(null));
      ui.selStep = null;
      renderAll(); dirty();
    };
    $('songMode').onclick = () => {
      project.songMode = !project.songMode;
      if (project.songMode && !project.song.length) project.song.push({ pat: project.pat, rep: 1 });
      ui.nextPat = null;
      renderPatterns(); dirty();
    };
    $('songAdd').onclick = () => { project.song.push({ pat: project.pat, rep: 1 }); renderPatterns(); dirty(); };
  }
  function renderPatterns() {
    $('ptnName').textContent = S33.patName(project.pat);
    $('ptnNext').textContent = ui.nextPat != null ? ' → ' + S33.patName(ui.nextPat) : project.songMode && project.song.length ? ' SONG' : '';
    if ($('patDrawer').hidden) return;
    [...$('patGrid').children].forEach((b, i) => {
      b.classList.toggle('cur', i === project.pat);
      b.classList.toggle('next', i === ui.nextPat);
      b.classList.toggle('data', S33.patternHasData(project, i));
    });
    $('songMode').classList.toggle('on', project.songMode);
    const box = $('songRows');
    box.innerHTML = '';
    project.song.forEach((row, r) => {
      const el = document.createElement('div');
      el.className = 'srow' + (seq.playing && project.songMode && r === ui.songRow ? ' cur' : '');
      el.innerHTML = `<span class="ix">${r + 1}</span>PTN<span class="pv">${S33.patName(row.pat)}</span>×<span class="rv">${row.rep}</span><span class="sp"></span>
        <button title="Su">▲</button><button title="Giù">▼</button><button title="Elimina">✕</button>`;
      dragNum(el.querySelector('.pv'), () => row.pat, (v) => { row.pat = S33.clamp(v, 0, S33.PATTERNS - 1); el.querySelector('.pv').textContent = S33.patName(row.pat); dirty(); });
      dragNum(el.querySelector('.rv'), () => row.rep, (v) => { row.rep = S33.clamp(v, 1, 64); el.querySelector('.rv').textContent = row.rep; dirty(); });
      const [up, dn, del] = el.querySelectorAll('button');
      up.onclick = () => { if (r > 0) { project.song.splice(r - 1, 0, project.song.splice(r, 1)[0]); renderPatterns(); dirty(); } };
      dn.onclick = () => { if (r < project.song.length - 1) { project.song.splice(r + 1, 0, project.song.splice(r, 1)[0]); renderPatterns(); dirty(); } };
      del.onclick = () => { project.song.splice(r, 1); if (!project.song.length) project.songMode = false; renderPatterns(); dirty(); };
      box.appendChild(el);
    });
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
    renderPatterns();
  }

  function frame() {
    const now = engine.ctx.currentTime;
    let changed = false;
    while (seq.uiQueue.length && seq.uiQueue[0].t <= now) {
      ui.playG = seq.uiQueue.shift().g;
      changed = true;
    }
    if (boundaryFlag) { boundaryFlag = false; renderAll(); }
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
    for (let i = 0; i < S33.TRACKS; i++) {
      cards[i].querySelector('.pad').classList.toggle('hit', pn < ui.ledUntil[i]);
      cards[i].querySelector('.meter').style.width = Math.min(42, engine.meterLevel(i) * 60) + 'px';
    }
    renderVoiceBars();
    document.querySelectorAll('.auxbtn').forEach((b) => {
      b.querySelector('.am').style.width = Math.min(100, engine.analyserLevel(engine.auxAnalyser(b.dataset.id)) * 140) + '%';
    });
    if (recorder) updateRecUI();
    if (ui.aux) drawScope(); else { drawWave(); renderZones(); }
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
  buildPanels();
  buildSteps();
  buildPatternUI();
  setupAutoUI();
  setupDrops();
  setupMidi();
  setupKeys();
  $('play').onclick = togglePlay;
  $('btnLib').onclick = toggleLibrary;
  $('btnTheme').onclick = cycleTheme;
  applyTheme();
  $('libClose').onclick = toggleLibrary;
  $('auxBack').onclick = () => { ui.aux = null; ui.focus = ui.trackFocus; buildAuxKnobs(); renderAll(); };
  window.addEventListener('resize', () => renderKnobs());
  $('fill').addEventListener('pointerdown', () => setFill(!seq.fill));
  $('rec').onclick = () => { ui.rec = !ui.rec; ui.recWrites.clear(); renderTransport(); };
  $('follow').onclick = () => { ui.follow = !ui.follow; renderTransport(); };
  $('btnSave').onclick = saveProject;
  $('btnOpen').onclick = openProject;
  $('fileProject').onchange = (e) => { if (e.target.files[0]) openProjectFile(e.target.files[0]); e.target.value = ''; };
  $('btnNew').onclick = () => {
    if (!confirm('Caricare il progetto demo? Il lavoro non salvato su file andrà perso.')) return;
    if (seq.playing) togglePlay();
    project = migrate(S33.demoProject());
    pool = { samples: factory.samples.slice(), multis: factory.multis.slice() };
    engine.pool = pool;
    ui.track = 0; ui.selStep = null; ui.stepPage = 0; ui.aux = null;
    applyAllAudio();
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
    applyFx();
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

  setupRecorderUI();
  setupScaleUI();
  applyAllAudio();
  renderAll();
  requestAnimationFrame(frame);
  window.__prisma = { get recorder() { return recorder; }, ensureRecorder, engine, seq, get project() { return project; }, get pool() { return pool; }, ui, noteOn, noteOff, setVal, togglePlay, cc };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
