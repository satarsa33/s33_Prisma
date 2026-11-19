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
    // GRAIN (machine granulare, bloccabili)
    gpos: { label: 'POS', min: 0, max: 1, step: 0.001, def: 0.3, fmt: pct, lock: true },
    gsize: { label: 'SIZE', min: 0, max: 127, step: 1, def: 60, fmt: (v) => { const t = 0.005 * Math.pow(200, v / 127); return t < 1 ? Math.round(t * 1000) + 'ms' : t.toFixed(2) + 's'; }, lock: true },
    gdens: { label: 'DENSITY', min: 0, max: 127, step: 1, def: 75, fmt: (v) => Math.pow(120, v / 127).toFixed(1) + '/s', lock: true },
    gspray: { label: 'SPRAY', min: 0, max: 127, step: 1, def: 20, lock: true },
    gjit: { label: 'JITTER', min: 0, max: 127, step: 1, def: 8, fmt: (v) => '±' + Math.round((v / 127) * 100) + 'c', lock: true },
    gscan: { label: 'SCAN', min: -64, max: 63, step: 1, def: 0, fmt: (v) => (v === 0 ? 'FREEZE' : ((v / 64) * 2).toFixed(2) + '×'), lock: true },
    // SUBTRACKS (impostazioni della sottotraccia selezionata)
    slot: { label: 'SLOT', min: 0, max: 7, step: 1, def: 0, fmt: (v) => 'SUB ' + (v + 1) + ' · ' + S33.noteName(60 + v), ui: true },
    ssmp: { label: 'S.SAMPLE', min: 0, max: 0, step: 1, def: 0, dynamic: true, sub: true },
    stune: { label: 'S.TUNE', min: -24, max: 24, step: 1, def: 0, fmt: signed, sub: true },
    slvl: { label: 'S.LEVEL', min: 0, max: 127, step: 1, def: 110, sub: true },
    span: { label: 'S.PAN', min: -64, max: 63, step: 1, def: 0, fmt: (v) => (v === 0 ? 'C' : v < 0 ? 'L' + -v : 'R' + v), sub: true },
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
    avel: { label: 'VELO', min: 0, max: 127, step: 1, def: 90, lock: true },
    // FX per voce (bloccabili) + uscita di traccia
    drive: { label: 'DRIVE', min: 0, max: 127, step: 1, def: 0, lock: true },
    bits: { label: 'BITS', min: 0, max: 15, step: 1, def: 0, fmt: (v) => (v === 0 ? 'OFF' : 17 - v + 'bit'), lock: true },
    sdly: { label: 'DELAY', min: 0, max: 127, step: 1, def: 0, lock: true },
    srev: { label: 'REVERB', min: 0, max: 127, step: 1, def: 0, lock: true },
    scho: { label: 'CHORUS', min: 0, max: 127, step: 1, def: 0, lock: true },
    out: { label: 'OUT', min: 0, max: 2, step: 1, def: 0, fmt: (v) => ['MAIN', 'BUS 1', 'BUS 2'][v] },
    // chord mode (impostazioni di traccia)
    chord: { label: 'CHORD', min: 0, max: 0, step: 1, def: 0, dynamic: true, fmt: (v) => S33.CHORDS[v].label },
    inv: { label: 'INV', min: -3, max: 3, step: 1, def: 0, fmt: (v) => (v > 0 ? '+' : '') + v },
    voic: { label: 'VOICING', min: 0, max: 3, step: 1, def: 0, fmt: (v) => ['CLOSE', 'OPEN', 'DROP2', 'WIDE'][v] },
    // LFO (solo DEPTH bloccabile)
    lwave: { label: 'WAVE', min: 0, max: S33.LWAVES.length - 1, step: 1, def: 0, fmt: (v) => S33.LWAVES[v] },
    lsync: { label: 'SYNC', min: 0, max: 1, step: 1, def: 1, fmt: onOff },
    lrate: { label: 'RATE', min: 0, max: 127, step: 1, def: 64, rate: true },
    ldest: { label: 'DEST', min: 0, max: S33.LDEST.length - 1, step: 1, def: 1, fmt: (v) => S33.LDEST[v] },
    ldep: { label: 'DEPTH', min: 0, max: 127, step: 1, def: 0, lock: true },
  };

  S33.PAGES = {
    TRIG: ['note', 'vel', 'len', 'micro', 'cond', 'chord', 'inv', 'voic'],
    SRC: ['smp', 'tune', 'fine', 'start', 'end', 'loop', 'rev', 'level'],
    FLTR: ['ftype', 'freq', 'reso', 'fenv', 'fatk', 'fdec', 'ktrk', 'fvel'],
    AMP: ['atk', 'dec', 'sus', 'rel', 'pan', 'vol', 'avel', null],
    FX: ['drive', 'bits', 'sdly', 'srev', 'scho', 'out', null, null],
    LFO: ['lwave', 'lsync', 'lrate', 'ldest', 'ldep', null, null, null],
  };
  S33.PAGE_NAMES = Object.keys(S33.PAGES);

  /* ---------- scale ---------- */
  S33.SCALES = [
    ['CHROMATIC', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    ['MAJOR', [0, 2, 4, 5, 7, 9, 11]],
    ['MINOR', [0, 2, 3, 5, 7, 8, 10]],
    ['HARM MIN', [0, 2, 3, 5, 7, 8, 11]],
    ['MEL MIN', [0, 2, 3, 5, 7, 9, 11]],
    ['DORIAN', [0, 2, 3, 5, 7, 9, 10]],
    ['PHRYGIAN', [0, 1, 3, 5, 7, 8, 10]],
    ['LYDIAN', [0, 2, 4, 6, 7, 9, 11]],
    ['MIXOLYD', [0, 2, 4, 5, 7, 9, 10]],
    ['LOCRIAN', [0, 1, 3, 5, 6, 8, 10]],
    ['MAJ PENTA', [0, 2, 4, 7, 9]],
    ['MIN PENTA', [0, 3, 5, 7, 10]],
    ['BLUES', [0, 3, 5, 6, 7, 10]],
    ['MAJ BLUES', [0, 2, 3, 4, 7, 9]],
    ['WHOLE TONE', [0, 2, 4, 6, 8, 10]],
    ['DIM HW', [0, 1, 3, 4, 6, 7, 9, 10]],
    ['DIM WH', [0, 2, 3, 5, 6, 8, 9, 11]],
    ['PHRYG DOM', [0, 1, 4, 5, 7, 8, 10]],
    ['LYD DOM', [0, 2, 4, 6, 7, 9, 10]],
    ['ALTERED', [0, 1, 3, 4, 6, 8, 10]],
    ['HUNG MIN', [0, 2, 3, 6, 7, 8, 11]],
    ['DBL HARM', [0, 1, 4, 5, 7, 8, 11]],
    ['NEAPOL MIN', [0, 1, 3, 5, 7, 8, 11]],
    ['BEBOP DOM', [0, 2, 4, 5, 7, 9, 10, 11]],
    ['HIRAJOSHI', [0, 2, 3, 7, 8]],
    ['IN SEN', [0, 1, 5, 7, 10]],
    ['IWATO', [0, 1, 5, 6, 10]],
    ['EGYPTIAN', [0, 2, 5, 7, 10]],
    ['PELOG', [0, 1, 3, 7, 8]],
    ['PROMETHEUS', [0, 2, 4, 6, 9, 10]],
  ];
  S33.NOTE_NAMES = NAMES;

  // nota → nota più vicina della scala (a parità, verso il basso)
  S33.snapToScale = (n, root, scaleIdx) => {
    const sc = S33.SCALES[scaleIdx][1];
    if (sc.length === 12) return n;
    for (let d = 0; d < 12; d++) {
      for (const s of [-d, d]) {
        const m = n + s;
        if (sc.includes((((m - root) % 12) + 12) % 12)) return m;
      }
    }
    return n;
  };
  // n-esimo grado della scala a partire da una nota (anche oltre l'ottava)
  S33.scaleDegree = (base, steps, root, scaleIdx) => {
    const sc = S33.SCALES[scaleIdx][1];
    let n = base, c = 0;
    const dir = steps >= 0 ? 1 : -1;
    while (c < Math.abs(steps)) {
      n += dir;
      if (sc.includes((((n - root) % 12) + 12) % 12)) c++;
    }
    return n;
  };

  /* ---------- accordi ---------- */
  // iv: intervalli fissi in semitoni · deg: gradi della scala (diatonici)
  S33.CHORDS = [
    { label: 'OFF' },
    { label: 'MAJ', iv: [0, 4, 7] },
    { label: 'MIN', iv: [0, 3, 7] },
    { label: '7', iv: [0, 4, 7, 10] },
    { label: 'MAJ7', iv: [0, 4, 7, 11] },
    { label: 'MIN7', iv: [0, 3, 7, 10] },
    { label: 'M7b5', iv: [0, 3, 6, 10] },
    { label: 'SUS2', iv: [0, 2, 7] },
    { label: 'SUS4', iv: [0, 5, 7] },
    { label: 'DIM', iv: [0, 3, 6] },
    { label: 'AUG', iv: [0, 4, 8] },
    { label: '6', iv: [0, 4, 7, 9] },
    { label: 'MIN6', iv: [0, 3, 7, 9] },
    { label: '9', iv: [0, 4, 7, 10, 14] },
    { label: 'MAJ9', iv: [0, 4, 7, 11, 14] },
    { label: 'MIN9', iv: [0, 3, 7, 10, 14] },
    { label: 'ADD9', iv: [0, 4, 7, 14] },
    { label: 'MIN11', iv: [0, 3, 7, 10, 14, 17] },
    { label: '5', iv: [0, 7] },
    { label: 'OCT', iv: [0, 12] },
    { label: 'SC TRIAD', deg: [0, 2, 4] },
    { label: 'SC 7TH', deg: [0, 2, 4, 6] },
    { label: 'SC 9TH', deg: [0, 2, 4, 6, 8] },
    { label: 'SC SUS4', deg: [0, 3, 4] },
    { label: 'SC QUART', deg: [0, 3, 6] },
  ];

  // costruisce l'accordo per una nota secondo le impostazioni della traccia
  S33.buildChord = (note, params, root, scaleIdx) => {
    const ch = S33.CHORDS[params.chord || 0];
    if (!ch || (!ch.iv && !ch.deg)) return [note];
    let notes;
    if (ch.deg) {
      const sc = S33.SCALES[scaleIdx][1];
      if (sc.length >= 12) notes = [0, 4, 7, 11, 14].slice(0, ch.deg.length).map((i) => note + i);
      else {
        const base = S33.snapToScale(note, root, scaleIdx);
        notes = ch.deg.map((d) => S33.scaleDegree(base, d, root, scaleIdx));
      }
    } else notes = ch.iv.map((i) => note + i);
    // rivolti
    let inv = params.inv || 0;
    while (inv > 0) { notes.push(notes.shift() + 12); inv--; }
    while (inv < 0) { notes.unshift(notes.pop() - 12); inv++; }
    notes.sort((a, b) => a - b);
    // disposizione
    switch (params.voic) {
      case 1: if (notes.length > 2) notes[1] += 12; break; // open
      case 2: if (notes.length > 3) notes[notes.length - 2] -= 12; break; // drop 2
      case 3: notes.unshift(notes[0] - 12); if (notes.length > 3) notes[notes.length - 1] += 12; break; // wide
    }
    return [...new Set(notes.map((n) => S33.clamp(n, 0, 127)))].sort((a, b) => a - b).slice(0, 8);
  };

  /* ---------- tracce ausiliarie: bus, effetti in mandata, mix ---------- */
  const DLY_T = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
  const DLY_L = ['1/32', '1/32.', '1/16', '1/16.', '1/8', '1/8.', '1/4', '1/4.', '1/2', '1/2.', '1/1'];
  S33.DLY_T = DLY_T;
  S33.AUXP = {
    bfilt: { label: 'FILTER', min: -64, max: 63, step: 1, def: 0, fmt: (v) => (v === 0 ? 'OFF' : v < 0 ? 'LP ' + -v : 'HP ' + v) },
    breso: { label: 'RESO', min: 0, max: 127, step: 1, def: 10 },
    bdrive: { label: 'DRIVE', min: 0, max: 127, step: 1, def: 0 },
    bcomp: { label: 'COMP', min: 0, max: 127, step: 1, def: 0 },
    bsA: { label: 'DELAY', min: 0, max: 127, step: 1, def: 0 },
    bsB: { label: 'REVERB', min: 0, max: 127, step: 1, def: 0 },
    bsC: { label: 'CHORUS', min: 0, max: 127, step: 1, def: 0 },
    blvl: { label: 'LEVEL', min: 0, max: 127, step: 1, def: 100 },

    dtime: { label: 'TIME', min: 0, max: DLY_T.length - 1, step: 1, def: 5, fmt: (v) => DLY_L[v] },
    dfb: { label: 'FDBK', min: 0, max: 127, step: 1, def: 60 },
    dpp: { label: 'PINGPONG', min: 0, max: 1, step: 1, def: 1, fmt: onOff },
    dhp: { label: 'HP', min: 0, max: 127, step: 1, def: 30, fmt: fmtHz },
    dlp: { label: 'LP', min: 0, max: 127, step: 1, def: 105, fmt: fmtHz },
    drev: { label: '→REV', min: 0, max: 127, step: 1, def: 20 },
    dlvl: { label: 'LEVEL', min: 0, max: 127, step: 1, def: 100 },

    rpre: { label: 'PRE', min: 0, max: 127, step: 1, def: 10, fmt: (v) => Math.round((v / 127) * 200) + 'ms' },
    rsize: { label: 'DECAY', min: 0, max: 127, step: 1, def: 70, fmt: (v) => S33.revSecs(v).toFixed(1) + 's' },
    rdamp: { label: 'DAMP', min: 0, max: 127, step: 1, def: 40 },
    rhp: { label: 'HP', min: 0, max: 127, step: 1, def: 35, fmt: fmtHz },
    rlvl: { label: 'LEVEL', min: 0, max: 127, step: 1, def: 100 },

    crate: { label: 'RATE', min: 0, max: 127, step: 1, def: 40, fmt: (v) => S33.choHz(v).toFixed(2) + 'Hz' },
    cdep: { label: 'DEPTH', min: 0, max: 127, step: 1, def: 60 },
    cwid: { label: 'WIDTH', min: 0, max: 127, step: 1, def: 110 },
    cfb: { label: 'FDBK', min: 0, max: 127, step: 1, def: 20 },
    crev: { label: '→REV', min: 0, max: 127, step: 1, def: 0 },
    clvl: { label: 'LEVEL', min: 0, max: 127, step: 1, def: 100 },

    m0: { label: 'T1', min: 0, max: 127, step: 1, def: 100 },
    m1: { label: 'T2', min: 0, max: 127, step: 1, def: 100 },
    m2: { label: 'T3', min: 0, max: 127, step: 1, def: 100 },
    m3: { label: 'T4', min: 0, max: 127, step: 1, def: 100 },
    mmst: { label: 'MASTER', min: 0, max: 127, step: 1, def: 100 },
    mlim: { label: 'LIMITER', min: 0, max: 1, step: 1, def: 1, fmt: onOff },
    mdrv: { label: 'M.DRIVE', min: 0, max: 127, step: 1, def: 0 },
  };
  S33.revSecs = (v) => 0.3 + Math.pow(v / 127, 2) * 9.7;
  S33.choHz = (v) => 0.05 * Math.pow(100, v / 127);

  // id → titolo, gruppo dati nel progetto, chiavi delle 8 manopole
  S33.AUX = {
    bus1: { title: 'BUS 1', group: 'bus0', keys: ['bfilt', 'breso', 'bdrive', 'bcomp', 'bsA', 'bsB', 'bsC', 'blvl'] },
    bus2: { title: 'BUS 2', group: 'bus1', keys: ['bfilt', 'breso', 'bdrive', 'bcomp', 'bsA', 'bsB', 'bsC', 'blvl'] },
    dly: { title: 'DELAY', group: 'dly', keys: ['dtime', 'dfb', 'dpp', 'dhp', 'dlp', 'drev', null, 'dlvl'] },
    rev: { title: 'REVERB', group: 'rev', keys: ['rpre', 'rsize', 'rdamp', 'rhp', null, null, null, 'rlvl'] },
    cho: { title: 'CHORUS', group: 'cho', keys: ['crate', 'cdep', 'cwid', 'cfb', 'crev', null, null, 'clvl'] },
    mix: { title: 'MIX', group: 'mix', keys: ['m0', 'm1', 'm2', 'm3', null, 'mdrv', 'mlim', 'mmst'] },
  };
  S33.AUX_IDS = Object.keys(S33.AUX);
  S33.defaultFx = () => {
    const fx = {};
    for (const id of S33.AUX_IDS) {
      const g = {};
      S33.AUX[id].keys.forEach((k) => { if (k) g[k] = S33.AUXP[k].def; });
      fx[S33.AUX[id].group] = g;
    }
    return fx;
  };

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
    for (const k in S33.PARAMS) { const d = S33.PARAMS[k]; if (!d.trig && !d.sub && !d.ui) p[k] = d.def; }
    return p;
  };
  S33.defaultSub = () => Array.from({ length: 8 }, (_, i) => ({ ssmp: i % 8, stune: 0, slvl: 110, span: 0 }));
  S33.MACHINES = ['single', 'multi', 'sub', 'grain'];
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
