import {
  config,
  DEFAULTS,
  TUNABLE_GROUPS,
  saveOverrides,
  clearOverrides,
  setTutorialDone,
  flags,
} from './config.js';

function isWholeStep(step) {
  return step >= 1;
}

function formatValue(value, item) {
  let text;
  if (isWholeStep(item.step)) text = String(Math.round(value));
  else if (item.step >= 0.1) text = Number(value).toFixed(1);
  else text = Number(value).toFixed(2);
  return item.unit ? `${text}${item.unit}` : text;
}

export class DebugUI {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.root = null;
    this.toastEl = null;
    this.toastTimer = null;
    this.build();
    if (flags.debug) this.open();
  }

  build() {
    const root = document.createElement('div');
    root.className = 'debug-panel';
    root.innerHTML = `
      <header class="debug-header">
        <span class="debug-title">调参面板</span>
        <span class="debug-hint">\` 开关</span>
        <button class="debug-close" type="button" title="关闭">×</button>
      </header>
      <div class="debug-actions">
        <button type="button" data-action="restart">重开本局</button>
        <button type="button" data-action="reset">重置数值</button>
        <button type="button" data-action="tutorial">重置教程</button>
        <button type="button" data-action="copy">复制 JSON</button>
      </div>
      <div class="debug-groups"></div>
      <div class="debug-footer">
        改动实时生效并保存在 localStorage。URL 参数优先级最高，例如
        <code>?bulletTimeScale=0.08&assistLevel=2</code>。
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;

    root.querySelector('.debug-close').addEventListener('click', () => {
      this.close();
    });

    root.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'restart') {
          this.game.startRun();
          this.toast('已重开本局，关闭面板后继续');
        } else if (action === 'reset') {
          clearOverrides();
          location.reload();
        } else if (action === 'tutorial') {
          setTutorialDone(false);
          this.game.tutorialDone = false;
          this.toast('教程已重置，下一局生效');
        } else if (action === 'copy') {
          this.copyConfig();
        }
      });
    });

    const groups = root.querySelector('.debug-groups');
    for (const group of TUNABLE_GROUPS) {
      const section = document.createElement('section');
      section.className = 'debug-group';
      const h = document.createElement('h3');
      h.textContent = group.title;
      section.appendChild(h);

      for (const item of group.items) {
        const row = document.createElement('div');
        row.className = 'debug-row';

        const label = document.createElement('label');
        const name = document.createElement('span');
        name.textContent = item.label;
        const value = document.createElement('span');
        value.className = 'debug-value';
        value.textContent = formatValue(config[item.key], item);
        label.appendChild(name);
        label.appendChild(value);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(item.min);
        input.max = String(item.max);
        input.step = String(item.step);
        input.value = String(config[item.key]);
        input.dataset.key = item.key;

        input.addEventListener('input', () => {
          const v = Number(input.value);
          config[item.key] = v;
          value.textContent = formatValue(v, item);
          saveOverrides();
        });

        row.appendChild(label);
        row.appendChild(input);
        section.appendChild(row);
      }
      groups.appendChild(section);
    }

    const toast = document.createElement('div');
    toast.className = 'debug-toast';
    document.body.appendChild(toast);
    this.toastEl = toast;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.classList.add('open');
    this.syncValues();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  syncValues() {
    if (!this.root) return;
    this.root.querySelectorAll('input[data-key]').forEach((input) => {
      const key = input.dataset.key;
      if (key in config) {
        input.value = String(config[key]);
        const valueEl = input.parentElement.querySelector('.debug-value');
        const item = TUNABLE_GROUPS.flatMap((g) => g.items).find(
          (i) => i.key === key
        );
        if (valueEl && item) valueEl.textContent = formatValue(config[key], item);
      }
    });
  }

  copyConfig() {
    const diff = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (config[key] !== DEFAULTS[key]) diff[key] = config[key];
    }
    const text = JSON.stringify(diff, null, 2);
    const done = () => this.toast('配置 JSON 已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        this.fallbackCopy(text, done);
      });
    } else {
      this.fallbackCopy(text, done);
    }
  }

  fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    }
    document.body.removeChild(ta);
    done();
  }

  toast(message) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 1600);
  }
}
