import { AudioEngine } from './audio.js';
import { Visuals } from './scene.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Teclas físicas (event.code), independientes de la distribución del teclado
const KEYS = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyW', 'KeyE', 'KeyR',
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyZ', 'KeyX', 'KeyC', 'KeyV',
  'Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'KeyM', 'Comma', 'Period', 'Slash',
];
const FALLBACK = { Semicolon: 'Ñ', Comma: ',', Period: '.', Slash: '-' };
const keyName = (code) => FALLBACK[code] || code.replace(/^(Digit|Key)/, '');

const state = {
  quant: 0,        // rejilla en pulsos (0 = libre)
  roll: false,     // modo roll fijo (para táctil)
  shift: false,
  rolls: new Map(),  // pad -> { nextBeat, src }
  visualQueue: [],
};

const engine = new AudioEngine();
let visuals, PADS;

// ---------------------------------------------------------------- arranque
async function boot() {
  const cfg = await (await fetch('js/pads.json')).json();
  PADS = cfg.pads.map((p, i) => ({ ...p, keyLabel: keyName(KEYS[i]) }));

  try { await document.fonts?.load('800 40px Orbitron'); } catch (_) {}
  visuals = new Visuals($('#scene'), PADS);
  requestAnimationFrame(loop);
  window.addEventListener('resize', () => visuals.resize());
  document.fonts?.ready.then(() => visuals.resize());

  // etiquetas reales del teclado del usuario (si el navegador lo permite)
  navigator.keyboard?.getLayoutMap?.().then(map => {
    const labels = KEYS.map(k => (map.get(k) || keyName(k)).toUpperCase());
    PADS.forEach((p, i) => p.keyLabel = labels[i]);
    visuals.setKeyLabels(labels);
    renderHelpKeys();
  }).catch(() => {});
  renderHelpKeys();

  const bar = $('#load-bar');
  await engine.loadPads(PADS.map(p => p.file), f => bar.style.width = `${f * 100}%`);
  $('#enter').disabled = false;
  $('#enter').textContent = 'Entrar';
  $('#load-text').textContent = 'Listo. Sube el volumen.';
  engine.loadBase(cfg.base).then(() => {
    $('#base-btn').disabled = false;
    $('#base-btn').classList.remove('loading');
    $('#reto-btn').disabled = false;
  }).catch(() => toast('No se pudo cargar la base'));
}

$('#enter').addEventListener('click', async () => {
  await engine.resume();
  $('#intro').classList.add('hidden');
  document.body.classList.add('live');
  // pequeño saludo visual
  [0, 5, 10, 15, 16 + 3, 16 + 6, 16 + 9, 16 + 12].forEach((p, k) => setTimeout(() => visuals.hit(p, 0.6), k * 70));
});

// ---------------------------------------------------------------- disparo de pads
function trigger(i, { when, record = true, strength = 1 } = {}) {
  if (!PADS[i]) return;
  engine.resume();
  const now = engine.now;
  let t = when ?? now;
  if (when == null && state.quant && !game.active) t = engine.quantize(now, state.quant);
  engine.playPad(i, t);
  state.visualQueue.push({ i, t, strength });
  if (record && looper.recording) looper.add(i, engine.beatAt(t));
  if (when == null && game.active) game.judge(i, now);
}

function pressPad(i) {
  trigger(i);
  if (state.shift || state.roll) startRoll(i);
}
function releasePad(i) { state.rolls.delete(i); }

function startRoll(i) {
  const grid = state.quant || 0.5;
  const b = engine.beatAt(engine.now);
  state.rolls.set(i, { grid, next: (Math.floor(b / grid) + 1) * grid });
}

// ---------------------------------------------------------------- looper
const looper = {
  bars: 2, events: [], playing: false, recording: false, start: 0, schedUntil: 0, layer: 0,
  get len() { return this.bars * 4; },
  add(pad, beat) {
    if (!this.playing) return;
    const pos = ((beat - this.start) % this.len + this.len) % this.len;
    this.events.push({ pad, pos, layer: this.layer, skipUntil: beat + 0.01 });
    updateLoopUI();
  },
  play() {
    if (this.playing) return;
    this.start = Math.ceil(engine.beatAt() / 4 + 0.01) * 4;
    this.schedUntil = this.start - 0.001;
    this.playing = true;
    updateLoopUI();
  },
  stop() { this.playing = false; this.recording = false; updateLoopUI(); },
  rec() {
    if (this.recording) { this.recording = false; updateLoopUI(); return; }
    this.layer++;
    this.recording = true;
    if (!this.playing) this.play();
    updateLoopUI();
  },
  undo() {
    const last = Math.max(0, ...this.events.map(e => e.layer));
    this.events = this.events.filter(e => e.layer !== last);
    updateLoopUI();
  },
  clear() { this.events = []; this.recording = false; updateLoopUI(); },
  schedule(toBeat) {
    if (!this.playing) return;
    const from = this.schedUntil, L = this.len;
    for (const e of this.events) {
      let n = Math.floor((from - this.start - e.pos) / L) + 1;
      for (let b = this.start + n * L + e.pos; b <= toBeat; b += L) {
        if (b > from && b > e.skipUntil) trigger(e.pad, { when: engine.timeAtBeat(b), record: false, strength: 0.85 });
      }
    }
    this.schedUntil = toBeat;
  },
  progress() {
    if (!this.playing) return 0;
    const b = engine.beatAt();
    if (b < this.start) return 0;
    return ((b - this.start) % this.len) / this.len;
  },
};

