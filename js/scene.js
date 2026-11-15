// Escena 3D: pads de neón flotando ante un portal a otra dimensión.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PAD = 1.5, GAP = 0.3, STEP = PAD + GAP;
const FONT = '"Orbitron", "Segoe UI", system-ui, sans-serif';
const LABEL_FONT = '"Rajdhani", "Arial Narrow", "Segoe UI", system-ui, sans-serif';

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function fitFont(g, text, maxW, size, weight = 800, font = FONT) {
  let s = size;
  do { g.font = `${weight} ${s}px ${font}`; s -= 2; } while (g.measureText(text).width > maxW && s > 10);
}

export class Visuals {
  constructor(canvas, pads) {
    this.pads = pads;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030109);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.camBase = new THREE.Vector3(0, 0.5, 12);
    this.camTarget = new THREE.Vector3();
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.time = 0; this.travel = 0; this.shake = 0; this.chroma = 0; this.hover = -1;
    this.coreColor = new THREE.Color(0x66ffff);
    this.showKeys = true;
    this.dot = glowTexture();

    this._lights();
    this._world();
    this._pads();
    this._core();
    this._fx();
    this._post();
    this.resize();
  }

  // ---------------- construcción ----------------
  _lights() {
    this.scene.add(new THREE.AmbientLight(0x6070a0, 0.6));
    this.lightA = new THREE.PointLight(0x33ffff, 8, 30, 1.6);
    this.lightB = new THREE.PointLight(0xff33ee, 8, 30, 1.6);
    this.lightA.position.set(-5, 3, 5); this.lightB.position.set(5, 3, 5);
    const top = new THREE.DirectionalLight(0xffffff, 0.5); top.position.set(0, 10, 10);
    this.scene.add(this.lightA, this.lightB, top);
  }

  _world() {
    // Suelo: rejilla infinita de neón
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: { uTravel: { value: 0 }, uPulse: { value: 0 }, uA: { value: new THREE.Color(0x00e5ff) }, uB: { value: new THREE.Color(0xff2bd6) } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float uTravel, uPulse; uniform vec3 uA, uB; varying vec3 vW;
        float grid(float x){ float d = abs(fract(x - .5) - .5) / fwidth(x); return 1. - min(d, 1.); }
        void main(){
          vec2 p = vec2(vW.x / 2., (vW.z + uTravel) / 2.);
          float g = max(grid(p.x), grid(p.y));
          float fade = exp(-abs(vW.z - 6.) * .022) * smoothstep(40., 8., abs(vW.x));
          vec3 col = mix(uB, uA, smoothstep(-90., 10., vW.z));
          gl_FragColor = vec4(col * g * fade * (.32 + uPulse * .35), 1.);
        }`,
    });
    Object.assign(this.floorMat, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 260), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, -6, -110);
    this.scene.add(floor);
    const ceil = floor.clone(); ceil.position.y = 14; ceil.rotation.x = Math.PI / 2;
    this.scene.add(ceil);

    // Portal: resplandor al fondo
    this.portalMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uA: { value: new THREE.Color(0x00e5ff) }, uB: { value: new THREE.Color(0xff2bd6) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime, uPulse; uniform vec3 uA, uB; varying vec2 vUv;
        void main(){
          vec2 p = vUv - .5; float r = length(p); float a = atan(p.y, p.x);
          float swirl = .5 + .5 * sin(a * 6. + r * 40. - uTime * 2.);
          float core = smoothstep(.5, 0., r);
          float ring = smoothstep(.02, 0., abs(r - .18 - uPulse * .03));
          vec3 col = mix(uA, uB, .5 + .5 * sin(a * 2. + uTime * .5));
          float i = core * core * (.18 + .12 * swirl) + ring * .4;
          gl_FragColor = vec4(col * i * (1. + uPulse * .5), 1.);
        }`,
    });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), this.portalMat);
    portal.position.set(0, 3, -150);
    this.scene.add(portal);

    // Túnel de anillos hexagonales
    this.rings = [];
    const ringGeo = new THREE.TorusGeometry(11, 0.05, 4, 6);
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, fog: false }));
      m.userData.z = -10 - i * 6.5;
      m.rotation.z = (i % 2) * Math.PI / 6;
      this.rings.push(m); this.scene.add(m);
    }

    // Estrellas en movimiento (posición calculada en la GPU)
    const N = 1800, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 40, a = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r * 0.6 + 3; pos[i * 3 + 2] = Math.random() * 160;
      c.setHSL(Math.random() < 0.5 ? 0.52 : 0.85, 1, 0.6 + Math.random() * 0.3); col.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      uniforms: { uTravel: { value: 0 }, uMap: { value: this.dot }, uSize: { value: 1 } },
      vertexShader: `uniform float uTravel, uSize; varying vec3 vC; varying float vF;
        void main(){ vec3 p = position; p.z = mod(p.z + uTravel * 2.5, 160.) - 145.;
          vC = color; vF = smoothstep(-145., -100., p.z) * smoothstep(15., 5., p.z);
          vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = uSize * 60. / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vC; varying float vF;
        void main(){ gl_FragColor = vec4(vC * vF, 1.) * texture2D(uMap, gl_PointCoord); }`,
    });
    this.scene.add(new THREE.Points(sg, this.starMat));
  }

  _labelCanvas(p) {
    const c = p.canvas || (p.canvas = document.createElement('canvas'));
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, 256, 256);
    const col = '#' + p.color.getHexString();
    // fondo oscuro para que el texto contraste
    g.fillStyle = 'rgba(4, 4, 14, 0.82)';
    g.beginPath(); g.roundRect(14, 14, 228, 228, 26); g.fill();
    g.strokeStyle = col; g.lineWidth = 6;
    g.beginPath(); g.roundRect(14, 14, 228, 228, 26); g.stroke();
    g.lineWidth = 1.5; g.globalAlpha = 0.35;
    g.beginPath(); g.roundRect(28, 28, 200, 200, 16); g.stroke();
    g.globalAlpha = 1;
    // texto nítido: sin sombra difusa, con contorno oscuro fino
    const words = p.label.toUpperCase().split(' ');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 4; g.lineJoin = 'round';
    const lines = words.length > 1 ? [words[0], words.slice(1).join(' ')] : words;
    fitFont(g, lines.reduce((a, b) => a.length > b.length ? a : b), 196, lines.length > 1 ? 58 : 64, 700, LABEL_FONT);
    const lh = parseInt(g.font.match(/(\d+)px/)[1]) * 0.95;
    const y0 = 128 - (lines.length - 1) * lh / 2;
    lines.forEach((l, k) => { g.strokeText(l, 128, y0 + k * lh); g.fillText(l, 128, y0 + k * lh); });
    if (this.showKeys && p.keyLabel) {
      g.font = `700 26px ${LABEL_FONT}`; g.fillStyle = col;
      g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillText(p.keyLabel, 224, 226);
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `600 20px ${LABEL_FONT}`; g.fillStyle = col; g.globalAlpha = 0.75;
    g.fillText(String(p.n).padStart(2, '0'), 34, 50);
    return c;
  }

  _pads() {
    this.banks = [new THREE.Group(), new THREE.Group()];
    this.banks.forEach(b => this.scene.add(b));
    const body = new RoundedBoxGeometry(PAD, PAD, 0.32, 3, 0.12);
    const face = new THREE.PlaneGeometry(PAD, PAD);
    this.padObjs = [];
    this.hitMeshes = [];
    const perBank = [0, 0];
    this.pads.forEach((p, i) => {
      const k = perBank[p.bank]++;
      const row = Math.floor(k / 4), col = k % 4;
      const hue = p.bank === 0 ? 0.5 + row * 0.03 : 0.86 + row * 0.03;
      const color = new THREE.Color().setHSL(hue % 1, 1, 0.58);
      const o = { i, n: k + 1, label: p.label, keyLabel: p.keyLabel, color, energy: 0, hoverE: 0, target: 0, row, col, bank: p.bank };
      const g = new THREE.Group();
      g.position.set((col - 1.5) * STEP, (1.5 - row) * STEP, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x0b0b1a, metalness: 0.7, roughness: 0.3, emissive: color, emissiveIntensity: 0.12 });
      const m = new THREE.Mesh(body, mat);
      const tex = new THREE.CanvasTexture(this._labelCanvas(o));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const fm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
      const f = new THREE.Mesh(face, fm); f.position.z = 0.17;
      g.add(m, f);
      m.userData.pad = i; f.userData.pad = i;
      this.hitMeshes.push(m);
      Object.assign(o, { group: g, mat, faceMat: fm, tex });
      this.banks[p.bank].add(g);
      this.padObjs[i] = o;
    });
    // rejilla de fondo de cada banco
    this.banks.forEach((b, bi) => {
      const frame = new THREE.Mesh(new RoundedBoxGeometry(4 * STEP + 0.4, 4 * STEP + 0.4, 0.12, 2, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x05050c, metalness: 0.9, roughness: 0.4, emissive: bi ? 0xff2bd6 : 0x00e5ff, emissiveIntensity: 0.05 }));
      frame.position.z = -0.25; b.add(frame);
    });
  }

  _core() {
    this.core = new THREE.Group();
    this.scene.add(this.core);
    this.coreWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1),
      new THREE.MeshBasicMaterial({ color: 0x88ffff, wireframe: true, toneMapped: false, transparent: true, opacity: 0.8 }));
    this.coreMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uColor: { value: new THREE.Color(0x66ffff) }, uFlash: { value: 0 } },
      vertexShader: `uniform float uTime, uLevel; varying vec3 vN; varying vec3 vV; varying float vD;
        void main(){
          vec3 p = position;
          float d = sin(p.x * 4. + uTime * 2.) * sin(p.y * 5. - uTime * 1.7) * sin(p.z * 4.5 + uTime * 1.3);
          d *= .12 + uLevel * .9; vD = d;
          p += normal * d;
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uFlash; varying vec3 vN; varying vec3 vV; varying float vD;
        void main(){
          float fr = pow(1. - max(dot(vN, vV), 0.), 2.2);
          vec3 c = uColor * (fr * 1.1 + .05 + vD * .8) + vec3(.4) * uFlash * fr;
          gl_FragColor = vec4(c, 1.); }`,
    });
    this.coreBall = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 24), this.coreMat);

    // anillo de progreso del looper
    this.loopMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uProg: { value: 0 }, uBars: { value: 2 }, uOn: { value: 0 }, uRec: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uProg, uBars, uOn, uRec; varying vec2 vUv;
        void main(){
          vec2 p = vUv - .5; float a = fract(.25 - atan(p.y, p.x) / 6.2831853);
          float steps = uBars * 4.;
          float tick = step(fract(a * steps), .06);
          float filled = step(a, uProg);
          vec3 col = mix(vec3(.3, 1., 1.), vec3(1., .2, .3), uRec);
          float v = (.15 + filled * .9 + tick * .5) * uOn;
          gl_FragColor = vec4(col * v * 1.6, v); }`,
    });
    const ringGeo = new THREE.RingGeometry(1.75, 1.92, 128, 1);
    // uv radial para el anillo
    const uv = ringGeo.attributes.uv, pos = ringGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 3.84 + 0.5, pos.getY(i) / 3.84 + 0.5);
    this.loopRing = new THREE.Mesh(ringGeo, this.loopMat);
    this.beatRing = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.025, 6, 96),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true }));
    this.core.add(this.coreWire, this.coreBall, this.loopRing, this.beatRing);
  }

  _fx() {
    // partículas
    const N = this.pN = 2500;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pBase = new Float32Array(N * 3);
    this.pPos.fill(9999); this.pNext = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo = g;
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, map: this.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);

    // ondas expansivas
    this.waves = [];
    const wg = new THREE.RingGeometry(0.9, 1, 64);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.visible = false; m.userData.life = 0; this.scene.add(m); this.waves.push(m);
    }

    // palabras que salen volando
    this.words = [];
    for (let i = 0; i < 20; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      s.visible = false; s.userData.life = 0; s.userData.vel = new THREE.Vector3();
      this.scene.add(s); this.words.push(s);
    }
    this.wordTex = [];

    // anillos de aproximación (modo reto)
    this.approach = [];
    const ag = new THREE.RingGeometry(0.98, 1.08, 4, 1, Math.PI / 4);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
      m.visible = false; this.approach.push(m);
    }
  }

  _post() {
    const r = this.renderer;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.35, 0.82);
    this.composer.addPass(this.bloom);
    this.finalPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uAmount: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount, uTime; varying vec2 vUv;
        void main(){
          vec2 d = vUv - .5; float r = dot(d, d);
          vec2 off = d * uAmount * (.5 + r * 3.);
          vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
          c *= 1. - r * 1.1;
          c *= .985 + .015 * sin(vUv.y * 900.);
          c += (fract(sin(dot(vUv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453) - .5) * .012;
          gl_FragColor = vec4(c, 1.); }`,
    });
    this.composer.addPass(this.finalPass);
    this.composer.addPass(new OutputPass());
  }

  // ---------------- disposición ----------------
  resize() {
    const w = window.innerWidth, h = window.innerHeight, a = w / h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = a;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.portrait = a < 0.95;
    const [A, B] = this.banks;
    // zona de pantalla libre de la interfaz (entre la barra superior y el panel inferior)
    const top = (document.querySelector('#top')?.getBoundingClientRect().bottom || 0) + 8;
    const panel = document.querySelector('#panel');
    const bottom = panel && !document.body.classList.contains('panel-min') ? panel.getBoundingClientRect().top - 8 : h;
    const safe = Math.max(0.35, (bottom - top) / h);
    const centerNdc = 1 - (top + bottom) / h;
    let needW, needH;
    if (this.portrait) {
      const dy = 2 * STEP + 1.9;
      A.position.set(0, dy + 0.15, 0); B.position.set(0, -dy + 0.15, 0);
      A.rotation.set(0.12, 0, 0); B.rotation.set(-0.12, 0, 0);
      this.core.position.set(0, 0.15, -1.2); this.core.scale.setScalar(0.62);
      needW = 4 * STEP + 1; needH = 2 * dy + 4 * STEP + 1;
    } else {
      const dx = 2 * STEP + 2.45;
      A.position.set(-dx, 0, 0); B.position.set(dx, 0, 0);
      A.rotation.set(0, 0.24, 0); B.rotation.set(0, -0.24, 0);
      this.core.position.set(0, 0, 0); this.core.scale.setScalar(1);
      needW = 2 * dx + 4 * STEP + 0.8; needH = 4 * STEP + 0.6;
    }
    const dW = (needW * 1.18 / 2) / (tanV * a), dH = (needH * 1.08 / 2) / (tanV * safe);
    const dist = Math.max(dW, dH);
    this.camBase.set(0, 0.4, dist);
    // la barra inferior es más alta que la superior: desplazamos la vista
    this.camTarget.set(0, this.camBase.y - centerNdc * dist * tanV, 0);
    this.camera.updateProjectionMatrix();
  }

  setShowKeys(on) {
    this.showKeys = on;
    this.padObjs.forEach(o => { this._labelCanvas(o); o.tex.needsUpdate = true; });
  }

  setKeyLabels(labels) {
    this.padObjs.forEach((o, i) => { o.keyLabel = labels[i]; this._labelCanvas(o); o.tex.needsUpdate = true; });
  }

  // ---------------- interacción ----------------
  pick(clientX, clientY) {
    this.pointer.set(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.hitMeshes, false)[0];
    return hit ? hit.object.userData.pad : -1;
  }

  setParallax(clientX, clientY) {
    this.parallax.set(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  }

  screenPos(i) {
    const v = new THREE.Vector3();
    this.padObjs[i].group.getWorldPosition(v);
    v.project(this.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }

  _wordTexture(o) {
    if (this.wordTex[o.i]) return this.wordTex[o.i];
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    const col = '#' + o.color.getHexString();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, o.label.toUpperCase(), 480, 80, 900);
    g.shadowColor = col; g.shadowBlur = 24; g.fillStyle = col; g.fillText(o.label.toUpperCase(), 256, 64);
    g.shadowBlur = 0; g.fillStyle = '#fff'; g.globalAlpha = 0.85; g.fillText(o.label.toUpperCase(), 256, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return (this.wordTex[o.i] = t);
  }

  hit(i, strength = 1) {
    const o = this.padObjs[i]; if (!o) return;
    o.energy = 1;
    const wp = new THREE.Vector3(); o.group.getWorldPosition(wp);
    const q = new THREE.Quaternion(); o.group.getWorldQuaternion(q);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    // partículas
    const count = Math.round(34 * strength);
    for (let k = 0; k < count; k++) {
      const j = this.pNext; this.pNext = (this.pNext + 1) % this.pN;
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      const v = new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, 0).applyQuaternion(q).addScaledVector(n, 2 + Math.random() * 5);
      this.pPos.set([wp.x + n.x * 0.2, wp.y + n.y * 0.2, wp.z + n.z * 0.2], j * 3);
      this.pVel.set([v.x, v.y, v.z], j * 3);
      const c = o.color.clone().lerp(new THREE.Color(1, 1, 1), Math.random() * 0.5).multiplyScalar(1.1);
      this.pBase.set([c.r, c.g, c.b], j * 3);
      this.pLife[j] = 0.6 + Math.random() * 0.7;
    }
    // onda
    const w = this.waves.find(m => !m.visible) || this.waves[0];
    w.visible = true; w.userData.life = 1;
    w.position.copy(wp).addScaledVector(n, 0.2); w.quaternion.copy(q);
    w.material.color.copy(o.color).multiplyScalar(0.9);
    // palabra
    if (strength >= 0.8) {
      const s = this.words.find(m => !m.visible) || this.words[0];
      s.material.map = this._wordTexture(o); s.material.needsUpdate = true;
      s.visible = true; s.userData.life = 1;
      s.position.copy(wp).addScaledVector(n, 1.2); s.position.y += 0.9;
      s.userData.vel.set((Math.random() - 0.5) * 1.5, 2.6 + Math.random(), 0).addScaledVector(n, 4);
    }
    this.coreColor.copy(o.color);
    this.coreMat.uniforms.uFlash.value = 1;
    this.chroma = Math.min(this.chroma + 0.002 * strength, 0.006);
    this.shake = Math.min(this.shake + 0.08 * strength, 0.25);
    (o.bank ? this.lightB : this.lightA).userData.kick = 1;
  }

  // notas del modo reto: [{pad, t}] con t = fracción restante (1 → 0)
  setApproach(list) {
    this.approach.forEach((m, k) => {
      const it = list[k];
      if (!it) { m.visible = false; return; }
      const o = this.padObjs[it.pad];
      if (m.parent !== o.group) o.group.add(m);
      m.visible = true;
      m.position.z = 0.2;
      m.scale.setScalar((PAD / 2) * 1.42 * (1 + it.t * 1.6));
      m.material.color.copy(o.color).lerp(new THREE.Color(1, 1, 1), 0.4).multiplyScalar(0.9 + (1 - it.t) * 0.6);
      m.material.opacity = Math.min(1, (1 - it.t) * 2.5);
      o.target = Math.max(o.target, 1 - it.t);
    });
  }

  setLoop(on, prog, bars, rec) {
    const u = this.loopMat.uniforms;
    u.uOn.value += ((on ? 1 : 0) - u.uOn.value) * 0.15;
    u.uProg.value = prog; u.uBars.value = bars; u.uRec.value = rec ? 1 : 0;
  }

  // ---------------- animación ----------------
  update(dt, s) {
    this.time += dt;
    const t = this.time;
    const beatPulse = Math.exp(-(s.beat % 1) * 5) * (s.running ? 1 : 0.4);
    const speed = 4 + s.bps * 3 + s.bass * 6;
    this.travel += dt * speed;

    this.floorMat.uniforms.uTravel.value = this.travel;
    this.floorMat.uniforms.uPulse.value = beatPulse * 0.6 + s.bass * 0.6;
    this.starMat.uniforms.uTravel.value = this.travel;
    this.portalMat.uniforms.uTime.value = t;
    this.portalMat.uniforms.uPulse.value = beatPulse * 0.5 + s.level;

    const c = new THREE.Color();
    this.rings.forEach((m, k) => {
      let z = m.userData.z + (this.travel % 6.5);
      m.position.set(0, 3, z);
      m.rotation.z += dt * 0.05 * (k % 2 ? 1 : -1);
      const f = THREE.MathUtils.smoothstep(z, -150, -40) * THREE.MathUtils.smoothstep(-z, -12, 0);
      c.setHSL((0.5 + k * 0.035 + t * 0.03) % 1, 1, 0.55);
      m.material.color.copy(c).multiplyScalar(0.3 + beatPulse * 0.4);
      m.material.opacity = f;
      m.scale.setScalar(1 + beatPulse * 0.03);
    });

    // pads
    this.padObjs.forEach(o => {
      o.energy *= Math.exp(-dt * 6);
      o.hoverE += ((this.hover === o.i ? 1 : 0) - o.hoverE) * Math.min(1, dt * 12);
      const e = o.energy, tg = o.target;
      o.group.position.z = -e * 0.22 + o.hoverE * 0.12 + tg * 0.1;
      o.group.scale.setScalar(1 + e * 0.06 + tg * 0.05);
      o.mat.emissiveIntensity = 0.05 + e * 0.6 + o.hoverE * 0.15 + tg * 0.35;
      o.faceMat.color.setScalar(0.78 + e * 0.9 + o.hoverE * 0.1 + tg * 0.5);
      o.target = 0;
    });
    this.banks.forEach((b, bi) => {
      const sway = Math.sin(t * 0.6 + bi * 2) * 0.02;
      b.rotation.z = sway;
      b.position.z = Math.sin(t * 0.8 + bi) * 0.08;
    });
    [this.lightA, this.lightB].forEach(L => {
      L.userData.kick = (L.userData.kick || 0) * Math.exp(-dt * 5);
      L.intensity = 8 + L.userData.kick * 14 + beatPulse * 3;
    });

    // núcleo
    const cu = this.coreMat.uniforms;
    cu.uTime.value = t; cu.uLevel.value += (s.level * 1.2 - cu.uLevel.value) * 0.2;
    cu.uFlash.value *= Math.exp(-dt * 5);
    cu.uColor.value.lerp(this.coreColor, Math.min(1, dt * 4));
    this.coreWire.rotation.x += dt * 0.3; this.coreWire.rotation.y += dt * 0.45;
    this.coreWire.material.color.copy(cu.uColor.value).multiplyScalar(0.6 + beatPulse * 0.4);
    this.coreWire.scale.setScalar(1 + beatPulse * 0.08 + s.bass * 0.15);
    this.beatRing.scale.setScalar(1 + beatPulse * 0.1);
    this.beatRing.material.opacity = 0.25 + beatPulse * 0.75;
    this.beatRing.material.color.copy(cu.uColor.value).multiplyScalar(0.9);
    this.beatRing.rotation.x = Math.sin(t * 0.7) * 0.4; this.beatRing.rotation.y = Math.cos(t * 0.5) * 0.4;

    // partículas
    const drag = Math.exp(-dt * 2.2);
    for (let j = 0; j < this.pN; j++) {
      if (this.pLife[j] <= 0) continue;
      this.pLife[j] -= dt;
      const j3 = j * 3;
      if (this.pLife[j] <= 0) { this.pPos[j3] = 9999; continue; }
      this.pVel[j3] *= drag; this.pVel[j3 + 1] = this.pVel[j3 + 1] * drag - dt * 1.5; this.pVel[j3 + 2] *= drag;
      this.pPos[j3] += this.pVel[j3] * dt; this.pPos[j3 + 1] += this.pVel[j3 + 1] * dt; this.pPos[j3 + 2] += this.pVel[j3 + 2] * dt;
      const l = Math.min(1, this.pLife[j] * 1.5);
      this.pCol[j3] = this.pBase[j3] * l; this.pCol[j3 + 1] = this.pBase[j3 + 1] * l; this.pCol[j3 + 2] = this.pBase[j3 + 2] * l;
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;

    this.waves.forEach(m => {
      if (!m.visible) return;
      m.userData.life -= dt * 1.8;
      if (m.userData.life <= 0) { m.visible = false; return; }
      const l = m.userData.life;
      m.scale.setScalar(0.8 + (1 - l) * 1.6);
      m.material.opacity = l * l;
    });
    this.words.forEach(s2 => {
      if (!s2.visible) return;
      s2.userData.life -= dt * 0.9;
      if (s2.userData.life <= 0) { s2.visible = false; return; }
      const l = s2.userData.life;
      s2.position.addScaledVector(s2.userData.vel, dt);
      s2.userData.vel.multiplyScalar(Math.exp(-dt * 1.5));
      s2.scale.set(3.2, 0.8, 1).multiplyScalar(0.7 + (1 - l) * 0.9);
      s2.material.opacity = Math.min(0.75, l * 1.2);
      s2.material.color.setScalar(0.9);
    });

    // cámara
    this.shake *= Math.exp(-dt * 8);
    this.chroma *= Math.exp(-dt * 4);
    const cam = this.camera;
    cam.position.set(
      this.camBase.x + this.parallax.x * 0.9 + (Math.random() - 0.5) * this.shake,
      this.camBase.y + this.parallax.y * 0.5 + (Math.random() - 0.5) * this.shake,
      this.camBase.z - beatPulse * 0.12 - s.bass * 0.3);
    cam.lookAt(this.camTarget);
    this.finalPass.uniforms.uAmount.value = this.chroma;
    this.finalPass.uniforms.uTime.value = t;
    this.bloom.strength = 0.5 + s.level * 0.15;

    this.composer.render(dt);
  }
}
