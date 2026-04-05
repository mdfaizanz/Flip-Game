"use strict";

// ─── CANVAS SETUP ─────────────────────────────
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let W = 0,
  H = 0;

function resizeCanvas() {
  // Use visualViewport for accurate mobile dimensions
  const viewport = window.visualViewport || {
    width: window.innerWidth,
    height: window.innerHeight
  };

  W = Math.round(viewport.width);
  H = Math.round(viewport.height);

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (H < 400) H = Math.max(H, window.innerHeight * 0.9);
}
resizeCanvas();
window.addEventListener("resize", () => {
  resizeCanvas();
  updateLandscapeOverlay();
  if (state !== STATE.PLAYING) drawIdleBackground();
});
window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    resizeCanvas();
    updateLandscapeOverlay();
  }, 100);
});

function isLandscape() {
  return window.matchMedia("(orientation: landscape)").matches || window.innerWidth > window.innerHeight;
}

function setRotateOverlay(show) {
  const el = document.getElementById("rotateOverlay");
  if (!el) return;
  if (show) {
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function updateLandscapeOverlay() {
  const show = !isLandscape();
  setRotateOverlay(show);
  if (!show && state === STATE.START) drawIdleBackground();
}

async function lockLandscape() {
  if (!screen.orientation || !screen.orientation.lock) {
    // Not supported; use overlay and manual rotation instead.
    return;
  }

  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    await screen.orientation.lock("landscape");
  } catch (e) {
    // Device/browser may not allow programmatic lock (especially iOS). No console flood.
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("rotateRetryBtn").addEventListener("click", () => {
    if (isLandscape()) {
      setRotateOverlay(false);
      startGame();
    } else {
      lockLandscape();
    }
  });
});

window.addEventListener("load", () => {
  updateLandscapeOverlay();
});

// ─── CONSTANTS ────────────────────────────────
const isMobileDevice = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const FLOOR_THICK = isMobileDevice ? 40 : 32;
const CEIL_THICK = isMobileDevice ? 40 : 32;
const PLAYER_W = 28;
const PLAYER_H = 28;
const PLAYER_X = isMobileDevice ? 70 : 90;
const BASE_SPEED = isMobileDevice ? 190 : 230;
const GRAVITY_ACC = 1000;
const FLIP_IMPULSE = -200;
const isMobile = isMobileDevice;
const SPAWN_DISTANCE = isMobile ? 340 : 40;
const SPAWN_COIN_DISTANCE = isMobile ? 280 : 30;
const SPAWN_POWERUP_DISTANCE = isMobile ? 280 : 30;

// ─── STATE MACHINE ────────────────────────────
const STATE = { START: 0, PLAYING: 1, PAUSED: 2, GAMEOVER: 3, SHOP: 4 };
let state = STATE.START;

// ─── PERSISTENCE ──────────────────────────────
const SAVE_KEY = "gfr_save";
let save = {
  bestScore: 0,
  totalCoins: 0,
  unlockedSkins: ["default"],
  activeSkin: "default",
  achievements: [],
};
loadSave();

function loadSave() {
  try {
    const d = localStorage.getItem(SAVE_KEY);
    if (d) {
      const loaded = JSON.parse(d);
      save = { ...save, ...loaded };
      // Ensure only legitimately unlocked skins are included
      save.unlockedSkins = (loaded.unlockedSkins || ["default"]).filter(
        (skinId) => {
          const skin = SKINS.find((s) => s.id === skinId);
          return (
            skin && (skinId === "default" || save.totalCoins >= skin.price)
          );
        },
      );
      // Ensure unlockedSkins always has 'default'
      if (!save.unlockedSkins.includes("default")) {
        save.unlockedSkins.push("default");
      }
    }
  } catch (e) {}
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) {}
}

// ─── SKINS ────────────────────────────────────
const SKINS = [
  {
    id: "default",
    name: "STICK MAN",
    price: 0,
    color: "#00e5ff",
    trail: "#00e5ff55",
    glow: "#00e5ff",
    type: "stick",
  },
  {
    id: "boxer",
    name: "BOXER",
    price: 150,
    color: "#ff9900",
    trail: "#ff990055",
    glow: "#ff9900",
    type: "boxer",
  },
  {
    id: "ninja",
    name: "NINJA",
    price: 220,
    color: "#bf5fff",
    trail: "#bf5fff55",
    glow: "#bf5fff",
    type: "ninja",
  },
  {
    id: "ranger",
    name: "RANGER",
    price: 300,
    color: "#39ff14",
    trail: "#39ff1455",
    glow: "#39ff14",
    type: "ranger",
  },
  {
    id: "robot",
    name: "ROBOT",
    price: 500,
    color: "#ffe600",
    trail: "#ffe60055",
    glow: "#ffe600",
    type: "robot",
  },
];

function getActiveSkin() {
  return SKINS.find((s) => s.id === save.activeSkin) || SKINS[0];
}

// ─── ACHIEVEMENTS ─────────────────────────────
const ACHIEVEMENTS = [
  { id: "surv20", name: "SURVIVOR", check: (g) => g.time >= 20 },
  { id: "surv60", name: "ENDURANCE", check: (g) => g.time >= 60 },
  { id: "flip50", name: "FLIPMASTER", check: (g) => g.flipCount >= 50 },
  { id: "coins100", name: "COLLECTOR", check: (g) => save.totalCoins >= 100 },
  { id: "score500", name: "HIGH SCORER", check: (g) => g.score >= 500 },
  { id: "combo5", name: "COMBO KING", check: (g) => g.maxCombo >= 5 },
];

// ─── SOUND ────────────────────────────────────
const AC = typeof AudioContext !== "undefined" ? new AudioContext() : null;
let soundEnabled = false;

