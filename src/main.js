import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { AudioManager } from './audio.js';
import { DebugUI } from './debug.js';
import { TouchControls } from './touch.js';
import { GestureControls } from './gesture.js';
import { LeaderboardUI } from './leaderboard-ui.js';
import { VehicleCodexUI } from './codex-ui.js';
import {
  config,
  flags,
  getControlMode,
  setControlMode,
} from './config.js';
import { clamp } from './math.js';

const canvas = document.getElementById('game');
const audio = new AudioManager();
const game = new Game(audio);
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const debug = new DebugUI(game);
const isTouch =
  flags.touch ||
  (navigator.maxTouchPoints > 0 &&
    window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches);
const touch = new TouchControls(game, input, audio);
touch.setEnabled(isTouch);
const gesture = new GestureControls(game, canvas, input, audio);
const leaderboard = new LeaderboardUI(game);
const codex = new VehicleCodexUI(game, renderer);
let controlMode = getControlMode();
touch.setMode(controlMode);
gesture.setEnabled(isTouch && controlMode === 'gesture');
renderer.muted = audio.muted;
renderer.touchMode = isTouch;
renderer.controlMode = controlMode;

window.__game = game;
window.__config = config;
window.__renderer = renderer;
window.__touch = touch;
window.__gesture = gesture;
window.__leaderboardUI = leaderboard;
window.__codex = codex;

// 操控方式选择器：只在手机的标题页 / 暂停页出现。
const modeUI = document.createElement('div');
modeUI.className = 'control-mode';
modeUI.innerHTML = `
  <span class="cm-label">操控</span>
  <button type="button" data-mode="buttons">按键</button>
  <button type="button" data-mode="gesture">手势</button>
`;
document.body.appendChild(modeUI);

function syncModeUI() {
  modeUI.querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === controlMode);
  });
}

function applyControlMode(mode) {
  controlMode = mode === 'gesture' ? 'gesture' : 'buttons';
  setControlMode(controlMode);
  touch.setMode(controlMode);
  gesture.setEnabled(isTouch && controlMode === 'gesture');
  renderer.controlMode = controlMode;
  syncModeUI();
}

modeUI.querySelectorAll('button').forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    audio.init();
    applyControlMode(button.dataset.mode);
  });
});
syncModeUI();

const layout = {
  W: 1280,
  H: 720,
  dpr: 1,
  u: 1,
  laneW: 70,
  roadLeft: 0,
  playerScreenY: 532,
  topWorld: 7.5,
  bottomWorld: 2.6,
  safe: { top: 0, right: 0, bottom: 0, left: 0 },
};

function readSafeArea() {
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)',
  ].join(';');
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safe = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return safe;
}

function resize() {
  const vv = window.visualViewport;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(320, Math.round(vv ? vv.width : window.innerWidth));
  const H = Math.max(240, Math.round(vv ? vv.height : window.innerHeight));

  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const u = clamp(Math.min(H / 720, W / 1100), 0.62, 1.6);
  const portrait = H > W;
  let laneW;
  if (isTouch && portrait) {
    // 竖屏把路面铺宽，优先保证车辆和车道可读。
    laneW = clamp(W / 8.6, 30, 150);
  } else {
    laneW = clamp(Math.min(W * 0.075, H / 10.2), 30, 150);
  }
  const playerScreenY = H * config.playerScreenY;
  const safe = readSafeArea();

  layout.W = W;
  layout.H = H;
  layout.dpr = dpr;
  layout.u = u;
  layout.laneW = laneW;
  layout.roadLeft = W * 0.5 - 4 * laneW;
  layout.playerScreenY = playerScreenY;
  layout.topWorld = playerScreenY / laneW;
  layout.bottomWorld = (H - playerScreenY) / laneW;
  layout.safe = safe;

  renderer.touchMode = isTouch;
  renderer.compactHud = isTouch || W < 760;
  renderer.safe = safe;

  game.setLayout(layout);
  renderer.setLayout(layout);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => {
  setTimeout(resize, 120);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
}
resize();

const initAudio = () => audio.init();
window.addEventListener('pointerdown', initAudio, { once: true });
window.addEventListener('keydown', initAudio, { once: true });

window.addEventListener('keydown', (event) => {
  if (leaderboard.isOpen || codex.isOpen) return;
  const formTarget =
    event.target &&
    event.target.tagName &&
    /^(INPUT|TEXTAREA|SELECT|BUTTON|OPTION)$/.test(event.target.tagName);

  if (event.code === 'Backquote') {
    event.preventDefault();
    audio.init();
    debug.toggle();
    return;
  }
  if (debug.isOpen && event.code === 'Escape') {
    event.preventDefault();
    debug.close();
    input.clearJustPressed();
    return;
  }
  if (formTarget) return;
  if (event.code === 'KeyM') {
    event.preventDefault();
    audio.init();
    audio.toggleMute();
    renderer.muted = audio.muted;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'playing' && !game.paused) {
    game.paused = true;
    game.pausedAt = game.realTime;
  }
});

window.addEventListener('blur', () => {
  if (game.mode === 'playing' && !game.paused) {
    game.paused = true;
    game.pausedAt = game.realTime;
  }
});

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const uiBlocked = debug.isOpen || leaderboard.isOpen || codex.isOpen;
  game.frame(dt, input, uiBlocked);
  audio.update(game, dt, uiBlocked);
  gesture.sync();
  touch.update(game, uiBlocked);
  leaderboard.update(game, debug.isOpen || codex.isOpen);
  codex.update(game, debug.isOpen || leaderboard.isOpen);
  renderer.gestureSteer = input.getSteer();
  renderer.gestureSteerActive = input.touchSteerActive;
  modeUI.classList.toggle(
    'visible',
    isTouch &&
      !debug.isOpen &&
      !leaderboard.isOpen &&
      !codex.isOpen &&
      (game.mode === 'title' || game.paused)
  );
  renderer.render(game);
  input.endFrame();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
