import { config } from './config.js';
import { clamp, lerp, easeOutBack, hash2 } from './math.js';
import { SCENES, mixTheme, mixColor } from './scenes.js';
import {
  ROAD_MAX,
  CENTER_X,
  LANE_COUNT,
  LANE_SPLIT,
  typePassiveText,
  typePassiveShort,
  typeLateralStats,
} from './game.js';

const FONT =
  '"Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
const MONO = 'Consolas, "Courier New", monospace';

const INK = '#1e2430';
const CREAM = '#fff6e5';
const MUTED = '#6b7280';
const ORANGE = '#ff6a3d';
const GOLD = '#ffd23f';
const RED = '#e63946';
const GREEN = '#43aa8b';

// 每三个行道树位置留一个给路灯，避免灯杆和树冠挤在一起。
const isStreetLampSlot = (ti) => ((ti % 3) + 3) % 3 === 1;

const REASONS = {
  oncoming: {
    title: '迎面撞车',
    quip: '你撞上了迎面而来的车。',
    color: RED,
  },
  dive_miss: {
    title: '飞扑落空',
    quip: '没有车接住你。',
    color: RED,
  },
  roof_crash: {
    title: '车顶被撞飞',
    quip: '站在车顶上时，你的车撞了。',
    color: RED,
  },
  explosion: {
    title: '车辆爆炸',
    quip: '这辆车终于散架了。',
    color: '#f08a24',
  },
};

const formatMultiplier = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '1';
  return String(Math.round(n * 100) / 100);
};

const wrongWayRangeLabel = () => {
  const base = Number(config.wrongWayMultiplier) || 1;
  const max = Math.max(
    base,
    Number(config.wrongWayMultiplier2) || base,
    Number(config.wrongWayMultiplier3) || base
  );
  return max > base
    ? `×${formatMultiplier(base)}→×${formatMultiplier(max)}`
    : `×${formatMultiplier(base)}`;
};