function updateLoopUI() {
  $('#loop-rec').classList.toggle('on', looper.recording);
  $('#loop-play').classList.toggle('on', looper.playing);
  $('#loop-play').textContent = looper.playing ? '■' : '▶';
  $('#loop-count').textContent = looper.events.length;
  $$('#loop-bars button').forEach(b => b.classList.toggle('on', +b.dataset.bars === looper.bars));
}

// ---------------------------------------------------------------- modo reto (juego de ritmo)
// Recorre los pads en su orden: banco A cada 2 pulsos, banco B cada pulso.
const game = {
  active: false, notes: [], score: 0, combo: 0, maxCombo: 0, hits: { perfect: 0, good: 0, miss: 0 },
  LEAD: 2, // pulsos de anticipación del anillo
  start() {
    if (!engine.baseBuffer) return;
    engine.stopBase(true);
    const startBeat = engine.playBase();
    syncBaseUI();
    let b = startBeat + 8;
    const notes = [];
    const pass = (bank, step) => { for (let k = 0; k < 16; k++) { notes.push({ pad: bank * 16 + k, beat: b }); b += step; } };
    pass(0, 2); pass(0, 2); pass(1, 1); pass(1, 1); pass(0, 2); pass(1, 1); pass(1, 1);
    this.notes = notes.map(n => ({ ...n, time: engine.timeAtBeat(n.beat), done: false }));
    this.endBeat = b + 2;
    Object.assign(this, { active: true, score: 0, combo: 0, maxCombo: 0, hits: { perfect: 0, good: 0, miss: 0 } });
    $('#game-hud').classList.add('show');
    $('#reto-btn').classList.add('on');
    $('#results').classList.add('hidden');
    updateHUD();
    toast('¡Sigue los anillos! Golpea cuando se cierren sobre el pad');
  },
  stop(showResults) {
    this.active = false;
    visuals.setApproach([]);
    $('#game-hud').classList.remove('show');
    $('#reto-btn').classList.remove('on');
    if (showResults) results();
  },
  judge(pad, hitTime) {
    const t = hitTime - engine.latency;
    let best = null;
    for (const n of this.notes) {
      if (n.done || n.pad !== pad) continue;
      const dt = Math.abs(t - n.time);
      if (dt < 0.2 && (!best || dt < best.dt)) best = { n, dt };
    }
    if (!best) return;
    best.n.done = true;
    const kind = best.dt < 0.07 ? 'perfect' : 'good';
    this.hits[kind]++;
    this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += (kind === 'perfect' ? 300 : 120) * (1 + Math.floor(this.combo / 10) * 0.5);
    popup(pad, kind === 'perfect' ? 'PERFECTO' : 'BIEN', kind);
    updateHUD();
  },
  update() {
    if (!this.active) return;
    const now = engine.now - engine.latency;
    const beat = engine.beatAt(now);
    const approach = [];
    for (const n of this.notes) {
      if (n.done) continue;
      if (now - n.time > 0.2) {
        n.done = true; this.hits.miss++; this.combo = 0;
        popup(n.pad, 'FALLO', 'miss'); updateHUD();
        continue;
      }
      const rem = (n.beat - beat) / this.LEAD;
      if (rem <= 1 && approach.length < 8) approach.push({ pad: n.pad, t: Math.max(0, rem) });
    }
    visuals.setApproach(approach);
    if (beat > this.endBeat) this.stop(true);
  },
};

function updateHUD() {
  $('#hud-score').textContent = Math.round(game.score).toLocaleString('es');
  $('#hud-combo').textContent = game.combo > 1 ? `${game.combo}× combo` : '';
}

