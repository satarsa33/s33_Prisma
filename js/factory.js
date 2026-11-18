/* S33 - Prisma · suoni di fabbrica generati con OfflineAudioContext (nessun file esterno) */
(function () {
  const S33 = window.S33;
  const SR = 48000;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  async function render(seconds, build, channels = 2) {
    const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * SR), SR);
    build(ctx, ctx.destination);
    return ctx.startRendering();
  }

  function noiseBuffer(ctx, seconds) {
    const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function noise(ctx, seconds) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx, seconds);
    return s;
  }
  function env(ctx, peak, a, d, t0 = 0) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.setTargetAtTime(0, t0 + a, d);
    return g;
  }

  const kick = () => render(0.9, (ctx, out) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(190, 0);
    o.frequency.exponentialRampToValueAtTime(52, 0.11);
    o.frequency.exponentialRampToValueAtTime(44, 0.6);
    const g = env(ctx, 1, 0.002, 0.18);
    const sh = ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * 1.6); }
    sh.curve = c;
    o.connect(g).connect(sh).connect(out);
    const n = noise(ctx, 0.02);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = env(ctx, 0.35, 0.0005, 0.004);
    n.connect(hp).connect(ng).connect(out);
    o.start(0); n.start(0);
  });

  const snare = () => render(0.6, (ctx, out) => {
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(230, 0); o.frequency.exponentialRampToValueAtTime(175, 0.08);
    const og = env(ctx, 0.7, 0.001, 0.05);
    o.connect(og).connect(out);
    const n = noise(ctx, 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    const ng = env(ctx, 0.65, 0.001, 0.09);
    n.connect(bp).connect(lp).connect(ng).connect(out);
    o.start(0); n.start(0);
  });

  const clap = () => render(0.7, (ctx, out) => {
    const n = noise(ctx, 0.7);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0);
    [0, 0.012, 0.025].forEach((t) => {
      g.gain.setValueAtTime(0.9, t);
      g.gain.setTargetAtTime(0.05, t + 0.001, 0.004);
    });
    g.gain.setValueAtTime(0.75, 0.034);
    g.gain.setTargetAtTime(0, 0.035, 0.11);
    n.connect(bp).connect(g).connect(out);
    n.start(0);
  });

  const hat = (decay, len) => () => render(len, (ctx, out) => {
    const n = noise(ctx, len);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 10500; pk.gain.value = 6;
    const g = env(ctx, 0.6, 0.0008, decay);
    n.connect(hp).connect(pk).connect(g).connect(out);
    // metallico: quadre inarmoniche
    [317, 421, 553, 731, 857].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * 6.1;
      const og = env(ctx, 0.04, 0.0008, decay * 0.8);
      o.connect(og).connect(hp);
      o.start(0);
    });
    n.start(0);
  });

  const blip = () => render(0.4, (ctx, out) => {
    const o = ctx.createOscillator(); o.frequency.value = hz(84);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = hz(96);
    const g = env(ctx, 0.6, 0.001, 0.04), g2 = env(ctx, 0.12, 0.001, 0.015);
    o.connect(g).connect(out); o2.connect(g2).connect(out);
    o.start(0); o2.start(0);
  });

  // basso a dente di sega, root C1 (36)
  const subSaw = () => render(2.2, (ctx, out) => {
    const f = hz(36);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(2400, 0); lp.frequency.setTargetAtTime(380, 0.005, 0.18);
    const g = env(ctx, 0.5, 0.004, 0.9);
    [-6, 0, 7].forEach((d) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
      o.connect(lp); o.start(0);
    });
    const sub = ctx.createOscillator(); sub.frequency.value = f / 2;
    const sg = ctx.createGain(); sg.gain.value = 0.6;
    sub.connect(sg).connect(g);
    sub.start(0);
    lp.connect(g).connect(out);
  });

  // campana FM, root C4 (72)
  const glass = () => render(3, (ctx, out) => {
    const f = hz(72);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, 0); mg.gain.setTargetAtTime(f * 0.2, 0, 0.5);
    mod.connect(mg).connect(car.frequency);
    const g = env(ctx, 0.45, 0.002, 0.9);
    car.connect(g).connect(out);
    car.start(0); mod.start(0);
  });

  // piano elettrico FM: una zona per ottava, timbro che cambia col registro
  const epZone = (root) => render(3.2, (ctx, out) => {
    const f = hz(root);
    const bright = S33.clamp((84 - root) / 48, 0.3, 1.2);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.6 * bright, 0); mg.gain.setTargetAtTime(f * 0.35 * bright, 0.001, 0.35);
    mod.connect(mg).connect(car.frequency);
    const tine = ctx.createOscillator(); tine.frequency.value = f * 14;
    const tg = env(ctx, 0.06 * bright, 0.0008, 0.03);
    const decay = 0.6 + (96 - root) / 48;
    const g = env(ctx, 0.42, 0.003, decay);
    car.connect(g); tine.connect(tg).connect(g);
    // leggero chorus stereo
    const merger = ctx.createChannelMerger(2);
    const dl = ctx.createDelay(); dl.delayTime.value = 0.0045;
    g.connect(merger, 0, 0); g.connect(dl).connect(merger, 0, 1);
    merger.connect(out);
    car.start(0); mod.start(0); tine.start(0);
  });

  // pad a seghe disaccordate
  const padZone = (root) => render(5, (ctx, out) => {
    const f = hz(root);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(6000, f * 9); lp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.22, 0.4); g.gain.setValueAtTime(0.22, 4.3); g.gain.linearRampToValueAtTime(0, 5);
    const merger = ctx.createChannelMerger(2);
    [-14, -5, 4, 13].forEach((d, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
      const p = ctx.createGain(); p.gain.value = 0.5;
      o.connect(p).connect(merger, 0, i % 2);
      o.start(0);
    });
    merger.connect(lp).connect(g).connect(out);
  });

  S33.buildFactory = async () => {
    const mk = async (id, name, fn, root = 60) => ({ id, name, root, factory: true, buffer: await fn() });
    const samples = await Promise.all([
      mk('f-kick', 'Kick', kick),
      mk('f-snare', 'Snare', snare),
      mk('f-clap', 'Clap', clap),
      mk('f-hatc', 'Hat C', hat(0.028, 0.35)),
      mk('f-hato', 'Hat O', hat(0.22, 1.2)),
      mk('f-blip', 'Blip', blip),
      mk('f-sub', 'Sub Saw', subSaw, 36),
      mk('f-glass', 'Glass', glass, 72),
    ]);
    const zones = async (roots, fn) =>
      Promise.all(roots.map(async (r) => ({ root: r, name: S33.noteName(r), buffer: await fn(r) })));
    const multis = [
      { id: 'f-keys', name: 'Keys', factory: true, zones: await zones([36, 48, 60, 72, 84], epZone) },
      { id: 'f-pad', name: 'Pad', factory: true, zones: await zones([48, 60, 72], padZone) },
    ];
    return { samples, multis };
  };
})();
