/* S33 - Prisma · motore audio: voci polifoniche, filtro, inviluppi, LFO per traccia */
(function () {
  const S33 = window.S33;
  const MAX_VOICES = 8;

  class Engine {
    constructor(trackCount) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 48000 });
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -4;
      this.limiter.knee.value = 2;
      this.limiter.ratio.value = 16;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.12;
      this.master.connect(this.limiter).connect(ctx.destination);
      this.lfoBuffers = this._makeLfoBuffers();
      this.tracks = [];
      for (let i = 0; i < trackCount; i++) this.tracks.push(this._makeTrack());
      this.pool = null; // impostato dall'app
    }

    resume() {
      if (this.ctx.state !== 'running') return this.ctx.resume();
      return Promise.resolve();
    }

    _makeTrack() {
      const ctx = this.ctx;
      const out = ctx.createGain();
      const meter = ctx.createAnalyser();
      meter.fftSize = 256;
      out.connect(this.master);
      out.connect(meter);
      const lfoOut = ctx.createGain();
      lfoOut.gain.value = 1;
      return { out, meter, lfoOut, lfoSrc: null, lfoWave: -1, voices: [], meterBuf: new Float32Array(256) };
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

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;

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
      pan.pan.value = S33.clamp(p.pan / 64, -1, 1);

      // LFO per voce (profondità bloccabile per step)
      const depth = p.ldep / 127;
      let tap = null;
      if (depth > 0) {
        tap = ctx.createGain();
        tr.lfoOut.connect(tap);
        switch (p.ldest) {
          case 0: tap.gain.value = depth * 1200; tap.connect(src.detune); break;
          case 1: tap.gain.value = depth * 4800; tap.connect(filt.detune); break;
          case 2: trem.gain.value = 1 - depth / 2; tap.gain.value = depth / 2; tap.connect(trem.gain); break;
          case 3: tap.gain.value = depth; tap.connect(pan.pan); break;
        }
      }

      // inviluppo d'ampiezza ADSR
      const velAmt = p.avel / 127;
      const velGain = 1 - velAmt + velAmt * velN * velN;
      const peakG = Math.pow(p.vol / 127, 2) * (p.level / 127) * velGain;
      const a = Math.max(0.0015, S33.envTime(p.atk));
      const sus = peakG * (p.sus / 127);
      const g = amp.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peakG, t + a);
      g.setTargetAtTime(sus, t + a, S33.envTime(p.dec) / 4);

      src.connect(filt).connect(trem).connect(amp).connect(pan).connect(tr.out);

      let natEnd = Infinity;
      if (p.loop) {
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
        src, filt, amp, pan, tap, trem, t, note, ti, rate, s0, s1, loop: !!p.loop, dur,
        rev: !!p.rev, buffer: buf, natEnd, released: false, dead: false, rel: S33.envTime(p.rel),
      };
      if (natEnd !== Infinity && natEnd - 0.006 > t + a) {
        g.setTargetAtTime(0, natEnd - 0.006, 0.002);
      }
      src.onended = () => this._cleanup(voice);
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
      try { voice.src.stop(stopAt); } catch (e) {}
    }

    _kill(voice, time) {
      const t = Math.max(time, this.ctx.currentTime);
      voice.dead = true;
      const g = voice.amp.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.003);
      try { voice.src.stop(t + 0.02); } catch (e) {}
    }

    _cleanup(voice) {
      voice.dead = true;
      const tr = this.tracks[voice.ti];
      const i = tr.voices.indexOf(voice);
      if (i >= 0) tr.voices.splice(i, 1);
      try {
        if (voice.tap) { this.tracks[voice.ti].lfoOut.disconnect(voice.tap); voice.tap.disconnect(); }
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
