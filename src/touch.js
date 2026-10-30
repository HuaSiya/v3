// 手机触控层：左侧横向摇杆 + 右侧四向操作盘 + 暂停按钮。
// 所有按钮只写入 Input 的虚拟状态，游戏逻辑不区分键盘还是触屏。

const PAD_CODES = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];

export class TouchControls {
  constructor(game, input, audio) {
    this.game = game;
    this.input = input;
    this.audio = audio;
    this.enabled = false;
    this.visible = false;
    this.mode = 'buttons';
    this.stickEnabled = false;
    this.stickPointer = null;
    this.stickRect = null;
    this.build();
  }

  build() {
    const root = document.createElement('div');
    root.className = 'touch-ui';
    root.innerHTML = `
      <button class="touch-pause" type="button" aria-label="暂停">Ⅱ</button>
      <div class="touch-stick is-disabled" aria-label="转向摇杆">
        <div class="stick-base"></div>
        <div class="stick-knob"></div>
      </div>
      <div class="touch-pad">
        <button class="pad up" type="button" data-code="ArrowUp">↑</button>
        <button class="pad left" type="button" data-code="ArrowLeft">←</button>
        <button class="pad down" type="button" data-code="ArrowDown">↓</button>
        <button class="pad right" type="button" data-code="ArrowRight">→</button>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.stickEl = root.querySelector('.touch-stick');
    this.knobEl = root.querySelector('.stick-knob');
    this.pauseEl = root.querySelector('.touch-pause');
    this.padButtons = Array.from(root.querySelectorAll('.pad'));

    this.bindStick();
    this.bindPad();
    this.bindPause();
  }

  bindStick() {
    const stick = this.stickEl;
    const knob = this.knobEl;

    const updateFromPointer = (event) => {
      if (!this.stickEnabled) return;
      if (!this.stickRect) {
        this.stickRect = stick.getBoundingClientRect();
      }
      const base = stick.querySelector('.stick-base');
      const baseRect = base.getBoundingClientRect();
      const knobRect = knob.getBoundingClientRect();
      const center = baseRect.left + baseRect.width * 0.5;
      const max = Math.max(
        1,
        (baseRect.width - knobRect.width) * 0.5
      );
      const dx = Math.max(-max, Math.min(max, event.clientX - center));
      const axis = dx / max;
      knob.style.transform = `translate(${dx}px, 0)`;
      stick.classList.add('is-active');
      this.input.setTouchSteer(axis, true);
    };

    const release = (event) => {
      if (this.stickPointer == null) return;
      if (event && event.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stickRect = null;
      stick.classList.remove('is-active');
      knob.style.transform = 'translate(0px, 0)';
      this.input.setTouchSteer(0, false);
    };

    stick.addEventListener('pointerdown', (event) => {
      if (!this.stickEnabled) return;
      event.preventDefault();
      event.stopPropagation();
      this.audio && this.audio.init();
      this.stickPointer = event.pointerId;
      this.stickRect = stick.getBoundingClientRect();
      stick.setPointerCapture(event.pointerId);
      updateFromPointer(event);
    });

    stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      updateFromPointer(event);
    });

    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    stick.addEventListener('lostpointercapture', release);
  }

  bindPad() {
    for (const button of this.padButtons) {
      const code = button.dataset.code;
      let pointerId = null;

      button.addEventListener('pointerdown', (event) => {
        if (button.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        this.audio && this.audio.init();
        pointerId = event.pointerId;
        button.setPointerCapture(event.pointerId);
        button.classList.add('pressed');
        this.input.setVirtualDown(code, true);
      });

      const release = (event) => {
        if (pointerId == null) return;
        if (event && event.pointerId !== pointerId) return;
        pointerId = null;
        button.classList.remove('pressed');
        this.input.setVirtualDown(code, false);
      };

      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    }
  }

  bindPause() {
    const pause = this.pauseEl;
    pause.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.audio && this.audio.init();
      this.input.pressVirtual('KeyP');
    });
    pause.addEventListener('pointerup', () => {
      this.input.setVirtualDown('KeyP', false);
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  setMode(mode) {
    this.mode = mode === 'gesture' ? 'gesture' : 'buttons';
    this.root.classList.toggle('mode-gesture', this.mode === 'gesture');
    this.reset();
  }

  reset() {
    this.stickPointer = null;
    this.stickRect = null;
    this.stickEl.classList.remove('is-active');
    this.stickEl.classList.add('is-disabled');
    this.knobEl.style.transform = 'translate(0px, 0)';
    this.input.setTouchSteer(0, false);
    for (const button of this.padButtons) {
      button.classList.remove('pressed');
      this.input.setVirtualDown(button.dataset.code, false);
    }
  }

  update(game, uiBlocked) {
    const playing =
      this.enabled &&
      game.mode === 'playing' &&
      !game.paused &&
      !uiBlocked &&
      game.state !== 'dead';
    this.visible = playing;
    this.root.classList.toggle('visible', playing);

    if (!playing) {
      if (this.stickPointer != null) this.reset();
      this.input.setTouchSteer(0, false);
      return;
    }

    const driving = game.state === 'driving';
    const roof = game.state === 'roof';

    for (const button of this.padButtons) {
      const code = button.dataset.code;
      let active = false;
      if (driving) active = code === 'ArrowDown';
      else if (roof) active = code !== 'ArrowDown';

      if (!active) {
        button.classList.remove('pressed');
        if (this.input.virtualDown.has(code)) {
          this.input.setVirtualDown(code, false);
        }
      }
      button.disabled = !active;
      button.classList.toggle('is-active', active);
    }

    const canSteer = driving;
    this.stickEnabled = canSteer;
    this.stickEl.classList.toggle('is-disabled', !canSteer);
    if (!canSteer && this.stickPointer != null) {
      this.reset();
    }
  }
}
