const GAME_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyP',
  'KeyR',
  'KeyM',
  'Escape',
  'Backquote',
]);

function isFormTarget(target) {
  if (!target || !target.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT|BUTTON|OPTION)$/.test(target.tagName);
}

export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = new Set();
    this.physicalDown = new Set();
    this.virtualDown = new Set();
    this.mouseClicked = false;
    this.touchSteer = 0;
    this.touchSteerActive = false;

    window.addEventListener(
      'keydown',
      (event) => {
        if (isFormTarget(event.target)) return;
        if (GAME_KEYS.has(event.code)) event.preventDefault();
        if (event.repeat) return;
        this.physicalDown.add(event.code);
        this.down.add(event.code);
        this.pressed.add(event.code);
      },
      { passive: false }
    );

    window.addEventListener('keyup', (event) => {
      this.physicalDown.delete(event.code);
      if (!this.virtualDown.has(event.code)) {
        this.down.delete(event.code);
      }
    });

    window.addEventListener('blur', () => {
      this.physicalDown.clear();
      this.virtualDown.clear();
      this.down.clear();
    });

    canvas.addEventListener('pointerdown', () => {
      this.mouseClicked = true;
    });
  }

  isDown(code) {
    return this.down.has(code);
  }

  justPressed(code) {
    return this.pressed.has(code);
  }

  // 键盘左右 / 触屏虚拟摇杆共用的模拟横移输入（-1 ~ 1）
  getSteer() {
    if (this.touchSteerActive) return this.touchSteer;
    const left =
      this.down.has('ArrowLeft') || this.down.has('KeyA') ? 1 : 0;
    const right =
      this.down.has('ArrowRight') || this.down.has('KeyD') ? 1 : 0;
    return right - left;
  }

  setTouchSteer(value, active) {
    this.touchSteer = Math.max(-1, Math.min(1, value));
    this.touchSteerActive = active;
  }

  setVirtualDown(code, down) {
    if (down) {
      this.virtualDown.add(code);
      this.down.add(code);
      this.pressed.add(code);
    } else {
      this.virtualDown.delete(code);
      if (!this.physicalDown.has(code)) {
        this.down.delete(code);
      }
    }
  }

  pressVirtual(code) {
    this.virtualDown.add(code);
    this.down.add(code);
    this.pressed.add(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mouseClicked = false;
  }

  clearJustPressed() {
    this.pressed.clear();
  }
}
