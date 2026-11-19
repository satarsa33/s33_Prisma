/* S33 - Prisma · Recorder: campiona l'ingresso audio o l'uscita principale */
(function () {
  const S33 = window.S33;

  const WORKLET = `
  class PrismaRec extends AudioWorkletProcessor {
    constructor() {
      super();
      this.state = 'idle'; this.L = []; this.R = []; this.n = 0; this.frames = 0; this.pk = 0; this.blocks = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m.cmd === 'start') { this.at = m.at; this.frames = m.frames; this.L = []; this.R = []; this.n = 0; this.state = 'wait'; }
        else if (m.cmd === 'stop') { if (this.state !== 'idle') this.finish(); }
        else if (m.cmd === 'cancel') { this.state = 'idle'; this.L = []; this.R = []; }
      };
    }
    finish() {
      this.state = 'idle';
      this.port.postMessage({ done: true, L: this.L, R: this.R, n: this.n });
      this.L = []; this.R = [];
    }
    process(inputs) {
      const inp = inputs[0];
      const l = inp[0], r = inp[1] || inp[0];
      if (l) for (let i = 0; i < l.length; i++) { const a = Math.abs(l[i]); if (a > this.pk) this.pk = a; }
      if (++this.blocks >= 8) { this.port.postMessage({ meter: this.pk, state: this.state, n: this.n }); this.pk = 0; this.blocks = 0; }
      if (!l) return true;
      const len = l.length;
      let from = 0;
      if (this.state === 'wait') {
        const off = Math.round((this.at - currentTime) * sampleRate);
        if (off >= len) return true;
        from = Math.max(0, off);
        this.state = 'rec';
      }
      if (this.state === 'rec') {
        let take = len - from;
        if (this.frames && this.n + take > this.frames) take = this.frames - this.n;
        if (take > 0) {
          this.L.push(l.slice(from, from + take));
          this.R.push(r.slice(from, from + take));
          this.n += take;
        }
        if (this.frames && this.n >= this.frames) this.finish();
      }
      return true;
    }
  }
  registerProcessor('prisma-rec', PrismaRec);`;

  class Recorder {
    constructor(engine) {
      this.engine = engine;
      this.ctx = engine.ctx;
      this.node = null;
      this.source = 'main'; // 'main' | 'in'
      this.inStream = null;
      this.inNode = null;
      this.inGain = this.ctx.createGain();
      this.monGain = this.ctx.createGain();
      this.monGain.gain.value = 0;
      this.inGain.connect(this.monGain).connect(engine.master);
      this.state = 'idle';
      this.meter = 0;
      this.onDone = null;
      this.onState = null;
      this.deviceId = '';
    }

    async init() {
      if (this.node) return;
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await this.ctx.audioWorklet.addModule(url);
        this.node = new AudioWorkletNode(this.ctx, 'prisma-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
        this.node.port.onmessage = (e) => this._msg(e.data);
      } catch (e) {
        // aperta come file locale: l'AudioWorklet non si carica, si usa un ScriptProcessor
        this.node = this._fallbackNode();
      }
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      this.node.connect(sink).connect(this.ctx.destination);
      this._connectSource();
    }

    _fallbackNode() {
      const sp = this.ctx.createScriptProcessor(2048, 2, 2);
      const sr = this.ctx.sampleRate;
      const st = { state: 'idle', L: [], R: [], n: 0, frames: 0, at: 0, pk: 0, blocks: 0 };
      const finish = () => { st.state = 'idle'; this._msg({ done: true, L: st.L, R: st.R, n: st.n }); st.L = []; st.R = []; };
      sp.port = {
        postMessage: (m) => {
          if (m.cmd === 'start') Object.assign(st, { at: m.at, frames: m.frames, L: [], R: [], n: 0, state: 'wait' });
          else if (m.cmd === 'stop') { if (st.state !== 'idle') finish(); }
          else if (m.cmd === 'cancel') Object.assign(st, { state: 'idle', L: [], R: [] });
        },
      };
      sp.onaudioprocess = (e) => {
        const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1);
        for (let i = 0; i < l.length; i++) { const a = Math.abs(l[i]); if (a > st.pk) st.pk = a; }
        if (++st.blocks >= 2) { this._msg({ meter: st.pk, state: st.state, n: st.n }); st.pk = 0; st.blocks = 0; }
        let from = 0;
        if (st.state === 'wait') {
          const off = Math.round((st.at - e.playbackTime) * sr);
          if (off >= l.length) return;
          from = Math.max(0, off);
          st.state = 'rec';
        }
        if (st.state === 'rec') {
          let take = l.length - from;
          if (st.n + take > st.frames) take = st.frames - st.n;
          if (take > 0) { st.L.push(l.slice(from, from + take)); st.R.push(r.slice(from, from + take)); st.n += take; }
          if (st.n >= st.frames) finish();
        }
      };
      return sp;
    }

    async setSource(src) {
      this.source = src;
      if (src === 'in') await this.openInput();
      this._connectSource();
    }

    async listInputs() {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audioinput');
    }

    async openInput(deviceId) {
      if (deviceId !== undefined) this.deviceId = deviceId;
      if (this.inStream && deviceId === undefined) return;
      if (this.inStream) this.inStream.getTracks().forEach((t) => t.stop());
      if (this.inNode) this.inNode.disconnect();
      this.inStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2,
        },
      });
      this.inNode = this.ctx.createMediaStreamSource(this.inStream);
      this.inNode.connect(this.inGain);
    }

    setMonitor(on) {
      this.monGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    }

    _connectSource() {
      if (!this.node) return;
      try { this.engine.out.disconnect(this.node); } catch (e) {}
      try { this.inGain.disconnect(this.node); } catch (e) {}
      if (this.source === 'main') this.engine.out.connect(this.node);
      else this.inGain.connect(this.node);
    }

    // at: tempo di inizio (ctx), seconds: durata (0 = libero, max 120 s)
    start(at, seconds) {
      const sr = this.ctx.sampleRate;
      this.free = !seconds;
      this.node.port.postMessage({ cmd: 'start', at, frames: Math.round((seconds || 120) * sr) });
      this.state = 'wait';
      if (this.onState) this.onState();
    }
    // una registrazione a durata fissa che restituisce il buffer (per l'Auto Sampler)
    take(at, seconds) {
      return new Promise((resolve) => {
        const prev = this.onDone;
        let guard = null;
        const finish = (b) => { clearTimeout(guard); this.onDone = prev; resolve(b); };
        this.onDone = (b) => finish(b);
        this.start(at, seconds);
        // registrazione vuota: _msg non chiama onDone, quindi si chiude da sola
        guard = setTimeout(() => finish(null), (at - this.ctx.currentTime + seconds) * 1000 + 3000);
      });
    }

    stop() {
      if (this.state === 'idle') return;
      this.node.port.postMessage({ cmd: 'stop' });
    }
    cancel() {
      this.node.port.postMessage({ cmd: 'cancel' });
      this.state = 'idle';
      if (this.onState) this.onState();
    }

    _msg(m) {
      if (m.meter !== undefined) {
        this.meter = m.meter;
        const st = m.state === 'idle' && this.state !== 'idle' ? this.state : m.state;
        if (st !== this.state && st === 'rec') { this.state = 'rec'; if (this.onState) this.onState(); }
        this.frames = m.n;
        return;
      }
      if (m.done) {
        this.state = 'idle';
        if (this.onState) this.onState();
        if (!m.n) return;
        const b = new AudioBuffer({ length: m.n, numberOfChannels: 2, sampleRate: this.ctx.sampleRate });
        let o = 0;
        m.L.forEach((c, i) => { b.copyToChannel(c, 0, o); b.copyToChannel(m.R[i], 1, o); o += c.length; });
        if (this.onDone) this.onDone(b, this.free);
      }
    }
  }

  // taglia il silenzio iniziale/finale (solo registrazioni libere) e normalizza
  S33.processTake = (buf, { trim, normalize }) => {
    const ctx = { sr: buf.sampleRate };
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let a = 0, b = buf.length;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (peak < 1e-5) return null;
    if (trim) {
      const th = Math.max(peak * 0.02, 0.0015);
      while (a < b && Math.abs(L[a]) < th && Math.abs(R[a]) < th) a++;
      while (b > a && Math.abs(L[b - 1]) < th && Math.abs(R[b - 1]) < th) b--;
      a = Math.max(0, a - Math.round(ctx.sr * 0.003));
      b = Math.min(buf.length, b + Math.round(ctx.sr * 0.05));
    }
    const g = normalize ? 0.95 / peak : 1;
    const out = new AudioBuffer({ length: b - a, numberOfChannels: 2, sampleRate: ctx.sr });
    for (let c = 0; c < 2; c++) {
      const src = buf.getChannelData(c).subarray(a, b);
      const d = new Float32Array(src.length);
      for (let i = 0; i < d.length; i++) d[i] = src[i] * g;
      // micro-fade ai bordi
      const f = Math.min(64, d.length >> 1);
      for (let i = 0; i < f; i++) { d[i] *= i / f; d[d.length - 1 - i] *= i / f; }
      out.copyToChannel(d, c);
    }
    return out;
  };

  S33.Recorder = Recorder;
})();