function shade(hex, amount) {
  let r;
  let g;
  let b;
  if (hex.startsWith('#')) {
    const clean = hex.replace('#', '');
    const n = parseInt(clean, 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = hex.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(',').map(Number) : [200, 200, 200];
    r = parts[0];
    g = parts[1];
    b = parts[2];
  }
  r = clamp(Math.round(r + 255 * amount), 0, 255);
  g = clamp(Math.round(g + 255 * amount), 0, 255);
  b = clamp(Math.round(b + 255 * amount), 0, 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layout = {
      W: 1280,
      H: 720,
      dpr: 1,
      u: 1,
      laneW: 70,
      playerScreenY: 530,
      topWorld: 7.5,
      bottomWorld: 2.6,
    };
    this.cam = 0;
    this.roadMin = 0;
    this.roadMax = 8;
    this.theme = SCENES[0];
    this.muted = false;
    this.touchMode = false;
    this.compactHud = false;
    this.controlMode = 'buttons';
    this.gestureSteer = 0;
    this.gestureSteerActive = false;
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.assistResults = { up: null, left: null, right: null };
    this.assistTargets = new Set();
  }

  setLayout(layout) {
    this.layout = layout;
  }

  // ---------------------------------------------------------------- 基础工具

  get u() {
    return this.layout.u;
  }

  // 手机 HUD 使用以 390px 短边为基准的独立缩放，避免被游戏世界的 u 压得太小。
  get mU() {
    return clamp(
      Math.min(this.layout.W, this.layout.H) / 390,
      0.82,
      1.25
    );
  }

  wx(x) {
    return this.layout.W * 0.5 + (x - CENTER_X) * this.layout.laneW;
  }

  wy(y) {
    return (
      this.layout.playerScreenY - (y - this.cam) * this.layout.laneW
    );
  }

  rr(x, y, w, h, r) {
    const ctx = this.ctx;
    const radius = Math.min(
      Math.abs(r),
      Math.abs(w) * 0.5,
      Math.abs(h) * 0.5
    );
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, radius);
      return;
    }
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  text(str, x, y, size, color, opts = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${opts.weight || 700} ${size}px ${opts.mono ? MONO : FONT
      }`;
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.baseline || 'middle';
    if (opts.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = opts.strokeWidth || 4 * this.u;
      ctx.strokeStyle = opts.stroke;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  panel(x, y, w, h, opts = {}) {
    const ctx = this.ctx;
    const u = this.u;
    const r = opts.r ?? 16 * u;
    if (opts.shadow !== false) {
      ctx.fillStyle = 'rgba(18, 26, 34, 0.18)';
      this.rr(x + 4 * u, y + 6 * u, w, h, r);
      ctx.fill();
    }
    ctx.fillStyle = opts.fill || CREAM;
    this.rr(x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = opts.stroke || INK;
    ctx.lineWidth = opts.lineWidth ?? 3 * u;
    ctx.stroke();
  }

  // ---------------------------------------------------------------- 主渲染

  render(game) {
    const { ctx, layout } = this;
    const { W, H } = layout;
    ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const isTitle = game.mode === 'title';
    const cam = isTitle ? game.demoCameraY : game.cameraY;
    this.cam = cam;
    this.roadMin = game.laneMin ?? 0;
    this.roadMax = game.laneMax ?? 8;

    const fromScene = SCENES[game.sceneFrom ?? 0] || SCENES[0];
    const toScene = SCENES[game.sceneTo ?? 0] || SCENES[0];
    const sceneMix = clamp(game.sceneMix ?? 1, 0, 1);
    const sceneT = sceneMix * sceneMix * (3 - 2 * sceneMix);
    this.theme =
      sceneMix >= 1
        ? toScene
        : sceneMix <= 0
          ? fromScene
          : mixTheme(fromScene, toScene, sceneT);

    this.assistResults = { up: null, left: null, right: null };
    this.assistTargets = new Set();

    if (!isTitle && game.state === 'roof' && config.assistLevel > 0) {
      this.assistResults.up = game.predictDive(0, 1);
      this.assistResults.left = game.predictDive(-1, 0);
      this.assistResults.right = game.predictDive(1, 0);
      for (const res of Object.values(this.assistResults)) {
        if (res && res.car) this.assistTargets.add(res.car);
      }
    }

    const shake =
      (game.shake || 0) * 6 * layout.u * config.screenShake;
    const sx = shake ? (Math.random() * 2 - 1) * shake : 0;
    const sy = shake ? (Math.random() * 2 - 1) * shake : 0;

    ctx.save();
    ctx.translate(sx, sy);
    this.drawCity();
    this.drawRoad();
    this.drawTrees();
    this.drawSidewalkGreenery();
    this.drawLamps();
    this.drawCars(game, isTitle);
    if (!isTitle) {
      this.drawAssist(game);
      this.drawDiveTrail(game);
      this.drawCharacter(game);
      this.drawParticleList(game.particles);
      this.drawPopupList(game.popups);
    }
    ctx.restore();

    this.drawAmbient();

    if (!isTitle) {
      this.drawBulletTime(game);
      this.drawWrongWayGlow(game);
      this.drawFlash(game);
      if (game.mode === 'playing') {
        if (this.compactHud) this.drawMobileHud(game);
        else this.drawHud(game);
        this.drawLaneNotice(game);
      }
    }

    if (isTitle) {
      if (this.touchMode) this.drawMobileTitle(game);
      else this.drawTitle(game);
    } else if (game.mode === 'gameover') {
      if (this.touchMode) this.drawMobileGameOver(game);
      else this.drawGameOver(game);
    } else if (game.paused) {
      this.drawPause();
    }

    this.drawFooter(game);
  }

  // ---------------------------------------------------------------- 场景

  drawCity() {
    const { ctx, layout } = this;
    const { W, H, laneW, u } = layout;
    const cam = this.cam;

    ctx.fillStyle = this.theme.ground;
    ctx.fillRect(0, 0, W, H);

    const xMin = CENTER_X - W * 0.5 / laneW - 3;
    const xMax = CENTER_X + W * 0.5 / laneW + 3;
    const yMin = cam - layout.bottomWorld - 2;
    const yMax = cam + layout.topWorld + 2;

    // 人行道：外侧固定，内侧跟着收窄后的路沿移动，收掉的车道会变成宽人行道
    const sw = 0.92;
    for (const side of [-1, 1]) {
      const outer = side < 0 ? -sw : ROAD_MAX + sw;
      const inner = side < 0 ? this.roadMin : this.roadMax;
      const x0 = Math.min(outer, inner);
      const x1 = Math.max(outer, inner);
      const sx = this.wx(x0);
      const swidth = (x1 - x0) * laneW;
      if (swidth <= 0) continue;
      ctx.fillStyle = this.theme.sidewalk;
      ctx.fillRect(sx, 0, swidth, H);
      ctx.strokeStyle = this.theme.sidewalkJoint;
      ctx.lineWidth = 1.5 * u;
      const joint = 1.5;
      let j = Math.floor(yMin / joint) * joint;
      for (; j < yMax; j += joint) {
        const yy = this.wy(j);
        ctx.beginPath();
        ctx.moveTo(sx, yy);
        ctx.lineTo(sx + swidth, yy);
        ctx.stroke();
      }
      ctx.fillStyle = this.theme.sidewalkEdge;
      ctx.fillRect(side < 0 ? sx : sx + swidth - 2 * u, 0, 2 * u, H);
    }

    // 2.5D 斜视街区：楼型、占地和楼间距都带随机，偶尔留出小块绿地
    const rowH = 5.2;
    const slotW = 3.35;
    const cols = 3;
    const rStart = Math.floor(yMin / rowH);
    const rEnd = Math.ceil(yMax / rowH);

    for (let r = rEnd; r >= rStart; r--) {
      for (const side of [-1, 1]) {
        for (let col = 0; col < cols; col++) {
          const seed = r * 13.71 + col * 7.37 + (side > 0 ? 47.3 : 0);
          const h0 = hash2(seed, 1);
          const h1 = hash2(seed, 2);
          const h2 = hash2(seed, 3);
          const h3 = hash2(seed, 4);
          const h4 = hash2(seed, 5);
          const h5 = hash2(seed, 6);
          const h6 = hash2(seed, 7);
          const h7 = hash2(seed, 8);

          const cellX =
            side < 0
              ? -1.15 - (col + 1) * slotW
              : ROAD_MAX + 1.15 + col * slotW;

          const width = slotW - 0.78 - h3 * 0.42;
          const maxInset = slotW - width - 0.28;
          let xL = cellX + 0.18 + h2 * (maxInset - 0.18);
          let xR = xL + width;

          let style = 'block';
          if (h1 < 0.2) style = 'tower';
          else if (h1 < 0.44) style = 'block';
          else if (h1 < 0.63) style = 'glass';
          else if (h1 < 0.82) style = 'shop';
          else style = 'setback';

          if (style === 'tower') {
            const nw = width * 0.74;
            const mid = (xL + xR) * 0.5;
            xL = mid - nw * 0.5;
            xR = mid + nw * 0.5;
          }

          if (xR < xMin || xL > xMax) continue;

          const y0 = r * rowH + 1.0 + h5 * 0.8;
          const y1 = (r + 1) * rowH - 1.1 - h6 * 0.8;
          const pyTop = this.wy(y1);
          const pyBottom = this.wy(y0);
          if (pyBottom - pyTop < 5 * u) continue;

          const px0 = this.wx(xL);
          const px1 = this.wx(xR);

          // 空地：草地 + 灌木，给密集街区留出呼吸感
          if (h0 < 0.2) {
            this.drawLot(px0, px1, pyTop, pyBottom, seed);
            continue;
          }

          const baseColor =
            this.theme.buildings[
            Math.floor(h4 * this.theme.buildings.length)
            ];
          const color = shade(baseColor, (h7 - 0.5) * 0.12);

          if (style === 'tower') {
            this.drawBuildingVolume(
              px0,
              px1,
              pyTop,
              pyBottom,
              (1.6 + h2 * 1.2) * laneW,
              side,
              color,
              'strips',
              seed,
              true
            );
          } else if (style === 'glass') {
            this.drawBuildingVolume(
              px0,
              px1,
              pyTop,
              pyBottom,
              (1.25 + h2 * 0.7) * laneW,
              side,
              color,
              'bands',
              seed,
              true
            );
          } else if (style === 'shop') {
            this.drawBuildingVolume(
              px0,
              px1,
              pyTop,
              pyBottom,
              (0.52 + h2 * 0.3) * laneW,
              side,
              color,
              'shop',
              seed,
              true
            );
          } else if (style === 'setback') {
            const lowerH = (0.55 + h2 * 0.3) * laneW;
            const roof = this.drawBuildingVolume(
              px0,
              px1,
              pyTop,
              pyBottom,
              lowerH,
              side,
              color,
              'block',
              seed,
              true
            );
            if (!roof) continue;
            const uw = roof.w * (0.54 + h3 * 0.16);
            const ux0 = roof.rx0 + (roof.w - uw) * 0.5;
            const uyTop = roof.ry0 + roof.h * 0.1;
            const uyBottom = roof.ry0 + roof.h * 0.86;
            const upperColor = shade(baseColor, 0.06);
            this.drawBuildingVolume(
              ux0,
              ux0 + uw,
              uyTop,
              uyBottom,
              (0.72 + h2 * 0.8) * laneW,
              side,
              upperColor,
              'grid',
              seed + 31.7,
              false
            );
          } else {
            this.drawBuildingVolume(
              px0,
              px1,
              pyTop,
              pyBottom,
              (1.05 + h2 * 0.65) * laneW,
              side,
              color,
              'grid',
              seed,
              true
            );
          }
        }
      }
    }
  }

  drawBuildingVolume(
    px0,
    px1,
    pyTop,
    pyBottom,
    height,
    side,
    color,
    wallStyle,
    seed,
    shadow
  ) {
    const { ctx, layout } = this;
    const { laneW, u } = layout;
    const w = px1 - px0;
    const depth = pyBottom - pyTop;
    if (w <= 0 || depth <= 0 || height <= 0) return null;

    // 正面始终是竖直矩形；屋顶向道路一侧后退，形成真正的箱体透视。
    const dx = -side * height * 0.38;
    const ry1 = pyBottom - height;
    const ry0 = pyTop - height;
    const frontColor = shade(color, -0.16);
    const sideColor = shade(color, -0.28);
    const glassDark = this.theme.windowDark;
    const glassLight = this.theme.windowGlass;
    const litChance = this.theme.litChance;
    const shopAccent =
      this.theme.shopAccents[
      Math.floor(hash2(seed, 41) * this.theme.shopAccents.length)
      ];

    if (shadow) {
      ctx.fillStyle = 'rgba(24, 34, 32, 0.14)';
      this.rr(px0 + 0.12 * laneW, pyTop + 0.18 * laneW, w, depth, 3 * u);
      ctx.fill();
    }

    // 朝路侧墙：平行四边形
    const sideX = side < 0 ? px1 : px0;
    const sidePt = (v, t) => [
      sideX + v * dx,
      lerp(lerp(pyBottom, pyTop, t), lerp(ry1, ry0, t), v),
    ];
    const s00 = sidePt(0, 0);
    const s01 = sidePt(0, 1);
    const s11 = sidePt(1, 1);
    const s10 = sidePt(1, 0);
    ctx.fillStyle = sideColor;
    ctx.beginPath();
    ctx.moveTo(s00[0], s00[1]);
    ctx.lineTo(s01[0], s01[1]);
    ctx.lineTo(s11[0], s11[1]);
    ctx.lineTo(s10[0], s10[1]);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.2)';
    ctx.lineWidth = 1.4 * u;
    ctx.stroke();

    // 侧墙窗户：沿侧墙透视画扁平行四边形
    if (Math.abs(dx) > 3 * u) {
      const sideCols = Math.max(
        2,
        Math.min(4, Math.round(depth / (0.45 * laneW)))
      );
      const sideRows = Math.max(2, Math.round(height / (0.38 * laneW)));
      for (let j = 0; j < sideRows; j++) {
        const v0 = (j + 0.28) / sideRows;
        const v1 = (j + 0.72) / sideRows;
        for (let i = 0; i < sideCols; i++) {
          const t0 = (i + 0.25) / sideCols;
          const t1 = (i + 0.75) / sideCols;
          const p00 = sidePt(v0, t0);
          const p01 = sidePt(v0, t1);
          const p11 = sidePt(v1, t1);
          const p10 = sidePt(v1, t0);
          const lit = hash2(seed + j * 5.3, i + 101) < litChance;
          ctx.fillStyle = lit ? this.theme.windowLit : glassDark;
          ctx.beginPath();
          ctx.moveTo(p00[0], p00[1]);
          ctx.lineTo(p01[0], p01[1]);
          ctx.lineTo(p11[0], p11[1]);
          ctx.lineTo(p10[0], p10[1]);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // 正面立面：竖直矩形，窗户不再被斜切
    ctx.fillStyle = frontColor;
    ctx.fillRect(px0, ry1, w, height);
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.2)';
    ctx.lineWidth = 1.4 * u;
    ctx.strokeRect(px0, ry1, w, height);

    const wallAt = (v) => ({
      y: lerp(pyBottom, ry1, v),
      left: px0,
      right: px1,
    });
    const quad = (a, b, inset) => {
      ctx.beginPath();
      ctx.moveTo(a.left + inset, a.y);
      ctx.lineTo(a.right - inset, a.y);
      ctx.lineTo(b.right - inset, b.y);
      ctx.lineTo(b.left + inset, b.y);
      ctx.closePath();
      ctx.fill();
    };

    if (wallStyle === 'bands') {
      // 玻璃幕墙：横向带窗
      const rows = Math.max(3, Math.round(height / (0.26 * laneW)));
      for (let j = 0; j < rows; j++) {
        const v0 = 0.08 + ((j + 0.12) / rows) * 0.84;
        const v1 = v0 + (0.84 / rows) * 0.5;
        const a = wallAt(v0);
        const b = wallAt(v1);
        const inset = (a.right - a.left) * 0.05;
        const lit = hash2(seed + j * 3.7, 21) < litChance;
        ctx.fillStyle = lit ? this.theme.windowLit : glassDark;
        quad(a, b, inset);
        if (j % 2 === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
          quad(wallAt(v0), wallAt(v0 + 0.008), inset);
        }
      }
    } else if (wallStyle === 'strips') {
      // 高塔：竖向窄窗
      const colsN = Math.max(2, Math.min(3, Math.round(w / (0.5 * laneW))));
      const floors = Math.max(3, Math.round(height / (0.42 * laneW)));
      for (let i = 0; i < colsN; i++) {
        const t0 = (i + 0.28) / colsN;
        const t1 = (i + 0.72) / colsN;
        for (let f = 0; f < floors; f++) {
          const v0 = 0.08 + ((f + 0.15) / floors) * 0.84;
          const v1 = v0 + (0.84 / floors) * 0.62;
          const a = wallAt(v0);
          const b = wallAt(v1);
          const ax0 = lerp(a.left, a.right, t0);
          const ax1 = lerp(a.left, a.right, t1);
          const bx0 = lerp(b.left, b.right, t0);
          const bx1 = lerp(b.left, b.right, t1);
          const lit = hash2(seed * 1.7 + i * 5.1, f + 31) < litChance;
          ctx.fillStyle = lit ? this.theme.windowLit : glassDark;
          ctx.beginPath();
          ctx.moveTo(ax0, a.y);
          ctx.lineTo(ax1, a.y);
          ctx.lineTo(bx1, b.y);
          ctx.lineTo(bx0, b.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (wallStyle === 'shop') {
      // 临街小楼：大玻璃橱窗 + 条纹雨棚
      const a = wallAt(0.06);
      const b = wallAt(0.34);
      ctx.fillStyle = this.theme.storefront;
      quad(a, b, (a.right - a.left) * 0.07);
      ctx.fillStyle = glassLight;
      quad(wallAt(0.3), wallAt(0.36), (a.right - a.left) * 0.07);
      ctx.fillStyle = shopAccent;
      quad(wallAt(0.34), wallAt(0.37), (a.right - a.left) * 0.18);

      const aw0 = wallAt(0.38);
      const aw1 = wallAt(0.5);
      const stripes = 7;
      const awWidth = aw0.right - aw0.left;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 ? '#f7f2e4' : shopAccent;
        ctx.beginPath();
        ctx.moveTo(aw0.left + (awWidth * i) / stripes, aw0.y);
        ctx.lineTo(aw0.left + (awWidth * (i + 1)) / stripes, aw0.y);
        const r1 = lerp(aw1.left, aw1.right, (i + 1) / stripes);
        const l1 = lerp(aw1.left, aw1.right, i / stripes);
        ctx.lineTo(r1, aw1.y);
        ctx.lineTo(l1, aw1.y);
        ctx.closePath();
        ctx.fill();
      }
      const scallopR = Math.max(1.4 * u, (awWidth / stripes) * 0.16);
      for (let i = 0; i < stripes; i++) {
        const sx0 = aw0.left + (awWidth * (i + 0.5)) / stripes;
        ctx.fillStyle = i % 2 ? '#f7f2e4' : shopAccent;
        ctx.beginPath();
        ctx.arc(sx0, aw0.y + 1 * u, scallopR, 0, Math.PI);
        ctx.fill();
      }
    } else {
      // 普通楼：规整方窗
      const colsN = Math.max(2, Math.min(4, Math.round(w / (0.42 * laneW))));
      const rowsN = Math.max(2, Math.round(height / (0.3 * laneW)));
      for (let j = 0; j < rowsN; j++) {
        const v = 0.1 + ((j + 0.5) / rowsN) * 0.8;
        const a = wallAt(v);
        const margin = (a.right - a.left) * 0.07;
        const cellW = (a.right - a.left - margin * 2) / colsN;
        for (let i = 0; i < colsN; i++) {
          const winW = cellW * 0.52;
          const x = a.left + margin + cellW * i + (cellW - winW) * 0.5;
          const lit = hash2(seed + j * 3.1, i + 71) < litChance;
          ctx.fillStyle = lit ? this.theme.windowLit : glassDark;
          this.rr(x, a.y - 0.06 * laneW, winW, 0.1 * laneW, 1.4 * u);
          ctx.fill();
        }
      }
    }

    // 屋顶：向道路一侧后退的平行四边形
    const roofColor = shade(
      mixColor(color, '#8a9096', 0.32),
      this.theme.roofShade * 0.65
    );
    const roofPt = (uu, vv) => ({
      x: lerp(px0, px1, uu) + dx * vv,
      y: lerp(ry1, ry0, vv),
    });
    const roofQuad = (u0, v0, u1, v1) => {
      const a = roofPt(u0, v0);
      const b = roofPt(u1, v0);
      const c = roofPt(u1, v1);
      const d = roofPt(u0, v1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
    };

    ctx.fillStyle = roofColor;
    roofQuad(0, 0, 1, 1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
    ctx.lineWidth = 2 * u;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5 * u;
    roofQuad(0.04, 0.06, 0.96, 0.94);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(30, 36, 48, 0.07)';
    ctx.lineWidth = 1 * u;
    for (let i = 1; i <= 2; i++) {
      const uu = i / 3;
      const a = roofPt(uu, 0.04);
      const b = roofPt(uu, 0.96);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const vv = i / 3;
      const c = roofPt(0.04, vv);
      const d = roofPt(0.96, vv);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    roofQuad(0.04, 0.04, 0.96, 0.09);
    ctx.fill();

    // 屋檐在立面上的短投影
    ctx.fillStyle = 'rgba(20, 28, 34, 0.12)';
    ctx.fillRect(px0, ry1, w, 3 * u);

    const dt = hash2(seed, 61);
    const acW = 0.24 * laneW;
    const acH = 0.18 * laneW;
    const acPt = roofPt(0.3, 0.52);

    if (wallStyle === 'strips') {
      // 高塔天线
      const ap = roofPt(0.5, 0.45);
      const ah = Math.min(height * 0.7, 0.9 * laneW);
      ctx.strokeStyle = 'rgba(42, 50, 58, 0.72)';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(ap.x, ap.y);
      ctx.lineTo(ap.x, ap.y - ah);
      ctx.stroke();
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.arc(ap.x, ap.y - ah, 2.2 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(42, 50, 58, 0.32)';
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.moveTo(ap.x, ap.y - ah * 0.72);
      ctx.lineTo(ap.x - w * 0.14, ap.y);
      ctx.moveTo(ap.x, ap.y - ah * 0.72);
      ctx.lineTo(ap.x + w * 0.14, ap.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(50, 60, 64, 0.34)';
      this.rr(acPt.x - acW * 0.5, acPt.y - acH * 0.5, acW, acH, 2 * u);
      ctx.fill();
    } else if (wallStyle === 'bands') {
      // 玻璃楼天窗 + 设备
      ctx.fillStyle = 'rgba(170, 218, 230, 0.55)';
      roofQuad(0.16, 0.24, 0.5, 0.46);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1 * u;
      ctx.stroke();
      ctx.fillStyle = 'rgba(50, 60, 64, 0.3)';
      const ac2 = roofPt(0.72, 0.56);
      this.rr(ac2.x - acW * 0.5, ac2.y - acH * 0.5, acW, acH, 2 * u);
      ctx.fill();
    } else if (wallStyle === 'shop') {
      // 屋顶招牌
      const sp = roofPt(0.5, 0.28);
      const sw2 = w * 0.6;
      const sh2 = Math.min(0.36 * laneW, Math.max(8 * u, depth * 0.22));
      const sx0 = sp.x - sw2 * 0.5;
      const sy0 = sp.y - sh2;
      ctx.strokeStyle = 'rgba(42, 50, 58, 0.6)';
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.moveTo(sx0 + sw2 * 0.22, sy0 + sh2);
      ctx.lineTo(sx0 + sw2 * 0.22, sp.y + 2 * u);
      ctx.moveTo(sx0 + sw2 * 0.78, sy0 + sh2);
      ctx.lineTo(sx0 + sw2 * 0.78, sp.y + 2 * u);
      ctx.stroke();
      ctx.fillStyle = 'rgba(246, 240, 225, 0.95)';
      this.rr(sx0, sy0, sw2, sh2, 2 * u);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.26)';
      ctx.lineWidth = 1.2 * u;
      ctx.stroke();
      ctx.fillStyle = shopAccent;
      this.rr(sx0 + sw2 * 0.1, sy0 + sh2 * 0.28, sw2 * 0.8, sh2 * 0.34, 1.5 * u);
      ctx.fill();
    } else {
      // 方楼：水箱或空调
      if (dt > 0.5) {
        const tp = roofPt(0.66, 0.36);
        const tw = w * 0.14;
        const th = Math.min(height * 0.35, 0.45 * laneW);
        ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
        ctx.beginPath();
        ctx.ellipse(tp.x + 2 * u, tp.y + 2 * u, tw * 0.6, tw * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b6ab93';
        this.rr(tp.x - tw * 0.5, tp.y - th, tw, th, 2 * u);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(tp.x - tw * 0.34, tp.y - th + 2 * u, tw * 0.16, th - 4 * u);
        ctx.fillStyle = '#e8dfc8';
        ctx.beginPath();
        ctx.ellipse(tp.x, tp.y - th, tw * 0.5, tw * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70, 60, 48, 0.3)';
        ctx.lineWidth = 1 * u;
        ctx.beginPath();
        ctx.moveTo(tp.x - tw * 0.5, tp.y - th * 0.62);
        ctx.lineTo(tp.x + tw * 0.5, tp.y - th * 0.62);
        ctx.moveTo(tp.x - tw * 0.5, tp.y - th * 0.28);
        ctx.lineTo(tp.x + tw * 0.5, tp.y - th * 0.28);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(50, 60, 64, 0.34)';
        this.rr(
          acPt.x - acW * 0.5,
          acPt.y - acH * 0.5,
          acW,
          acH,
          2 * u
        );
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        this.rr(
          acPt.x - acW * 0.34,
          acPt.y - acH * 0.34,
          acW * 0.46,
          acH * 0.42,
          1.5 * u
        );
        ctx.fill();
      }
    }

    const boxX0 = Math.min(px0, px0 + dx);
    const boxX1 = Math.max(px1, px1 + dx);
    return {
      rx0: boxX0,
      rx1: boxX1,
      ry0,
      ry1,
      w: boxX1 - boxX0,
      h: depth,
    };
  }

  drawLot(px0, px1, pyTop, pyBottom, seed) {
    const { ctx, layout } = this;
    const { laneW, u } = layout;
    const w = px1 - px0;
    const hgt = pyBottom - pyTop;
    if (w < 6 * u || hgt < 6 * u) return;

    ctx.fillStyle = this.theme.grass;
    this.rr(px0 + 2 * u, pyTop + 3 * u, w - 4 * u, hgt - 6 * u, 7 * u);
    ctx.fill();

    ctx.fillStyle = this.theme.path;
    this.rr(px0 + w * 0.16, pyTop + hgt * 0.18, w * 0.68, hgt * 0.64, 6 * u);
    ctx.fill();

    const bushes = 2 + Math.floor(hash2(seed, 91) * 2);
    for (let i = 0; i < bushes; i++) {
      const bx = px0 + w * (0.18 + hash2(seed, 100 + i * 3) * 0.64);
      const by = pyTop + hgt * (0.2 + hash2(seed, 101 + i * 3) * 0.6);
      const r = (0.14 + hash2(seed, 102 + i * 3) * 0.1) * laneW;
      ctx.fillStyle = 'rgba(24, 34, 32, 0.14)';
      ctx.beginPath();
      ctx.ellipse(bx + 2 * u, by + 3 * u, r * 1.1, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.theme.tree.dark;
      ctx.beginPath();
      ctx.arc(bx - r * 0.35, by - r * 0.2, r * 0.62, 0, Math.PI * 2);
      ctx.arc(bx + r * 0.34, by - r * 0.12, r * 0.56, 0, Math.PI * 2);
      ctx.arc(bx, by - r * 0.5, r * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.theme.tree.mid;
      ctx.beginPath();
      ctx.arc(bx - r * 0.22, by - r * 0.45, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawTrees() {
    const { ctx, layout } = this;
    const { laneW, u, W, H } = layout;
    const cam = this.cam;
    const yMin = cam - layout.bottomWorld - 2;
    const yMax = cam + layout.topWorld + 2;
    const treeGap = 2.9;
    const tStart = Math.floor(yMin / treeGap);
    const tEnd = Math.ceil(yMax / treeGap);

    for (let ti = tEnd; ti >= tStart; ti--) {
      if (isStreetLampSlot(ti)) continue;
      for (const side of [-1, 1]) {
        const t = hash2(ti, side + 4);
        if (hash2(ti, side + 23) < 0.1) continue;
        const ty = ti * treeGap + (t - 0.5) * 0.45;
        const tx =
          side < 0
            ? this.roadMin - 0.44 - t * 0.1
            : this.roadMax + 0.44 + t * 0.1;
        const px = this.wx(tx);
        const py = this.wy(ty);
        if (px < -80 * u || px > W + 80 * u) continue;
        if (py < -240 * u || py > H + 90 * u) continue;

        const scale = (0.78 + t * 0.42) * laneW;
        const type = Math.floor(hash2(ti * 2.3, side + 31) * 5);

        // 地面影子
        const shadowW =
          type === 1
            ? scale * 0.34
            : type === 2
              ? scale * 0.28
              : type === 3
                ? scale * 0.44
                : scale * 0.4;
        ctx.fillStyle = 'rgba(24, 34, 32, 0.18)';
        ctx.beginPath();
        ctx.ellipse(
          px + 4 * u,
          py + 3 * u,
          shadowW,
          scale * 0.12,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        if (type === 0) this.drawTreeRound(px, py, scale, t, false);
        else if (type === 1) this.drawTreePine(px, py, scale);
        else if (type === 2) this.drawTreeCypress(px, py, scale);
        else if (type === 3) this.drawTreeBush(px, py, scale, t);
        else this.drawTreeRound(px, py, scale, t, true);
      }
    }
  }

  drawTreeRound(px, py, scale, t, fruit) {
    const { ctx, layout } = this;
    const u = layout.u;
    const trunkH = scale * 0.5;
    const canopyR = scale * 0.56;
    const cy = py - trunkH - canopyR * 0.45;

    // 树干
    ctx.fillStyle = this.theme.tree.trunk;
    this.rr(
      px - scale * 0.055,
      py - trunkH,
      scale * 0.11,
      trunkH + scale * 0.05,
      scale * 0.045
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 32, 24, 0.35)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();

    const tint = (c) => shade(c, (t - 0.5) * 0.08);
    const dark = tint(this.theme.tree.dark);
    const mid = tint(this.theme.tree.mid);
    const light = tint(this.theme.tree.light);
    const blobs = [
      [0, 0, 1.0],
      [-0.55, 0.12, 0.72],
      [0.55, 0.1, 0.76],
      [-0.22, -0.42, 0.64],
      [0.3, -0.4, 0.6],
    ];
    ctx.fillStyle = dark;
    for (const [bx, by, br] of blobs) {
      ctx.beginPath();
      ctx.arc(
        px + bx * canopyR,
        cy + by * canopyR + canopyR * 0.09,
        canopyR * br,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.fillStyle = mid;
    for (const [bx, by, br] of blobs) {
      ctx.beginPath();
      ctx.arc(
        px + bx * canopyR,
        cy + by * canopyR,
        canopyR * br * 0.92,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(
      px - canopyR * 0.3,
      cy - canopyR * 0.3,
      canopyR * 0.44,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(
      px - canopyR * 0.36,
      cy - canopyR * 0.36,
      canopyR * 0.2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    if (fruit) {
      const colors = this.theme.tree.fruit;
      for (let i = 0; i < 5; i++) {
        const fx =
          px +
          Math.sin(i * 2.1 + t * 8) * canopyR * 0.55;
        const fy =
          cy +
          Math.cos(i * 1.7 + t * 6) * canopyR * 0.45;
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.arc(fx, fy, Math.max(1.5 * u, canopyR * 0.09), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(
          fx - canopyR * 0.03,
          fy - canopyR * 0.03,
          Math.max(0.8 * u, canopyR * 0.035),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  drawTreePine(px, py, scale) {
    const { ctx } = this;
    const h = scale * 1.5;
    const trunkH = h * 0.3;
    ctx.fillStyle = this.theme.tree.trunk;
    this.rr(
      px - scale * 0.05,
      py - trunkH,
      scale * 0.1,
      trunkH + scale * 0.04,
      scale * 0.04
    );
    ctx.fill();

    const tree = this.theme.tree;
    const layers = [
      { base: py - h * 0.12, w: scale * 0.64, hh: h * 0.5, color: shade(tree.dark, -0.05) },
      { base: py - h * 0.4, w: scale * 0.5, hh: h * 0.42, color: tree.mid },
      { base: py - h * 0.64, w: scale * 0.36, hh: h * 0.36, color: tree.light },
    ];
    for (const layer of layers) {
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(px, layer.base - layer.hh);
      ctx.lineTo(px + layer.w * 0.5, layer.base);
      ctx.quadraticCurveTo(
        px,
        layer.base - layer.hh * 0.14,
        px - layer.w * 0.5,
        layer.base
      );
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.beginPath();
      ctx.moveTo(px, layer.base - layer.hh * 0.94);
      ctx.lineTo(px - layer.w * 0.14, layer.base - layer.hh * 0.08);
      ctx.lineTo(px - layer.w * 0.36, layer.base - layer.hh * 0.05);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawTreeCypress(px, py, scale) {
    const { ctx } = this;
    const h = scale * 1.65;
    const w = scale * 0.42;
    ctx.fillStyle = this.theme.tree.trunk;
    this.rr(
      px - scale * 0.045,
      py - h * 0.18,
      scale * 0.09,
      h * 0.18 + scale * 0.04,
      scale * 0.035
    );
    ctx.fill();

    ctx.fillStyle = this.theme.tree.dark;
    ctx.beginPath();
    ctx.moveTo(px, py - h);
    ctx.quadraticCurveTo(px + w * 0.7, py - h * 0.55, px + w * 0.42, py - h * 0.1);
    ctx.quadraticCurveTo(px, py - h * 0.02, px - w * 0.42, py - h * 0.1);
    ctx.quadraticCurveTo(px - w * 0.7, py - h * 0.55, px, py - h);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = shade(this.theme.tree.light, 0.12);
    ctx.beginPath();
    ctx.moveTo(px - w * 0.06, py - h * 0.92);
    ctx.quadraticCurveTo(
      px + w * 0.3,
      py - h * 0.5,
      px + w * 0.08,
      py - h * 0.12
    );
    ctx.quadraticCurveTo(px - w * 0.12, py - h * 0.4, px - w * 0.06, py - h * 0.92);
    ctx.fill();
    ctx.restore();
  }

  drawTreeBush(px, py, scale, t) {
    const { ctx, layout } = this;
    const u = layout.u;
    const r = scale * 0.3;
    const cy = py - r * 0.7;
    const blobs = [
      [-0.7, 0.1, 0.72],
      [0.62, 0.08, 0.78],
      [-0.12, -0.2, 0.95],
      [0.18, 0.16, 0.66],
    ];
    ctx.fillStyle = this.theme.tree.dark;
    for (const [bx, by, br] of blobs) {
      ctx.beginPath();
      ctx.arc(px + bx * r, cy + by * r + r * 0.1, r * br, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = this.theme.tree.mid;
    for (const [bx, by, br] of blobs) {
      ctx.beginPath();
      ctx.arc(px + bx * r, cy + by * r, r * br * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = this.theme.tree.light;
    ctx.beginPath();
    ctx.arc(px - r * 0.3, cy - r * 0.45, r * 0.38, 0, Math.PI * 2);
    ctx.fill();

    if (t > 0.62) {
      ctx.fillStyle = 'rgba(255, 246, 220, 0.9)';
      for (let i = 0; i < 3; i++) {
        const fx = px + Math.sin(t * 9 + i * 2.2) * r * 0.65;
        const fy = cy + Math.cos(t * 7 + i * 1.8) * r * 0.35;
        ctx.beginPath();
        ctx.arc(fx, fy, Math.max(1 * u, r * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawSidewalkGreenery() {
    const { ctx, layout } = this;
    const { laneW, u, W, H } = layout;
    const cam = this.cam;
    const leftExtra = clamp(
      (this.roadMin + 0.92 - 1.15) / 0.75,
      0,
      1
    );
    const rightExtra = clamp(
      (8.92 - this.roadMax - 1.15) / 0.75,
      0,
      1
    );
    if (leftExtra <= 0.01 && rightExtra <= 0.01) return;

    const yMin = cam - layout.bottomWorld - 2;
    const yMax = cam + layout.topWorld + 2;
    const gap = 4.6;
    const start = Math.floor(yMin / gap);
    const end = Math.ceil(yMax / gap);

    for (let i = end; i >= start; i--) {
      for (const side of [-1, 1]) {
        const extra = side < 0 ? leftExtra : rightExtra;
        if (extra <= 0.01) continue;
        const t = hash2(i, side + 133);
        if (t < 0.18) continue;
        const y = i * gap + (hash2(i, side + 132) - 0.5) * 1.2;
        const x =
          side < 0 ? -0.92 + 0.38 + t * 0.12 : 8.92 - 0.38 - t * 0.12;
        const px = this.wx(x);
        const py = this.wy(y);
        if (px < -60 * u || px > W + 60 * u) continue;
        if (py < -80 * u || py > H + 60 * u) continue;

        const r = laneW * 0.24 * (0.7 + t * 0.4) * extra;
        if (r < 1) continue;

        ctx.save();
        ctx.globalAlpha = 0.9 * extra;
        ctx.fillStyle = 'rgba(20, 28, 34, 0.14)';
        ctx.beginPath();
        ctx.ellipse(px + 2 * u, py + 2 * u, r * 1.15, r * 0.38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.theme.tree.dark;
        ctx.beginPath();
        ctx.arc(px - r * 0.4, py - r * 0.25, r * 0.55, 0, Math.PI * 2);
        ctx.arc(px + r * 0.4, py - r * 0.2, r * 0.5, 0, Math.PI * 2);
        ctx.arc(px, py - r * 0.55, r * 0.58, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.theme.tree.mid;
        ctx.beginPath();
        ctx.arc(px - r * 0.2, py - r * 0.5, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawLamps() {
    const { ctx, layout } = this;
    const { laneW, u, W, H } = layout;
    const cam = this.cam;
    const yMin = cam - layout.bottomWorld - 2;
    const yMax = cam + layout.topWorld + 2;
    const treeGap = 2.9;
    const start = Math.floor(yMin / treeGap) - 1;
    const end = Math.ceil(yMax / treeGap);
    const glow = this.theme.lampGlow;

    ctx.save();
    for (let ti = end; ti >= start; ti--) {
      if (!isStreetLampSlot(ti)) continue;
      for (const side of [-1, 1]) {
        const t = hash2(ti, side + 4);
        if (hash2(ti, side + 93) < 0.08) continue;
        const y = ti * treeGap + (t - 0.5) * 0.45;
        const px0 =
          side < 0
            ? this.wx(this.roadMin - 0.82)
            : this.wx(this.roadMax + 0.82);
        const py = this.wy(y);
        if (px0 < -90 * u || px0 > W + 90 * u) continue;
        if (py < -240 * u || py > H + 90 * u) continue;

        const scale = laneW * (0.82 + t * 0.2);
        const poleH = scale * 1.18;
        const arm = scale * 0.34;
        const dir = side < 0 ? 1 : -1;
        const headX = px0 + dir * arm;

        ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
        ctx.beginPath();
        ctx.ellipse(
          px0 + 3 * u,
          py + 2 * u,
          scale * 0.16,
          scale * 0.06,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        ctx.strokeStyle = this.theme.lampPole;
        ctx.lineWidth = Math.max(1.6 * u, scale * 0.055);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px0, py);
        ctx.lineTo(px0, py - poleH);
        ctx.lineTo(headX, py - poleH);
        ctx.stroke();

        ctx.fillStyle = this.theme.lampColor;
        this.rr(
          headX - scale * 0.075,
          py - poleH - scale * 0.045,
          scale * 0.15,
          scale * 0.09,
          2 * u
        );
        ctx.fill();

        if (glow > 0.02) {
          const lx = headX;
          const ly = py - poleH + scale * 0.02;
          const rad = scale * 0.95;
          const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, rad);
          grad.addColorStop(0, `rgba(255, 216, 140, ${0.42 * glow})`);
          grad.addColorStop(0.45, `rgba(255, 198, 110, ${0.14 * glow})`);
          grad.addColorStop(1, 'rgba(255, 190, 100, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(lx, ly, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  drawAmbient() {
    const { ctx, layout } = this;
    const ambient = this.theme && this.theme.ambient;
    if (!ambient || ambient === 'rgba(0, 0, 0, 0)') return;
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, layout.W, layout.H);
  }

  drawLaneNotice(game) {
    if (!(game.laneNoticeTimer > 0) || game.mode !== 'playing') return;
    const { ctx, layout } = this;
    const m = this.compactHud ? this.mU : layout.u;
    const fade = clamp(game.laneNoticeTimer / 0.45, 0, 1);
    const title = game.laneNoticeText;
    const sub = game.laneNoticeSub;
    const titleSize = 16 * m;
    const subSize = 11 * m;
    const w = Math.max(
      200 * m,
      this.measure(title, titleSize) + 52 * m
    );
    const h = 56 * m;
    const x = layout.W * 0.5 - w * 0.5;
    let y = this.compactHud
      ? (this.safe.top || 0) + 64 * m
      : 100 * layout.u;
    if (game.escapeTimer > 0) y += 52 * m;

    ctx.save();
    ctx.globalAlpha = fade;
    this.panel(x, y, w, h, {
      r: 15 * m,
      fill: '#1e2430',
      lineWidth: 2.5 * m,
    });
    ctx.fillStyle = GOLD;
    this.rr(x + 14 * m, y + 8 * m, w - 28 * m, 3 * m, 1.5 * m);
    ctx.fill();
    this.text(title, layout.W * 0.5, y + 27 * m, titleSize, CREAM, {
      weight: 900,
      align: 'center',
    });
    this.text(sub, layout.W * 0.5, y + 44 * m, subSize, GOLD, {
      weight: 800,
      align: 'center',
    });
    ctx.restore();
  }

  drawRoad() {
    const { ctx, layout } = this;
    const { H, laneW } = layout;
    const cam = this.cam;
    const theme = this.theme;

    const roadL = this.roadMin;
    const roadR = this.roadMax;
    const xL = this.wx(roadL);
    const xR = this.wx(roadR);
    const roadW = Math.max(0, xR - xL);
    if (roadW <= 0) return;
    const midX = this.wx(CENTER_X);

    ctx.fillStyle = theme.road;
    ctx.fillRect(xL, 0, roadW, H);

    // 左（迎面）冷色 / 右（同向）暖色，低透明度，帮助读方向
    ctx.fillStyle = theme.roadCool;
    ctx.fillRect(xL, 0, Math.max(0, midX - xL), H);
    ctx.fillStyle = theme.roadWarm;
    ctx.fillRect(midX, 0, Math.max(0, xR - midX), H);

    const yMin = cam - layout.bottomWorld - 2;
    const yMax = cam + layout.topWorld + 2;

    // 收窄过渡时用裁剪把最外侧车道的标线平滑抹掉
    ctx.save();
    ctx.beginPath();
    ctx.rect(xL, 0, roadW, H);
    ctx.clip();

    // 车道虚线（中央 x=4 是双黄线）
    for (let laneX = 1; laneX < ROAD_MAX; laneX++) {
      if (laneX === CENTER_X) continue;
      // 已经在路缘上的分隔线不再画，避免和白色边线叠成一条粗线
      if (laneX <= roadL + 0.09 || laneX >= roadR - 0.09) continue;
      const px = this.wx(laneX);
      ctx.fillStyle = theme.laneLine;
      const period = 1.6;
      const dash = 0.8;
      let y = Math.floor(yMin / period) * period;
      for (; y < yMax; y += period) {
        const top = this.wy(y + dash);
        const bottom = this.wy(y);
        ctx.fillRect(
          px - 0.035 * laneW,
          top,
          0.07 * laneW,
          bottom - top
        );
      }
    }

    // 中央双黄线
    for (const xOf of [-0.065, 0.065]) {
      const px = this.wx(CENTER_X + xOf);
      ctx.fillStyle = theme.centerLine;
      ctx.fillRect(px - 0.025 * laneW, 0, 0.05 * laneW, H);
    }

    // 路面箭头
    const period = 4.2;
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const dir = lane < LANE_SPLIT ? -1 : 1;
      const color = dir === 1 ? theme.arrowWarm : theme.arrowCool;
      const laneX = lane + 0.5;
      let y = Math.floor(yMin / period) * period + lane * 0.63;
      for (; y < yMax; y += period) {
        this.drawRoadArrow(this.wx(laneX), this.wy(y), dir, color);
      }
    }
    ctx.restore();

    // 路缘白线跟着收窄边界移动
    for (const x of [roadL + 0.055, roadR - 0.055]) {
      const px = this.wx(x);
      ctx.fillStyle = theme.edgeLine;
      ctx.fillRect(px - 0.03 * laneW, 0, 0.06 * laneW, H);
    }
  }

  drawRoadArrow(px, py, dir, color) {
    const { ctx } = this;
    const laneW = this.layout.laneW;
    const w = 0.34 * laneW;
    const h = 0.72 * laneW;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (dir === 1) {
      ctx.moveTo(px, py - h * 0.5);
      ctx.lineTo(px + w * 0.5, py - h * 0.05);
      ctx.lineTo(px, py - h * 0.18);
      ctx.lineTo(px - w * 0.5, py - h * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(px - w * 0.16, py - h * 0.2, w * 0.32, h * 0.55);
    } else {
      ctx.moveTo(px, py + h * 0.5);
      ctx.lineTo(px + w * 0.5, py + h * 0.05);
      ctx.lineTo(px, py + h * 0.18);
      ctx.lineTo(px - w * 0.5, py + h * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(px - w * 0.16, py - h * 0.35, w * 0.32, h * 0.55);
    }
  }

  // ---------------------------------------------------------------- 车辆

  drawCars(game, isTitle) {
    const cars = isTitle ? game.demoCars : game.cars;
    const sorted = [...cars].sort((a, b) => a.y - b.y);
    for (const car of sorted) {
      if (!isTitle && car.isPlayer) continue;
      this.drawCar(car, game, isTitle);
    }
    if (!isTitle && game.playerCar && game.playerCar.isPlayer) {
      this.drawCar(game.playerCar, game, false);
    }
  }

  drawCar(car, game, isTitle) {
    const { ctx, layout } = this;
    const u = layout.u;
    const laneW = layout.laneW;
    const px = this.wx(car.x);
    const py = this.wy(car.y);
    if (py < -2.4 * laneW || py > layout.H + 2.4 * laneW) return;

    const w = car.w * laneW;
    const l = car.l * laneW;
    const alpha = car.ghost ? Math.max(0, car.ghostAlpha) : 1;
    let tilt = 0;
    if (car.isPlayer && !isTitle && game.state === 'driving') {
      const lateral = typeLateralStats(car.type);
      tilt =
        clamp(car.vx / Math.max(0.001, lateral.speed), -1, 1) * 0.11;
    }
    const rot = car.renderRot + tilt;
    const isTutorialTarget =
      !isTitle &&
      !game.tutorialDone &&
      game.tutorialTarget === car;
    const isAssistTarget = this.assistTargets.has(car);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(rot);

    // 影子
    ctx.fillStyle = 'rgba(22, 30, 36, 0.20)';
    this.rr(
      -w * 0.52 + 3 * u,
      -l * 0.5 + 5 * u,
      w * 1.04,
      l * 1.02,
      Math.min(w, l) * 0.28
    );
    ctx.fill();

    if (car.isPlayer) {
      const pulse = 0.5 + 0.5 * Math.sin(this.realTimeFor(game) * 5.5);
      ctx.fillStyle = `rgba(255, 210, 63, ${0.16 + 0.12 * pulse})`;
      this.rr(-w * 0.62, -l * 0.56, w * 1.24, l * 1.12, Math.min(w, l) * 0.32);
      ctx.fill();
    }

    if (car.isPlayer && !isTitle && game.escapeTimer > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.realTimeFor(game) * 14);
      ctx.fillStyle = `rgba(127, 220, 255, ${0.07 + 0.05 * pulse})`;
      this.rr(-w * 0.7, -l * 0.7, w * 1.4, l * 1.4, Math.min(w, l) * 0.36);
      ctx.fill();
      ctx.strokeStyle = `rgba(127, 220, 255, ${0.45 + 0.4 * pulse})`;
      ctx.lineWidth = 3 * u;
      this.rr(-w * 0.7, -l * 0.7, w * 1.4, l * 1.4, Math.min(w, l) * 0.36);
      ctx.stroke();
    }

    if (car.destroyed) {
      this.drawWreck(w, l);
      ctx.restore();
      return;
    }

    this.drawCarBody(car, w, l, u);

    // 本体轮廓
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.5)';
    ctx.lineWidth = 1.6 * u;
    if (car.type === 'sports' || car.type === 'supercar') {
      this.traceSportsBody(w, l);
      ctx.stroke();
    } else {
      this.rr(-w * 0.5, -l * 0.5, w, l, Math.min(w, l) * 0.26);
      ctx.stroke();
    }

    if (car.isPlayer) {
      const pulse = 0.5 + 0.5 * Math.sin(this.realTimeFor(game) * 5.5);
      ctx.strokeStyle = `rgba(255, 250, 236, ${0.7 + 0.3 * pulse})`;
      ctx.lineWidth = 2.6 * u;
      if (car.type === 'sports' || car.type === 'supercar') {
        this.traceSportsBody(w, l, 1.06, 1.06);
        ctx.stroke();
      } else {
        this.rr(-w * 0.53, -l * 0.53, w * 1.06, l * 1.06, Math.min(w, l) * 0.28);
        ctx.stroke();
      }
    }

    if (isTutorialTarget || isAssistTarget) {
      const pulse = 0.5 + 0.5 * Math.sin(this.realTimeFor(game) * 7);
      ctx.strokeStyle = isAssistTarget
        ? `rgba(127, 220, 255, ${0.65 + 0.35 * pulse})`
        : `rgba(255, 210, 63, ${0.65 + 0.35 * pulse})`;
      ctx.lineWidth = 3 * u;
      this.rr(-w * 0.58, -l * 0.58, w * 1.16, l * 1.16, Math.min(w, l) * 0.3);
      ctx.stroke();
    }

    ctx.restore();

    if (isTutorialTarget) {
      const bob = Math.sin(this.realTimeFor(game) * 6) * 0.08 * laneW;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(px, py - l * 0.72 + bob);
      ctx.lineTo(px - 0.1 * laneW, py - l * 0.9 + bob);
      ctx.lineTo(px + 0.1 * laneW, py - l * 0.9 + bob);
      ctx.closePath();
      ctx.fill();
    }
  }

  traceSportsBody(w, l, sx = 1, sy = 1) {
    const { ctx } = this;
    const hw = w * 0.5 * sx;
    const hl = l * 0.5 * sy;
    ctx.beginPath();
    ctx.moveTo(0, -hl);
    ctx.quadraticCurveTo(hw * 0.6, -hl * 0.98, hw * 0.84, -hl * 0.5);
    ctx.quadraticCurveTo(hw, -hl * 0.26, hw, hl * 0.34);
    ctx.quadraticCurveTo(hw, hl * 0.92, hw * 0.66, hl * 0.94);
    ctx.lineTo(-hw * 0.66, hl * 0.94);
    ctx.quadraticCurveTo(-hw, hl * 0.92, -hw, hl * 0.34);
    ctx.quadraticCurveTo(-hw, -hl * 0.26, -hw * 0.84, -hl * 0.5);
    ctx.quadraticCurveTo(-hw * 0.6, -hl * 0.98, 0, -hl);
    ctx.closePath();
  }

  drawCarBody(car, w, l, u) {
    const { ctx } = this;
    const body = car.color;
    const dark = shade(body, -0.22);
    const light = shade(body, 0.18);
    const glass = 'rgba(42, 60, 70, 0.88)';
    const glassLight = 'rgba(150, 205, 220, 0.35)';

    const baseRR = (x, y, ww, hh, r) => {
      this.rr(x, y, ww, hh, r);
      ctx.fill();
    };

    // 车头灯 / 车尾灯（在本地坐标中，车头上方为负 y）
    const headY = -l * 0.5 + 2.4 * u;
    const tailY = l * 0.5 - 2.4 * u;
    ctx.fillStyle = 'rgba(38,48,54,0.35)';
    baseRR(-w * 0.5, -l * 0.5, w, l, Math.min(w, l) * 0.26);

    if (car.type === 'truck') {
      const cab = l * 0.33;
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, cab, w * 0.14);
      ctx.fillStyle = '#e9e4d8';
      baseRR(-w * 0.5, -l * 0.5 + cab, w, l - cab, w * 0.07);
      ctx.fillStyle = light;
      ctx.fillRect(-w * 0.5 + 2 * u, -l * 0.5 + cab + 4 * u, w * 0.1, (l - cab) * 0.8);
      ctx.fillStyle = 'rgba(90, 84, 72, 0.22)';
      for (let i = 1; i <= 3; i++) {
        ctx.fillRect(
          -w * 0.42,
          -l * 0.5 + cab + (l - cab) * (i / 4),
          w * 0.84,
          1.6 * u
        );
      }
      ctx.fillStyle = glass;
      baseRR(-w * 0.34, -l * 0.5 + cab * 0.18, w * 0.68, cab * 0.42, w * 0.1);
      ctx.fillStyle = glassLight;
      ctx.fillRect(
        -w * 0.28,
        -l * 0.5 + cab * 0.2,
        w * 0.56,
        cab * 0.12
      );
    } else if (car.type === 'bus') {
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.18);
      ctx.fillStyle = light;
      baseRR(-w * 0.38, -l * 0.41, w * 0.76, l * 0.72, w * 0.14);
      ctx.fillStyle = 'rgba(50, 70, 80, 0.55)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(
          -w * 0.34,
          -l * 0.36 + i * l * 0.145,
          w * 0.68,
          l * 0.045
        );
      }
      ctx.fillStyle = glass;
      baseRR(-w * 0.36, -l * 0.49, w * 0.72, l * 0.07, w * 0.08);
      ctx.fillStyle = 'rgba(240, 240, 230, 0.5)';
      baseRR(-w * 0.2, l * 0.18, w * 0.4, l * 0.12, w * 0.08);
    } else if (car.type === 'sports') {
      // 楔形车身：尖头宽尾、低趴座舱、尾翼
      ctx.fillStyle = body;
      this.traceSportsBody(w, l);
      ctx.fill();

      // 侧裙暗部，强化低趴轮廓
      ctx.strokeStyle = shade(body, -0.3);
      ctx.lineWidth = Math.max(1.4 * u, w * 0.028);
      this.traceSportsBody(w * 0.97, l * 0.985);
      ctx.stroke();

      // 中央拉花
      ctx.fillStyle = light;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(-w * 0.045, -l * 0.46, w * 0.09, l * 0.3);
      ctx.globalAlpha = 1;
      ctx.fillRect(-w * 0.16, -l * 0.44, w * 0.032, l * 0.24);
      ctx.fillRect(w * 0.128, -l * 0.44, w * 0.032, l * 0.24);

      // 前唇
      ctx.fillStyle = 'rgba(30, 36, 48, 0.5)';
      this.rr(-w * 0.3, -l * 0.49, w * 0.6, l * 0.038, 2 * u);
      ctx.fill();

      // 座舱（泪滴形）
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.moveTo(-w * 0.25, -l * 0.14);
      ctx.quadraticCurveTo(0, -l * 0.2, w * 0.25, -l * 0.14);
      ctx.lineTo(w * 0.27, l * 0.16);
      ctx.quadraticCurveTo(0, l * 0.22, -w * 0.27, l * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = glassLight;
      ctx.beginPath();
      ctx.moveTo(-w * 0.20, -l * 0.11);
      ctx.quadraticCurveTo(0, -l * 0.145, w * 0.20, -l * 0.11);
      ctx.lineTo(w * 0.21, -l * 0.06);
      ctx.quadraticCurveTo(0, -l * 0.1, -w * 0.21, -l * 0.06);
      ctx.closePath();
      ctx.fill();

      // 引擎盖散热口
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.3)';
      ctx.lineWidth = 1.2 * u;
      for (let i = 0; i < 3; i++) {
        const yy = l * 0.22 + i * l * 0.03;
        ctx.beginPath();
        ctx.moveTo(-w * 0.2, yy);
        ctx.lineTo(w * 0.2, yy);
        ctx.stroke();
      }

      // 侧进气口
      ctx.fillStyle = 'rgba(28, 34, 42, 0.55)';
      this.rr(-w * 0.46, l * 0.02, w * 0.1, l * 0.12, 2.5 * u);
      ctx.fill();
      this.rr(w * 0.36, l * 0.02, w * 0.1, l * 0.12, 2.5 * u);
      ctx.fill();

      // 尾翼：两根支架 + 横翼 + 端板
      ctx.fillStyle = '#242b34';
      ctx.fillRect(-w * 0.3, l * 0.21, w * 0.065, l * 0.14);
      ctx.fillRect(w * 0.235, l * 0.21, w * 0.065, l * 0.14);
      this.rr(-w * 0.52, l * 0.315, w * 1.04, l * 0.075, 3 * u);
      ctx.fill();
      this.rr(-w * 0.535, l * 0.295, w * 0.055, l * 0.11, 2 * u);
      ctx.fill();
      this.rr(w * 0.48, l * 0.295, w * 0.055, l * 0.11, 2 * u);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(-w * 0.48, l * 0.325, w * 0.96, 1.2 * u);

      // 尾部扩散器与排气
      ctx.fillStyle = 'rgba(30, 36, 48, 0.45)';
      this.rr(-w * 0.3, l * 0.43, w * 0.6, l * 0.045, 2 * u);
      ctx.fill();
      ctx.fillStyle = '#9aa3ab';
      ctx.beginPath();
      ctx.arc(-w * 0.1, l * 0.435, Math.max(1.5 * u, w * 0.045), 0, Math.PI * 2);
      ctx.arc(w * 0.1, l * 0.435, Math.max(1.5 * u, w * 0.045), 0, Math.PI * 2);
      ctx.fill();
    } else if (car.type === 'taxi') {
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.28);
      ctx.fillStyle = light;
      ctx.fillRect(-w * 0.42, -l * 0.34, w * 0.84, l * 0.05);
      ctx.fillStyle = glass;
      baseRR(-w * 0.36, -l * 0.17, w * 0.72, l * 0.36, w * 0.18);
      ctx.fillStyle = glassLight;
      ctx.fillRect(-w * 0.28, -l * 0.13, w * 0.56, l * 0.07);
      // 出租车顶灯
      ctx.fillStyle = '#fff6e5';
      this.rr(-w * 0.16, -l * 0.06, w * 0.32, l * 0.12, 2 * u);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.55)';
      ctx.lineWidth = 1.4 * u;
      ctx.stroke();
      // 侧身格纹
      const sq = w * 0.1;
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#1e2430' : '#fff6e5';
        ctx.fillRect(-w * 0.3 + i * sq, l * 0.2, sq, l * 0.05);
      }
      ctx.fillStyle = dark;
      baseRR(-w * 0.3, l * 0.32, w * 0.6, l * 0.08, w * 0.08);
    } else if (car.type === 'van') {
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.14);
      // 前风挡
      ctx.fillStyle = glass;
      baseRR(-w * 0.4, -l * 0.44, w * 0.8, l * 0.16, w * 0.08);
      // 侧窗
      baseRR(-w * 0.46, -l * 0.22, w * 0.1, l * 0.42, w * 0.04);
      baseRR(w * 0.36, -l * 0.22, w * 0.1, l * 0.42, w * 0.04);
      // 货箱分隔线
      ctx.fillStyle = light;
      ctx.fillRect(-w * 0.38, -l * 0.02, w * 0.76, l * 0.035);
      ctx.fillRect(-w * 0.38, l * 0.16, w * 0.76, l * 0.035);
      // 后门
      ctx.fillStyle = dark;
      baseRR(-w * 0.3, l * 0.34, w * 0.6, l * 0.1, w * 0.04);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(-w * 0.3, -l * 0.28, w * 0.6, l * 0.04);
    } else if (car.type === 'limo') {
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.2);
      ctx.fillStyle = light;
      ctx.fillRect(-w * 0.42, -l * 0.42, w * 0.84, l * 0.035);
      ctx.fillRect(-w * 0.42, l * 0.38, w * 0.84, l * 0.03);
      ctx.fillStyle = glass;
      baseRR(-w * 0.35, -l * 0.32, w * 0.7, l * 0.1, w * 0.06);
      baseRR(-w * 0.35, -l * 0.12, w * 0.7, l * 0.16, w * 0.06);
      baseRR(-w * 0.35, l * 0.12, w * 0.7, l * 0.1, w * 0.06);
      // 金色腰线
      ctx.fillStyle = 'rgba(255, 210, 63, 0.55)';
      ctx.fillRect(-w * 0.5, -l * 0.02, w, l * 0.012);
      ctx.fillRect(-w * 0.5, l * 0.18, w, l * 0.012);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fillRect(-w * 0.26, -l * 0.24, w * 0.52, l * 0.07);
    } else if (car.type === 'ambulance') {
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.14);
      // 前风挡
      ctx.fillStyle = glass;
      baseRR(-w * 0.4, -l * 0.44, w * 0.8, l * 0.14, w * 0.08);
      // 侧窗
      baseRR(-w * 0.46, -l * 0.24, w * 0.1, l * 0.34, w * 0.04);
      baseRR(w * 0.36, -l * 0.24, w * 0.1, l * 0.34, w * 0.04);
      // 红色侧条
      ctx.fillStyle = 'rgba(214, 60, 60, 0.85)';
      ctx.fillRect(-w * 0.5, -l * 0.08, w, l * 0.04);
      // 车顶红十字
      ctx.fillStyle = '#d63c3c';
      ctx.fillRect(-w * 0.055, l * 0.02, w * 0.11, l * 0.22);
      ctx.fillRect(-w * 0.17, l * 0.08, w * 0.34, l * 0.1);
      // 警示灯
      ctx.fillStyle = '#e63946';
      this.rr(-w * 0.18, -l * 0.16, w * 0.16, l * 0.045, 2 * u);
      ctx.fill();
      ctx.fillStyle = '#2f6fed';
      this.rr(w * 0.02, -l * 0.16, w * 0.16, l * 0.045, 2 * u);
      ctx.fill();
    } else if (car.type === 'firetruck') {
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.1);
      // 前风挡
      ctx.fillStyle = glass;
      baseRR(-w * 0.4, -l * 0.46, w * 0.8, l * 0.12, w * 0.06);
      // 白色腰线
      ctx.fillStyle = 'rgba(255, 246, 229, 0.92)';
      ctx.fillRect(-w * 0.5, -l * 0.06, w, l * 0.035);
      // 后部设备舱
      ctx.fillStyle = dark;
      baseRR(-w * 0.36, l * 0.18, w * 0.72, l * 0.22, w * 0.04);
      // 云梯
      ctx.strokeStyle = '#e8d9b5';
      ctx.lineWidth = Math.max(1.2 * u, w * 0.025);
      const ladderY0 = -l * 0.18;
      const ladderY1 = l * 0.3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * w * 0.16, ladderY0);
        ctx.lineTo(side * w * 0.16, ladderY1);
        ctx.stroke();
      }
      for (let i = 0; i <= 6; i++) {
        const yy = ladderY0 + ((ladderY1 - ladderY0) * i) / 6;
        ctx.beginPath();
        ctx.moveTo(-w * 0.16, yy);
        ctx.lineTo(w * 0.16, yy);
        ctx.stroke();
      }
      // 警示灯
      ctx.fillStyle = '#e63946';
      this.rr(-w * 0.2, -l * 0.24, w * 0.18, l * 0.04, 2 * u);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      this.rr(w * 0.02, -l * 0.24, w * 0.18, l * 0.04, 2 * u);
      ctx.fill();
    } else if (car.type === 'police') {
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.26);
      // 白色车门/车顶
      ctx.fillStyle = '#f4f4f0';
      this.rr(-w * 0.46, -l * 0.06, w * 0.92, l * 0.3, w * 0.1);
      ctx.fill();
      // 玻璃
      ctx.fillStyle = glass;
      baseRR(-w * 0.36, -l * 0.2, w * 0.72, l * 0.34, w * 0.16);
      // 警灯
      ctx.fillStyle = '#e63946';
      this.rr(-w * 0.2, -l * 0.08, w * 0.18, l * 0.05, 2 * u);
      ctx.fill();
      ctx.fillStyle = '#2f6fed';
      this.rr(w * 0.02, -l * 0.08, w * 0.18, l * 0.05, 2 * u);
      ctx.fill();
      // 车头徽标
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(0, -l * 0.34, Math.max(1.4 * u, w * 0.05), 0, Math.PI * 2);
      ctx.fill();
    } else if (car.type === 'supercar') {
      ctx.fillStyle = body;
      this.traceSportsBody(w, l);
      ctx.fill();
      ctx.strokeStyle = shade(body, -0.3);
      ctx.lineWidth = Math.max(1.4 * u, w * 0.026);
      this.traceSportsBody(w * 0.97, l * 0.985);
      ctx.stroke();
      // 中央拉花
      ctx.fillStyle = light;
      ctx.fillRect(-w * 0.04, -l * 0.45, w * 0.08, l * 0.86);
      // 座舱
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.moveTo(-w * 0.25, -l * 0.16);
      ctx.quadraticCurveTo(0, -l * 0.22, w * 0.25, -l * 0.16);
      ctx.lineTo(w * 0.27, l * 0.14);
      ctx.quadraticCurveTo(0, l * 0.2, -w * 0.27, l * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = glassLight;
      ctx.beginPath();
      ctx.moveTo(-w * 0.2, -l * 0.12);
      ctx.quadraticCurveTo(0, -l * 0.16, w * 0.2, -l * 0.12);
      ctx.lineTo(w * 0.21, -l * 0.07);
      ctx.quadraticCurveTo(0, -l * 0.11, -w * 0.21, -l * 0.07);
      ctx.closePath();
      ctx.fill();
      // 大型尾翼
      ctx.fillStyle = '#1e2430';
      ctx.fillRect(-w * 0.28, l * 0.3, w * 0.06, l * 0.16);
      ctx.fillRect(w * 0.22, l * 0.3, w * 0.06, l * 0.16);
      this.rr(-w * 0.58, l * 0.43, w * 1.16, l * 0.075, 3 * u);
      ctx.fill();
      // 侧进气
      ctx.fillStyle = 'rgba(28, 34, 42, 0.6)';
      this.rr(-w * 0.47, l * 0.02, w * 0.1, l * 0.14, 2 * u);
      ctx.fill();
      this.rr(w * 0.37, l * 0.02, w * 0.1, l * 0.14, 2 * u);
      ctx.fill();
      // 尾部扩散器
      ctx.fillStyle = 'rgba(30, 36, 48, 0.5)';
      this.rr(-w * 0.3, l * 0.46, w * 0.6, l * 0.04, 2 * u);
      ctx.fill();
    } else {
      // sedan
      ctx.fillStyle = body;
      baseRR(-w * 0.5, -l * 0.5, w, l, w * 0.28);
      ctx.fillStyle = light;
      ctx.fillRect(-w * 0.42, -l * 0.34, w * 0.84, l * 0.05);
      ctx.fillStyle = glass;
      baseRR(-w * 0.36, -l * 0.17, w * 0.72, l * 0.36, w * 0.18);
      ctx.fillStyle = glassLight;
      ctx.fillRect(-w * 0.28, -l * 0.13, w * 0.56, l * 0.07);
      ctx.fillStyle = dark;
      baseRR(-w * 0.3, l * 0.22, w * 0.6, l * 0.1, w * 0.1);
    }

    // 车灯
    if (car.type === 'sports' || car.type === 'supercar') {
      // 斜切大灯 / 细长尾灯
      ctx.fillStyle = 'rgba(255, 245, 190, 0.95)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * w * 0.4, headY + l * 0.012);
        ctx.lineTo(s * w * 0.17, headY - l * 0.004);
        ctx.lineTo(s * w * 0.19, headY + l * 0.035);
        ctx.lineTo(s * w * 0.38, headY + l * 0.042);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(230, 57, 70, 0.9)';
      this.rr(-w * 0.4, tailY, w * 0.26, l * 0.03, 2 * u);
      ctx.fill();
      this.rr(w * 0.14, tailY, w * 0.26, l * 0.03, 2 * u);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255, 245, 190, 0.95)';
      this.rr(-w * 0.41, headY, w * 0.2, l * 0.045, 2 * u);
      ctx.fill();
      this.rr(w * 0.21, headY, w * 0.2, l * 0.045, 2 * u);
      ctx.fill();
      ctx.fillStyle = 'rgba(230, 57, 70, 0.9)';
      this.rr(-w * 0.41, tailY, w * 0.2, l * 0.04, 2 * u);
      ctx.fill();
      this.rr(w * 0.21, tailY, w * 0.2, l * 0.04, 2 * u);
      ctx.fill();
    }

    // 后视镜
    if (car.type !== 'truck' && car.type !== 'bus') {
      ctx.fillStyle = dark;
      this.rr(-w * 0.56, -l * 0.26, w * 0.1, l * 0.09, 2 * u);
      ctx.fill();
      this.rr(w * 0.46, -l * 0.26, w * 0.1, l * 0.09, 2 * u);
      ctx.fill();
    }
  }

  drawVehiclePreview(canvas, vehicle) {
    if (!canvas || !vehicle) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(
      (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      2
    );
    const W = 260;
    const H = 168;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2d3947');
    bg.addColorStop(1, '#111820');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(
      W * 0.5,
      H * 0.52,
      8,
      W * 0.5,
      H * 0.52,
      W * 0.55
    );
    glow.addColorStop(0, 'rgba(255, 214, 130, 0.2)');
    glow.addColorStop(1, 'rgba(255, 214, 130, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 244, 224, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(W * 0.18, 0);
    ctx.lineTo(W * 0.18, H);
    ctx.moveTo(W * 0.82, 0);
    ctx.lineTo(W * 0.82, H);
    ctx.stroke();
    ctx.restore();

    const laneW = Math.min(
      (H - 34) / Math.max(1, vehicle.length),
      (W * 0.46) / Math.max(0.4, vehicle.width)
    );
    const w = vehicle.width * laneW;
    const l = vehicle.length * laneW;
    const car = {
      type: vehicle.type,
      color: vehicle.color,
      w,
      l,
      isPlayer: false,
      renderRot: 0,
    };

    const prevCtx = this.ctx;
    try {
      this.ctx = ctx;
      ctx.save();
      ctx.translate(W * 0.5, H * 0.5);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      ctx.beginPath();
      ctx.ellipse(4, l * 0.26, w * 0.58, l * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawCarBody(car, w, l, Math.max(0.55, laneW / 65));
      ctx.strokeStyle = 'rgba(255, 250, 236, 0.28)';
      ctx.lineWidth = 1.2;
      if (car.type === 'sports' || car.type === 'supercar') {
        this.traceSportsBody(w, l);
      } else {
        this.rr(-w * 0.5, -l * 0.5, w, l, Math.min(w, l) * 0.26);
      }
      ctx.stroke();
      ctx.restore();
    } finally {
      this.ctx = prevCtx;
    }
  }

  drawWreck(w, l) {
    const { ctx } = this;
    ctx.fillStyle = '#3a3330';
    this.rr(-w * 0.5, -l * 0.5, w, l, Math.min(w, l) * 0.26);
    ctx.fill();
    ctx.strokeStyle = '#221d1b';
    ctx.lineWidth = 2 * this.u;
    ctx.stroke();
    ctx.fillStyle = '#2a2422';
    this.rr(-w * 0.32, -l * 0.18, w * 0.64, l * 0.3, w * 0.1);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 160, 70, 0.55)';
    ctx.beginPath();
    ctx.arc(w * 0.18, -l * 0.12, w * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  realTimeFor(game) {
    return game.realTime || 0;
  }

  // ---------------------------------------------------------------- 小人

  drawCharacter(game) {
    const { ctx, layout } = this;
    const u = layout.u;

    if (game.state === 'roof' && game.playerCar) {
      const car = game.playerCar;
      const bob = Math.sin(game.realTime * 8) * 0.05 * layout.laneW;
      this.drawChibi(
        this.wx(car.x),
        this.wy(car.y) - layout.laneW * 0.05 + bob,
        0,
        'roof',
        game,
        1
      );
      return;
    }

    if (game.state === 'hijack' && game.character && game.playerCar) {
      const t = clamp(game.hijackTimer / Math.max(0.01, game.hijackDuration), 0, 1);
      this.drawChibi(
        this.wx(game.character.x),
        this.wy(game.character.y),
        game.playerCar.renderRot,
        'hijack',
        game,
        1 - t * 0.55,
        1 - t * 0.8
      );
      return;
    }

    if (game.state === 'diving' && game.character) {
      const ch = game.character;
      this.drawChibi(
        this.wx(ch.x),
        this.wy(ch.y),
        ch.rot,
        'diving',
        game,
        1
      );
      return;
    }

    if (game.state === 'dead') {
      if (game.character && game.character.mode === 'splat') {
        this.drawSplat(
          this.wx(game.character.x),
          this.wy(game.character.y),
          u
        );
      }
      if (game.deathCharacter) {
        const d = game.deathCharacter;
        this.drawChibi(
          this.wx(d.x),
          this.wy(d.y),
          d.rot,
          'fly',
          game,
          1
        );
      }
    }
  }

  drawChibi(px, py, rot, mode, game, scale = 1, alpha = 1) {
    const { ctx, layout } = this;
    const u = layout.u;
    const s = layout.laneW * 0.26 * scale;
    if (s <= 0.5) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 地面影子
    ctx.fillStyle = 'rgba(20, 28, 34, 0.18)';
    ctx.beginPath();
    ctx.ellipse(px + 2 * u, py + 4 * u, s * 0.62, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(px, py);
    ctx.rotate(rot);
    if (mode === 'diving') ctx.scale(0.92, 1.12);

    const outline = 'rgba(26, 32, 42, 0.9)';
    const skin = '#f2c6a0';
    const jacket = '#2f6fed';
    const jacketLight = '#4f8bff';
    const pants = '#2b2b3a';
    const helmet = '#ffd23f';

    // 披风
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    const capeWave = Math.sin(game.realTime * 12) * 0.08 * s;
    ctx.moveTo(-s * 0.38, s * 0.12);
    ctx.lineTo(s * 0.38, s * 0.12);
    ctx.lineTo(s * 0.12 + capeWave, s * 0.95);
    ctx.lineTo(-s * 0.12 + capeWave, s * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();

    // 腿
    ctx.fillStyle = pants;
    const legSpread = mode === 'roof' ? 0.22 : mode === 'diving' ? 0.18 : 0.26;
    for (const side of [-1, 1]) {
      this.rr(
        side * s * legSpread - s * 0.11,
        s * 0.34,
        s * 0.22,
        s * 0.46,
        s * 0.1
      );
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1 * u;
      ctx.stroke();
    }

    // 身体
    ctx.fillStyle = jacket;
    this.rr(-s * 0.42, -s * 0.4, s * 0.84, s * 0.82, s * 0.24);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.3 * u;
    ctx.stroke();
    ctx.fillStyle = jacketLight;
    this.rr(-s * 0.22, -s * 0.3, s * 0.44, s * 0.45, s * 0.16);
    ctx.fill();

    // 手臂
    ctx.fillStyle = jacket;
    const armSpread = mode === 'roof' ? 1.0 : mode === 'diving' ? 0.35 : 0.5;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * s * 0.42, -s * 0.1);
      ctx.rotate(side * armSpread);
      this.rr(-s * 0.09, -s * 0.08, s * 0.18, s * 0.5, s * 0.09);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1 * u;
      ctx.stroke();
      // 手
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0, s * 0.46, s * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = jacket;
      ctx.restore();
    }

    // 头
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -s * 0.62, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.3 * u;
    ctx.stroke();

    // 头盔
    ctx.fillStyle = helmet;
    ctx.beginPath();
    ctx.arc(0, -s * 0.68, s * 0.44, Math.PI * 0.92, Math.PI * 2.08);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();

    // 护目镜
    ctx.fillStyle = 'rgba(38, 54, 64, 0.9)';
    this.rr(-s * 0.3, -s * 0.74, s * 0.6, s * 0.13, s * 0.06);
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#23303c';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * s * 0.14, -s * 0.5, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }

    // 飞扑时的前伸手臂高光
    if (mode === 'diving') {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      this.rr(-s * 0.18, -s * 0.5, s * 0.36, s * 0.14, s * 0.08);
      ctx.fill();
    }

    ctx.restore();
  }

  drawSplat(px, py, u) {
    const { ctx, layout } = this;
    const s = layout.laneW * 0.26;
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = 'rgba(20,28,34,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 3 * u, s * 0.9, s * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2f6fed';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.85, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,32,42,0.9)';
    ctx.lineWidth = 1.4 * u;
    ctx.stroke();

    ctx.fillStyle = '#f2c6a0';
    ctx.beginPath();
    ctx.arc(s * 0.66, -s * 0.06, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,32,42,0.9)';
    ctx.stroke();

    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(s * 0.66, -s * 0.12, s * 0.34, Math.PI * 0.9, Math.PI * 2.1);
    ctx.closePath();
    ctx.fill();

    // X 眼
    ctx.strokeStyle = '#23303c';
    ctx.lineWidth = 1.4 * u;
    for (const side of [-1, 1]) {
      const ex = s * 0.66 + side * s * 0.11;
      const ey = -s * 0.01;
      ctx.beginPath();
      ctx.moveTo(ex - s * 0.05, ey - s * 0.05);
      ctx.lineTo(ex + s * 0.05, ey + s * 0.05);
      ctx.moveTo(ex + s * 0.05, ey - s * 0.05);
      ctx.lineTo(ex - s * 0.05, ey + s * 0.05);
      ctx.stroke();
    }

    // 星星
    ctx.fillStyle = '#ffd23f';
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI * 0.2 - i * 0.5;
      const r = s * (1.1 + i * 0.25);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r - s * 0.2;
      this.drawStar(x, y, s * 0.13, ctx);
    }
    ctx.restore();
  }

  drawStar(x, y, r, ctx = this.ctx) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI * 0.5;
      const rr = i % 2 === 0 ? r : r * 0.38;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawDiveTrail(game) {
    if (!game.diveTrail || game.diveTrail.length === 0) return;
    const { ctx, layout } = this;
    const s = layout.laneW * 0.26;
    for (const t of game.diveTrail) {
      const alpha = clamp(t.life / 0.18, 0, 1) * 0.3;
      const px = this.wx(t.x);
      const py = this.wy(t.y);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.rotate(t.rot);
      ctx.fillStyle = '#2f6fed';
      this.rr(-s * 0.35, -s * 0.35, s * 0.7, s * 0.7, s * 0.2);
      ctx.fill();
      ctx.fillStyle = '#f2c6a0';
      ctx.beginPath();
      ctx.arc(0, -s * 0.55, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 特效

  drawFlash(game) {
    if (game.flash <= 0) return;
    const { ctx, layout } = this;
    ctx.save();
    ctx.globalAlpha = game.flash * 0.55;
    ctx.fillStyle = game.flashColor;
    ctx.fillRect(0, 0, layout.W, layout.H);
    ctx.restore();
  }

  drawWrongWayGlow(game) {
    if (!game.wrongWayFlash || game.wrongWayFlash <= 0) return;
    const { ctx, layout } = this;
    const { W, H } = layout;
    const a = clamp(game.wrongWayFlash, 0, 1) * 0.32;
    const g = ctx.createRadialGradient(
      W * 0.5,
      H * 0.55,
      Math.min(W, H) * 0.38,
      W * 0.5,
      H * 0.55,
      Math.max(W, H) * 0.72
    );
    g.addColorStop(0, 'rgba(230, 57, 70, 0)');
    g.addColorStop(1, `rgba(230, 57, 70, ${a})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  drawBulletTime(game) {
    if (game.state !== 'roof' && game.state !== 'diving') return;
    const strength = clamp(
      (1 - game.timeScale) / Math.max(0.001, 1 - config.bulletTimeScale),
      0,
      1
    );
    if (strength <= 0.01) return;
    const { ctx, layout } = this;
    const { W, H } = layout;

    ctx.save();
    ctx.fillStyle = `rgba(12, 26, 40, ${0.26 * strength})`;
    ctx.fillRect(0, 0, W, H);

    const g = ctx.createRadialGradient(
      W * 0.5,
      H * 0.5,
      Math.min(W, H) * 0.18,
      W * 0.5,
      H * 0.5,
      Math.max(W, H) * 0.72
    );
    g.addColorStop(0, 'rgba(10,20,30,0)');
    g.addColorStop(1, `rgba(6, 14, 22, ${0.55 * strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = `rgba(220, 240, 255, ${0.22 * strength})`;
    for (let i = 0; i < 18; i++) {
      const x = hash2(i, 3) * W;
      const y =
        (hash2(i, 8) * H + game.realTime * (10 + (i % 5) * 6)) % H;
      const r = (1 + hash2(i, 12) * 2) * layout.u;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD

  drawHud(game) {
    const { ctx, layout } = this;
    const u = layout.u;
    const car = game.playerCar;

    // 分数
    const sx = 20 * u;
    const sy = 18 * u;
    this.panel(sx, sy, 220 * u, 94 * u, { r: 18 * u });
    this.text('得分', sx + 18 * u, sy + 25 * u, 13 * u, MUTED, {
      weight: 800,
    });
    this.text(
      Math.floor(game.score).toLocaleString('zh-CN'),
      sx + 18 * u,
      sy + 56 * u,
      34 * u,
      INK,
      { weight: 900 }
    );
    this.text(
      `最高 ${game.bestScore}`,
      sx + 18 * u,
      sy + 82 * u,
      12 * u,
      MUTED,
      { weight: 700 }
    );

    if (game.isWrongWay && game.state !== 'dead') {
      const info = game.wrongWayInfo;
      const badgeW = 150 * u;
      const badgeH = 46 * u;
      const badgeY = sy + 104 * u;
      const pulse =
        0.8 + 0.2 * Math.sin(game.realTime * (6 + info.tier * 3));
      const bg = info.tier >= 2 ? GOLD : info.tier >= 1 ? '#ff8a3d' : RED;
      const fg = info.tier >= 2 ? INK : CREAM;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = bg;
      this.rr(sx, badgeY, badgeW, badgeH, 15 * u);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4 * u;
      ctx.stroke();
      this.text(
        `逆行 ×${formatMultiplier(info.multiplier)}`,
        sx + 14 * u,
        badgeY + 16 * u,
        16 * u,
        fg,
        { weight: 900 }
      );
      this.text(
        `${info.heat.toFixed(1)}s`,
        sx + badgeW - 14 * u,
        badgeY + 16 * u,
        12 * u,
        fg,
        { weight: 800, align: 'right' }
      );
      const barX = sx + 14 * u;
      const barY = badgeY + 31 * u;
      const barW = badgeW - 28 * u;
      const barH = 5 * u;
      ctx.fillStyle =
        info.tier >= 2
          ? 'rgba(30, 36, 48, 0.25)'
          : 'rgba(255, 246, 229, 0.28)';
      this.rr(barX, barY, barW, barH, barH * 0.5);
      ctx.fill();
      ctx.fillStyle = fg;
      this.rr(barX, barY, barW * info.progress, barH, barH * 0.5);
      ctx.fill();
      ctx.restore();
    }

    // 耐久
    if (car && !car.destroyed) {
      const dw = 330 * u;
      const dx = layout.W * 0.5 - dw * 0.5;
      const dy = 18 * u;
      const passive = typePassiveText(car.type);
      const panelH = passive ? 78 * u : 72 * u;
      this.panel(dx, dy, dw, panelH, { r: 16 * u });
      const frac = clamp(car.durability / Math.max(0.01, car.durabilityMax), 0, 1);
      const warn = car.durability <= config.durabilityWarnTime;
      this.text(
        car.displayName || '车辆',
        dx + 18 * u,
        dy + 23 * u,
        15 * u,
        warn ? RED : INK,
        { weight: 900 }
      );
      this.text(
        `${Math.max(0, car.durability).toFixed(1)}s`,
        dx + dw - 18 * u,
        dy + 23 * u,
        13 * u,
        warn ? RED : MUTED,
        { weight: 800, align: 'right' }
      );

      const bx = dx + 18 * u;
      const by = dy + 42 * u;
      const bw = dw - 36 * u;
      const bh = 16 * u;
      ctx.fillStyle = 'rgba(30, 36, 48, 0.14)';
      this.rr(bx, by, bw, bh, 8 * u);
      ctx.fill();

      let barColor = GREEN;
      if (frac <= 0.25) barColor = RED;
      else if (frac <= 0.5) barColor = '#f2b134';
      ctx.fillStyle = barColor;
      this.rr(bx, by, Math.max(0, bw * frac), bh, 8 * u);
      ctx.fill();

      if (warn) {
        const pulse = 0.5 + 0.5 * Math.sin(game.realTime * 10);
        ctx.strokeStyle = `rgba(230, 57, 70, ${0.35 + 0.55 * pulse})`;
        ctx.lineWidth = 2.4 * u;
        this.rr(bx - 1.5 * u, by - 1.5 * u, bw + 3 * u, bh + 3 * u, 9 * u);
        ctx.stroke();
      }

      if (passive) {
        this.text(passive, dx + 18 * u, dy + 69 * u, 9 * u, MUTED, {
          weight: 700,
        });
      }
    }

    // 连击
    if (game.combo > 1 && game.comboTimer > 0) {
      const cw = 170 * u;
      const cx = layout.W - cw - 20 * u;
      const cy = game.contract ? 118 * u : 18 * u;
      const flash = game.comboFlash;
      ctx.save();
      ctx.translate(cx + cw * 0.5, cy + 31 * u);
      ctx.scale(1 + 0.05 * flash, 1 + 0.05 * flash);
      ctx.translate(-(cx + cw * 0.5), -(cy + 31 * u));
      this.panel(cx, cy, cw, 62 * u, { r: 16 * u });
      this.text(
        `连击 ×${game.combo}`,
        cx + 16 * u,
        cy + 22 * u,
        18 * u,
        ORANGE,
        { weight: 900 }
      );
      const nextBonus =
        config.hijackBonus + Math.max(0, game.combo) * config.comboStep;
      this.text(
        `下次 +${nextBonus}`,
        cx + cw - 16 * u,
        cy + 22 * u,
        11 * u,
        MUTED,
        { weight: 800, align: 'right' }
      );
      const t = clamp(
        game.comboTimer /
          Math.max(0.01, game.comboWindowEffective || config.comboWindow),
        0,
        1
      );
      ctx.fillStyle = 'rgba(30,36,48,0.12)';
      this.rr(cx + 16 * u, cy + 42 * u, cw - 32 * u, 8 * u, 4 * u);
      ctx.fill();
      ctx.fillStyle = ORANGE;
      this.rr(cx + 16 * u, cy + 42 * u, (cw - 32 * u) * t, 8 * u, 4 * u);
      ctx.fill();
      ctx.restore();
    }

    // 连击瞬间的大字反馈
    if (game.comboFlash > 0 && game.comboFlashText) {
      const cf = clamp(game.comboFlash, 0, 1);
      const scale = 1 + 0.16 * (1 - cf);
      ctx.save();
      ctx.globalAlpha = cf;
      ctx.translate(layout.W * 0.5, layout.H * 0.27);
      ctx.scale(scale, scale);
      this.text(game.comboFlashText, 0, 0, 30 * u, ORANGE, {
        weight: 900,
        align: 'center',
        stroke: 'rgba(24, 30, 40, 0.85)',
        strokeWidth: 5 * u,
      });
      ctx.restore();
    }

    this.drawContractPanel(game);

    // 子弹时间仪表
    if (game.state === 'roof' && car) {
      this.drawBulletTimeMeter(game, car);
    }
    if (game.escapeTimer > 0) {
      this.drawEscapeBanner(game);
    } else {
      this.drawTutorialBanner(game);
    }
    this.drawContractFlash(game);
  }

  drawMobileHud(game) {
    const { ctx, layout, safe } = this;
    const { W } = layout;
    const m = this.mU;
    const car = game.playerCar;

    // 分数 + 连击/逆行小状态
    const sx = safe.left + 8 * m;
    const sy = safe.top + 8 * m;
    const sw = 108 * m;
    const sh = 44 * m;
    this.panel(sx, sy, sw, sh, { r: 12 * m, lineWidth: 2.2 * m });
    this.text('得分', sx + 11 * m, sy + 9 * m, 8.5 * m, MUTED, {
      weight: 800,
    });
    this.text(
      Math.floor(game.score).toLocaleString('zh-CN'),
      sx + 11 * m,
      sy + 29 * m,
      19 * m,
      INK,
      { weight: 900 }
    );
    let miniY = sy + 12 * m;
    if (game.isWrongWay && game.state !== 'dead') {
      const info = game.wrongWayInfo;
      this.text(
        `×${formatMultiplier(info.multiplier)}`,
        sx + sw - 9 * m,
        miniY,
        11 * m,
        info.tier >= 2 ? '#b07a00' : RED,
        {
          weight: 900,
          align: 'right',
        }
      );
      const barX = sx + 10 * m;
      const barY = sy + sh - 4 * m;
      const barW = sw - 20 * m;
      const barH = 2 * m;
      ctx.fillStyle = 'rgba(230, 57, 70, 0.18)';
      this.rr(barX, barY, barW, barH, barH * 0.5);
      ctx.fill();
      ctx.fillStyle = info.tier >= 2 ? GOLD : RED;
      this.rr(barX, barY, barW * info.progress, barH, barH * 0.5);
      ctx.fill();
      miniY += 14 * m;
    }
    if (game.combo > 1) {
      this.text(`连${game.combo}`, sx + sw - 9 * m, miniY, 10 * m, ORANGE, {
        weight: 900,
        align: 'right',
      });
    }

    // 耐久
    if (car && !car.destroyed) {
      const dw = 146 * m;
      const passive = typePassiveShort(car.type);
      const dh = (passive ? 42 : 40) * m;
      const dx = W * 0.5 - dw * 0.5;
      const dy = safe.top + 8 * m;
      this.panel(dx, dy, dw, dh, { r: 12 * m, lineWidth: 2.2 * m });
      const frac = clamp(
        car.durability / Math.max(0.01, car.durabilityMax),
        0,
        1
      );
      const warn = car.durability <= config.durabilityWarnTime;
      this.text(
        car.displayName || '车辆',
        dx + 10 * m,
        dy + 13 * m,
        10.5 * m,
        warn ? RED : INK,
        { weight: 900 }
      );
      this.text(
        `${Math.max(0, car.durability).toFixed(1)}s`,
        dx + dw - 10 * m,
        dy + 13 * m,
        9 * m,
        warn ? RED : MUTED,
        { weight: 800, align: 'right' }
      );
      const bx = dx + 10 * m;
      const by = dy + 25 * m;
      const bw = dw - 20 * m;
      const bh = 6 * m;
      ctx.fillStyle = 'rgba(30,36,48,0.14)';
      this.rr(bx, by, bw, bh, 3 * m);
      ctx.fill();
      let barColor = GREEN;
      if (frac <= 0.25) barColor = RED;
      else if (frac <= 0.5) barColor = '#f2b134';
      ctx.fillStyle = barColor;
      this.rr(bx, by, Math.max(0, bw * frac), bh, 3 * m);
      ctx.fill();
      if (warn) {
        const pulse = 0.5 + 0.5 * Math.sin(game.realTime * 10);
        ctx.strokeStyle = `rgba(230,57,70,${0.35 + 0.5 * pulse})`;
        ctx.lineWidth = 1.8 * m;
        this.rr(bx - 1 * m, by - 1 * m, bw + 2 * m, bh + 2 * m, 4 * m);
        ctx.stroke();
      }

      if (passive) {
        this.text(passive, dx + 10 * m, dy + 37 * m, 6.8 * m, MUTED, {
          weight: 700,
        });
      }
    }

    // 连击/夺车大字
    if (game.comboFlash > 0 && game.comboFlashText) {
      const cf = clamp(game.comboFlash, 0, 1);
      const scale = 1 + 0.16 * (1 - cf);
      ctx.save();
      ctx.globalAlpha = cf;
      ctx.translate(W * 0.5, layout.H * 0.24);
      ctx.scale(scale, scale);
      this.text(game.comboFlashText, 0, 0, 22 * m, ORANGE, {
        weight: 900,
        align: 'center',
        stroke: 'rgba(24,30,40,0.85)',
        strokeWidth: 4 * m,
      });
      ctx.restore();
    }

    this.drawMobileContractPanel(game);

    // 手势模式的横向舵量指示条
    if (
      this.controlMode === 'gesture' &&
      this.gestureSteerActive &&
      game.state === 'driving'
    ) {
      const bw = 150 * m;
      const bh = 6 * m;
      const bx = W * 0.5 - bw * 0.5;
      const by = layout.H - safe.bottom - 24 * m;
      ctx.fillStyle = 'rgba(30,36,48,0.18)';
      this.rr(bx, by, bw, bh, bh * 0.5);
      ctx.fill();
      const dotX = bx + (this.gestureSteer + 1) * 0.5 * bw;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(dotX, by + bh * 0.5, 6 * m, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6 * m;
      ctx.stroke();
    }

    // 子弹时间仪表 / 提示条
    if (game.state === 'roof' && car) {
      this.drawBulletTimeMeter(game, car);
    }
    if (game.escapeTimer > 0) {
      this.drawEscapeBanner(game);
    } else {
      this.drawTutorialBanner(game);
    }
    this.drawContractFlash(game);
  }

  contractProgressLabel(contract) {
    if (!contract) return '';
    const target = contract.target;
    const targetText = Number.isInteger(target)
      ? String(target)
      : target.toFixed(1);
    if (contract.def.timeBased) {
      return `${Math.min(contract.progress, target).toFixed(1)} / ${targetText}s`;
    }
    return `${Math.min(Math.floor(contract.progress), target)} / ${targetText}`;
  }

  drawContractPanel(game) {
    const contract = game.contract;
    if (!contract) return;
    const { ctx, layout } = this;
    const u = layout.u;
    const w = 240 * u;
    const h = 92 * u;
    const x = layout.W - w - 20 * u;
    const y = 18 * u;
    const flash = clamp(game.contractFlash || 0, 0, 1);
    this.panel(x, y, w, h, {
      r: 16 * u,
      stroke: flash > 0 ? GOLD : INK,
      lineWidth: (flash > 0 ? 4 : 3) * u,
    });

    ctx.fillStyle = GOLD;
    this.rr(x + 16 * u, y + 10 * u, 4 * u, 12 * u, 2 * u);
    ctx.fill();

    this.text('悬赏目标', x + 28 * u, y + 17 * u, 11 * u, MUTED, {
      weight: 800,
    });
    this.text(
      `+${contract.reward}`,
      x + w - 16 * u,
      y + 17 * u,
      14 * u,
      ORANGE,
      { weight: 900, align: 'right' }
    );
    this.text(contract.def.title, x + 16 * u, y + 40 * u, 18 * u, INK, {
      weight: 900,
    });
    this.text(
      contract.def.describe(contract.target),
      x + 16 * u,
      y + 58 * u,
      11.5 * u,
      MUTED,
      { weight: 700 }
    );
    this.text(
      this.contractProgressLabel(contract),
      x + w - 16 * u,
      y + 58 * u,
      10 * u,
      MUTED,
      { weight: 800, align: 'right' }
    );

    const bx = x + 16 * u;
    const by = y + 72 * u;
    const bw = w - 32 * u;
    const bh = 8 * u;
    const pct = clamp(
      contract.progress / Math.max(0.001, contract.target),
      0,
      1
    );
    ctx.fillStyle = 'rgba(30, 36, 48, 0.14)';
    this.rr(bx, by, bw, bh, bh * 0.5);
    ctx.fill();
    ctx.fillStyle = flash > 0 ? GOLD : ORANGE;
    this.rr(bx, by, bw * pct, bh, bh * 0.5);
    ctx.fill();
  }

  drawMobileContractPanel(game) {
    const contract = game.contract;
    if (!contract || game.laneNoticeTimer > 0) return;
    const { ctx, layout, safe } = this;
    const m = this.mU;
    const w = 150 * m;
    const h = 62 * m;
    const x = layout.W - w - safe.right - 8 * m;
    const y = safe.top + 92 * m;
    const flash = clamp(game.contractFlash || 0, 0, 1);
    this.panel(x, y, w, h, {
      r: 10 * m,
      stroke: flash > 0 ? GOLD : INK,
      lineWidth: (flash > 0 ? 3 : 2.2) * m,
    });

    this.text('悬赏', x + 8 * m, y + 10 * m, 7.5 * m, MUTED, {
      weight: 800,
    });
    this.text(
      `+${contract.reward}`,
      x + w - 8 * m,
      y + 10 * m,
      9 * m,
      ORANGE,
      { weight: 900, align: 'right' }
    );
    this.text(contract.def.title, x + 8 * m, y + 25 * m, 11 * m, INK, {
      weight: 900,
    });
    this.text(
      contract.def.describe(contract.target),
      x + 8 * m,
      y + 37 * m,
      8 * m,
      MUTED,
      { weight: 700 }
    );
    this.text(
      this.contractProgressLabel(contract),
      x + w - 8 * m,
      y + 46 * m,
      7 * m,
      MUTED,
      { weight: 800, align: 'right' }
    );

    const bx = x + 8 * m;
    const by = y + 51 * m;
    const bw = w - 16 * m;
    const bh = 4 * m;
    const pct = clamp(
      contract.progress / Math.max(0.001, contract.target),
      0,
      1
    );
    ctx.fillStyle = 'rgba(30, 36, 48, 0.14)';
    this.rr(bx, by, bw, bh, bh * 0.5);
    ctx.fill();
    ctx.fillStyle = flash > 0 ? GOLD : ORANGE;
    this.rr(bx, by, bw * pct, bh, bh * 0.5);
    ctx.fill();
  }

  drawContractFlash(game) {
    if (!(game.contractFlash > 0) || !game.contractFlashText) return;
    const { ctx, layout } = this;
    const mobile = this.compactHud;
    const k = mobile ? this.mU : layout.u;
    const cf = clamp(game.contractFlash, 0, 1);
    const scale = 1 + 0.14 * (1 - cf);
    ctx.save();
    ctx.globalAlpha = cf;
    ctx.translate(layout.W * 0.5, layout.H * (mobile ? 0.46 : 0.36));
    ctx.scale(scale, scale);
    this.text(game.contractFlashText, 0, 0, (mobile ? 22 : 28) * k, GOLD, {
      weight: 900,
      align: 'center',
      stroke: 'rgba(24, 30, 40, 0.85)',
      strokeWidth: (mobile ? 4 : 5) * k,
    });
    ctx.restore();
  }

  drawBulletTimeMeter(game, car) {
    const { ctx, layout } = this;
    const u = layout.u;
    const mobile = this.touchMode;
    const m = this.mU;
    const px = this.wx(car.x);
    const py = this.wy(car.y);
    const radius = layout.laneW * 1.0;
    const frac = clamp(
      game.bulletTimeRemaining /
        Math.max(0.01, game.bulletTimeMax || config.bulletTimeDuration),
      0,
      1
    );

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20, 28, 36, 0.28)';
    ctx.lineWidth = 7 * u;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.stroke();

    const color = frac <= 0.22 ? '#ff5a3c' : GOLD;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6 * u;
    ctx.beginPath();
    ctx.arc(
      px,
      py,
      radius,
      -Math.PI * 0.5,
      -Math.PI * 0.5 + Math.PI * 2 * frac
    );
    ctx.stroke();

    this.text(
      `${Math.max(0, game.bulletTimeRemaining).toFixed(1)}s`,
      px,
      py + radius + (mobile ? 16 * m : 18 * u),
      mobile ? 10 * m : 12 * u,
      frac <= 0.22 ? '#ff5a3c' : CREAM,
      {
        weight: 900,
        align: 'center',
        stroke: 'rgba(20,28,36,0.7)',
        strokeWidth: mobile ? 2.5 * m : 3 * u,
      }
    );

    // 方向提示
    const chevronGap = mobile ? 14 * m : 16 * u;
    const chevronSize = mobile ? 9 * m : 11 * u;
    const dirs = [
      { key: 'up', dx: 0, dy: -1, x: px, y: py - radius - chevronGap },
      {
        key: 'left',
        dx: -1,
        dy: 0,
        x: px - radius - chevronGap,
        y: py,
      },
      {
        key: 'right',
        dx: 1,
        dy: 0,
        x: px + radius + chevronGap,
        y: py,
      },
    ];
    for (const d of dirs) {
      const res = this.assistResults[d.key];
      const valid = !!(res && res.car);
      const pulse = 0.55 + 0.45 * Math.sin(game.realTime * 8);
      const alpha = valid && config.assistLevel > 0 ? 0.7 + 0.3 * pulse : 0.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(d.x, d.y);
      ctx.rotate(Math.atan2(d.dy, d.dx) + Math.PI * 0.5);
      ctx.fillStyle = valid && config.assistLevel > 0 ? '#7fdcff' : CREAM;
      ctx.beginPath();
      ctx.moveTo(0, -chevronSize);
      ctx.lineTo(chevronSize * 0.73, chevronSize * 0.55);
      ctx.lineTo(0, chevronSize * 0.18);
      ctx.lineTo(-chevronSize * 0.73, chevronSize * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,28,36,0.65)';
      ctx.lineWidth = mobile ? 1.6 * m : 2 * u;
      ctx.stroke();
      ctx.restore();
    }

    if (game.bulletTimeRemaining <= 0) {
      const pulse = 0.5 + 0.5 * Math.sin(game.realTime * 12);
      this.text(
        '立即飞扑！',
        px,
        py - radius - (mobile ? 34 * m : 40 * u),
        mobile ? 13 * m : 16 * u,
        `rgba(255, 90, 60, ${0.55 + 0.45 * pulse})`,
        {
          weight: 900,
          align: 'center',
          stroke: 'rgba(20,28,36,0.7)',
          strokeWidth: mobile ? 2.5 * m : 3 * u,
        }
      );
    }
    ctx.restore();
  }

  drawTutorialBanner(game) {
    const stage = game.tutorialStage;
    if (stage === 'done') return;
    if (
      !(
        game.state === 'driving' ||
        game.state === 'roof' ||
        game.state === 'hijack'
      )
    ) {
      return;
    }

    let key = '';
    let label = '';
    const gesture = this.controlMode === 'gesture';
    if (stage === 'start') {
      key = '↓';
      label = this.touchMode
        ? gesture
          ? '下滑上车顶（子弹时间）'
          : '上车顶（子弹时间）'
        : '爬上车顶，进入子弹时间';
    } else if (stage === 'roof') {
      key = '↑';
      label = this.touchMode && gesture ? '上滑或侧滑飞扑前面的车' : '飞扑前面的车';
    } else if (stage === 'hijacked') {
      key = '← →';
      label =
        this.touchMode && gesture
          ? '试试侧滑扑向旁边的车'
          : '试试扑向旁边的车';
    } else {
      return;
    }

    const { ctx, layout } = this;
    const mobile = this.touchMode;
    const k = mobile ? this.mU : layout.u;
    const textSize = mobile ? 11.5 * k : 15 * layout.u;
    const capHeight = mobile ? 20 * k : 26 * layout.u;
    const capW = mobile
      ? Math.max(24 * k, this.measure(key, 10 * k) + 8 * k)
      : Math.max(
        30 * layout.u,
        this.measure(key, 14 * layout.u) + 14 * layout.u
      );
    const pad = mobile ? 10 * k : 14 * layout.u;
    const gap = mobile ? 7 * k : 10 * layout.u;
    const w = this.measure(label, textSize) + capW + pad * 2 + gap;
    const h = mobile ? 30 * k : 42 * layout.u;
    const x = layout.W * 0.5 - w * 0.5;
    const y = mobile
      ? this.safe.top + 54 * k + Math.sin(game.realTime * 4) * 1.5 * k
      : 100 * layout.u + Math.sin(game.realTime * 4) * 2 * layout.u;
    const radius = mobile ? 10 * k : 14 * layout.u;

    this.panel(x, y, w, h, { r: radius, fill: '#fff0d2' });

    ctx.fillStyle = '#f1e6d2';
    this.rr(
      x + pad,
      y + (h - capHeight) * 0.5,
      capW,
      capHeight,
      mobile ? 6 * k : 7 * layout.u
    );
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = mobile ? 1.6 * k : 2 * layout.u;
    ctx.stroke();
    this.text(
      key,
      x + pad + capW * 0.5,
      y + h * 0.5,
      mobile ? 10 * k : 14 * layout.u,
      INK,
      { weight: 900, align: 'center' }
    );
    this.text(
      label,
      x + pad + capW + gap,
      y + h * 0.5,
      textSize,
      INK,
      { weight: 900 }
    );
  }

  drawEscapeBanner(game) {
    const { ctx, layout } = this;
    const mobile = this.touchMode;
    const k = mobile ? this.mU : layout.u;
    const key = '→';
    const label = `碰撞保护时间：${game.escapeTimer.toFixed(1)}s`;
    const textSize = mobile ? 11.5 * k : 15 * layout.u;
    const capHeight = mobile ? 20 * k : 26 * layout.u;
    const capW = mobile
      ? Math.max(24 * k, this.measure(key, 10 * k) + 8 * k)
      : Math.max(
        30 * layout.u,
        this.measure(key, 14 * layout.u) + 14 * layout.u
      );
    const pad = mobile ? 10 * k : 14 * layout.u;
    const gap = mobile ? 7 * k : 10 * layout.u;
    const w = this.measure(label, textSize) + capW + pad * 2 + gap;
    const h = mobile ? 30 * k : 42 * layout.u;
    const x = layout.W * 0.5 - w * 0.5;
    const y = mobile ? this.safe.top + 54 * k : 100 * layout.u;
    const radius = mobile ? 10 * k : 14 * layout.u;
    const pulse = 0.5 + 0.5 * Math.sin(game.realTime * 9);

    ctx.save();
    ctx.globalAlpha = 0.92 + 0.08 * pulse;
    this.panel(x, y, w, h, { r: radius, fill: '#ff5a3c', stroke: INK });

    ctx.fillStyle = '#fff0d2';
    this.rr(
      x + pad,
      y + (h - capHeight) * 0.5,
      capW,
      capHeight,
      mobile ? 6 * k : 7 * layout.u
    );
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = mobile ? 1.6 * k : 2 * layout.u;
    ctx.stroke();
    this.text(
      key,
      x + pad + capW * 0.5,
      y + h * 0.5,
      mobile ? 10 * k : 14 * layout.u,
      INK,
      { weight: 900, align: 'center' }
    );
    this.text(
      label,
      x + pad + capW + gap,
      y + h * 0.5,
      textSize,
      '#fff6e5',
      { weight: 900 }
    );

    const frac = clamp(
      game.escapeTimer / Math.max(0.01, game.escapeMax),
      0,
      1
    );
    const barH = mobile ? 2.6 * k : 3.2 * layout.u;
    const barY = y + h - (mobile ? 5 * k : 7 * layout.u);
    ctx.fillStyle = 'rgba(255, 246, 229, 0.22)';
    this.rr(x + pad, barY, w - pad * 2, barH, barH * 0.5);
    ctx.fill();
    ctx.fillStyle = '#fff0d2';
    this.rr(x + pad, barY, (w - pad * 2) * frac, barH, barH * 0.5);
    ctx.fill();
    ctx.restore();
  }

  measure(str, size) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `900 ${size}px ${FONT}`;
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  drawAssist(game) {
    if (config.assistLevel === 0) return;
    if (game.state !== 'roof' || !game.playerCar) return;
    const { ctx, layout } = this;
    const u = layout.u;

    const list = [
      { res: this.assistResults.up, color: '#7fdcff' },
      { res: this.assistResults.left, color: '#7fdcff' },
      { res: this.assistResults.right, color: '#7fdcff' },
    ];

    if (config.assistLevel >= 2) {
      for (const { res } of list) {
        if (!res) continue;
        const hit = !!res.car;
        ctx.save();
        ctx.globalAlpha = hit ? 0.55 : 0.2;
        ctx.setLineDash([6 * u, 6 * u]);
        ctx.strokeStyle = hit ? '#ffd23f' : '#ffffff';
        ctx.lineWidth = 2.4 * u;
        ctx.beginPath();
        res.points.forEach((p, i) => {
          const x = this.wx(p.x);
          const y = this.wy(p.y);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        const lx = this.wx(res.landing.x);
        const ly = this.wy(res.landing.y);
        ctx.fillStyle = hit ? '#ffd23f' : 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(lx, ly, 5 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawPopupList(popups) {
    const { ctx, layout } = this;
    const u = layout.u;
    for (const p of popups) {
      const age = p.maxLife - p.life;
      const t = clamp(p.life / p.maxLife, 0, 1);
      const alpha = Math.min(1, t * 2.2);
      const scale = 1 + 0.22 * Math.max(0, 1 - age * 6);
      const px = this.wx(p.x);
      const py = this.wy(p.y) - age * 68 * u;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.scale(scale, scale);
      ctx.font = `900 ${p.size * u}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5 * u;
      ctx.strokeStyle = 'rgba(24, 30, 40, 0.85)';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  drawParticleList(particles) {
    const { ctx, layout } = this;
    const u = layout.u;
    for (const p of particles) {
      const px = this.wx(p.x);
      const py = this.wy(p.y);
      if (
        px < -60 * u ||
        px > layout.W + 60 * u ||
        py < -60 * u ||
        py > layout.H + 60 * u
      ) {
        continue;
      }
      const t = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = t;
      if (p.type === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.4 * u, p.size * layout.laneW);
        ctx.lineCap = 'round';
        const len = 0.07 * layout.laneW;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(
          px - p.vx * 0.02 * layout.laneW,
          py + p.vy * 0.02 * layout.laneW
        );
        ctx.stroke();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, p.size * layout.laneW * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'smoke') {
        ctx.globalAlpha = t * 0.32;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, p.size * layout.laneW), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'ring') {
        ctx.globalAlpha = t * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3.2 * u;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, p.size * layout.laneW), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        this.drawStar(px, py, p.size * layout.laneW, ctx);
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 标题 / 结算 / 暂停

  drawTitle(game) {
    const { ctx, layout } = this;
    const { W, H, u } = layout;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 22, 30, 0.5)';
    ctx.fillRect(0, 0, W, H);

    const cardW = Math.min(W * 0.86, 780 * u);
    const cardH = Math.min(H * 0.84, 442 * u);
    ctx.translate(W * 0.5, H * 0.5);
    ctx.rotate(-0.012);
    const x = -cardW * 0.5;
    const y = -cardH * 0.5;

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    this.rr(x + 7 * u, y + 11 * u, cardW, cardH, 26 * u);
    ctx.fill();

    ctx.fillStyle = CREAM;
    this.rr(x, y, cardW, cardH, 26 * u);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4 * u;
    ctx.stroke();

    ctx.save();
    this.rr(x, y, cardW, cardH, 26 * u);
    ctx.clip();
    const stripes = [ORANGE, GOLD, '#4f9fd9', GREEN];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = stripes[i];
      ctx.fillRect(x + (cardW / 4) * i, y, cardW / 4, 10 * u);
    }
    ctx.restore();

    const titleY = y + 88 * u;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${64 * u}px ${FONT}`;
    ctx.fillStyle = ORANGE;
    ctx.fillText('侠盗飞车', 2 * u, titleY + 3 * u);
    ctx.fillStyle = INK;
    ctx.fillText('侠盗飞车', 0, titleY);

    this.text('飞扑 · 夺车 · 逆行，活下去', 0, titleY + 44 * u, 16 * u, MUTED, {
      weight: 800,
      align: 'center',
    });
    this.text(`最高分  ${game.bestScore}`, 0, titleY + 76 * u, 14 * u, INK, {
      weight: 900,
      align: 'center',
    });

    const leftX = x + cardW * 0.09;
    const rightX = x + cardW * 0.55;
    const rowY = y + 214 * u;
    const rowGap = 40 * u;

    this.drawKeyRow(leftX, rowY, ['←', '→'], '变道 / 转向', u);
    this.drawKeyRow(leftX, rowY + rowGap, ['↓'], '上车顶（子弹时间）', u);
    this.drawKeyRow(
      leftX,
      rowY + rowGap * 2,
      ['↑', '←', '→'],
      '飞扑抢车',
      u
    );

    this.drawBulletRow(
      rightX,
      rowY,
      '抢到车',
      `+${config.hijackBonus}`,
      GOLD,
      u
    );
    this.drawBulletRow(
      rightX,
      rowY + rowGap,
      '逆行车道',
      wrongWayRangeLabel(),
      ORANGE,
      u
    );
    this.drawBulletRow(
      rightX,
      rowY + rowGap * 2,
      '同向碰撞',
      '只减速',
      GREEN,
      u
    );

    this.text(
      '每辆车都会散架，及时换车；迎面撞车、飞扑落空、车顶被撞都会结束',
      x + cardW * 0.5,
      y + cardH - 92 * u,
      12.5 * u,
      MUTED,
      { weight: 700, align: 'center' }
    );

    const pulse = 0.62 + 0.38 * Math.sin(game.realTime * 5);
    ctx.save();
    ctx.globalAlpha = pulse;
    this.text('按空格 / 点击开始', 0, y + cardH - 52 * u, 22 * u, ORANGE, {
      weight: 900,
      align: 'center',
    });
    ctx.restore();

    this.text('` 调参 · M 静音 · P 暂停', 0, y + cardH - 24 * u, 11 * u, '#9aa1a9', {
      weight: 700,
      align: 'center',
    });

    ctx.restore();
  }

  drawKeyRow(x, y, keys, label, u) {
    const { ctx } = this;
    let cx = x;
    for (const key of keys) {
      const w = Math.max(28 * u, this.measure(key, 14 * u) + 16 * u);
      ctx.fillStyle = '#f1e6d2';
      this.rr(cx, y - 13 * u, w, 26 * u, 7 * u);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      this.text(key, cx + w * 0.5, y, 14 * u, INK, {
        weight: 900,
        align: 'center',
      });
      cx += w + 6 * u;
    }
    this.text(label, cx + 6 * u, y, 14 * u, INK, { weight: 800 });
  }

  drawBulletRow(x, y, label, value, color, u) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 5 * u, y, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    this.text(label, x + 18 * u, y, 14 * u, MUTED, { weight: 700 });
    this.text(value, x + 156 * u, y, 15 * u, color, { weight: 900 });
  }

  drawGameOver(game) {
    const { ctx, layout } = this;
    const { W, H, u } = layout;
    const age = Math.max(0, game.realTime - game.gameOverAt);
    const t = clamp(age / 0.4, 0, 1);
    const scale = 0.86 + 0.14 * easeOutBack(t);
    const alpha = Math.min(1, t * 1.5);

    ctx.save();
    ctx.fillStyle = `rgba(15, 22, 30, ${0.62 * Math.min(1, age * 4)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    ctx.translate(W * 0.5, H * 0.5);
    ctx.scale(scale, scale);

    const cardW = Math.min(W * 0.86, 720 * u);
    const cardH = Math.min(H * 0.86, 430 * u);
    const x = -cardW * 0.5;
    const y = -cardH * 0.5;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    this.rr(x + 7 * u, y + 11 * u, cardW, cardH, 26 * u);
    ctx.fill();
    ctx.fillStyle = CREAM;
    this.rr(x, y, cardW, cardH, 26 * u);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4 * u;
    ctx.stroke();

    const reason = REASONS[game.deathReason] || {
      title: '结束了',
      quip: '',
      color: RED,
    };

    this.text('游戏结束', 0, y + 62 * u, 42 * u, INK, {
      weight: 900,
      align: 'center',
    });

    // 死因标签
    const pillW = this.measure(reason.title, 17 * u) + 40 * u;
    const pillY = y + 106 * u;
    ctx.fillStyle = reason.color;
    this.rr(-pillW * 0.5, pillY - 15 * u, pillW, 30 * u, 15 * u);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4 * u;
    ctx.stroke();
    this.text(reason.title, 0, pillY, 17 * u, CREAM, {
      weight: 900,
      align: 'center',
    });
    this.text(reason.quip, 0, pillY + 32 * u, 13 * u, MUTED, {
      weight: 700,
      align: 'center',
    });

    this.text('本局得分', 0, y + 186 * u, 13 * u, MUTED, {
      weight: 800,
      align: 'center',
    });
    this.text(
      game.finalScore.toLocaleString('zh-CN'),
      0,
      y + 228 * u,
      54 * u,
      ORANGE,
      { weight: 900, align: 'center' }
    );
    this.text(
      `最高分  ${game.bestScore}`,
      0,
      y + 268 * u,
      14 * u,
      INK,
      { weight: 800, align: 'center' }
    );
    this.text(
      `抢车 ${game.hijackCount} 辆 · 最高连击 ×${Math.max(
        1,
        game.maxCombo
      )} · 存活 ${Math.max(
        0,
        game.runRealTime ?? game.elapsed
      ).toFixed(1)} 秒`,
      0,
      y + 302 * u,
      12.5 * u,
      MUTED,
      { weight: 700, align: 'center' }
    );

    if (game.newBest) {
      ctx.save();
      ctx.translate(cardW * 0.32, y + 48 * u);
      ctx.rotate(0.14);
      ctx.fillStyle = GOLD;
      this.rr(-62 * u, -18 * u, 124 * u, 36 * u, 10 * u);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6 * u;
      ctx.stroke();
      this.text('新纪录！', 0, 0, 16 * u, INK, {
        weight: 900,
        align: 'center',
      });
      ctx.restore();
    }

    const ready = age > 0.35;
    const pulse = 0.6 + 0.4 * Math.sin(game.realTime * 5.5);
    ctx.save();
    ctx.globalAlpha = ready ? pulse : 0.35;
    this.text(
      ready ? '按 R 或点击重开' : '……',
      0,
      y + cardH - 48 * u,
      18 * u,
      ORANGE,
      { weight: 900, align: 'center' }
    );
    ctx.restore();

    this.text('` 调参 · M 静音', 0, y + cardH - 20 * u, 11 * u, '#9aa1a9', {
      weight: 700,
      align: 'center',
    });

    ctx.restore();
  }

  drawMobileTitle(game) {
    const { ctx, layout } = this;
    const { W, H } = layout;
    const m = this.mU;
    const portrait = H > W;
    const cardW = Math.min(W * 0.94, 560 * m);
    const cardH = Math.min(H * 0.9, 342 * m);

    ctx.save();
    ctx.fillStyle = 'rgba(15, 22, 30, 0.56)';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W * 0.5, H * 0.5);
    const x = -cardW * 0.5;
    const y = -cardH * 0.5;

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    this.rr(x + 6 * m, y + 10 * m, cardW, cardH, 22 * m);
    ctx.fill();
    ctx.fillStyle = CREAM;
    this.rr(x, y, cardW, cardH, 22 * m);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5 * m;
    ctx.stroke();

    ctx.save();
    this.rr(x, y, cardW, cardH, 22 * m);
    ctx.clip();
    const stripes = [ORANGE, GOLD, '#4f9fd9', GREEN];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = stripes[i];
      ctx.fillRect(x + (cardW / 4) * i, y, cardW / 4, 8 * m);
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${38 * m}px ${FONT}`;
    ctx.fillStyle = ORANGE;
    ctx.fillText('侠盗飞车', 2 * m, y + 58 * m);
    ctx.fillStyle = INK;
    ctx.fillText('侠盗飞车', 0, y + 56 * m);

    this.text('飞扑 · 夺车 · 逆行，活下去', 0, y + 86 * m, 12 * m, MUTED, {
      weight: 800,
      align: 'center',
    });
    this.text(`最高分  ${game.bestScore}`, 0, y + 108 * m, 11 * m, INK, {
      weight: 900,
      align: 'center',
    });

    const lineX = x + 26 * m;
    const lineW = cardW - 52 * m;
    const isGesture = this.controlMode === 'gesture';
    const lines = isGesture
      ? [
        ['↔', '横向拖动  转向'],
        ['↓', '下滑  上车顶（子弹时间）'],
        ['↑', '上 / 左 / 右滑  飞扑'],
        ['+', `抢车 +${config.hijackBonus} · 逆行 ${wrongWayRangeLabel()} · 同向碰撞只减速`],
      ]
      : [
        ['↔', '左侧拖动  转向'],
        ['↓', '右侧按钮  上车顶（子弹时间）'],
        ['↑', '右侧 ← / → / ↑  飞扑'],
        ['+', `抢车 +${config.hijackBonus} · 逆行 ${wrongWayRangeLabel()} · 同向碰撞只减速`],
      ];
    const startY = y + 142 * m;
    lines.forEach(([glyph, text], i) => {
      const ly = startY + i * 26 * m;
      ctx.fillStyle =
        i === 3 ? 'rgba(255, 210, 63, 0.22)' : 'rgba(30,36,48,0.06)';
      this.rr(lineX, ly - 12 * m, lineW, 24 * m, 7 * m);
      ctx.fill();
      this.text(
        glyph,
        lineX + 13 * m,
        ly,
        12 * m,
        i === 3 ? '#b07a00' : ORANGE,
        { weight: 900, align: 'center' }
      );
      this.text(text, lineX + 30 * m, ly, 11.5 * m, INK, {
        weight: 800,
      });
    });

    this.text(
      '迎面碰撞、飞扑落空、耐久归零都会结束',
      0,
      y + 252 * m,
      10 * m,
      MUTED,
      { weight: 700, align: 'center' }
    );

    const pulse = 0.62 + 0.38 * Math.sin(game.realTime * 5);
    ctx.save();
    ctx.globalAlpha = pulse;
    this.text('点击开始', 0, y + cardH - 38 * m, 18 * m, ORANGE, {
      weight: 900,
      align: 'center',
    });
    ctx.restore();

    if (portrait) {
      this.text('横屏视野更佳', 0, y + cardH - 16 * m, 9 * m, '#9aa1a9', {
        weight: 700,
        align: 'center',
      });
    }

    ctx.restore();
  }

  drawMobileGameOver(game) {
    const { ctx, layout } = this;
    const { W, H } = layout;
    const m = this.mU;
    const age = Math.max(0, game.realTime - game.gameOverAt);
    const t = clamp(age / 0.4, 0, 1);
    const scale = 0.88 + 0.12 * easeOutBack(t);
    const alpha = Math.min(1, t * 1.5);
    const cardW = Math.min(W * 0.94, 540 * m);
    const cardH = Math.min(H * 0.92, 344 * m);

    ctx.save();
    ctx.fillStyle = `rgba(15, 22, 30, ${0.64 * Math.min(1, age * 4)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    ctx.translate(W * 0.5, H * 0.5);
    ctx.scale(scale, scale);
    const x = -cardW * 0.5;
    const y = -cardH * 0.5;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    this.rr(x + 6 * m, y + 10 * m, cardW, cardH, 22 * m);
    ctx.fill();
    ctx.fillStyle = CREAM;
    this.rr(x, y, cardW, cardH, 22 * m);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5 * m;
    ctx.stroke();

    const reason = REASONS[game.deathReason] || {
      title: '结束了',
      quip: '',
      color: RED,
    };

    this.text('游戏结束', 0, y + 46 * m, 30 * m, INK, {
      weight: 900,
      align: 'center',
    });

    const pillW = this.measure(reason.title, 13 * m) + 34 * m;
    const pillY = y + 82 * m;
    ctx.fillStyle = reason.color;
    this.rr(-pillW * 0.5, pillY - 12 * m, pillW, 24 * m, 12 * m);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * m;
    ctx.stroke();
    this.text(reason.title, 0, pillY, 13 * m, CREAM, {
      weight: 900,
      align: 'center',
    });
    this.text(reason.quip, 0, pillY + 24 * m, 10.5 * m, MUTED, {
      weight: 700,
      align: 'center',
    });

    this.text('本局得分', 0, y + 142 * m, 9.5 * m, MUTED, {
      weight: 800,
      align: 'center',
    });
    this.text(
      game.finalScore.toLocaleString('zh-CN'),
      0,
      y + 176 * m,
      38 * m,
      ORANGE,
      { weight: 900, align: 'center' }
    );
    this.text(`最高分  ${game.bestScore}`, 0, y + 206 * m, 10.5 * m, INK, {
      weight: 800,
      align: 'center',
    });
    this.text(
      `抢车 ${game.hijackCount} 辆 · 最高连击 ×${Math.max(
        1,
        game.maxCombo
      )} · 存活 ${Math.max(
        0,
        game.runRealTime ?? game.elapsed
      ).toFixed(1)} 秒`,
      0,
      y + 230 * m,
      9.5 * m,
      MUTED,
      { weight: 700, align: 'center' }
    );

    if (game.newBest) {
      ctx.save();
      ctx.translate(cardW * 0.32, y + 36 * m);
      ctx.rotate(0.14);
      ctx.fillStyle = GOLD;
      this.rr(-52 * m, -15 * m, 104 * m, 30 * m, 8 * m);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2 * m;
      ctx.stroke();
      this.text('新纪录！', 0, 0, 13 * m, INK, {
        weight: 900,
        align: 'center',
      });
      ctx.restore();
    }

    const ready = age > 0.35;
    const pulse = 0.6 + 0.4 * Math.sin(game.realTime * 5.5);
    ctx.save();
    ctx.globalAlpha = ready ? pulse : 0.35;
    this.text(
      ready ? '点击重开' : '……',
      0,
      y + cardH - 32 * m,
      15 * m,
      ORANGE,
      { weight: 900, align: 'center' }
    );
    ctx.restore();

    ctx.restore();
  }

  drawPause() {
    const { ctx, layout } = this;
    const { W, H, u } = layout;
    const mobile = this.touchMode;
    const m = this.mU;
    const k = mobile ? m : u;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 22, 30, 0.52)';
    ctx.fillRect(0, 0, W, H);
    const w = (mobile ? 260 : 280) * k;
    const h = (mobile ? 150 : 150) * k;
    const x = W * 0.5 - w * 0.5;
    const y = H * 0.5 - h * 0.5;
    this.panel(x, y, w, h, { r: 22 * k });
    this.text('暂停', W * 0.5, y + 50 * k, (mobile ? 28 : 36) * k, INK, {
      weight: 900,
      align: 'center',
    });
    this.text(
      mobile ? '点击任意位置继续' : '按 P 继续',
      W * 0.5,
      y + 94 * k,
      (mobile ? 13 : 15) * k,
      MUTED,
      { weight: 800, align: 'center' }
    );
    if (!mobile) {
      this.text(
        'M 静音 · ` 调参',
        W * 0.5,
        y + 122 * u,
        11 * u,
        '#9aa1a9',
        { weight: 700, align: 'center' }
      );
    }
    ctx.restore();
  }

  drawFooter(game) {
    if (this.touchMode) return;
    const { ctx, layout } = this;
    const { W, H, u } = layout;
    const muted = this.muted ? '已静音' : '静音';

    if (config.showFps) {
      const label = `FPS ${Math.round(game.fps)}`;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 246, 229, 0.85)';
      this.rr(18 * u, H - 38 * u, 84 * u, 22 * u, 8 * u);
      ctx.fill();
      this.text(label, 24 * u, H - 27 * u, 11 * u, MUTED, {
        weight: 800,
        mono: true,
      });
      ctx.restore();
    }

    if (game.mode === 'title' || game.mode === 'gameover') return;

    let hint = `P 暂停 · M ${muted}`;
    if (game.paused) hint = `P 继续 · M ${muted}`;

    ctx.save();
    ctx.globalAlpha = 0.75;
    this.text(hint, W - 20 * u, H - 26 * u, 11 * u, INK, {
      weight: 700,
      align: 'right',
      stroke: 'rgba(255,246,229,0.45)',
      strokeWidth: 3 * u,
    });
    ctx.restore();
  }
}
