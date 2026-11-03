import { getVehicleCatalog } from './game.js';

const ROLES = {
  sedan: '均衡入门',
  sports: '高速灵活',
  truck: '重型推车',
  bus: '耐撞平台',
  taxi: '小费专家',
  van: '重装货箱',
  limo: '豪华得分',
  ambulance: '战地急救',
  firetruck: '移动路障',
  police: '高速赏金',
  supercar: '极速冲分',
};

function formatPercent(weight) {
  const value = Math.max(0, Number(weight) || 0) * 100;
  return `${Math.round(value * 10) / 10}%`;
}

export class VehicleCodexUI {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.isOpen = false;
    this.build();
  }

  build() {
    const root = document.createElement('div');
    root.className = 'codex-root';
    root.innerHTML = `
      <button class="codex-open" type="button" aria-haspopup="dialog">车型图鉴</button>
      <div class="codex-modal" aria-hidden="true">
        <div class="codex-backdrop" data-close="1"></div>
        <section class="codex-card" role="dialog" aria-modal="true" aria-labelledby="codex-title">
          <div class="codex-stripe"></div>
          <header class="codex-head">
            <div class="codex-heading">
              <h2 id="codex-title">车型图鉴</h2>
              <p class="codex-sub">所有车辆的外形、数值与特殊能力</p>
            </div>
            <button class="codex-close" type="button" aria-label="关闭">×</button>
          </header>
          <div class="codex-body">
            <section class="codex-section">
              <h3>常规车型 <span class="codex-count codex-count-common"></span></h3>
              <div class="codex-grid codex-grid-common"></div>
            </section>
            <section class="codex-section">
              <h3>稀有车型 <span class="codex-count codex-count-rare"></span></h3>
              <div class="codex-grid codex-grid-rare"></div>
            </section>
          </div>
          <p class="codex-foot">数值为当前配置；出现率按迎面 / 同向车道分别统计，稀有车生成概率明显更低。</p>
        </section>
      </div>
    `;

    document.body.appendChild(root);
    this.root = root;
    this.button = root.querySelector('.codex-open');
    this.modal = root.querySelector('.codex-modal');
    this.closeBtn = root.querySelector('.codex-close');
    this.body = root.querySelector('.codex-body');
    this.commonGrid = root.querySelector('.codex-grid-common');
    this.rareGrid = root.querySelector('.codex-grid-rare');
    this.commonCount = root.querySelector('.codex-count-common');
    this.rareCount = root.querySelector('.codex-count-rare');

    this.button.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    this.modal
      .querySelector('.codex-backdrop')
      .addEventListener('click', () => this.close());
    window.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
  }

  update(game, otherUIOpen = false) {
    this.game = game;
    const canShow =
      (game.mode === 'title' || game.mode === 'gameover') &&
      !otherUIOpen &&
      !this.isOpen;
    this.button.classList.toggle('visible', canShow);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.button.classList.remove('visible');
    this.renderCatalog();
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      this.closeBtn.focus({ preventScroll: true });
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
    this.update(this.game, false);
    this.button.focus({ preventScroll: true });
  }

  renderCatalog() {
    const catalog = getVehicleCatalog();
    const common = catalog.filter((vehicle) => !vehicle.rare);
    const rare = catalog.filter((vehicle) => vehicle.rare);

    this.commonGrid.innerHTML = '';
    this.rareGrid.innerHTML = '';
    for (const vehicle of common) {
      this.commonGrid.appendChild(this.createCard(vehicle));
    }
    for (const vehicle of rare) {
      this.rareGrid.appendChild(this.createCard(vehicle));
    }
    this.commonCount.textContent = `${common.length} 辆`;
    this.rareCount.textContent = `${rare.length} 辆`;
  }

  createCard(vehicle) {
    const card = document.createElement('article');
    card.className = `codex-item${vehicle.rare ? ' rare' : ''}`;
    const lateral = vehicle.lateral;
    const passive = vehicle.passive || '无';
    card.innerHTML = `
      <canvas class="codex-preview" aria-hidden="true"></canvas>
      <div class="codex-item-head">
        <h4>${vehicle.name}</h4>
        <span class="codex-tag ${vehicle.rare ? 'rare' : 'common'}">${
          vehicle.rare ? '稀有' : '常规'
        }</span>
      </div>
      <p class="codex-role">${ROLES[vehicle.type] || ''}</p>
      <div class="codex-stats">
        <div><span>速度</span><b>${vehicle.speed.toFixed(1)}</b></div>
        <div><span>耐久</span><b>${vehicle.durability.toFixed(1)}s</b></div>
        <div><span>得分</span><b>${vehicle.score}/s</b></div>
        <div><span>车宽</span><b>${vehicle.width.toFixed(2)}</b></div>
        <div><span>车长</span><b>${vehicle.length.toFixed(2)}</b></div>
      </div>
      <div class="codex-lateral">
        <span>横移 速度 / 加速 / 减速</span>
        <b>${lateral.speed.toFixed(1)} / ${lateral.accel} / ${lateral.decel}</b>
      </div>
      <div class="codex-spawn">出现率：迎面 ${formatPercent(
        vehicle.oncomingWeight
      )} · 同向 ${formatPercent(vehicle.sameDirWeight)}</div>
      <div class="codex-ability">
        <span>特殊能力</span>
        <p>${passive}</p>
      </div>
    `;
    const canvas = card.querySelector('.codex-preview');
    this.renderer.drawVehiclePreview(canvas, vehicle);
    return card;
  }
}
