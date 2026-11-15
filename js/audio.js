// Motor de audio: Web Audio API, baja latencia, reloj de pulsos sincronizado con la base.
export const BPM = 123;          // tempo medido de sounds/17base.mp3
export const BEAT_OFFSET = 0.105; // segundo del primer pulso dentro de la base

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.buffers = [];
    this.baseBuffer = null;
    this.rate = 1;
    this.voices = [];           // voz activa por pad (para cortar al redisparar)
    this.clk = { t0: this.ctx.currentTime, beat0: 0 };
    this.base = { playing: false, src: null, startBeat: 0, trackBeat0: 0, pausedBeat: 0 };
    this._buildGraph();
  }

  _buildGraph() {
    const c = this.ctx;
    this.padBus = c.createGain(); this.padBus.gain.value = 0.9;
    this.baseGain = c.createGain(); this.baseGain.gain.value = 0.75;

    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = 20000; this.filter.Q.value = 4;

    // Eco (solo pads) con realimentación filtrada
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = 0.75 * 60 / BPM;
    this.delaySend = c.createGain(); this.delaySend.gain.value = 0;
    this.feedback = c.createGain(); this.feedback.gain.value = 0.42;
    const fbFilter = c.createBiquadFilter(); fbFilter.type = 'lowpass'; fbFilter.frequency.value = 3200;
    this.padBus.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(fbFilter); fbFilter.connect(this.feedback); this.feedback.connect(this.delay);
    fbFilter.connect(this.filter);

    this.padBus.connect(this.filter);
    this.baseGain.connect(this.filter);

    this.master = c.createGain(); this.master.gain.value = 1;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 512; this.analyser.smoothingTimeConstant = 0.7;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);

    this.filter.connect(this.master); this.master.connect(this.comp);
    this.comp.connect(this.analyser); this.analyser.connect(c.destination);
  }

  async _load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
    const data = await res.arrayBuffer();
    return await new Promise((ok, ko) => this.ctx.decodeAudioData(data, ok, ko));
  }

  async loadPads(files, onProgress) {
    let done = 0;
    this.buffers = await Promise.all(files.map(async (f) => {
      const b = await this._load(f); onProgress?.(++done / files.length); return b;
    }));
  }

  async loadBase(url) { this.baseBuffer = await this._load(url); }

  resume() { if (this.ctx.state !== 'running') return this.ctx.resume(); }
  get now() { return this.ctx.currentTime; }
  get latency() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0); }

  // ---------- reloj ----------
  get bps() { return BPM / 60 * this.rate; }
  beatAt(t = this.now) { return this.clk.beat0 + (t - this.clk.t0) * this.bps; }
  timeAtBeat(b) { return this.clk.t0 + (b - this.clk.beat0) / this.bps; }

  setRate(r) {
    const t = this.now;
    this.clk = { t0: t, beat0: this.beatAt(t) };
    this.rate = r;
    if (this.base.src) this.base.src.playbackRate.setValueAtTime(r, t);
    this.voices.forEach(v => v && v.src.playbackRate.setValueAtTime(r, t));
    this.delay.delayTime.setTargetAtTime(0.75 / this.bps, t, 0.05);
  }

  // Tiempo cuantizado: siguiente división de la rejilla (tolerancia para golpes algo tardíos)
  quantize(t, grid) {
    if (!grid) return t;
    const b = this.beatAt(t);
    const prev = Math.floor(b / grid) * grid;
    if ((b - prev) / this.bps < 0.045) return t;
    return this.timeAtBeat(prev + grid);
  }

  // ---------- pads ----------
  playPad(i, when = this.now, gain = 1) {
    const c = this.ctx, buf = this.buffers[i];
    if (!buf) return;
    when = Math.max(when, c.currentTime);
    const prev = this.voices[i];
    if (prev) {
      prev.g.gain.setTargetAtTime(0, when, 0.006);
      try { prev.src.stop(when + 0.06); } catch (_) {}
    }
    const src = c.createBufferSource();
    src.buffer = buf; src.playbackRate.value = this.rate;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(this.padBus);
    src.start(when);
    const v = { src, g };
    this.voices[i] = v;
    src.onended = () => { if (this.voices[i] === v) this.voices[i] = null; g.disconnect(); };
  }

  // ---------- base ----------
  get trackBeats() { return this.baseBuffer ? (this.baseBuffer.duration - BEAT_OFFSET) * BPM / 60 : 0; }

  // posición de la base en pulsos (para la barra de progreso)
  trackBeat(t = this.now) {
    const b = this.base;
    if (!b.playing) return b.pausedBeat;
    return Math.max(0, b.trackBeat0 + this.beatAt(t) - b.startBeat);
  }

  playBase() {
    if (!this.baseBuffer || this.base.playing) return null;
    const c = this.ctx, b = this.base;
    // arranca en el siguiente compás del reloj, desde un inicio de compás de la base
    let trackBeat0 = Math.floor(b.pausedBeat / 4) * 4;
    if (trackBeat0 >= this.trackBeats - 4) trackBeat0 = 0;
    const startBeat = Math.ceil(this.beatAt() / 4 + 0.02) * 4;
    const when = this.timeAtBeat(startBeat);
    const src = c.createBufferSource();
    src.buffer = this.baseBuffer; src.playbackRate.value = this.rate;
    src.connect(this.baseGain);
    src.start(when, BEAT_OFFSET + trackBeat0 * 60 / BPM);
    Object.assign(b, { playing: true, src, startBeat, trackBeat0 });
    src.onended = () => {
      if (b.src !== src) return;
      Object.assign(b, { playing: false, src: null, pausedBeat: 0 });
      this.onBaseEnd?.();
    };
    return startBeat;
  }

  stopBase(reset = false) {
    const b = this.base;
    if (!b.playing) { if (reset) b.pausedBeat = 0; return; }
    b.pausedBeat = reset ? 0 : this.trackBeat();
    const src = b.src; b.src = null; b.playing = false;
    try { src.stop(); } catch (_) {}
  }

  // ---------- efectos ----------
  setFilter(v) { // v 0..1 → 120 Hz .. 20 kHz (exponencial)
    const f = 120 * Math.pow(20000 / 120, v);
    this.filter.frequency.setTargetAtTime(f, this.now, 0.03);
  }
  setEcho(on) { this.delaySend.gain.setTargetAtTime(on ? 0.5 : 0, this.now, 0.02); }
  setBaseVolume(v) { this.baseGain.gain.setTargetAtTime(v, this.now, 0.03); }
  setPadVolume(v) { this.padBus.gain.setTargetAtTime(v, this.now, 0.03); }

  // ---------- análisis ----------
  levels() {
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq;
    let bass = 0, all = 0;
    for (let i = 0; i < 6; i++) bass += f[i];
    for (let i = 0; i < 96; i++) all += f[i];
    return { bass: bass / (6 * 255), level: all / (96 * 255), freq: f };
  }

  // ---------- grabar mezcla ----------
  startRecording() {
    if (!window.MediaRecorder) return false;
    const dest = this.ctx.createMediaStreamDestination();
    this.comp.connect(dest);
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = types.find(t => MediaRecorder.isTypeSupported?.(t));
    const rec = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    this.rec = { rec, dest, chunks, mimeType: rec.mimeType || mimeType || 'audio/webm' };
    rec.start();
    return true;
  }

  stopRecording() {
    return new Promise(ok => {
      const r = this.rec; if (!r) return ok(null);
      r.rec.onstop = () => {
        this.comp.disconnect(r.dest);
        this.rec = null;
        ok(new Blob(r.chunks, { type: r.mimeType }));
      };
      r.rec.stop();
    });
  }
}
