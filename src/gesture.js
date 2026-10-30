// 手势操控：
// - 驾驶时横向拖动转向，下滑上车顶；
// - 车顶上滑 / 左滑 / 右滑飞扑。
// 手势和按键模式共用同一套 Input 状态，游戏逻辑不感知操控方式。

import { clamp } from './math.js';

const DRAG_MAX = 64; // 横向拖动多少像素算满舵
const DEADZONE = 4;
const SWIPE = 34; // 触发滑动的最小位移
const DOMINANCE = 1.15; // 主轴必须明显压过另一个轴

export class GestureControls {
  constructor(game, canvas, input, audio) {
    this.game = game;
    this.canvas = canvas;
    this.input = input;
    this.audio = audio;
    this.enabled = false;
    this.active = false;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.triggered = false;
    this.bind();
  }

  bind() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (event) => this.onDown(event));
    canvas.addEventListener('pointermove', (event) => this.onMove(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (event) => this.onUp(event));
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  reset() {
    this.active = false;
    this.pointerId = null;
    this.triggered = false;
    this.input.setTouchSteer(0, false);
  }

  // 手势是“一次性按键”：按下事件给 justPressed，别把方向键留在 down 里。
  press(code) {
    this.input.pressVirtual(code);
    this.input.setVirtualDown(code, false);
  }

  // 每帧同步一次：离开驾驶/车顶、暂停、死亡时立即松开方向。
  sync() {
    const g = this.game;
    if (!this.enabled) return;
    const valid =
      g.mode === 'playing' &&
      !g.paused &&
      (g.state === 'driving' || g.state === 'roof');
    if (!valid && this.active) {
      this.reset();
    }
    if (!valid) {
      this.input.setTouchSteer(0, false);
    }
  }

  onDown(event) {
    if (!this.enabled) return;
    const g = this.game;
    if (
      g.mode !== 'playing' ||
      g.paused ||
      (g.state !== 'driving' && g.state !== 'roof')
    ) {
      return;
    }
    if (this.active) return;
    event.preventDefault();
    this.audio && this.audio.init();
    this.active = true;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.triggered = false;
    this.canvas.setPointerCapture(event.pointerId);
    if (g.state === 'driving') {
      this.input.setTouchSteer(0, true);
    }
  }

  onMove(event) {
    if (!this.active || event.pointerId !== this.pointerId) return;
    if (event.cancelable) event.preventDefault();
    if (this.triggered) return;
    const g = this.game;
    if (g.mode !== 'playing' || g.paused) return;

    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (g.state === 'driving') {
      const steer =
        absX > DEADZONE ? clamp(dx / DRAG_MAX, -1, 1) : 0;
      this.input.setTouchSteer(steer, true);

      if (dy > SWIPE && dy > absX * DOMINANCE) {
        // 下滑：上车顶
        this.triggered = true;
        this.input.setTouchSteer(0, false);
        this.press('ArrowDown');
      }
      return;
    }

    if (g.state === 'roof') {
      this.input.setTouchSteer(0, false);
      if (dy < -SWIPE && absY > absX * DOMINANCE) {
        // 上滑：向前飞扑
        this.triggered = true;
        this.press('ArrowUp');
      } else if (dx < -SWIPE && absX > absY * DOMINANCE) {
        // 左滑
        this.triggered = true;
        this.press('ArrowLeft');
      } else if (dx > SWIPE && absX > absY * DOMINANCE) {
        // 右滑
        this.triggered = true;
        this.press('ArrowRight');
      }
    }
  }

  onUp(event) {
    if (this.pointerId == null) return;
    if (event && event.pointerId !== this.pointerId) return;
    this.reset();
  }
}
