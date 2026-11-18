/* S33 - Prisma · modello del progetto e sequencer (p-lock, trig condition, microtiming, fill) */
(function () {
  const S33 = window.S33;
  S33.MAX_STEPS = 64;
  S33.TRACKS = 4;

  S33.newStep = (trig, notes) => ({
    notes: notes ? notes.slice() : [trig.note],
    vel: trig.vel, len: trig.len, micro: trig.micro, cond: trig.cond, locks: {},
  });

  S33.newTrack = (i) => ({
    name: 'T' + (i + 1),
    machine: 'single',
    params: S33.defaultParams(),
    trig: S33.defaultTrig(),
    length: 16,
    mute: false,
    solo: false,
    steps: new Array(S33.MAX_STEPS).fill(null),
  });

  // parametri effettivi per uno step: valori traccia + p-lock
  S33.resolveParams = (track, step) => {
    if (!step || !step.locks) return track.params;
    const p = Object.assign({}, track.params);
    for (const k in step.locks) p[k] = step.locks[k];
    return p;
  };

  class Sequencer {
    constructor(engine, getProject) {
      this.engine = engine;
      this.getProject = getProject;
      this.playing = false;
      this.fill = false;
      this.lookahead = 0.12;
      this.uiQueue = [];
      this.grid = []; // [{g, t}] ultimi step schedulati (per registrazione live)
      this.onStep = null;
    }

    stepDur() {
      return 60 / this.getProject().bpm / 4;
    }

    start() {
      const ctx = this.engine.ctx;
      this.playing = true;
      this.g = 0;
      this.gridT = ctx.currentTime + 0.06;
      this.state = Array.from({ length: S33.TRACKS }, () => ({ pre: true }));
      this.uiQueue.length = 0;
      this.grid.length = 0;
      this._tick();
      this.timer = setInterval(() => this._tick(), 20);
    }

    stop() {
      this.playing = false;
      clearInterval(this.timer);
      this.uiQueue.length = 0;
    }

    swingOffset(g) {
      const sw = this.getProject().swing; // 50..80
      return g % 2 === 1 ? ((sw - 50) / 100) * 2 * this.stepDur() : 0;
    }

    _tick() {
      if (!this.playing) return;
      const ctx = this.engine.ctx;
      while (this.gridT < ctx.currentTime + this.lookahead) {
        this._scheduleGrid(this.g, this.gridT);
        this.uiQueue.push({ g: this.g, t: this.gridT + this.swingOffset(this.g) });
        this.grid.push({ g: this.g, t: this.gridT + this.swingOffset(this.g) });
        if (this.grid.length > 8) this.grid.shift();
        this.gridT += this.stepDur();
        this.g++;
      }
    }

    // pianifica gli step con micro >= 0 di g e quelli con micro < 0 di g+1
    _scheduleGrid(g, gridT) {
      const proj = this.getProject();
      const sd = this.stepDur();
      const anySolo = proj.tracks.some((t) => t.solo);
      proj.tracks.forEach((track, ti) => {
        const audible = !track.mute && (!anySolo || track.solo);
        const a = this._stepAt(track, g);
        if (a && a.micro >= 0) this._fire(ti, track, a, g, gridT + this.swingOffset(g) + (a.micro / 24) * sd, audible);
        const b = this._stepAt(track, g + 1);
        if (b && b.micro < 0) this._fire(ti, track, b, g + 1, gridT + sd + this.swingOffset(g + 1) + (b.micro / 24) * sd, audible);
      });
    }

    _stepAt(track, g) {
      return track.steps[g % track.length] || null;
    }

    _cond(ti, step, iter) {
      const c = S33.COND[step.cond] || S33.COND[0];
      const st = this.state[ti];
      let r;
      switch (c.k) {
        case 'none': return true;
        case 'prob': r = Math.random() * 100 < c.p; break;
        case 'fill': r = this.fill; break;
        case 'nfill': r = !this.fill; break;
        case 'pre': return st.pre;
        case 'npre': return !st.pre;
        case 'first': r = iter === 0; break;
        case 'nfirst': r = iter !== 0; break;
        case 'ratio': r = iter % c.b === c.a - 1; break;
        default: r = true;
      }
      st.pre = r;
      return r;
    }

    _fire(ti, track, step, g, time, audible) {
      const iter = Math.floor(g / track.length);
      if (!this._cond(ti, step, iter)) return;
      if (!audible) return;
      const p = S33.resolveParams(track, step);
      const gate = S33.LEN[step.len] * this.stepDur();
      const vel = step.vel;
      for (const n of step.notes) this.engine.play(ti, track.machine, p, n, vel, time, gate);
      if (this.onStep) this.onStep(ti, time);
    }

    // per la registrazione live: indice globale dello step più vicino a "adesso"
    nearestG() {
      if (!this.grid.length) return null;
      const now = this.engine.ctx.currentTime - (this.engine.ctx.outputLatency || 0);
      let best = this.grid[0];
      for (const e of this.grid) if (Math.abs(e.t - now) < Math.abs(best.t - now)) best = e;
      return best.g;
    }
  }
  S33.Sequencer = Sequencer;

  /* ---------- progetto demo ---------- */
  S33.demoProject = () => {
    const tracks = Array.from({ length: S33.TRACKS }, (_, i) => S33.newTrack(i));
    const put = (t, i, o = {}) => {
      const s = S33.newStep(t.trig, o.notes);
      Object.assign(s, o, { notes: o.notes || [t.trig.note], locks: o.locks || {} });
      t.steps[i] = s;
      return s;
    };
    const condIdx = (label) => S33.COND.findIndex((c) => c.label === label);
    const lenIdx = (v) => S33.LEN.indexOf(v);

    // T1 kick
    const k = tracks[0];
    k.name = 'KICK';
    k.params.smp = 0; k.params.dec = 85; k.params.rel = 40; k.params.vol = 112;
    [0, 4, 8, 12].forEach((i) => put(k, i, { vel: 120 }));
    put(k, 10, { vel: 70, cond: condIdx('2:4') });
    put(k, 15, { vel: 90, cond: condIdx('FILL') });

    // T2 snare
    const s = tracks[1];
    s.name = 'SNARE';
    s.params.smp = 1; s.params.vol = 96;
    put(s, 4, { vel: 110 });
    put(s, 12, { vel: 110, locks: { smp: 2 } }); // p-lock: clap sul secondo colpo
    put(s, 7, { vel: 45, cond: condIdx('50%'), micro: 6 });
    put(s, 14, { vel: 60, cond: condIdx('FILL'), locks: { tune: 3 } });
    put(s, 15, { vel: 75, cond: condIdx('FILL'), locks: { tune: 7 } });

    // T3 hats
    const h = tracks[2];
    h.name = 'HATS';
    h.params.smp = 3; h.params.vol = 84; h.params.pan = 10; h.params.ftype = 2; h.params.freq = 70;
    for (let i = 0; i < 16; i += 2) put(h, i, { vel: i % 4 === 0 ? 100 : 72 });
    put(h, 3, { vel: 50, cond: condIdx('33%'), micro: -4 });
    put(h, 11, { vel: 55, cond: condIdx('50%') });
    put(h, 14, { vel: 90, locks: { smp: 4, dec: 95 }, len: lenIdx(2) }); // p-lock: hat aperto
    h.params.lwave = 1; h.params.lsync = 1; h.params.lrate = Math.round((9 / 14) * 127); h.params.ldest = 3; h.params.ldep = 40;

    // T4 keys (multi player)
    const p = tracks[3];
    p.name = 'KEYS';
    p.machine = 'multi';
    p.length = 64;
    Object.assign(p.params, { smp: 0, freq: 82, reso: 22, fenv: 12, fdec: 80, ktrk: 50, atk: 8, dec: 95, sus: 70, rel: 70, vol: 92, lwave: 0, lsync: 1, lrate: Math.round((11 / 14) * 127), ldest: 1, ldep: 26 });
    p.trig.len = lenIdx(4);
    const chords = [
      [53, 57, 60, 64], // Fmaj7
      [52, 55, 59, 62], // Em7
      [50, 53, 57, 60], // Dm7
      [48, 52, 55, 59], // Cmaj7
    ];
    chords.forEach((c, j) => {
      put(p, j * 16, { notes: c, vel: 96, len: lenIdx(8) });
      put(p, j * 16 + 10, { notes: c.slice(1), vel: 70, len: lenIdx(2), cond: condIdx('1:2'), locks: { freq: 100 } });
      put(p, j * 16 + 14, { notes: [c[3] + 12], vel: 64, len: lenIdx(1), cond: condIdx('59%'), micro: 5 });
    });
    p.trig.note = 60;

    return { name: 'Demo', bpm: 112, swing: 56, tracks, version: 1 };
  };
})();
