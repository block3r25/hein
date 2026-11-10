import * as THREE from 'three';

// ===================== Configuration =====================
const IS_MOBILE =
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
  window.innerWidth < 768;

const IMAGE_URL = '/hein.png';
const IMG_STEP = IS_MOBILE ? 2 : 1;
const PARTY_STEP = IS_MOBILE ? 2 : 1;
const MAX_IMG_DIM = IS_MOBILE ? 300 : 350;
const CAMERA_Z = IS_MOBILE ? 340 : 300;
const CONFETTI_COUNT = IS_MOBILE ? 150 : 300;
const BRIGHTNESS_MIN = 5;
const CELEBRATION_DURATION = 8; // seconds

const CONFETTI_COLORS = [
  [1.0, 0.3, 0.5], [1.0, 0.6, 0.2], [1.0, 0.9, 0.3],
  [0.4, 1.0, 0.5], [0.3, 0.7, 1.0], [0.7, 0.4, 1.0],
  [1.0, 0.4, 0.7], [0.4, 1.0, 0.9],
];

// ===================== Renderer =====================
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// ===================== Scene & Camera =====================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(0, 0, CAMERA_Z);

const clock = new THREE.Clock();

// ===================== State =====================
let imageGroup = null;
let partyGroup = null;
let imageUniforms = null;
let partyUniforms = null;
let confettiUniforms = null;

let phase = 'image'; // 'image' | 'celebrating'
let phaseStartTime = 0;
let imageForm = 1;
let partyForm = 0;
let confettiIntensity = 0;

let isDragging = false;
let hasMoved = false;
let prevX = 0, prevY = 0;
let userRotY = 0, userRotX = 0;
let autoRotY = 0;
let tapStartX = 0, tapStartY = 0, tapStartTime = 0;

// ===================== Utilities =====================
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function clamp01(v) {
  return Math.min(Math.max(v, 0), 1);
}

function fitScale(srcW, srcH, fraction) {
  const vh = 2 * CAMERA_Z * Math.tan((camera.fov * 0.5 * Math.PI) / 180);
  const vw = vh * (window.innerWidth / window.innerHeight);
  return Math.min((vw * fraction) / srcW, (vh * fraction) / srcH);
}