function results() {
  const h = game.hits, total = h.perfect + h.good + h.miss || 1;
  const acc = (h.perfect + h.good * 0.5) / total;
  const rank = acc > 0.95 ? 'S' : acc > 0.85 ? 'A' : acc > 0.7 ? 'B' : acc > 0.5 ? 'C' : 'D';
  const best = +localStorage.getItem('idaft-best') || 0;
  const record = game.score > best;
  if (record) localStorage.setItem('idaft-best', Math.round(game.score));
  $('#res-rank').textContent = rank;
  $('#res-score').textContent = Math.round(game.score).toLocaleString('es');
  $('#res-detail').innerHTML = `Perfectos <b>${h.perfect}</b> · Bien <b>${h.good}</b> · Fallos <b>${h.miss}</b><br>Precisión <b>${Math.round(acc * 100)}%</b> · Combo máx. <b>${game.maxCombo}</b>`;
  $('#res-best').textContent = record ? '¡Nuevo récord!' : `Récord: ${best.toLocaleString('es')}`;
  $('#results').classList.remove('hidden');
}

function popup(pad, text, kind) {
  const p = visuals.screenPos(pad);
  const el = document.createElement('div');
  el.className = `judge ${kind}`; el.textContent = text;
  el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

// ---------------------------------------------------------------- planificador
setInterval(() => {
  if (engine.ctx.state !== 'running') return;
  const ahead = engine.beatAt(engine.now + 0.12);
  looper.schedule(ahead);
  for (const [i, r] of state.rolls) {
    while (r.next <= ahead) { trigger(i, { when: engine.timeAtBeat(r.next), strength: 0.5 }); r.next += r.grid; }
  }
}, 25);

// ---------------------------------------------------------------- bucle de render
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = engine.now, lat = engine.latency;
  const q = state.visualQueue;
  for (let k = q.length - 1; k >= 0; k--) {
    if (t + 0.005 >= q[k].t + lat) { visuals.hit(q[k].i, q[k].strength); q.splice(k, 1); }
  }
  game.update();
  const lv = engine.levels();
  const beat = engine.beatAt(t - lat);
  visuals.setLoop(looper.playing || looper.events.length > 0, looper.progress(), looper.bars, looper.recording);
  visuals.update(dt, { beat, bps: engine.bps, bass: lv.bass, level: lv.level, running: engine.base.playing || looper.playing });
  drawUI(beat);
}

const beatDots = $$('#beats i');
function drawUI(beat) {
  const k = ((Math.floor(beat) % 4) + 4) % 4;
  beatDots.forEach((d, j) => d.classList.toggle('on', j === k && (beat % 1) < 0.35));
  if (engine.baseBuffer) {
    const tb = engine.trackBeat();
    const p = Math.min(1, tb / engine.trackBeats);
    $('#base-prog').style.width = `${p * 100}%`;
    const sec = tb * 60 / 123;
    $('#base-time').textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
}

// ---------------------------------------------------------------- entrada: puntero
const canvas = $('#scene');
const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('live')) return;
  const i = visuals.pick(e.clientX, e.clientY);
  if (i < 0) return;
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, i);
  pressPad(i);
});
const endPointer = (e) => {
  const i = pointers.get(e.pointerId);
  if (i == null) return;
  pointers.delete(e.pointerId);
  if (![...pointers.values()].includes(i)) releasePad(i);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    visuals.setParallax(e.clientX, e.clientY);
    visuals.hover = visuals.pick(e.clientX, e.clientY);
    canvas.style.cursor = visuals.hover >= 0 ? 'pointer' : 'default';
  }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------------------------------------------------------------- entrada: teclado
const held = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (!document.body.classList.contains('live')) { if (e.code === 'Enter' && !$('#enter').disabled) $('#enter').click(); return; }
  if (e.key === 'Shift') { state.shift = true; return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const i = KEYS.indexOf(e.code);
  if (i >= 0) {
    e.preventDefault();
    if (e.repeat || held.has(e.code)) return;
    held.add(e.code);
    pressPad(i);
    return;
  }
  if (e.repeat) return;
  switch (e.code) {
    case 'Space': e.preventDefault(); toggleBase(); break;
    case 'Digit5': looper.rec(); break;
    case 'Digit6': looper.playing ? looper.stop() : looper.play(); break;
    case 'KeyT': $('#echo').click(); break;
    case 'KeyY': cycleQuant(); break;
    case 'KeyG': toggleRecording(); break;
    case 'Escape': $('#help').classList.add('hidden'); $('#results').classList.add('hidden'); if (game.active) game.stop(false); break;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') { state.shift = false; if (!state.roll) state.rolls.clear(); return; }
  const i = KEYS.indexOf(e.code);
  if (i >= 0) { held.delete(e.code); releasePad(i); }
});
window.addEventListener('blur', () => { held.clear(); state.shift = false; state.rolls.clear(); });

