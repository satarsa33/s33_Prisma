/* S33 - Prisma · definizioni parametri, liste e utilità */
(function () {
  const S33 = (window.S33 = window.S33 || {});

  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // Convenzione Logic/Yamaha: MIDI 60 = C3
  S33.noteName = (n) => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 2);

  // Durate delle note in step (1 step = 1/16)
  S33.LEN = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
  const lenFmt = (i) => {
    const v = S33.LEN[i];
    if (v === 0.125) return '1/8';
    if (v === 0.25) return '1/4';
    if (v === 0.5) return '1/2';
    if (v === 0.75) return '3/4';
    return String(v);
  };

  // Trig condition (stile Elektron)
  const COND = [{ k: 'none', label: '—' }];
  [1, 2, 4, 6, 9, 13, 19, 25, 33, 41, 50, 59, 67, 75, 81, 87, 91, 94, 96, 98, 99].forEach((p) =>
    COND.push({ k: 'prob', p, label: p + '%' })
  );
  [['fill', 'FILL'], ['nfill', '!FILL'], ['pre', 'PRE'], ['npre', '!PRE'], ['first', '1ST'], ['nfirst', '!1ST']].forEach(
    ([k, label]) => COND.push({ k, label })
  );
  for (let b = 2; b <= 8; b++) for (let a = 1; a <= b; a++) COND.push({ k: 'ratio', a, b, label: a + ':' + b });
  S33.COND = COND;

  S33.FTYPES = ['LP', 'BP', 'HP'];
  S33.LWAVES = ['SIN', 'TRI', 'SAW', 'SQR', 'S&H', 'RND'];
  S33.LDEST = ['PITCH', 'FREQ', 'AMP', 'PAN'];
  // LFO sincronizzato: periodo in step
  S33.LSYNC = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 128];

  // tempo inviluppi: 0..127 → 1 ms .. 10 s (esponenziale)
  S33.envTime = (v) => 0.001 * Math.pow(10000, v / 127);
  const fmtTime = (v) => {
    const t = S33.envTime(v);
    return t < 1 ? Math.round(t * 1000) + 'ms' : t.toFixed(t < 10 ? 2 : 1) + 's';
  };
  S33.cutoffHz = (v) => 20 * Math.pow(1000, v / 127);
  const fmtHz = (v) => {
    const h = S33.cutoffHz(v);
    return h >= 1000 ? (h / 1000).toFixed(h >= 10000 ? 1 : 2) + 'k' : Math.round(h) + 'Hz';
  };
  S33.lfoHz = (v) => 0.03 * Math.pow(1000, v / 127);
  const pct = (v) => Math.round(v * 100) + '%';
  const signed = (v) => (v > 0 ? '+' : '') + v;
  const onOff = (v) => (v ? 'ON' : 'OFF');

  // k: chiave, lock: bloccabile per step (p-lock)
  S33.PARAMS = {
    // TRIG (attributi dello step)
    note: { label: 'NOTE', min: 0, max: 127, step: 1, def: 60, fmt: S33.noteName, trig: true },
    vel: { label: 'VEL', min: 1, max: 127, step: 1, def: 100, trig: true },
    len: { label: 'LEN', min: 0, max: S33.LEN.length - 1, step: 1, def: 4, fmt: lenFmt, trig: true },
    micro: { label: 'MICRO', min: -23, max: 23, step: 1, def: 0, fmt: (v) => (v === 0 ? '0' : signed(v) + '/384'), trig: true },
    cond: { label: 'COND', min: 0, max: COND.length - 1, step: 1, def: 0, fmt: (v) => COND[v].label, trig: true },
    // SRC
    smp: { label: 'SAMPLE', min: 0, max: 0, step: 1, def: 0, lock: true, dynamic: true },
    tune: { label: 'TUNE', min: -24, max: 24, step: 1, def: 0, fmt: signed, lock: true },
    fine: { label: 'FINE', min: -100, max: 100, step: 1, def: 0, fmt: (v) => signed(v) + 'c', lock: true },
    start: { label: 'START', min: 0, max: 1, step: 0.001, def: 0, fmt: pct, lock: true },
    end: { label: 'END', min: 0, max: 1, step: 0.001, def: 1, fmt: pct, lock: true },
    loop: { label: 'LOOP', min: 0, max: 1, step: 1, def: 0, fmt: onOff, lock: true },
    rev: { label: 'REV', min: 0, max: 1, step: 1, def: 0, fmt: onOff, lock: true },
    level: { label: 'LEVEL', min: 0, max: 127, step: 1, def: 110, lock: true },
    // FLTR
    ftype: { label: 'TYPE', min: 0, max: 2, step: 1, def: 0, fmt: (v) => S33.FTYPES[v], lock: true },
    freq: { label: 'FREQ', min: 0, max: 127, step: 1, def: 127, fmt: fmtHz, lock: true },
    reso: { label: 'RESO', min: 0, max: 127, step: 1, def: 0, lock: true },
    fenv: { label: 'ENV', min: -64, max: 63, step: 1, def: 0, fmt: signed, lock: true },
    fatk: { label: 'F.ATK', min: 0, max: 127, step: 1, def: 0, fmt: fmtTime, lock: true },
    fdec: { label: 'F.DEC', min: 0, max: 127, step: 1, def: 70, fmt: fmtTime, lock: true },
    ktrk: { label: 'KEYTRK', min: 0, max: 127, step: 1, def: 0, lock: true },
    fvel: { label: 'F.VEL', min: 0, max: 127, step: 1, def: 0, lock: true },
    // AMP
    atk: { label: 'ATK', min: 0, max: 127, step: 1, def: 0, fmt: fmtTime, lock: true },
    dec: { label: 'DEC', min: 0, max: 127, step: 1, def: 80, fmt: fmtTime, lock: true },
    sus: { label: 'SUS', min: 0, max: 127, step: 1, def: 127, lock: true },
    rel: { label: 'REL', min: 0, max: 127, step: 1, def: 50, fmt: fmtTime, lock: true },
    pan: { label: 'PAN', min: -64, max: 63, step: 1, def: 0, fmt: (v) => (v === 0 ? 'C' : v < 0 ? 'L' + -v : 'R' + v), lock: true },
    vol: { label: 'VOL', min: 0, max: 127, step: 1, def: 100, lock: true },
    avel: { label: 'VEL>AMP', min: 0, max: 127, step: 1, def: 90, lock: true },
    // LFO (solo DEPTH bloccabile)
    lwave: { label: 'WAVE', min: 0, max: S33.LWAVES.length - 1, step: 1, def: 0, fmt: (v) => S33.LWAVES[v] },
    lsync: { label: 'SYNC', min: 0, max: 1, step: 1, def: 1, fmt: onOff },
    lrate: { label: 'RATE', min: 0, max: 127, step: 1, def: 64, rate: true },
    ldest: { label: 'DEST', min: 0, max: S33.LDEST.length - 1, step: 1, def: 1, fmt: (v) => S33.LDEST[v] },
    ldep: { label: 'DEPTH', min: 0, max: 127, step: 1, def: 0, lock: true },
  };

  S33.PAGES = {
    TRIG: ['note', 'vel', 'len', 'micro', 'cond', null, null, null],
    SRC: ['smp', 'tune', 'fine', 'start', 'end', 'loop', 'rev', 'level'],
    FLTR: ['ftype', 'freq', 'reso', 'fenv', 'fatk', 'fdec', 'ktrk', 'fvel'],
    AMP: ['atk', 'dec', 'sus', 'rel', 'pan', 'vol', 'avel', null],
    LFO: ['lwave', 'lsync', 'lrate', 'ldest', 'ldep', null, null, null],
  };
  S33.PAGE_NAMES = Object.keys(S33.PAGES);

  // indice LFO sincronizzato a partire da lrate 0..127
  S33.lsyncIndex = (v) => Math.round((v / 127) * (S33.LSYNC.length - 1));
  S33.fmtRate = (v, synced) => {
    if (synced) {
      const s = S33.LSYNC[S33.lsyncIndex(v)];
      return s < 1 ? '1/' + 1 / s + 'st' : s + 'st';
    }
    const h = S33.lfoHz(v);
    return (h < 1 ? h.toFixed(2) : h < 10 ? h.toFixed(1) : Math.round(h)) + 'Hz';
  };

  S33.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  S33.defaultParams = () => {
    const p = {};
    for (const k in S33.PARAMS) if (!S33.PARAMS[k].trig) p[k] = S33.PARAMS[k].def;
    return p;
  };
  S33.defaultTrig = () => ({ note: 60, vel: 100, len: 4, micro: 0, cond: 0 });

  // Riconosce una nota nel nome file: "Piano_C3.wav", "EP F#2", "sax-60.wav"
  S33.parseNoteFromName = (name) => {
    const base = name.replace(/\.[a-z0-9]+$/i, '');
    const re = /(?:^|[^A-Za-z0-9])([A-Ga-g])(#|b|s)?(-?\d)(?![0-9])/g;
    let m, last = null;
    while ((m = re.exec(base))) last = m;
    if (last) {
      let n = NAMES.indexOf(last[1].toUpperCase());
      if (last[2] === '#' || last[2] === 's') n += 1;
      if (last[2] === 'b') n -= 1;
      return n + (parseInt(last[3], 10) + 2) * 12; // C3 = 60
    }
    const num = base.match(/(?:^|[^0-9])(\d{2,3})(?:[^0-9]|$)/g);
    if (num) {
      const v = parseInt(num[num.length - 1].replace(/\D/g, ''), 10);
      if (v >= 12 && v <= 120) return v;
    }
    return null;
  };
})();