document.addEventListener(
  "pointerdown",
  () => {
    if (AC && AC.state === "suspended") {
      AC.resume();
      soundEnabled = true;
    }
    soundEnabled = true;
  },
  { once: true },
);

function playSound(type) {
  if (!AC || !soundEnabled) return;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.connect(g);
  g.connect(AC.destination);
  const t = AC.currentTime;
  if (type === "flip") {
    o.type = "sine";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(820, t + 0.08);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.start(t);
    o.stop(t + 0.15);
  } else if (type === "coin") {
    o.type = "triangle";
    o.frequency.setValueAtTime(880, t);
    o.frequency.setValueAtTime(1200, t + 0.05);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.start(t);
    o.stop(t + 0.2);
  } else if (type === "death") {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.6);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.start(t);
    o.stop(t + 0.7);
  } else if (type === "powerup") {
    o.type = "sine";
    o.frequency.setValueAtTime(440, t);
    o.frequency.setValueAtTime(660, t + 0.1);
    o.frequency.setValueAtTime(880, t + 0.2);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.start(t);
    o.stop(t + 0.35);
  }
}

// ─── PARTICLES ────────────────────────────────
class Particle {
  constructor(x, y, vx, vy, color, life, size) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = this.maxLife = life;
    this.size = size;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 200 * dt;
    this.life -= dt;
  }
  draw() {
    const a = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    const s = this.size * a;
    ctx.beginPath();
    ctx.arc(this.x, this.y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

let particles = [];

function spawnBurst(x, y, color, count = 24) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const speed = 80 + Math.random() * 220;
    particles.push(
      new Particle(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        color,
        0.6 + Math.random() * 0.6,
        2 + Math.random() * 4,
      ),
    );
  }
}

function spawnCoinCollect(x, y) {
  for (let i = 0; i < 10; i++) {
    particles.push(
      new Particle(
        x + (Math.random() - 0.5) * 20,
        y + (Math.random() - 0.5) * 20,
        "#ffe600",
        (Math.random() - 0.5) * 80,
        -120 - Math.random() * 80,
        0.5 + Math.random() * 0.3,
        2 + Math.random() * 2,
      ),
    );
  }
}

// ─── PLAYER TRAIL ─────────────────────────────
let trail = [];

function addTrail(x, y) {
  trail.push({ x, y, life: 1 });
  if (trail.length > 20) trail.shift();
}

function updateTrail(dt) {
  for (let t of trail) t.life -= dt * 3;
  trail = trail.filter((t) => t.life > 0);
}