// ---------------------------------------------------------------- controles
function syncBaseUI() {
  $('#base-btn').classList.toggle('on', engine.base.playing);
  $('#base-btn').textContent = engine.base.playing ? '❚❚' : '▶';
}
function toggleBase() {
  if (!engine.baseBuffer) return;
  engine.resume();
  if (engine.base.playing) { engine.stopBase(); if (game.active) game.stop(false); }
  else engine.playBase();
  syncBaseUI();
}
engine.onBaseEnd = syncBaseUI;
$('#base-btn').addEventListener('click', toggleBase);
$('#base-restart').addEventListener('click', () => { engine.stopBase(true); syncBaseUI(); });

$('#filter').addEventListener('input', e => engine.setFilter(+e.target.value));
$('#filter').addEventListener('dblclick', e => { e.target.value = 1; engine.setFilter(1); });
$('#speed').addEventListener('input', e => {
  const r = +e.target.value;
  engine.setRate(r);
  $('#bpm').textContent = Math.round(123 * r);
});
$('#speed').addEventListener('dblclick', e => { e.target.value = 1; e.target.dispatchEvent(new Event('input')); });
$('#vol-base').addEventListener('input', e => engine.setBaseVolume(+e.target.value));
$('#vol-pads').addEventListener('input', e => engine.setPadVolume(+e.target.value));

$('#echo').addEventListener('click', e => {
  const on = e.currentTarget.classList.toggle('on');
  engine.setEcho(on);
});
$('#roll').addEventListener('click', e => {
  state.roll = e.currentTarget.classList.toggle('on');
  if (!state.roll) state.rolls.clear();
});

const QUANTS = [0, 1, 0.5, 0.25];
const QNAMES = ['Libre', '1/4', '1/8', '1/16'];
function setQuant(q) {
  state.quant = q;
  $$('#quant button').forEach(b => b.classList.toggle('on', +b.dataset.q === q));
}
function cycleQuant() {
  const q = QUANTS[(QUANTS.indexOf(state.quant) + 1) % QUANTS.length];
  setQuant(q); toast(`Cuantizar: ${QNAMES[QUANTS.indexOf(q)]}`);
}
$$('#quant button').forEach(b => b.addEventListener('click', () => setQuant(+b.dataset.q)));

$('#loop-rec').addEventListener('click', () => looper.rec());
$('#loop-play').addEventListener('click', () => looper.playing ? looper.stop() : looper.play());
$('#loop-undo').addEventListener('click', () => looper.undo());
$('#loop-clear').addEventListener('click', () => looper.clear());
$$('#loop-bars button').forEach(b => b.addEventListener('click', () => {
  looper.bars = +b.dataset.bars;
  updateLoopUI();
}));

async function toggleRecording() {
  const btn = $('#rec-btn');
  if (engine.rec) {
    const blob = await engine.stopRecording();
    btn.classList.remove('on'); btn.querySelector('span').textContent = 'Grabar';
    if (!blob) return;
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `idaft-mezcla-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Mezcla descargada');
  } else {
    engine.resume();
    if (!engine.startRecording()) { toast('Tu navegador no permite grabar audio'); return; }
    btn.classList.add('on'); btn.querySelector('span').textContent = 'Parar';
    toast('Grabando tu mezcla…');
  }
}
$('#rec-btn').addEventListener('click', toggleRecording);

$('#reto-btn').addEventListener('click', () => game.active ? game.stop(false) : game.start());
$('#res-again').addEventListener('click', () => game.start());
$('#res-close').addEventListener('click', () => $('#results').classList.add('hidden'));

$('#keys-btn').addEventListener('click', e => visuals.setShowKeys(e.currentTarget.classList.toggle('on')));
$('#help-btn').addEventListener('click', () => $('#help').classList.toggle('hidden'));
$('#help-close').addEventListener('click', () => $('#help').classList.add('hidden'));
$('#fs-btn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
$('#panel-toggle').addEventListener('click', () => { document.body.classList.toggle('panel-min'); setTimeout(() => visuals.resize(), 320); });

function renderHelpKeys() {
  const grid = (bank) => PADS.slice(bank * 16, bank * 16 + 16)
    .map(p => `<span><kbd>${p.keyLabel}</kbd>${p.label}</span>`).join('');
  $('#help-a').innerHTML = grid(0);
  $('#help-b').innerHTML = grid(1);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

boot().catch(err => {
  console.error(err);
  $('#load-text').textContent = 'Error al cargar: ' + err.message;
});

// acceso para depurar desde la consola
window.idaft = { engine, looper, game, state };
