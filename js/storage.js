/* S33 - Prisma · salvataggio automatico (IndexedDB) e file di progetto (.prisma) */
(function () {
  const S33 = window.S33;
  const DB = 's33-prisma', STORE = 'state';

  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  const bufToRaw = (b) => ({
    sr: b.sampleRate,
    channels: Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice()),
  });
  const rawToBuf = (r) => {
    const b = new AudioBuffer({ length: r.channels[0].length, numberOfChannels: r.channels.length, sampleRate: r.sr });
    r.channels.forEach((d, c) => b.copyToChannel(d, c));
    return b;
  };

  function poolToRaw(pool) {
    return {
      samples: pool.samples.map((s) => (s.factory ? { id: s.id, factory: true } : { id: s.id, name: s.name, root: s.root, raw: bufToRaw(s.buffer) })),
      multis: pool.multis.map((m) =>
        m.factory ? { id: m.id, factory: true } : { id: m.id, name: m.name, zones: m.zones.map((z) => ({ root: z.root, name: z.name, raw: bufToRaw(z.buffer) })) }
      ),
    };
  }
  function rawToPool(raw, factory) {
    const fs = (id, list) => list.find((x) => x.id === id);
    const samples = raw.samples.map((s) => (s.factory ? fs(s.id, factory.samples) : { id: s.id, name: s.name, root: s.root, buffer: rawToBuf(s.raw) })).filter(Boolean);
    const multis = raw.multis.map((m) =>
      m.factory ? fs(m.id, factory.multis) : { id: m.id, name: m.name, zones: m.zones.map((z) => ({ root: z.root, name: z.name, buffer: rawToBuf(z.raw) })) }
    ).filter(Boolean);
    // eventuali suoni di fabbrica nuovi non presenti nel salvataggio
    factory.samples.forEach((f) => { if (!samples.includes(f)) samples.push(f); });
    factory.multis.forEach((f) => { if (!multis.includes(f)) multis.push(f); });
    return { samples, multis };
  }

  S33.autosave = async (project, pool) => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ project: JSON.parse(JSON.stringify(project)), pool: poolToRaw(pool) }, 'current');
      await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
    } catch (e) { console.warn('autosave', e); }
  };

  S33.autoload = async (factory) => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('current');
      const v = await new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
      if (!v) return null;
      return { project: v.project, pool: rawToPool(v.pool, factory) };
    } catch (e) { console.warn('autoload', e); return null; }
  };

  /* ---------- file progetto: JSON con campioni WAV 16 bit in base64 ---------- */
  const abToB64 = (ab) => {
    const u = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64ToAb = (b64) => {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  };

  S33.projectToFile = (project, pool) => {
    const wav = (b) => abToB64(S33.encodeWav16(b));
    return JSON.stringify({
      app: 'S33 - Prisma', version: 1, project,
      pool: {
        samples: pool.samples.map((s) => (s.factory ? { id: s.id, factory: true } : { id: s.id, name: s.name, root: s.root, wav: wav(s.buffer) })),
        multis: pool.multis.map((m) => (m.factory ? { id: m.id, factory: true } : { id: m.id, name: m.name, zones: m.zones.map((z) => ({ root: z.root, name: z.name, wav: wav(z.buffer) })) })),
      },
    });
  };

  S33.fileToProject = async (text, factory, ctx) => {
    const data = JSON.parse(text);
    if (!data.project || !data.pool) throw new Error('File non valido');
    const dec = (b64) => ctx.decodeAudioData(b64ToAb(b64));
    const fs = (id, list) => list.find((x) => x.id === id);
    const samples = [];
    for (const s of data.pool.samples) samples.push(s.factory ? fs(s.id, factory.samples) : { id: s.id, name: s.name, root: s.root, buffer: await dec(s.wav) });
    const multis = [];
    for (const m of data.pool.multis) {
      if (m.factory) { multis.push(fs(m.id, factory.multis)); continue; }
      const zones = [];
      for (const z of m.zones) zones.push({ root: z.root, name: z.name, buffer: await dec(z.wav) });
      multis.push({ id: m.id, name: m.name, zones });
    }
    const pool = { samples: samples.filter(Boolean), multis: multis.filter(Boolean) };
    factory.samples.forEach((f) => { if (!pool.samples.includes(f)) pool.samples.push(f); });
    factory.multis.forEach((f) => { if (!pool.multis.includes(f)) pool.multis.push(f); });
    return { project: data.project, pool };
  };
})();