// ===================== Image Particle System =====================
// Uses NormalBlending with original colors so the image looks like the reference.
// Starts fully formed (uForm = 1) so the image is visible immediately.
function createImageParticles(source) {
  // Draw image to canvas (downscale if large)
  const imgCanvas = document.createElement('canvas');
  const ctx = imgCanvas.getContext('2d');
  const ratio = Math.min(1, MAX_IMG_DIM / Math.max(source.width, source.height));
  imgCanvas.width = Math.floor(source.width * ratio);
  imgCanvas.height = Math.floor(source.height * ratio);
  ctx.drawImage(source, 0, 0, imgCanvas.width, imgCanvas.height);

  const data = ctx.getImageData(0, 0, imgCanvas.width, imgCanvas.height).data;
  const w = imgCanvas.width;
  const h = imgCanvas.height;
  const scale = fitScale(w, h, 0.65);

  const targets = [];
  const scatters = [];
  const colors = [];
  const sizes = [];
  const phases = [];

  for (let y = 0; y < h; y += IMG_STEP) {
    for (let x = 0; x < w; x += IMG_STEP) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 30) continue;
      if ((r + g + b) / 3 < BRIGHTNESS_MIN) continue;

      // Target position: centered, Y flipped, Z from luminance for 3D relief
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      targets.push(
        (x - w / 2) * scale,
        -(y - h / 2) * scale,
        (lum - 0.5) * 20
      );

      // Original colors for accurate image reproduction
      colors.push(r / 255, g / 255, b / 255);

      sizes.push(2.5 + Math.random() * 1.5);
      phases.push(Math.random() * Math.PI * 2);

      // Scatter: random point in a sphere
      const sr = 100 + Math.random() * 100;
      const stheta = Math.random() * Math.PI * 2;
      const sphi = Math.acos(2 * Math.random() - 1);
      scatters.push(
        sr * Math.sin(sphi) * Math.cos(stheta),
        sr * Math.sin(sphi) * Math.sin(stheta),
        sr * Math.cos(sphi)
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(targets, 3));
  geometry.setAttribute('aTarget', new THREE.Float32BufferAttribute(targets, 3));
  geometry.setAttribute('aScatter', new THREE.Float32BufferAttribute(scatters, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));

  imageUniforms = {
    uTime: { value: 0 },
    uForm: { value: 1 }, // Start fully formed!
    uPixelRatio: { value: renderer.getPixelRatio() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: imageUniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aTarget;
      attribute vec3 aScatter;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;

      varying vec3 vColor;
      varying float vAlpha;

      uniform float uTime;
      uniform float uForm;
      uniform float uPixelRatio;

      void main() {
        vColor = aColor;

        vec3 pos = mix(aScatter, aTarget, uForm);

        // Gentle breathing when formed
        float breath = sin(uTime * 0.6 + aPhase) * 2.0;
        pos.z += breath * uForm;
        pos.x += sin(uTime * 0.25 + aPhase * 2.0) * 1.5 * uForm;
        pos.y += cos(uTime * 0.35 + aPhase * 1.5) * 1.5 * uForm;

        // Swirl when scattering
        float scatterAmt = 1.0 - uForm;
        float swirl = uTime * 0.5 + aPhase;
        pos.x += sin(swirl) * 8.0 * scatterAmt;
        pos.y += cos(swirl * 1.3) * 8.0 * scatterAmt;
        pos.z += sin(swirl * 0.7) * 8.0 * scatterAmt;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);

        vAlpha = uForm;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        if (d > 0.5) discard;
        // Harder edge for solid image appearance
        float strength = 1.0 - smoothstep(0.38, 0.5, d);
        gl_FragColor = vec4(vColor, strength * vAlpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending, // Accurate colors
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  imageGroup = new THREE.Group();
  imageGroup.add(points);
  scene.add(imageGroup);
}

// ===================== Party Canvas Drawing =====================
// Draws text, balloons, and cake on a canvas, then sampled into particles.
function createPartyCanvas() {
  const c = document.createElement('canvas');
  c.width = 1000;
  c.height = 700;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1000, 700);

  // --- Balloons ---
  const balloons = [
    { x: 80, y: 380, color: '#ff6b9d', r: 50 },
    { x: 920, y: 360, color: '#6bb6ff', r: 55 },
    { x: 55, y: 530, color: '#ffcc6b', r: 45 },
    { x: 945, y: 510, color: '#9d6bff', r: 50 },
    { x: 110, y: 630, color: '#6bff9d', r: 42 },
    { x: 890, y: 630, color: '#ff8b6b', r: 48 },
  ];

  balloons.forEach((b) => {
    // Balloon body
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.r * 0.82, b.r, 0, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(
      b.x - b.r * 0.25, b.y - b.r * 0.3,
      b.r * 0.2, b.r * 0.3, -0.3, 0, Math.PI * 2
    );
    ctx.fill();

    // Tie (triangle)
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(b.x - 6, b.y + b.r);
    ctx.lineTo(b.x + 6, b.y + b.r);
    ctx.lineTo(b.x, b.y + b.r + 10);
    ctx.closePath();
    ctx.fill();

    // String
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + b.r + 10);
    ctx.quadraticCurveTo(b.x + 15, b.y + b.r + 60, b.x - 5, b.y + b.r + 100);
    ctx.stroke();
  });

  // --- Cake ---
  const cx = 500;
  const cy = 570;

  // Bottom layer
  ctx.fillStyle = '#d49b6e';
  ctx.fillRect(cx - 100, cy - 35, 200, 35);

  // Frosting drips (bottom)
  ctx.fillStyle = '#fff5e6';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(cx - 80 + i * 40, cy, 10, 0, Math.PI);
    ctx.fill();
  }

  // Middle layer
  ctx.fillStyle = '#e8b884';
  ctx.fillRect(cx - 75, cy - 60, 150, 25);

  // Frosting drips (middle)
  ctx.fillStyle = '#fff5e6';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(cx - 60 + i * 40, cy - 35, 8, 0, Math.PI);
    ctx.fill();
  }

  // Top layer
  ctx.fillStyle = '#f0c994';
  ctx.fillRect(cx - 45, cy - 82, 90, 22);

  // Candles with flames
  const candleColors = ['#ff6b9d', '#6bb6ff', '#ffcc6b', '#9d6bff', '#6bff9d'];
  for (let i = 0; i < 5; i++) {
    const x = cx - 40 + i * 20;
    // Candle body
    ctx.fillStyle = candleColors[i];
    ctx.fillRect(x - 2, cy - 105, 4, 23);
    // Flame outer
    ctx.fillStyle = '#ffdd88';
    ctx.beginPath();
    ctx.ellipse(x, cy - 113, 3.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Flame inner
    ctx.fillStyle = '#ffaa44';
    ctx.beginPath();
    ctx.ellipse(x, cy - 111, 1.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Text ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // "Happy Birthday"
  ctx.fillStyle = '#ff6b9d';
  ctx.font = 'bold 64px Arial, sans-serif';
  ctx.fillText('Happy Birthday', 500, 70);

  // "Tyler Hein"
  ctx.fillStyle = '#6bb6ff';
  ctx.font = 'bold 115px Arial, sans-serif';
  ctx.fillText('Tyler Hein', 500, 180);

  // "from Basanta Family"
  ctx.fillStyle = '#ffcc6b';
  ctx.font = 'bold 48px Arial, sans-serif';
  ctx.fillText('from Basanta Family', 500, 275);

  return c;
}

// ===================== Party Particle System =====================
// Uses AdditiveBlending for a festive glowing look. Particles form the
// text + balloons + cake drawn on the party canvas.
function createPartyParticles() {
  const src = createPartyCanvas();
  const ctx = src.getContext('2d');
  const w = src.width;
  const h = src.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  const scale = fitScale(w, h, 0.82);

  const targets = [];
  const scatters = [];
  const colors = [];
  const sizes = [];
  const phases = [];

  for (let y = 0; y < h; y += PARTY_STEP) {
    for (let x = 0; x < w; x += PARTY_STEP) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 30) continue;
      if ((r + g + b) / 3 < 10) continue;

      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      targets.push(
        (x - w / 2) * scale,
        -(y - h / 2) * scale,
        (lum - 0.5) * 15
      );

      // Slightly boosted colors for vibrancy
      colors.push(
        Math.min(1, (r / 255) * 1.1),
        Math.min(1, (g / 255) * 1.1),
        Math.min(1, (b / 255) * 1.1)
      );

      sizes.push(2.5 + Math.random() * 1.5);
      phases.push(Math.random() * Math.PI * 2);

      // Scatter positions
      const sr = 120 + Math.random() * 100;
      const stheta = Math.random() * Math.PI * 2;
      const sphi = Math.acos(2 * Math.random() - 1);
      scatters.push(
        sr * Math.sin(sphi) * Math.cos(stheta),
        sr * Math.sin(sphi) * Math.sin(stheta),
        sr * Math.cos(sphi)
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(targets, 3));
  geometry.setAttribute('aTarget', new THREE.Float32BufferAttribute(targets, 3));
  geometry.setAttribute('aScatter', new THREE.Float32BufferAttribute(scatters, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));

  partyUniforms = {
    uTime: { value: 0 },
    uForm: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: partyUniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aTarget;
      attribute vec3 aScatter;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;

      varying vec3 vColor;
      varying float vAlpha;

      uniform float uTime;
      uniform float uForm;
      uniform float uPixelRatio;

      void main() {
        vColor = aColor;

        vec3 pos = mix(aScatter, aTarget, uForm);

        // Gentle floating when formed
        pos.y += sin(uTime * 0.5 + aPhase) * 2.0 * uForm;
        pos.x += sin(uTime * 0.3 + aPhase * 1.5) * 1.5 * uForm;

        // Swirl when scattering
        float scatterAmt = 1.0 - uForm;
        float swirl = uTime * 0.6 + aPhase;
        pos.x += sin(swirl) * 10.0 * scatterAmt;
        pos.y += cos(swirl * 1.3) * 10.0 * scatterAmt;
        pos.z += sin(swirl * 0.7) * 10.0 * scatterAmt;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Twinkling effect
        float twinkle = 0.85 + 0.15 * sin(uTime * 3.0 + aPhase * 5.0);
        gl_PointSize = aSize * twinkle * uPixelRatio * (300.0 / -mvPosition.z);

        vAlpha = uForm;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        if (d > 0.5) discard;
        float strength = 1.0 - smoothstep(0.3, 0.5, d);
        gl_FragColor = vec4(vColor, strength * vAlpha);
      }
    `,
    transparent: true,
    blending: THREE.NormalBlending, // Clear, readable text
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  partyGroup = new THREE.Group();
  partyGroup.add(points);
  scene.add(partyGroup);
}

// ===================== Confetti System =====================
function createConfetti() {
  const positions = [];
  const colors = [];
  const sizes = [];
  const offsets = [];

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    positions.push(
      (Math.random() - 0.5) * 500,
      200 + Math.random() * 100,
      (Math.random() - 0.5) * 200
    );

    const c = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    colors.push(c[0], c[1], c[2]);

    sizes.push(2 + Math.random() * 4);
    offsets.push(Math.random());
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 1));

  confettiUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uIntensity: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: confettiUniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aOffset;

      varying vec3 vColor;
      varying float vAlpha;

      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uIntensity;

      void main() {
        vColor = aColor;

        vec3 pos = position;

        // Continuous fall with modulo for infinite respawn
        float fallSpeed = 50.0 + aOffset * 30.0;
        float fallDist = mod(uTime * fallSpeed + aOffset * 400.0, 450.0);
        pos.y = position.y - fallDist;

        // Horizontal sway
        pos.x += sin(uTime * 2.0 + aOffset * 10.0) * 20.0;
        pos.z += cos(uTime * 1.5 + aOffset * 8.0) * 15.0;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Twinkling
        float twinkle = 0.6 + 0.4 * sin(uTime * 4.0 + aOffset * 20.0);
        gl_PointSize = aSize * twinkle * uPixelRatio * (200.0 / -mvPosition.z);

        // Fade at bottom edge
        float edgeFade = smoothstep(-220.0, -180.0, pos.y);
        vAlpha = uIntensity * edgeFade;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        if (d > 0.5) discard;
        float strength = 1.0 - smoothstep(0.0, 0.5, d);
        strength = pow(strength, 1.5);
        gl_FragColor = vec4(vColor, strength * vAlpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
}

// ===================== Initialization =====================
function init(source) {
  createImageParticles(source);
  createPartyParticles();
  createConfetti();

  document.getElementById('loading').classList.add('hidden');

  // Show tap hint after image is visible
  const hint = document.querySelector('.hint');
  if (hint) setTimeout(() => hint.classList.add('show'), 1500);

  animate();
}

function initFallback() {
  // Fallback: generate particles from text "HEIN"
  const fbCanvas = document.createElement('canvas');
  const fbCtx = fbCanvas.getContext('2d');
  fbCanvas.width = 400;
  fbCanvas.height = 200;
  fbCtx.fillStyle = '#ff6b9d';
  fbCtx.font = 'bold 140px Arial, sans-serif';
  fbCtx.textAlign = 'center';
  fbCtx.textBaseline = 'middle';
  fbCtx.fillText('HEIN', 200, 100);
  init(fbCanvas);
}

const img = new Image();
img.crossOrigin = 'anonymous';
img.onload = () => init(img);
img.onerror = () => initFallback();
img.src = IMAGE_URL;

// ===================== Phase Machine =====================
// IMAGE: image visible, party hidden, confetti off
// CELEBRATING (8s total):
//   0-1.5s:   image scatters, party particles converge to form text + balloons + cake
//   1.5-6s:   party holds (particle text readable), confetti active
//   6-8s:     party particles scatter (text dissolves), image reforms, confetti fades
function updatePhase(time) {
  if (phase === 'image') {
    imageForm = 1;
    partyForm = 0;
    confettiIntensity = 0;
    return;
  }

  // Celebrating
  const elapsed = time - phaseStartTime;

  if (elapsed < 1.5) {
    // FORM: image scatters, party particles converge into text/balloons/cake
    const t = easeInOutCubic(elapsed / 1.5);
    imageForm = 1 - t;
    partyForm = t;
    confettiIntensity = t;
  } else if (elapsed < 6) {
    // HOLD: party visible, confetti active
    imageForm = 0;
    partyForm = 1;
    confettiIntensity = 1;
  } else if (elapsed < CELEBRATION_DURATION) {
    // EXIT: party particles scatter, image reforms
    const t = easeInOutCubic((elapsed - 6) / (CELEBRATION_DURATION - 6));
    partyForm = 1 - t;
    imageForm = t;
    confettiIntensity = 1 - t;
  } else {
    // Back to image
    phase = 'image';
    imageForm = 1;
    partyForm = 0;
    confettiIntensity = 0;
    const hint = document.querySelector('.hint');
    if (hint) hint.classList.add('show');
  }
}

function triggerCelebration() {
  if (phase === 'image') {
    phase = 'celebrating';
    phaseStartTime = clock.getElapsedTime();
    const hint = document.querySelector('.hint');
    if (hint) hint.classList.remove('show');
  }
}

// ===================== Interaction =====================
canvas.addEventListener('pointerdown', (e) => {
  isDragging = true;
  hasMoved = false;
  prevX = e.clientX;
  prevY = e.clientY;
  tapStartX = e.clientX;
  tapStartY = e.clientY;
  tapStartTime = Date.now();
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  if (
    Math.abs(e.clientX - tapStartX) > 5 ||
    Math.abs(e.clientY - tapStartY) > 5
  ) {
    hasMoved = true;
  }
  userRotY += dx * 0.008;
  userRotX = Math.max(-0.6, Math.min(0.6, userRotX + dy * 0.008));
  prevX = e.clientX;
  prevY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  isDragging = false;
  const dt = Date.now() - tapStartTime;
  if (!hasMoved && dt < 300) {
    triggerCelebration();
  }
});

canvas.addEventListener('pointercancel', () => {
  isDragging = false;
});

// ===================== Animation Loop =====================
function animate() {
  requestAnimationFrame(animate);

  const time = clock.getElapsedTime();

  updatePhase(time);

  // Update uniforms
  if (imageUniforms) {
    imageUniforms.uTime.value = time;
    imageUniforms.uForm.value = imageForm;
  }
  if (partyUniforms) {
    partyUniforms.uTime.value = time;
    partyUniforms.uForm.value = partyForm;
  }
  if (confettiUniforms) {
    confettiUniforms.uTime.value = time;
    confettiUniforms.uIntensity.value = confettiIntensity;
  }

  // Image group: auto-rotate when visible, manual drag override
  if (imageGroup) {
    imageGroup.visible = imageForm > 0.01;
    if (!isDragging && phase === 'image') {
      autoRotY += 0.003;
    }
    imageGroup.rotation.y = autoRotY + userRotY;
    imageGroup.rotation.x = userRotX;
  }

  // Party group: gentle 3D wobble for a living feel
  if (partyGroup) {
    partyGroup.visible = partyForm > 0.01;
    partyGroup.rotation.y = Math.sin(time * 0.3) * 0.08;
    partyGroup.rotation.x = Math.sin(time * 0.2) * 0.04;
    partyGroup.position.y = Math.sin(time * 0.5) * 3;
  }

  renderer.render(scene, camera);
}

// ===================== Resize Handler =====================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const pr = renderer.getPixelRatio();
  if (imageUniforms) imageUniforms.uPixelRatio.value = pr;
  if (partyUniforms) partyUniforms.uPixelRatio.value = pr;
  if (confettiUniforms) confettiUniforms.uPixelRatio.value = pr;
});