function drawTrail(skin) {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    const a = t.life * 0.6;
    ctx.globalAlpha = a;
    ctx.fillStyle = skin.trail;
    const s = PLAYER_W * 0.5 * t.life;
    ctx.beginPath();
    ctx.arc(t.x + PLAYER_W / 2, t.y + PLAYER_H / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── OBSTACLES ────────────────────────────────
let obstacles = [];

function spawnObstacle(gameTime, speed) {
  // One side per spawn — never both at the same time
  const onCeiling = Math.random() < 0.5;

  if (gameTime < 40) {
    // Phase 0: spikes only, slow
    spawnSpike(onCeiling, speed);
  } else if (gameTime < 120) {
    // Phase 1: spikes + barriers, moderate speed
    const r = Math.random();
    if (r < 0.65) spawnSpike(onCeiling, speed);
    else spawnBarrier(speed);
  } else {
    // Phase 2: spikes + barriers + lasers, fast
    const r = Math.random();
    if (r < 0.5) spawnSpike(onCeiling, speed);
    else if (r < 0.8) spawnBarrier(speed);
    else spawnLaser(onCeiling, speed);
  }
}

function spawnSpike(onCeiling, speed) {
  const spikeH = 24 + Math.random() * 20;
  const spikeW = 16 + Math.random() * 24;
  const x = W + SPAWN_DISTANCE;
  const y = onCeiling ? CEIL_THICK : H - FLOOR_THICK - spikeH;
  obstacles.push({
    type: "spike",
    x,
    y,
    w: spikeW,
    h: spikeH,
    onCeiling,
    speed,
  });
}

function spawnBarrier(speed) {
  const gapH = 90 + Math.random() * 60;
  const barrierW = 18;
  const playH = H - FLOOR_THICK - CEIL_THICK;
  const gapStart = CEIL_THICK + Math.random() * (playH - gapH);
  const x = W + SPAWN_DISTANCE;
  obstacles.push({
    type: "barrier_seg",
    x,
    y: CEIL_THICK,
    w: barrierW,
    h: gapStart - CEIL_THICK,
    speed,
  });
  obstacles.push({
    type: "barrier_seg",
    x,
    y: gapStart + gapH,
    w: barrierW,
    h: H - FLOOR_THICK - (gapStart + gapH),
    speed,
  });
}

function spawnLaser(onCeiling, speed) {
  const x = W + 40;
  const h = 8;
  const y = onCeiling ? CEIL_THICK : H - FLOOR_THICK - h;
  obstacles.push({
    type: "laser",
    x,
    y,
    w: 3,
    h,
    speed,
    active: true,
    timer: 0,
    period: 1.0,
    onCeiling,
  });
}

// ─── COINS ────────────────────────────────────
let coins = [];

function spawnCoin(speed) {
  // Coins sit on floor or ceiling
  const onFloor = Math.random() < 0.5;
  const y = onFloor ? H - FLOOR_THICK - 9 : CEIL_THICK + 9;
  coins.push({ x: W + SPAWN_COIN_DISTANCE, y, r: 11.5, speed, collected: false, animT: 0 });
}

// ─── -UPS ────────────────────────────────
let powerups = [];
const POWERUP_TYPES = ["shield", "slow", "double", "magnetic"];

function spawnPowerup(speed) {
  const playH = H - FLOOR_THICK - CEIL_THICK;
  const y = CEIL_THICK + 30 + Math.random() * (playH - 60);
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  powerups.push({
    x: W + SPAWN_POWERUP_DISTANCE,
    y,
    r: 15.5,
    speed,
    type,
    collected: false,
    animT: 0,
  });
}

// ─── GAME STATE ───────────────────────────────
let player,
  gameTime,
  score,
  sessionCoins,
  gameSpeed,
  flipCount,
  combo,
  maxCombo;
let shakeTimer = 0,
  shakeIntensity = 0;
let obstacleTimer = 0,
  coinTimer = 0,
  powerupTimer = 0;
let activePowerups = {};
let bgStars = [];
let lastTimestamp = null;
let slowMoFactor = 1;
let bgOffset = 0;

function initGame() {
  player = {
    x: PLAYER_X,
    y: H * 0.5 - PLAYER_H / 2,
    vy: 0,
    gravDir: 1,
    onGround: false,
    dead: false,
    shieldActive: false,
    invincible: false,
    flipCooldown: 0,
  };
  gameTime = 0;
  score = 0;
  sessionCoins = 0;
  gameSpeed = BASE_SPEED;
  flipCount = 0;
  combo = 0;
  maxCombo = 0;
  obstacleTimer = 0;
  coinTimer = 0;
  powerupTimer = 0;
  obstacles = [];
  coins = [];
  powerups = [];
  particles = [];
  trail = [];
  activePowerups = {};
  slowMoFactor = 1;
  shakeTimer = 0;
  lastTimestamp = null;
  save._milestones = [];
  updateHUD();
}

// ─── DIFFICULTY HELPERS ───────────────────────
function getObstacleInterval(t) {
  if (isMobile) {
    if (t < 40) return 2.5;
    if (t < 120) return 2.0;
    return 1.3;
  } else {
    if (t < 40) return 2.0;
    if (t < 120) return 1.5;
    return 1.0;
  }
}

function getCoinInterval() {
  return 1.5;
}

// ─── BACKGROUND ───────────────────────────────
function generateStars(count = 200) {
  bgStars = [];
  for (let i = 0; i < count; i++) {
    bgStars.push({
      x: Math.random() * 2000,
      y: Math.random(),
      size: Math.random() * 1.5 + 0.2,
      speed: 0.1 + Math.random() * 0.4,
      bright: Math.random(),
    });
  }
}
generateStars();

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#020210");
  grad.addColorStop(0.5, "#05050f");
  grad.addColorStop(1, "#020210");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  for (const s of bgStars) {
    const x = (((s.x - bgOffset * s.speed * 60) % W) + W) % W;
    const y = s.y * H;
    const flicker =
      0.5 + 0.5 * Math.sin(performance.now() * 0.001 + s.bright * 10);
    ctx.globalAlpha = (0.3 + 0.5 * s.bright) * flicker;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawIdleBackground() {
  drawBackground();
}

// ─── FLOOR & CEILING ──────────────────────────
function drawFloorCeiling() {
  // Floor
  const fg = ctx.createLinearGradient(0, H - FLOOR_THICK, 0, H);
  fg.addColorStop(0, "#0055aa");
  fg.addColorStop(1, "#001133");
  ctx.fillStyle = fg;
  ctx.fillRect(0, H - FLOOR_THICK, W, FLOOR_THICK);
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H - FLOOR_THICK);
  ctx.lineTo(W, H - FLOOR_THICK);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Ceiling
  const cg = ctx.createLinearGradient(0, 0, 0, CEIL_THICK);
  cg.addColorStop(0, "#001133");
  cg.addColorStop(1, "#0055aa");
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, W, CEIL_THICK);
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, CEIL_THICK);
  ctx.lineTo(W, CEIL_THICK);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ─── STICK MAN BASE (shared by drawPlayer) ────
function drawStickBase(c, legSwing, armSwing, color) {
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 2.2;
  c.lineCap = "round";
  c.lineJoin = "round";
  // Head
  c.beginPath();
  c.arc(0, -16, 6, 0, Math.PI * 2);
  c.stroke();
  // Torso
  c.beginPath();
  c.moveTo(0, -10);
  c.lineTo(0, 5);
  c.stroke();
  // Arms
  c.beginPath();
  c.moveTo(0, -7);
  c.lineTo(-10, -7 + armSwing);
  c.moveTo(0, -7);
  c.lineTo(10, -7 - armSwing);
  c.stroke();
  // Legs
  c.beginPath();
  c.moveTo(0, 5);
  c.lineTo(-7, 12 + legSwing);
  c.lineTo(-8, 20 + legSwing);
  c.moveTo(0, 5);
  c.lineTo(7, 12 - legSwing);
  c.lineTo(8, 20 - legSwing);
  c.stroke();
}

// ─── PLAYER DRAW ──────────────────────────────
function drawPlayer(skin) {
  const cx = player.x + PLAYER_W / 2;
  const cy = player.y + PLAYER_H / 2;
  const flip = player.gravDir === -1 ? -1 : 1;
  const t = performance.now() * 0.006;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, flip);
  ctx.shadowColor = skin.glow;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = skin.color;
  ctx.fillStyle = skin.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const legSwing = Math.sin(t * 4) * 8;
  const armSwing = Math.sin(t * 4) * 7;

  if (skin.type === "stick") {
    drawStickBase(ctx, legSwing, armSwing, skin.color);
  } else if (skin.type === "boxer") {
    drawStickBase(ctx, legSwing, armSwing, skin.color);
    ctx.shadowBlur = 14;
    ctx.fillStyle = skin.color;
    ctx.beginPath();
    ctx.arc(11, -7 + armSwing * 0.8, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-11, -7 - armSwing * 0.8, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-5, 4);
    ctx.lineTo(5, 4);
    ctx.stroke();
  } else if (skin.type === "ninja") {
    drawStickBase(ctx, legSwing, armSwing, skin.color);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-7, -21);
    ctx.lineTo(7, -21);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, -21);
    ctx.lineTo(9, -16);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, -13);
    ctx.lineTo(5, -13);
    ctx.stroke();
    ctx.save();
    ctx.translate(11, -7 + armSwing * 0.7);
    ctx.rotate(t * 5);
    ctx.lineWidth = 1.8;
    ctx.shadowBlur = 10;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate((Math.PI / 4) * i);
      ctx.beginPath();
      ctx.moveTo(-5, 0);
      ctx.lineTo(5, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  } else if (skin.type === "ranger") {
    drawStickBase(ctx, legSwing, armSwing, skin.color);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, -21);
    ctx.lineTo(10, -21);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, -21);
    ctx.lineTo(-4, -28);
    ctx.lineTo(4, -28);
    ctx.lineTo(6, -21);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-3, -9);
    ctx.lineTo(-11, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, -9);
    ctx.lineTo(11, 0);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, -6);
    ctx.lineTo(17, -6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, -6);
    ctx.lineTo(6, -2);
    ctx.stroke();
  } else if (skin.type === "robot") {
    ctx.lineWidth = 2;
    ctx.strokeRect(-7, -28, 14, 12);
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(0, -33);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -34, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-5, -26, 10, 4);
    ctx.shadowBlur = 14;
    ctx.fillStyle = skin.color;
    ctx.strokeRect(-8, -15, 16, 15);
    ctx.beginPath();
    ctx.arc(0, -7, 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8, -12);
    ctx.lineTo(-15, -12 + armSwing * 0.5);
    ctx.moveTo(8, -12);
    ctx.lineTo(15, -12 - armSwing * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-3, 7 + legSwing * 0.5);
    ctx.lineTo(-7, 15 + legSwing);
    ctx.moveTo(3, 0);
    ctx.lineTo(3, 7 - legSwing * 0.5);
    ctx.lineTo(7, 15 - legSwing);
    ctx.stroke();
  }

  ctx.restore();

  // Shield ring (outside the flipped transform)
  if (player.shieldActive) {
    ctx.save();
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 20;
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(performance.now() * 0.006);
    ctx.beginPath();
    ctx.arc(cx, cy, PLAYER_W * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── OBSTACLE DRAW ────────────────────────────
function drawObstacle(o) {
  const t = performance.now() * 0.003;
  ctx.save();

  if (o.type === "spike") {
    ctx.shadowColor = "#ff3a3a";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#ff3a3a";
    if (o.onCeiling) {
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + o.w, o.y);
      ctx.lineTo(o.x + o.w / 2, o.y + o.h);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.moveTo(o.x, o.y + o.h);
      ctx.lineTo(o.x + o.w, o.y + o.h);
      ctx.lineTo(o.x + o.w / 2, o.y);
      ctx.closePath();
    }
    ctx.fill();
  } else if (o.type === "barrier_seg") {
    const grad = ctx.createLinearGradient(o.x, 0, o.x + o.w, 0);
    grad.addColorStop(0, "#ff6600");
    grad.addColorStop(1, "#ff2200");
    ctx.fillStyle = grad;
    ctx.shadowColor = "#ff4400";
    ctx.shadowBlur = 10;
    ctx.fillRect(o.x, o.y, o.w, o.h);
  } else if (o.type === "laser") {
    const laserActive = Math.sin(t * 3) > 0;
    if (laserActive) {
      const laserLen = W * 0.3;
      const gy = o.y + o.h / 8;
      ctx.shadowColor = "#ff0060";
      ctx.shadowBlur = 20;
      const lg = ctx.createLinearGradient(o.x, 0, o.x + laserLen, 0);
      lg.addColorStop(0, "#ff0060");
      lg.addColorStop(0.5, "#ff80b0");
      lg.addColorStop(1, "transparent");
      ctx.fillStyle = lg;
      ctx.fillRect(o.x, gy - 3, laserLen, 6);
      o._active = true;
    } else {
      ctx.shadowColor = "#ff006044";
      ctx.shadowBlur = 4;
      ctx.fillStyle = "#ff006033";
      ctx.fillRect(o.x, o.y, 6, o.h);
      o._active = false;
    }
  }

  ctx.restore();
}

// ─── COIN DRAW ────────────────────────────────
function drawCoin(c) {
  c.animT += 0.05;
  ctx.save();
  ctx.shadowColor = "#ffe600";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ffe600";
  const wobble = Math.cos(c.animT * 3) * 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y + wobble, c.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff8";
  ctx.beginPath();
  ctx.arc(c.x - 3, c.y + wobble - 3, c.r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── POWER-UP DRAW ────────────────────────────
const POWERUP_COLORS = {
  shield: "#00e5ff",
  slow: "#bf5fff",
  double: "#ffe600",
  magnetic: "#ff4444"
};
const POWERUP_ICONS = { shield: "🛡", slow: "⏱", double: "×2", magnetic: "🧲"};

function drawPowerup(p) {
  p.animT += 0.04;
  const col = POWERUP_COLORS[p.type] || "#fff";
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 16;
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y + Math.sin(p.animT * 2) * 3, p.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `${p.r}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    POWERUP_ICONS[p.type] || "?",
    p.x,
    p.y + Math.sin(p.animT * 2) * 3,
  );
  ctx.restore();
}

// ─── COLLISION ────────────────────────────────
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX,
    dy = cy - nearY;
  return dx * dx + dy * dy < cr * cr;
}

function checkCollisions() {
  if (player.invincible) return false;
  const px = player.x + 3,
    py = player.y + 3;
  const pw = PLAYER_W - 6,
    ph = PLAYER_H - 6;

  for (const o of obstacles) {
    if (o.type === "laser") {
      if (!o._active) continue;
      const laserLen = W * 0.4;
      if (rectOverlap(px, py, pw, ph, o.x, o.y + o.h / 2 - 3, laserLen, 6))
        return true;
    } else {
      if (rectOverlap(px, py, pw, ph, o.x, o.y, o.w, o.h)) return true;
    }
  }
  return false;
}

// ─── FLIP GRAVITY ─────────────────────────────
function flipGravity() {
  if (player.dead) return;
  if (player.flipCooldown > 0) return;
  player.gravDir *= -1;
  player.vy = FLIP_IMPULSE * player.gravDir;
  player.flipCooldown = 0.1;
  flipCount++;
  playSound("flip");

  combo++;
  if (combo > maxCombo) maxCombo = combo;
  if (combo >= 3) showCombo(combo);

  if (combo >= 2) {
    const bonus = combo * 5;
    score += bonus;
    spawnFloatText(`+${bonus}`, player.x + PLAYER_W, player.y, "#ffe600");
  }

  checkAchievements();
}

// ─── UPDATE ───────────────────────────────────
function update(dt) {
  if (state !== STATE.PLAYING) return;

  const slowDt = dt * slowMoFactor;
  bgOffset += slowDt;

  gameTime += slowDt;
  score = Math.floor(gameTime * 8 + flipCount * 2);

  // Speed ramp — 3 phases matching obstacle phases
  if (gameTime < 40) gameSpeed = BASE_SPEED + gameTime * 1.5;
  else if (gameTime < 120) gameSpeed = BASE_SPEED + 60 + (gameTime - 40) * 2;
  else gameSpeed = BASE_SPEED + 220 + (gameTime - 120) * 3;

  // Active powerup timers
  if (activePowerups.shield) {
    activePowerups.shield -= dt;
    if (activePowerups.shield <= 0) {
      delete activePowerups.shield;
      player.shieldActive = false;
    }
  }
  if (activePowerups.slow) {
    activePowerups.slow -= dt;
    if (activePowerups.slow <= 0) {
      delete activePowerups.slow;
      slowMoFactor = 1;
    }
  }
  if (activePowerups.double) {
    activePowerups.double -= dt;
    if (activePowerups.double <= 0) {
      delete activePowerups.double;
    }
  }
  if (activePowerups.magnetic) {
    activePowerups.magnetic -= dt;
    if (activePowerups.magnetic <= 0) {
      delete activePowerups.magnetic;
    }
  }

  // Player physics
  if (player.flipCooldown > 0) player.flipCooldown -= dt;
  player.vy += GRAVITY_ACC * player.gravDir * slowDt;
  player.vy = Math.max(-900, Math.min(900, player.vy));
  player.y += player.vy * slowDt;

  const floorY = H - FLOOR_THICK - PLAYER_H;
  const ceilY = CEIL_THICK;

  if (player.y >= floorY) {
    player.y = floorY;
    player.vy = 0;
    player.onGround = true;
    combo = 0;
  } else if (player.y <= ceilY) {
    player.y = ceilY;
    player.vy = 0;
    player.onGround = true;
    combo = 0;
  } else {
    player.onGround = false;
  }

  addTrail(player.x, player.y);
  updateTrail(dt);

  // Spawn obstacles
  obstacleTimer -= dt;
  if (obstacleTimer <= 0) {
    obstacleTimer = getObstacleInterval(gameTime) * (1 / slowMoFactor);
    spawnObstacle(gameTime, gameSpeed);
  }

  // Spawn coins
  coinTimer -= dt;
  if (coinTimer <= 0) {
    coinTimer = getCoinInterval();
    spawnCoin(gameSpeed);
  }

  // Spawn powerups
  powerupTimer -= dt;
  if (powerupTimer <= 0) {
    powerupTimer = 12 + Math.random() * 8;
    spawnPowerup(gameSpeed);
  }

  // Move & cull obstacles
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.x -= o.speed * slowDt;
    if (o.x + (o.w || 200) < -50) obstacles.splice(i, 1);
  }

  // Move & collect coins
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.x -= c.speed * slowDt;

    // Magnetic attraction when powerup active (full 2D radius)
    if (activePowerups.magnetic) {
      const magnetRadius = 400;
      const px = player.x + PLAYER_W / 2;
      const py = player.y + PLAYER_H / 2;
      const dx = px - c.x;
      const dy = py - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0 && dist < magnetRadius) {
        // stronger pull when closer
        const pullPower = (1 - dist / magnetRadius);
        const strength = 3.7 * pullPower + 0.15;

        const moveX = dx * strength * slowDt;
        const moveY = dy * strength * slowDt;

        const nextDx = dx - moveX;
        const nextDy = dy - moveY;
        const nextDist = Math.sqrt(nextDx * nextDx + nextDy * nextDy);

        const minDistance = Math.max(PLAYER_W, PLAYER_H) / 2 + c.r;

        if (nextDist <= minDistance) {
          // stick at edge but not inside player
          c.x = px - (dx / dist) * minDistance;
          c.y = py - (dy / dist) * minDistance;
        } else {
          c.x += moveX;
          c.y += moveY;
        }
      }
    }

    if (c.x < -30 || c.y < -30 || c.y > H + 30) {
      coins.splice(i, 1);
      continue;
    }
    if (
      !c.collected &&
      circleRect(c.x, c.y, c.r, player.x, player.y, PLAYER_W, PLAYER_H)
    ) {
      c.collected = true;
      sessionCoins += activePowerups.double ? 2 : 1;
      spawnCoinCollect(c.x, c.y);
      playSound("coin");
      spawnFloatText(
        activePowerups.double ? "+2" : "+1",
        c.x,
        c.y - 10,
        "#ffe600",
      );
      coins.splice(i, 1);
    }
  }

  // Move & collect powerups
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.x -= p.speed * slowDt;
    if (p.x < -30) {
      powerups.splice(i, 1);
      continue;
    }
    if (
      !p.collected &&
      circleRect(p.x, p.y, p.r, player.x, player.y, PLAYER_W, PLAYER_H)
    ) {
      p.collected = true;
      activatePowerup(p.type);
      spawnBurst(p.x, p.y, POWERUP_COLORS[p.type], 16);
      playSound("powerup");
      powerups.splice(i, 1);
    }
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(dt);
    if (particles[i].life <= 0) particles.splice(i, 1);
  }

  // Screen shake decay
  if (shakeTimer > 0) shakeTimer -= dt;

  // Collision
  if (checkCollisions()) {
    if (player.shieldActive) {
      player.shieldHits--;
      if (player.shieldHits <= 0) {
        delete activePowerups.shield;
        player.shieldActive = false;
      }
      triggerShake(1.5, 6);
      spawnBurst(
        player.x + PLAYER_W / 2,
        player.y + PLAYER_H / 2,
        "#00e5ff",
        28,
      );
      spawnFloatText(
        "SHIELD BLOCKED!",
        player.x - 30,
        player.y - 20,
        "#00e5ff",
      );
      // Brief invincibility window so player doesn't instantly die again
      player.invincible = true;
      setTimeout(() => {
        if (player) player.invincible = false;
      }, 900);
    } else {
      die();
    }
  }




  checkAchievements();
  checkMilestones();
  updateHUD();
  updatePowerupDisplay();
}

function activatePowerup(type) {
  if (type === "shield") {
    activePowerups.shield = 8;
    player.shieldActive = true;
  }
  if (type === "slow") {
    activePowerups.slow = 6;
    slowMoFactor = 0.45;
  }
  if (type === "double") {
    activePowerups.double = 15;
  }
  if (type === "magnetic") {
    activePowerups.magnetic = 10;
  }
}

function triggerShake(duration, intensity) {
  shakeTimer = duration;
  shakeIntensity = intensity;
}


function die() {
  if (player.dead) return;
  player.dead = true;
  playSound("death");
  triggerShake(1.1, 12);
  spawnBurst(
    player.x + PLAYER_W / 2,
    player.y + PLAYER_H / 2,
    getActiveSkin().color,
    40,
  );

  setTimeout(() => {
    if (score > save.bestScore) save.bestScore = score;
    save.totalCoins += sessionCoins;
    writeSave();
    showGameOver();
  }, 700);

  state = STATE.GAMEOVER;
}

// ─── DRAW ─────────────────────────────────────
function draw() {
  ctx.save();

  // Screen shake
  if (shakeTimer > 0) {
    const s = shakeIntensity * (shakeTimer / 1.5);
    ctx.translate((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2);
  }

  drawBackground();
  drawFloorCeiling();
  drawTrail(getActiveSkin());

  for (const o of obstacles) drawObstacle(o);
  for (const c of coins) drawCoin(c);
  for (const p of powerups) drawPowerup(p);

  if (!player.dead) drawPlayer(getActiveSkin());

  for (const p of particles) p.draw();

  ctx.restore();
}

// ─── HUD ──────────────────────────────────────
function updateHUD() {
  document.getElementById("hudScore").textContent = Math.floor(score);
  document.getElementById("hudCoins").textContent = sessionCoins;
}

const POWERUP_DURATION = {
  shield: 8,
  slow: 5,
  double: 15,
  magnetic: 10,
};

function updatePowerupDisplay() {
  const el = document.getElementById("powerupDisplay");
  el.innerHTML = "";
  for (const [type, t] of Object.entries(activePowerups)) {
    const maxTime = POWERUP_DURATION[type] || 10;
    const pct = Math.max(0, Math.min(100, (t / maxTime) * 100));

    const div = document.createElement("div");
    div.className = `powerup-icon ${type}`;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${POWERUP_ICONS[type]}`;
    div.appendChild(label);

    const barWrap = document.createElement("div");
    barWrap.className = "powerup-bar-wrap";
    const barFill = document.createElement("div");
    barFill.className = "powerup-bar-fill";
    barFill.style.width = `${pct}%`;
    barFill.style.background = `linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.45))`;

    barWrap.appendChild(barFill);
    div.appendChild(barWrap);
    el.appendChild(div);
  }
}

let comboHideTimer = null;
function showCombo(c) {
  const el = document.getElementById("comboDisplay");
  el.textContent = `COMBO ×${c}`;
  el.classList.add("visible");
  if (comboHideTimer) clearTimeout(comboHideTimer);
  comboHideTimer = setTimeout(() => el.classList.remove("visible"), 1200);
}

// ─── FLOATING TEXT ────────────────────────────
function spawnFloatText(text, x, y, color) {
  const el = document.createElement("div");
  el.className = "float-text";
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  el.style.textShadow = `0 0 10px ${color}`;
  document.getElementById("floatingTexts").appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// ─── ACHIEVEMENTS ─────────────────────────────
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (
      !save.achievements.includes(a.id) &&
      a.check({ time: gameTime, flipCount, score, maxCombo })
    ) {
      save.achievements.push(a.id);
      writeSave();
      showAchievementPopup(a);
    }
  }
}

function showAchievementPopup(a) {
  const container = document.getElementById("achievementPopup");
  const el = document.createElement("div");
  el.className = "achievement-item";
  el.innerHTML = `<div class="achievement-title">🏆 ACHIEVEMENT UNLOCKED</div><div class="achievement-name">${a.name}</div>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 0.5s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 500);
  }, 2800);
}

// ─── GAME LOOP ────────────────────────────────
function gameLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;

  if (state === STATE.PLAYING) {
    update(dt);
    draw();
  } else if (state === STATE.PAUSED || state === STATE.GAMEOVER) {
    draw();
  } else {
    drawIdleBackground();
  }

  requestAnimationFrame(gameLoop);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === STATE.PLAYING) pauseGame();
  if (!document.hidden) lastTimestamp = null;
});

// ─── SCREENS ──────────────────────────────────
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function showStartScreen() {
  state = STATE.START;
  document.getElementById("startBestScore").textContent = save.bestScore;
  showScreen("startScreen");
  document.getElementById("gameHUD").classList.remove("active");
}

function startGame() {
  if (!isLandscape()) {
    setRotateOverlay(true);
    lockLandscape();
    return;
  }

  setRotateOverlay(false);
  initGame();
  state = STATE.PLAYING;
  showScreen("gameHUD");
  document.getElementById("gameHUD").classList.add("active");
  if (typeof CrazyGames !== 'undefined') CrazyGames.SDK.game.gameplayStart();
}

function pauseGame() {
  if (state !== STATE.PLAYING) return;
  state = STATE.PAUSED;
  showScreen("pauseScreen");
  if (typeof CrazyGames !== 'undefined') CrazyGames.SDK.game.gameplayStop();
}

function resumeGame() {
  state = STATE.PLAYING;
  showScreen("gameHUD");
  lastTimestamp = null;
  if (typeof CrazyGames !== 'undefined') CrazyGames.SDK.game.gameplayStart();
}

function showGameOver() {
  document.getElementById("finalScore").textContent = Math.floor(score);
  document.getElementById("finalBest").textContent = save.bestScore;
  document.getElementById("finalCoins").textContent = sessionCoins;
  document.getElementById("finalFlips").textContent = flipCount;
  const badge = document.getElementById("newBestBadge");
  badge.style.display = score > 0 && score >= save.bestScore ? "block" : "none";
  state = STATE.GAMEOVER;
  showScreen("gameOverScreen");
  document.getElementById("gameHUD").classList.remove("active");

  if (typeof CrazyGames !== 'undefined') {
    CrazyGames.SDK.game.gameplayStop();
    CrazyGames.SDK.ad.requestAd('midgame', {
      adStarted:  () => { soundEnabled = false; },
      adFinished: () => { soundEnabled = true;  },
      adError:    () => { soundEnabled = true;  }
    });
  }
}

function showShopScreen() {
  state = STATE.SHOP;
  document.getElementById("shopCoinCount").textContent = save.totalCoins;
  buildSkinGrid();
  showScreen("shopScreen");
  document.getElementById("gameHUD").classList.remove("active");
}

// ─── SHOP ─────────────────────────────────────
function buildSkinGrid() {
  const grid = document.getElementById("skinGrid");
  grid.innerHTML = "";
  for (const skin of SKINS) {
    const unlocked = save.unlockedSkins.includes(skin.id);
    const isActive = save.activeSkin === skin.id;
    const card = document.createElement("div");
    card.className = `skin-card${isActive ? " selected" : ""}${!unlocked ? " locked" : ""}`;

    const pv = document.createElement("canvas");
    pv.className = "skin-preview";
    pv.width = 80;
    pv.height = 70;
    drawSkinPreview(pv, skin);
    card.appendChild(pv);

    const name = document.createElement("div");
    name.className = "skin-name";
    name.textContent = skin.name;
    card.appendChild(name);

    if (!unlocked) {
      const price = document.createElement("div");
      price.className = "skin-price";
      price.textContent = `🪙 ${skin.price}`;
      card.appendChild(price);
      const badge = document.createElement("div");
      badge.className = "skin-badge locked-badge";
      badge.textContent = "LOCKED";
      card.appendChild(badge);
      card.addEventListener("click", () => buySkin(skin));
    } else {
      if (isActive) {
        const badge = document.createElement("div");
        badge.className = "skin-badge active-badge";
        badge.textContent = "ACTIVE";
        card.appendChild(badge);
      }
      card.addEventListener("click", () => selectSkin(skin));
    }

    grid.appendChild(card);
  }
}

// Fully standalone — zero dependency on the player object
function drawSkinPreview(cvs, skin) {
  const c = cvs.getContext("2d");
  c.clearRect(0, 0, cvs.width, cvs.height);
  c.fillStyle = "#0a0a1a";
  c.fillRect(0, 0, cvs.width, cvs.height);

  // Floor line
  c.strokeStyle = "#1a3a5a";
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(8, cvs.height - 8);
  c.lineTo(cvs.width - 8, cvs.height - 8);
  c.stroke();

  c.save();
  // Translate so feet land on the floor line
  c.translate(cvs.width / 2, cvs.height - 8 - 22);
  c.shadowColor = skin.glow;
  c.shadowBlur = 10;
  c.strokeStyle = skin.color;
  c.fillStyle = skin.color;
  c.lineCap = "round";
  c.lineJoin = "round";

  const legSwing = 5;
  const armSwing = 6;

  function base() {
    c.lineWidth = 2.2;
    c.beginPath();
    c.arc(0, -16, 6, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(0, 5);
    c.stroke();
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(-10, -7 + armSwing);
    c.moveTo(0, -7);
    c.lineTo(10, -7 - armSwing);
    c.stroke();
    c.beginPath();
    c.moveTo(0, 5);
    c.lineTo(-7, 12 + legSwing);
    c.lineTo(-8, 20 + legSwing);
    c.moveTo(0, 5);
    c.lineTo(7, 12 - legSwing);
    c.lineTo(8, 20 - legSwing);
    c.stroke();
  }

  if (skin.type === "stick") {
    base();
  } else if (skin.type === "boxer") {
    base();
    c.beginPath();
    c.arc(11, -7 + armSwing * 0.8, 5.5, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(-11, -7 - armSwing * 0.8, 4.5, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(-5, 4);
    c.lineTo(5, 4);
    c.stroke();
  } else if (skin.type === "ninja") {
    base();
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(-7, -21);
    c.lineTo(7, -21);
    c.stroke();
    c.beginPath();
    c.moveTo(5, -21);
    c.lineTo(9, -16);
    c.stroke();
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-5, -13);
    c.lineTo(5, -13);
    c.stroke();
    c.save();
    c.translate(11, -7 + armSwing * 0.7);
    c.rotate(Math.PI / 8);
    c.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      c.save();
      c.rotate((Math.PI / 4) * i);
      c.beginPath();
      c.moveTo(-5, 0);
      c.lineTo(5, 0);
      c.stroke();
      c.restore();
    }
    c.restore();
  } else if (skin.type === "ranger") {
    base();
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-10, -21);
    c.lineTo(10, -21);
    c.stroke();
    c.beginPath();
    c.moveTo(-6, -21);
    c.lineTo(-4, -28);
    c.lineTo(4, -28);
    c.lineTo(6, -21);
    c.stroke();
    c.beginPath();
    c.moveTo(-3, -9);
    c.lineTo(-11, 0);
    c.stroke();
    c.beginPath();
    c.moveTo(3, -9);
    c.lineTo(11, 0);
    c.stroke();
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(6, -6);
    c.lineTo(17, -6);
    c.stroke();
    c.beginPath();
    c.moveTo(6, -6);
    c.lineTo(6, -2);
    c.stroke();
  } else if (skin.type === "robot") {
    c.lineWidth = 2;
    c.strokeRect(-7, -28, 14, 12);
    c.beginPath();
    c.moveTo(0, -28);
    c.lineTo(0, -33);
    c.stroke();
    c.beginPath();
    c.arc(0, -34, 2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#ffffff";
    c.fillRect(-5, -26, 10, 4);
    c.fillStyle = skin.color;
    c.strokeRect(-8, -15, 16, 15);
    c.beginPath();
    c.arc(0, -7, 2, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-8, -12);
    c.lineTo(-15, -12 + armSwing * 0.5);
    c.moveTo(8, -12);
    c.lineTo(15, -12 - armSwing * 0.5);
    c.stroke();
    c.beginPath();
    c.moveTo(-3, 0);
    c.lineTo(-3, 7 + legSwing * 0.5);
    c.lineTo(-7, 15 + legSwing);
    c.moveTo(3, 0);
    c.lineTo(3, 7 - legSwing * 0.5);
    c.lineTo(7, 15 - legSwing);
    c.stroke();
  }

  c.restore();
}

function buySkin(skin) {
  if (save.totalCoins < skin.price) {
    spawnFloatText("NOT ENOUGH COINS", W / 2, H / 2, "#ff2d78");
    return;
  }
  save.totalCoins -= skin.price;
  save.unlockedSkins.push(skin.id);
  selectSkin(skin);
}

function selectSkin(skin) {
  save.activeSkin = skin.id;
  writeSave();
  document.getElementById("shopCoinCount").textContent = save.totalCoins;
  buildSkinGrid();
}

// ─── INPUT ────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    if (state === STATE.PLAYING) flipGravity();
    else if (state === STATE.START) startGame();
    else if (state === STATE.GAMEOVER) {
      initGame();
      startGame();
    } else if (state === STATE.PAUSED) resumeGame();
  }
  if (e.code === "Escape" || e.code === "KeyP") {
    if (state === STATE.PLAYING) pauseGame();
    else if (state === STATE.PAUSED) resumeGame();
  }
});

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (state === STATE.PLAYING) flipGravity();
  else if (state === STATE.START) startGame();
  else if (state === STATE.GAMEOVER) {
    initGame();
    startGame();
  } else if (state === STATE.PAUSED) resumeGame();
});

// Fallback for older mobile browsers on canvas only
document.addEventListener("touchstart", (e) => {
  // Prevent game actions if touching a button or interactive element
  if (e.target.closest('button') || e.target.closest('.btn') || e.target.closest('input') || e.target.closest('select')) {
    return; // Let the button handle it
  }
  e.preventDefault();
  if (state === STATE.PLAYING) flipGravity();
  else if (state === STATE.START) startGame();
  else if (state === STATE.GAMEOVER) {
    initGame();
    startGame();
  } else if (state === STATE.PAUSED) resumeGame();
}, { passive: false });

// Buttons
document.getElementById("playBtn").addEventListener("click", startGame);
document.getElementById("shopBtn").addEventListener("click", showShopScreen);
document.getElementById("pauseBtn").addEventListener("click", pauseGame);
document.getElementById("resumeBtn").addEventListener("click", resumeGame);
document.getElementById("pauseRestartBtn").addEventListener("click", () => {
  initGame();
  startGame();
});
document
  .getElementById("pauseMenuBtn")
  .addEventListener("click", showStartScreen);
document.getElementById("restartBtn").addEventListener("click", () => {
  initGame();
  startGame();
});
document.getElementById("goShopBtn").addEventListener("click", showShopScreen);
document.getElementById("menuBtn").addEventListener("click", showStartScreen);
document
  .getElementById("shopBackBtn")
  .addEventListener("click", showStartScreen);

// ─── BOOT ─────────────────────────────────────
showStartScreen();
requestAnimationFrame(gameLoop);
if (typeof CrazyGames !== 'undefined') CrazyGames.SDK.init();


function checkMilestones() {
  const milestones = [30, 60, 90, 120, 180, 240];
  for (const m of milestones) {
    if (!save._milestones) save._milestones = [];
    if (gameTime >= m && !save._milestones.includes(m)) {
      save._milestones.push(m);
      const msgs = {
        30:  '30s — WARMING UP!',
        60:  '1 MIN — KEEP GOING!',
        90:  '90s — ON FIRE!',
        120: '2 MIN — BEAST MODE!',
        180: '3 MIN — UNSTOPPABLE!',
        240: '4 MIN — LEGENDARY!'
      };
      spawnFloatText(msgs[m], W / 2 - 80, H / 2 - 40, '#ffe600');
    }
  }
}