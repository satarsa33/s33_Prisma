/* S33 - Prisma · motore audio: voci polifoniche, filtro, inviluppi, LFO per traccia */
(function () {
  const S33 = window.S33;
  const MAX_VOICES = 8;

  class Engine {
    constructor(trackCount) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 48000 });
      const ctx = this.ctx;
      // master: drive → (limiter | diretto) → uscita
      this.master = ctx.createGain();
      this.mDrive = ctx.createWaveShaper();
      this.mDrive.oversample = '2x';
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -4;
      this.limiter.knee.value = 2;
      this.limiter.ratio.value = 16;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.12;
      this.limOn = ctx.createGain();
      this.limOff = ctx.createGain();
      this.limOff.gain.value = 0;
      this.out = ctx.createGain();
      this.out.gain.value = 0.8;
      this.master.connect(this.mDrive);
      this.mDrive.connect(this.limiter).connect(this.limOn).connect(this.out);
      this.mDrive.connect(this.limOff).connect(this.out);
      this.out.connect(ctx.destination);
      this.outMeter = ctx.createAnalyser();
      this.outMeter.fftSize = 512;
      this.out.connect(this.outMeter);

      this.lfoBuffers = this._makeLfoBuffers();
      this._buildSends();
      this.buses = [this._makeBus(), this._makeBus()];
      this.tracks = [];
      for (let i = 0; i < trackCount; i++) this.tracks.push(this._makeTrack());
      this.sendIns = [this.dly.in, this.rev.in, this.cho.in];
      this.pool = null; // impostato dall'app
    }

    resume() {
      if (this.ctx.state !== 'running') return this.ctx.resume();
      return Promise.resolve();
    }

    _makeTrack() {
      const ctx = this.ctx;
      const out = ctx.createGain(); // fader di traccia (MIX)
      const meter = ctx.createAnalyser();
      meter.fftSize = 256;
      out.connect(this.master);
      out.connect(meter);
      const lfoOut = ctx.createGain();
      lfoOut.gain.value = 1;
      return { out, meter, lfoOut, lfoSrc: null, lfoWave: -1, voices: [], meterBuf: new Float32Array(256), route: 0 };
    }

    // uscita di traccia: 0 = MAIN, 1 = BUS 1, 2 = BUS 2
    setRoute(ti, r) {
      const tr = this.tracks[ti];
      if (tr.route === r) return;
      tr.out.disconnect();
      tr.out.connect(tr.meter);
      tr.out.connect(r === 0 ? this.master : this.buses[r - 1].in);
      tr.route = r;
    }

    _makeBus() {
      const ctx = this.ctx;
      const b = {};
      b.in = ctx.createGain();
      b.filt = ctx.createBiquadFilter();
      b.filt.type = 'allpass';
      b.drive = ctx.createWaveShaper();
      b.drive.oversample = '2x';
      b.comp = ctx.createDynamicsCompressor();
      b.comp.threshold.value = 0;
      b.comp.ratio.value = 4;
      b.comp.attack.value = 0.008;
      b.comp.release.value = 0.15;
      b.makeup = ctx.createGain();
      b.level = ctx.createGain();
      b.meter = ctx.createAnalyser();
      b.meter.fftSize = 256;
      b.in.connect(b.filt).connect(b.drive).connect(b.comp).connect(b.makeup).connect(b.level);
      b.level.connect(this.master);
      b.level.connect(b.meter);
      b.sends = [0, 1, 2].map(() => ctx.createGain());
      b.sends.forEach((g, i) => { g.gain.value = 0; b.level.connect(g); g.connect([this.dly, this.rev, this.cho][i].in); });
      return b;
    }

    _buildSends() {
      const ctx = this.ctx;
      // DELAY ping-pong con filtri nel feedback
      const d = (this.dly = {});
      d.in = ctx.createGain();
      d.hp = ctx.createBiquadFilter(); d.hp.type = 'highpass';
      d.lp = ctx.createBiquadFilter(); d.lp.type = 'lowpass';
      d.dL = ctx.createDelay(4); d.dR = ctx.createDelay(4);
      d.fb = ctx.createGain();
      d.cross = ctx.createGain(); // L → R (ping-pong)
      d.mono = ctx.createGain(); // ingresso anche a destra (no ping-pong)
      d.merge = ctx.createChannelMerger(2);
      d.level = ctx.createGain();
      d.toRev = ctx.createGain();
      d.meter = ctx.createAnalyser(); d.meter.fftSize = 256;
      d.in.connect(d.hp).connect(d.lp);
      d.lp.connect(d.dL);
      d.lp.connect(d.mono).connect(d.dR);
      d.dL.connect(d.cross).connect(d.dR);
      d.dR.connect(d.fb).connect(d.hp);
      d.dL.connect(d.merge, 0, 0);
      d.dR.connect(d.merge, 0, 1);
      d.merge.connect(d.level).connect(this.master);
      d.level.connect(d.meter);

      // REVERB a convoluzione (risposta generata)
      const r = (this.rev = {});
      r.in = ctx.createGain();
      r.pre = ctx.createDelay(1);
      r.hp = ctx.createBiquadFilter(); r.hp.type = 'highpass';
      r.conv = ctx.createConvolver();
      r.damp = ctx.createBiquadFilter(); r.damp.type = 'lowpass';
      r.level = ctx.createGain();
      r.meter = ctx.createAnalyser(); r.meter.fftSize = 256;
      r.in.connect(r.pre).connect(r.hp).connect(r.conv).connect(r.damp).connect(r.level).connect(this.master);
      r.level.connect(r.meter);
      d.toRev.connect(r.in);
      d.level.connect(d.toRev);

      // CHORUS a due linee modulate
      const c = (this.cho = {});
      c.in = ctx.createGain();
      c.dL = ctx.createDelay(0.1); c.dR = ctx.createDelay(0.1);
      c.dL.delayTime.value = 0.012; c.dR.delayTime.value = 0.017;
      c.lfo = ctx.createOscillator(); c.lfo.type = 'triangle';
      c.lfo2 = ctx.createOscillator(); c.lfo2.type = 'triangle';
      c.depL = ctx.createGain(); c.depR = ctx.createGain();
      c.lfo.connect(c.depL).connect(c.dL.delayTime);
      c.lfo2.connect(c.depR).connect(c.dR.delayTime);
      c.fb = ctx.createGain();
      c.merge = ctx.createChannelMerger(2);
      c.wL = ctx.createStereoPanner(); c.wR = ctx.createStereoPanner();
      c.level = ctx.createGain();
      c.toRev = ctx.createGain();
      c.meter = ctx.createAnalyser(); c.meter.fftSize = 256;
      c.in.connect(c.dL); c.in.connect(c.dR);
      c.dL.connect(c.fb).connect(c.in);
      c.dL.connect(c.wL).connect(c.level);
      c.dR.connect(c.wR).connect(c.level);
      c.level.connect(this.master);
      c.level.connect(c.meter);
      c.level.connect(c.toRev).connect(r.in);
      c.lfo.start(); c.lfo2.start();
      this._revKey = null;
    }

    _revIR(secs) {
      const ctx = this.ctx;
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * (secs + 0.1));
      const b = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const env = Math.pow(10, (-3 * t) / secs); // -60 dB a "secs"
          const fade = t < 0.004 ? t / 0.004 : 1;
          const n = Math.random() * 2 - 1;
          lp = lp + (n - lp) * (0.25 + 0.75 * Math.exp(-t * 1.5)); // si scurisce nel tempo
          d[i] = lp * env * fade * (i < sr * 0.03 && Math.random() < 0.004 ? 3 : 1);
        }
      }
      return b;
    }

    // applica tutti i parametri dei bus, effetti e mix
    applyFx(fx, bpm) {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const set = (param, v) => param.setTargetAtTime(v, now, 0.015);
      const n = (v) => v / 127;
      // mix
      for (let i = 0; i < this.tracks.length; i++) set(this.tracks[i].out.gain, Math.pow(n(fx.mix['m' + i]), 2) * 1.6);
      set(this.master.gain, Math.pow(n(fx.mix.mmst), 2) * 1.6);
      this.mDrive.curve = fx.mix.mdrv ? S33.shaperCurve(fx.mix.mdrv * 0.6, 0) : null;
      set(this.limOn.gain, fx.mix.mlim ? 1 : 0);
      set(this.limOff.gain, fx.mix.mlim ? 0 : 1);
      // bus
      this.buses.forEach((b, i) => {
        const p = fx['bus' + i];
        if (p.bfilt === 0) b.filt.type = 'allpass';
        else {
          b.filt.type = p.bfilt < 0 ? 'lowpass' : 'highpass';
          const f = p.bfilt < 0 ? 20000 * Math.pow(0.0015, -p.bfilt / 64) : 20 * Math.pow(400, p.bfilt / 63);
          set(b.filt.frequency, S33.clamp(f, 20, 20000));
        }
        set(b.filt.Q, 0.5 + Math.pow(n(p.breso), 2) * 18);
        b.drive.curve = p.bdrive ? S33.shaperCurve(p.bdrive, 0) : null;
        set(b.comp.threshold, -n(p.bcomp) * 40);
        set(b.makeup.gain, Math.pow(10, (n(p.bcomp) * 40 * 0.22) / 20));
        set(b.level.gain, Math.pow(n(p.blvl), 2) * 1.6);
        ['bsA', 'bsB', 'bsC'].forEach((k, j) => set(b.sends[j].gain, Math.pow(n(p[k]), 2)));
      });
      // delay
      const d = this.dly, pd = fx.dly;
      const t = Math.min(3.9, (S33.DLY_T[pd.dtime] * 60) / bpm / 4);
      set(d.dL.delayTime, t);
      set(d.dR.delayTime, t);
      set(d.fb.gain, n(pd.dfb) * 0.95);
      set(d.cross.gain, pd.dpp ? 1 : 0);
      set(d.mono.gain, pd.dpp ? 0 : 1);
      set(d.hp.frequency, S33.cutoffHz(pd.dhp));
      set(d.lp.frequency, S33.cutoffHz(pd.dlp));
      set(d.toRev.gain, Math.pow(n(pd.drev), 2));
      set(d.level.gain, Math.pow(n(pd.dlvl), 2) * 1.4);
      // reverb
      const r = this.rev, pr = fx.rev;
      const secs = S33.revSecs(pr.rsize);
      const key = Math.round(secs * 20);
      if (key !== this._revKey) { r.conv.buffer = this._revIR(secs); this._revKey = key; }
      set(r.pre.delayTime, n(pr.rpre) * 0.2);
      set(r.damp.frequency, 20000 * Math.pow(0.05, n(pr.rdamp)));
      set(r.hp.frequency, S33.cutoffHz(pr.rhp));
      set(r.level.gain, Math.pow(n(pr.rlvl), 2) * 1.2);
      // chorus
      const c = this.cho, pc = fx.cho;
      set(c.lfo.frequency, S33.choHz(pc.crate));
      set(c.lfo2.frequency, S33.choHz(pc.crate) * 1.07);
      set(c.depL.gain, n(pc.cdep) * 0.006);
      set(c.depR.gain, n(pc.cdep) * 0.006);
      set(c.fb.gain, n(pc.cfb) * 0.6);
      set(c.wL.pan, -n(pc.cwid));
      set(c.wR.pan, n(pc.cwid));
      set(c.toRev.gain, Math.pow(n(pc.crev), 2));
      set(c.level.gain, Math.pow(n(pc.clvl), 2) * 1.3);
    }

    analyserLevel(an) {
      const buf = (this._abuf = this._abuf && this._abuf.length === an.fftSize ? this._abuf : new Float32Array(an.fftSize));
      an.getFloatTimeDomainData(buf);
      let m = 0;
      for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
      return m;
    }
    auxAnalyser(id) {
      return { bus1: this.buses[0].meter, bus2: this.buses[1].meter, dly: this.dly.meter, rev: this.rev.meter, cho: this.cho.meter, mix: this.outMeter }[id];
    }

    // un periodo di ciascuna forma d'onda in un buffer da 1 secondo: playbackRate = Hz
    _makeLfoBuffers() {
      const sr = this.ctx.sampleRate;
      const n = sr;
      const mk = (fn) => {
        const b = this.ctx.createBuffer(1, n, sr);
        const d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = fn(i / n);
        return b;
      };
      const rnd = Array.from({ length: 16 }, () => Math.random() * 2 - 1);
      const smooth = Array.from({ length: 9 }, () => Math.random() * 2 - 1);
      smooth[8] = smooth[0];
      return [
        mk((x) => Math.sin(2 * Math.PI * x)),
        mk((x) => (x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4)),
        mk((x) => 1 - 2 * x),
        mk((x) => (x < 0.5 ? 1 : -1)),
        mk((x) => rnd[Math.floor(x * 16)]),
        mk((x) => {
          const p = x * 8, i = Math.floor(p), f = p - i;
          const s = (1 - Math.cos(f * Math.PI)) / 2;
          return smooth[i] * (1 - s) + smooth[i + 1] * s;
        }),
      ];
    }

    // aggiorna l'LFO di traccia (forma e velocità)
    updateLfo(ti, params, bpm) {
      const tr = this.tracks[ti];
      const ctx = this.ctx;
      const hz = params.lsync
        ? bpm / 60 * 4 / S33.LSYNC[S33.lsyncIndex(params.lrate)]
        : S33.lfoHz(params.lrate);
      if (tr.lfoWave !== params.lwave || !tr.lfoSrc) {
        const src = ctx.createBufferSource();
        src.buffer = this.lfoBuffers[params.lwave];
        src.loop = true;
        src.playbackRate.value = hz;
        src.connect(tr.lfoOut);
        src.start();
        if (tr.lfoSrc) {
          try { tr.lfoSrc.stop(); } catch (e) {}
          tr.lfoSrc.disconnect();
        }
        tr.lfoSrc = src;
        tr.lfoWave = params.lwave;
      } else {
        tr.lfoSrc.playbackRate.setTargetAtTime(hz, ctx.currentTime, 0.02);
      }
    }

    setTrackGain(ti, g) {
      const p = this.tracks[ti].out.gain;
      p.cancelScheduledValues(this.ctx.currentTime);
      p.setTargetAtTime(g, this.ctx.currentTime, 0.01);
    }

    meterLevel(ti) {
      const tr = this.tracks[ti];
      tr.meter.getFloatTimeDomainData(tr.meterBuf);
      let m = 0;
      for (let i = 0; i < tr.meterBuf.length; i++) m = Math.max(m, Math.abs(tr.meterBuf[i]));
      return m;
    }

    // sceglie buffer e nota di riferimento per la voce
    _resolveSource(machine, p, note) {
      const pool = this.pool;
      if (!pool) return null;
      if (machine === 'multi') {
        const inst = pool.multis[p.smp] || pool.multis[0];
        if (!inst || !inst.zones.length) return null;
        let best = inst.zones[0], bd = 1e9;
        for (const z of inst.zones) {
          const d = Math.abs(z.root - note) + (z.root > note ? 0.1 : 0); // a parità, preferisce la zona sotto
          if (d < bd) { bd = d; best = z; }
        }
        return { entry: best, buffer: p.rev ? reversed(best) : best.buffer, root: best.root };
      }
      if (machine === 'sub') {
        // Subtracks: C3..G3 (e ottave) = sottotracce 1..8, ognuna col suo campione
        const slot = (((note - 60) % 8) + 8) % 8;
        const sl = (p._sub && p._sub[slot]) || { ssmp: 0, stune: 0, slvl: 110, span: 0 };
        const e = pool.samples[sl.ssmp] || pool.samples[0];
        if (!e) return null;
        return { entry: e, buffer: p.rev ? reversed(e) : e.buffer, root: note - sl.stune, gain: sl.slvl / 127, panOff: sl.span / 64 };
      }
      const s = pool.samples[p.smp] || pool.samples[0];
      if (!s) return null;
      return { entry: s, buffer: p.rev ? reversed(s) : s.buffer, root: s.root };
    }

    /*
     * Avvia una voce. gate = durata in secondi (null = finché non arriva noteOff).
     * Ritorna l'oggetto voce.
     */
    play(ti, machine, p, note, vel, time, gate) {
      const ctx = this.ctx;
      const tr = this.tracks[ti];
      const res = this._resolveSource(machine, p, note);
      if (!res) return null;
      const t = Math.max(time, ctx.currentTime);
      const buf = res.buffer;
      const dur = buf.duration;

      // voice stealing
      const alive = tr.voices.filter((v) => !v.dead);
      if (alive.length >= MAX_VOICES) this._kill(alive[0], t);

      const rate = Math.pow(2, (note - res.root + p.tune + p.fine / 100) / 12);
      let s0 = S33.clamp(p.start, 0, 1) * dur;
      let s1 = S33.clamp(p.end, 0, 1) * dur;
      if (s1 <= s0 + 0.002) s1 = Math.min(dur, s0 + 0.002);

      const isGrain = machine === 'grain';
      // per il granulare la "sorgente" è un nodo dove confluiscono i grani
      const src = isGrain ? ctx.createGain() : ctx.createBufferSource();
      if (!isGrain) {
        src.buffer = buf;
        src.playbackRate.value = rate;
      }

      // filtro con key tracking, velocity e inviluppo
      const filt = ctx.createBiquadFilter();
      filt.type = ['lowpass', 'bandpass', 'highpass'][p.ftype] || 'lowpass';
      const velN = vel / 127;
      let base = S33.cutoffHz(p.freq);
      base *= Math.pow(2, ((note - 60) / 12) * (p.ktrk / 127));
      base *= Math.pow(2, (velN - 1) * (p.fvel / 127) * 4);
      base = S33.clamp(base, 20, 20000);
      filt.Q.value = p.ftype === 1 ? 0.7 + (p.reso / 127) * 12 : 0.5 + Math.pow(p.reso / 127, 2) * 22;
      filt.frequency.setValueAtTime(base, t);
      if (p.fenv !== 0) {
        const oct = (p.fenv / 64) * 7;
        const peak = S33.clamp(base * Math.pow(2, oct), 20, 20000);
        const fa = S33.envTime(p.fatk);
        filt.frequency.setValueAtTime(base, t);
        filt.frequency.exponentialRampToValueAtTime(peak, t + fa);
        filt.frequency.setTargetAtTime(base, t + fa, S33.envTime(p.fdec) / 4);
      }

      const trem = ctx.createGain();
      const amp = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.pan.value = S33.clamp(p.pan / 64 + (res.panOff || 0), -1, 1);

      // LFO per voce (profondità bloccabile per step)
      const depth = p.ldep / 127;
      let tap = null;
      if (depth > 0) {
        tap = ctx.createGain();
        tr.lfoOut.connect(tap);
        switch (p.ldest) {
          case 0: tap.gain.value = depth * 1200; if (!isGrain) tap.connect(src.detune); break;
          case 1: tap.gain.value = depth * 4800; tap.connect(filt.detune); break;
          case 2: trem.gain.value = 1 - depth / 2; tap.gain.value = depth / 2; tap.connect(trem.gain); break;
          case 3: tap.gain.value = depth; tap.connect(pan.pan); break;
        }
      }

      // inviluppo d'ampiezza ADSR
      const velAmt = p.avel / 127;
      const velGain = 1 - velAmt + velAmt * velN * velN;
      const peakG = Math.pow(p.vol / 127, 2) * (p.level / 127) * velGain * (res.gain != null ? res.gain : 1);
      const a = Math.max(0.0015, S33.envTime(p.atk));
      const sus = peakG * (p.sus / 127);
      const g = amp.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peakG, t + a);
      g.setTargetAtTime(sus, t + a, S33.envTime(p.dec) / 4);

      let shp = null;
      if (p.drive > 0 || p.bits > 0) {
        shp = ctx.createWaveShaper();
        shp.curve = S33.shaperCurve(p.drive, p.bits);
        shp.oversample = p.drive > 0 ? '2x' : 'none';
        src.connect(shp).connect(filt);
      } else src.connect(filt);
      filt.connect(trem).connect(amp).connect(pan).connect(tr.out);
      // mandate per voce (bloccabili per step)
      const sends = [];
      [p.sdly, p.srev, p.scho].forEach((v, i) => {
        if (!v) return;
        const sg = ctx.createGain();
        sg.gain.value = Math.pow(v / 127, 1.5);
        pan.connect(sg).connect(this.sendIns[i]);
        sends.push(sg);
      });

      let natEnd = Infinity;
      if (isGrain) {
        // i grani vengono pianificati dallo scheduler granulare
      } else if (p.loop) {
        src.loop = true;
        src.loopStart = s0;
        src.loopEnd = s1;
        src.start(t, s0);
      } else {
        src.start(t, s0);
        natEnd = t + (s1 - s0) / rate;
        // micro-fade alla fine della regione per evitare click
        src.stop(natEnd + 0.004);
      }

      const voice = {
        src, filt, amp, pan, tap, trem, shp, sends, t, note, ti, rate, s0, s1, loop: !!p.loop, dur,
        rev: !!p.rev, buffer: buf, natEnd, released: false, dead: false, rel: S33.envTime(p.rel),
      };
      if (isGrain) {
        voice.grain = {
          pos: S33.clamp(p.gpos, 0, 1) * dur,
          size: 0.005 * Math.pow(200, p.gsize / 127),
          dens: Math.pow(120, p.gdens / 127),
          spray: (p.gspray / 127) * 0.2 * dur + (p.gspray ? 0.004 : 0),
          jit: (p.gjit / 127) * 100,
          scan: (p.gscan / 64) * 2,
          nextT: t,
          stopAt: Infinity,
          pitchTap: p.ldep > 0 && p.ldest === 0 ? tap : null,
          cur: 0,
        };
        this._startGrains();
      }
      if (natEnd !== Infinity && natEnd - 0.006 > t + a) {
        g.setTargetAtTime(0, natEnd - 0.006, 0.002);
      }
      if (!isGrain) src.onended = () => this._cleanup(voice);
      tr.voices.push(voice);
      if (gate != null) this.release(voice, t + Math.max(0.005, gate));
      return voice;
    }

    release(voice, time) {
      if (!voice || voice.released || voice.dead) return;
      const ctx = this.ctx;
      const t = Math.max(time, ctx.currentTime);
      voice.released = true;
      voice.relTime = t;
      const g = voice.amp.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else { g.cancelScheduledValues(t); }
      g.setTargetAtTime(0, t, voice.rel / 4 + 0.001);
      const stopAt = Math.min(voice.natEnd + 0.004, t + voice.rel * 1.6 + 0.05);
      if (voice.grain) { voice.grain.stopAt = stopAt; return; }
      try { voice.src.stop(stopAt); } catch (e) {}
    }

    _kill(voice, time) {
      const t = Math.max(time, this.ctx.currentTime);
      voice.dead = true;
      const g = voice.amp.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.003);
      if (voice.grain) { voice.grain.stopAt = Math.min(voice.grain.stopAt, t + 0.02); return; }
      try { voice.src.stop(t + 0.02); } catch (e) {}
    }

    /* ---------- scheduler dei grani (machine GRAIN) ---------- */
    _startGrains() {
      if (this._grainTimer) return;
      this._grainTimer = setInterval(() => this._grainTick(), 20);
    }
    _grainTick() {
      const ctx = this.ctx;
      const now = ctx.currentTime;
      const ahead = now + 0.09;
      let any = false;
      for (const tr of this.tracks) {
        for (const v of tr.voices.slice()) {
          const G = v.grain;
          if (!G) continue;
          any = true;
          if (now > G.stopAt + 0.25) { this._cleanup(v); continue; }
          while (G.nextT < ahead && G.nextT < G.stopAt) {
            this._spawnGrain(v, G, G.nextT);
            G.nextT += (1 / G.dens) * (0.85 + Math.random() * 0.3);
          }
        }
      }
      if (!any) { clearInterval(this._grainTimer); this._grainTimer = null; }
    }
    _spawnGrain(v, G, gt) {
      const ctx = this.ctx;
      const dur = v.dur;
      let center = G.pos + G.scan * (gt - v.t);
      center = ((center % dur) + dur) % dur;
      G.cur = center;
      const size = G.size;
      let off = center + (Math.random() * 2 - 1) * G.spray - (size * v.rate) / 2;
      off = S33.clamp(off, 0, Math.max(0, dur - 0.002));
      const bs = ctx.createBufferSource();
      bs.buffer = v.buffer;
      bs.playbackRate.value = v.rate * Math.pow(2, ((Math.random() * 2 - 1) * G.jit) / 1200);
      if (G.pitchTap) G.pitchTap.connect(bs.detune);
      const env = ctx.createGain();
      env.gain.value = 0;
      const peak = 1 / Math.sqrt(Math.max(1, G.dens * size));
      env.gain.setValueCurveAtTime(grainCurve(peak), gt, size);
      bs.connect(env).connect(v.src);
      bs.start(gt, off);
      bs.stop(gt + size + 0.005);
      bs.onended = () => { try { bs.disconnect(); env.disconnect(); if (G.pitchTap) G.pitchTap.disconnect(bs.detune); } catch (e) {} };
    }

    _cleanup(voice) {
      voice.dead = true;
      const tr = this.tracks[voice.ti];
      const i = tr.voices.indexOf(voice);
      if (i >= 0) tr.voices.splice(i, 1);
      try {
        if (voice.tap) { this.tracks[voice.ti].lfoOut.disconnect(voice.tap); voice.tap.disconnect(); }
        if (voice.shp) voice.shp.disconnect();
        voice.sends.forEach((g) => g.disconnect());
        voice.src.disconnect(); voice.filt.disconnect(); voice.trem.disconnect(); voice.amp.disconnect(); voice.pan.disconnect();
      } catch (e) {}
    }

    // allo stop: elimina le voci già pianificate nel futuro, lascia le code delle altre
    cancelFuture() {
      const now = this.ctx.currentTime;
      this.tracks.forEach((tr) => tr.voices.slice().forEach((v) => {
        if (v.t > now + 0.001) this._kill(v, now);
        else this.release(v, now);
      }));
    }

    stopAll() {
      const t = this.ctx.currentTime;
      this.tracks.forEach((tr) => tr.voices.slice().forEach((v) => this._kill(v, t)));
    }

    // posizioni (0..1) delle voci attive, per il disegno della forma d'onda
    voicePositions(ti) {
      const now = this.ctx.currentTime;
      const out = [];
      for (const v of this.tracks[ti].voices) {
        if (v.dead || now < v.t) continue;
        if (v.grain) {
          if (now < v.grain.stopAt) out.push({ x: v.rev ? 1 - v.grain.cur / v.dur : v.grain.cur / v.dur, buffer: v.buffer });
          continue;
        }
        if (v.released && now > v.relTime + v.rel * 1.5) continue;
        let pos = v.s0 + (now - v.t) * v.rate;
        if (v.loop) {
          const L = v.s1 - v.s0;
          if (pos > v.s1) pos = v.s0 + ((pos - v.s0) % L);
        } else if (pos > v.s1) continue;
        let x = pos / v.dur;
        out.push({ x: v.rev ? 1 - x : x, buffer: v.buffer });
      }
      return out;
    }
  }

  // finestra di Hann per i grani (cache per ampiezza)
  const curveCache2 = new Map();
  function grainCurve(peak) {
    const k = Math.round(peak * 100);
    if (curveCache2.has(k)) return curveCache2.get(k);
    const N = 64, c = new Float32Array(N);
    for (let i = 0; i < N; i++) c[i] = (k / 100) * Math.sin((Math.PI * i) / (N - 1)) ** 2;
    curveCache2.set(k, c);
    return c;
  }

  function reversed(entry) {
    if (entry._rev) return entry._rev;
    const b = entry.buffer;
    const r = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c).slice();
      d.reverse();
      r.copyToChannel(d, c);
    }
    entry._rev = r;
    return r;
  }

  S33.Engine = Engine;

  /* ---------- rilevamento intonazione (per multicampioni senza nota nel nome) ---------- */
  S33.detectPitch = (buffer) => {
    const sr = buffer.sampleRate;
    const d = buffer.getChannelData(0);
    // finestra dopo l'attacco
    const start = Math.min(d.length - 1, Math.floor(sr * 0.08));
    const N = Math.min(4096, d.length - start);
    if (N < 1024) return null;
    const x = d.subarray(start, start + N);
    const minLag = Math.floor(sr / 2000), maxLag = Math.min(Math.floor(sr / 30), N >> 1);
    // differenza normalizzata cumulativa (YIN)
    const yin = new Float32Array(maxLag + 1);
    let run = 0;
    yin[0] = 1;
    for (let lag = 1; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < N - maxLag; i++) { const df = x[i] - x[i + lag]; s += df * df; }
      run += s;
      yin[lag] = run ? (s * lag) / run : 1;
    }
    let lag = -1;
    for (let l = minLag; l <= maxLag; l++) {
      if (yin[l] < 0.15) { while (l + 1 <= maxLag && yin[l + 1] < yin[l]) l++; lag = l; break; }
    }
    if (lag < 0) return null;
    const f = sr / lag;
    return Math.round(69 + 12 * Math.log2(f / 440));
  };

  /* ---------- curva di saturazione + riduzione bit (cache) ---------- */
  const curveCache = new Map();
  S33.shaperCurve = (drive, bits) => {
    const key = drive * 100 + bits;
    if (curveCache.has(key)) return curveCache.get(key);
    const N = 4096, c = new Float32Array(N);
    const k = 1 + Math.pow(drive / 127, 2) * 30;
    const levels = bits > 0 ? Math.pow(2, 17 - bits) / 2 : 0;
    const norm = Math.tanh(k);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      let y = drive > 0 ? Math.tanh(k * x) / norm : x;
      if (drive > 0) y *= 1 - 0.35 * Math.pow(drive / 127, 1.5); // compensa il volume
      if (levels) y = Math.round(y * levels) / levels;
      c[i] = y;
    }
    curveCache.set(key, c);
    return c;
  };

  /* ---------- WAV: codifica 16 bit (per salvataggio progetto) ---------- */
  S33.encodeWav16 = (buffer) => {
    const ch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
    const ab = new ArrayBuffer(44 + len * ch * 2);
    const v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len * ch * 2, true);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
    return ab;
  };
})();
