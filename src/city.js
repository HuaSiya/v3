import { ROAD_MAX, CENTER_X } from './game.js';
import { clamp, hash2, lerp } from './math.js';
import { mixColor, shadeColor as shade } from './scenes.js';

// 街区按“沙盘模型”来画：占地和屋顶是主角，墙体只保留很矮的一段，
// 所有体块朝同一方向轻微挤压，再配一层方向一致的地面阴影。
const ROW_H = 5.2;
const SLOT_W = 3.35;
const COLS = 3;
const CREAM = '#fff6e5';

const ROOF_TONES = [
  '#c85c43',
  '#5f8a86',
  '#8a6aa8',
  '#c08a3e',
  '#4f739c',
  '#a85a6a',
];

function pickKind(seed, col) {
  const r = hash2(seed, 211);
  if (col === 0) {
    if (r < 0.18) return 'shop';
    if (r < 0.32) return 'supermarket';
    if (r < 0.48) return 'apartment';
    if (r < 0.64) return 'house';
    if (r < 0.74) return 'tower';
    if (r < 0.82) return 'park';
    if (r < 0.88) return 'parking';
    if (r < 0.93) return 'stadium';
    if (r < 0.97) return 'construction';
    return 'house';
  }
  if (r < 0.3) return 'house';
  if (r < 0.55) return 'apartment';
  if (r < 0.69) return 'tower';
  if (r < 0.79) return 'park';
  if (r < 0.86) return 'parking';
  if (r < 0.92) return 'construction';
  if (r < 0.97) return 'supermarket';
  return 'stadium';
}

export class CityPainter {
  constructor(renderer) {
    this.r = renderer;
    this.ctx = renderer.ctx;
    this.layout = renderer.layout;
    this.theme = renderer.theme;
    this.cam = renderer.cam;
    this.W = renderer.layout.W;
    this.H = renderer.layout.H;
    this.u = renderer.layout.u;
    this.laneW = renderer.layout.laneW;
    this.roadMin = renderer.roadMin;
    this.roadMax = renderer.roadMax;
  }

  wx(x) {
    return this.r.wx(x);
  }

  wy(y) {
    return this.r.wy(y);
  }

  rr(...args) {
    return this.r.rr(...args);
  }

  text(...args) {
    return this.r.text(...args);
  }

  mix(a, b, t) {
    return mixColor(a, b, t);
  }

  // ---------------------------------------------------------------- 街区入口

  draw() {
    const { ctx } = this;
    ctx.fillStyle = this.theme.ground;
    ctx.fillRect(0, 0, this.W, this.H);

    this.drawSidewalks();

    const yMin = this.cam - this.layout.bottomWorld - 2;
    const yMax = this.cam + this.layout.topWorld + 2;
    const rStart = Math.floor((yMin - 1) / ROW_H);
    const rEnd = Math.ceil((yMax + 1) / ROW_H);
    const xMin = CENTER_X - this.W * 0.5 / this.laneW - 2;
    const xMax = CENTER_X + this.W * 0.5 / this.laneW + 2;

    // 从远到近画，近处的体块自然盖住远处。
    for (let r = rEnd; r >= rStart; r--) {
      for (const side of [-1, 1]) {
        for (let col = 0; col < COLS; col++) {
          const seed = r * 13.71 + col * 7.37 + (side > 0 ? 47.3 : 0);
          const kind = pickKind(seed, col);
          const near =
            side < 0
              ? -1.02 - col * SLOT_W
              : ROAD_MAX + 1.02 + col * SLOT_W;
          const far = near + side * SLOT_W;
          const x0 = Math.min(near, far) + 0.055;
          const x1 = Math.max(near, far) - 0.055;
          const y0 = r * ROW_H + 0.55 + (hash2(seed, 3) - 0.5) * 0.1;
          const y1 = (r + 1) * ROW_H - 0.45 + (hash2(seed, 4) - 0.5) * 0.1;
          if (x1 < xMin || x0 > xMax) continue;

          const px0 = this.wx(x0);
          const px1 = this.wx(x1);
          const pyTop = this.wy(y1);
          const pyBottom = this.wy(y0);
          // 高楼会向上伸出地块，留出大约一层半的余量。
          if (pyBottom < -2 * this.laneW) continue;
          if (pyTop - 1.6 * this.laneW > this.H) continue;

          this.drawPlot({
            kind,
            seed,
            side,
            col,
            px0,
            px1,
            pyTop,
            pyBottom,
          });
        }
      }
    }
  }

  drawSidewalks() {
    const { ctx } = this;
    const { u, laneW, H } = this;
    const sw = 0.92;
    const yMin = this.cam - this.layout.bottomWorld - 2;
    const yMax = this.cam + this.layout.topWorld + 2;

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
  }

  drawPlot(plot) {
    this.drawPad(plot);
    switch (plot.kind) {
      case 'house':
        this.drawHouse(plot);
        break;
      case 'apartment':
        this.drawApartment(plot);
        break;
      case 'tower':
        this.drawTower(plot);
        break;
      case 'shop':
        this.drawShop(plot);
        break;
      case 'supermarket':
        this.drawSupermarket(plot);
        break;
      case 'stadium':
        this.drawStadium(plot);
        break;
      case 'park':
        this.drawPark(plot);
        break;
      case 'parking':
        this.drawParkingLot(plot);
        break;
      case 'construction':
        this.drawConstruction(plot);
        break;
      default:
        this.drawHouse(plot);
    }
  }

  // ---------------------------------------------------------------- 地块底座

  padFill(kind, seed) {
    const tint = (hash2(seed, 621) - 0.5) * 0.07;
    if (kind === 'parking') {
      return shade(this.mix(this.theme.road, '#5c6268', 0.52), tint - 0.03);
    }
    if (kind === 'construction') {
      return shade(this.mix(this.theme.grass, '#b08a5a', 0.5), tint);
    }
    if (kind === 'shop' || kind === 'supermarket' || kind === 'stadium') {
      return shade(this.mix(this.theme.sidewalk, this.theme.road, 0.3), tint);
    }
    if (this.isLawn(kind, seed)) {
      return shade(this.theme.grass, tint);
    }
    // 一部分住宅/办公地块铺成浅色碎石前院，避免整条街都是同一种草坪。
    return shade(this.mix(this.theme.sidewalk, '#cdc2a6', 0.55), tint);
  }

  isLawn(kind, seed) {
    if (kind === 'park') return true;
    if (kind === 'house' || kind === 'apartment' || kind === 'tower') {
      return hash2(seed, 622) >= 0.26;
    }
    return false;
  }

  drawPad(plot) {
    const { ctx } = this;
    const { u } = this;
    const { kind, seed, px0, px1, pyTop, pyBottom } = plot;
    const w = px1 - px0;
    const h = pyBottom - pyTop;
    if (w <= 2 * u || h <= 2 * u) return;

    ctx.fillStyle = 'rgba(20, 28, 34, 0.09)';
    this.rr(px0 + 1.5 * u, pyTop + 2.5 * u, w, h, 7 * u);
    ctx.fill();

    const lawn = this.isLawn(kind, seed);
    ctx.fillStyle = this.padFill(kind, seed);
    this.rr(px0, pyTop, w, h - 1.5 * u, 7 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.15)';
    ctx.lineWidth = 1.2 * u;
    this.rr(px0, pyTop, w, h - 1.5 * u, 7 * u);
    ctx.stroke();

    const inset = 2 * u;
    const innerW = w - inset * 2;
    const innerH = h - 1.5 * u - inset * 2;
    if (innerW <= 0 || innerH <= 0) return;
    this.rr(px0 + inset, pyTop + inset, innerW, innerH, 6 * u);

    ctx.save();
    ctx.clip();

    if (lawn) {
      // 草坪的修剪条纹，远看有沙盘草粉的层次。
      const band = 0.55 * this.laneW;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
      for (let y = pyTop + band; y < pyBottom; y += band * 2) {
        ctx.fillRect(px0, y, w, band);
      }
    } else if (kind === 'shop' || kind === 'supermarket' || kind === 'stadium') {
      // 铺装的伸缩缝。
      const gap = 0.55 * this.laneW;
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.055)';
      ctx.lineWidth = 1 * u;
      for (let x = px0 + gap; x < px1; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, pyTop);
        ctx.lineTo(x, pyBottom);
        ctx.stroke();
      }
      for (let y = pyTop + gap; y < pyBottom; y += gap) {
        ctx.beginPath();
        ctx.moveTo(px0, y);
        ctx.lineTo(px1, y);
        ctx.stroke();
      }
    } else if (kind === 'construction') {
      // 工地泥土的碎石点。
      for (let i = 0; i < 14; i++) {
        const rx = px0 + hash2(seed, 510 + i) * w;
        const ry = pyTop + hash2(seed, 530 + i) * h;
        ctx.fillStyle =
          i % 3 === 0
            ? 'rgba(255, 240, 210, 0.16)'
            : 'rgba(60, 46, 34, 0.12)';
        ctx.beginPath();
        ctx.arc(rx, ry, (1.2 + hash2(seed, 550 + i) * 2.2) * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------- 体块基础

  makeBox(px0, px1, pyTop, pyBottom, height, side) {
    const shiftX = side * height * 0.3;
    const roofX0 = px0 + shiftX;
    const roofX1 = px1 + shiftX;
    const roofY0 = pyTop - height;
    const roofY1 = pyBottom - height;
    const roadX = side < 0 ? px1 : px0;
    return {
      px0,
      px1,
      pyTop,
      pyBottom,
      height,
      side,
      shiftX,
      roofX0,
      roofX1,
      roofY0,
      roofY1,
      roofW: px1 - px0,
      roofH: pyBottom - pyTop,
      roadX,
      bottomPt: (uu, vv) => ({
        x: lerp(px0, px1, uu) + shiftX * vv,
        y: pyBottom - height * vv,
      }),
      roadPt: (tt, vv) => ({
        x: roadX + shiftX * vv,
        y: lerp(pyTop, pyBottom, tt) - height * vv,
      }),
      roofPt: (uu, vv) => ({
        x: lerp(roofX0, roofX1, uu),
        y: lerp(roofY0, roofY1, vv),
      }),
    };
  }

  quad(a, b, c, d) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  drawCastShadow(geo, strength = 1) {
    const { ctx } = this;
    const { u } = this;
    const offX = geo.height * 0.2 + 2.5 * u;
    const offY = geo.height * 0.3 + 3.5 * u;
    const w = geo.px1 - geo.px0;
    const h = geo.pyBottom - geo.pyTop;
    ctx.fillStyle = `rgba(18, 26, 32, ${0.1 * strength})`;
    this.rr(geo.px0 + offX, geo.pyTop + offY, w, h, 4 * u);
    ctx.fill();
    ctx.fillStyle = `rgba(18, 26, 32, ${0.045 * strength})`;
    this.rr(
      geo.px0 + offX * 1.9,
      geo.pyTop + offY * 1.8,
      w,
      h,
      6 * u
    );
    ctx.fill();
  }

  baseColor(seed) {
    const palette = this.theme.buildings;
    return palette[Math.floor(hash2(seed, 401) * palette.length) % palette.length];
  }

  accent(seed, n = 421) {
    const palette = this.theme.shopAccents;
    return palette[Math.floor(hash2(seed, n) * palette.length) % palette.length];
  }

  roofColor(color) {
    return shade(
      mixColor(color, '#e9e3d5', 0.52),
      this.theme.roofShade * 0.32
    );
  }

  // 墙面：南侧（画面下方）是主立面，临路一侧只留一道窄墙。
  drawWalls(geo, color, seed, style = 'windows') {
    const { ctx } = this;
    const { u } = this;
    const bottomColor = shade(color, -0.15);
    const sideColor = shade(color, -0.27);

    ctx.fillStyle = bottomColor;
    this.quad(
      geo.bottomPt(0, 0),
      geo.bottomPt(1, 0),
      geo.bottomPt(1, 1),
      geo.bottomPt(0, 1)
    );
    ctx.fill();

    ctx.fillStyle = sideColor;
    this.quad(
      geo.roadPt(0, 0),
      geo.roadPt(1, 0),
      geo.roadPt(1, 1),
      geo.roadPt(0, 1)
    );
    ctx.fill();

    ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
    ctx.lineWidth = 1.1 * u;
    this.quad(
      geo.bottomPt(0, 0),
      geo.bottomPt(1, 0),
      geo.bottomPt(1, 1),
      geo.bottomPt(0, 1)
    );
    ctx.stroke();

    // 底部勒脚
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    ctx.fillRect(geo.px0, geo.pyBottom - 1.6 * u, geo.px1 - geo.px0, 1.6 * u);

    if (style === 'house') {
      const doorU = 0.18 + hash2(seed, 441) * 0.64;
      this.drawBottomWindows(geo, seed, 3, 1, 0.35, doorU);
      this.drawDoor(geo, doorU, seed);
    } else if (style === 'apartment') {
      this.drawBottomWindows(geo, seed, 4, 2, 0.2);
      this.drawBalconies(geo, seed);
    } else if (style === 'tower') {
      this.drawVerticalStripes(geo, seed);
    } else if (style === 'shop') {
      this.drawShopWindow(geo, seed);
    } else if (style === 'supermarket') {
      this.drawShopWindow(geo, seed, true);
    } else if (style === 'plain') {
      this.drawVent(geo, seed);
    } else {
      this.drawBottomWindows(geo, seed, 3, 1, 0.2);
    }
  }

  drawBottomWindows(geo, seed, colsN, rowsN, inset = 0.2, skipU = null) {
    const { ctx } = this;
    const litChance = this.theme.litChance;
    const glassDark = this.theme.windowDark;
    const glass = this.theme.windowGlass;
    const litColor = this.theme.windowLit;
    const margin = 0.07 + inset * 0.04;
    const cell = (1 - margin * 2) / colsN;
    const span = 0.66;
    for (let row = 0; row < rowsN; row++) {
      const v0 = 0.16 + (row / rowsN) * span;
      const v1 = v0 + (span / rowsN) * 0.54;
      for (let i = 0; i < colsN; i++) {
        const u0 = margin + cell * i + cell * 0.18;
        const u1 = u0 + cell * 0.64;
        if (skipU !== null && u0 < skipU + 0.11 && u1 > skipU - 0.11) continue;
        const lit = hash2(seed + row * 3.1, i + 71) < litChance;
        const reflective = hash2(seed + row * 1.7, i + 91) < 0.3;
        ctx.fillStyle = lit ? litColor : reflective ? glass : glassDark;
        this.quad(
          geo.bottomPt(u0, v0),
          geo.bottomPt(u1, v0),
          geo.bottomPt(u1, v1),
          geo.bottomPt(u0, v1)
        );
        ctx.fill();
      }
    }
  }

  drawDoor(geo, u, seed) {
    const { ctx } = this;
    const w = 0.075;
    const v0 = 0.01;
    const v1 = 0.44;
    ctx.fillStyle = 'rgba(32, 42, 48, 0.8)';
    this.quad(
      geo.bottomPt(u - w, v0),
      geo.bottomPt(u + w, v0),
      geo.bottomPt(u + w, v1),
      geo.bottomPt(u - w, v1)
    );
    ctx.fill();
    ctx.fillStyle = this.theme.windowLit;
    ctx.fillRect(
      lerp(geo.px0, geo.px1, u + w * 0.2),
      geo.pyBottom - geo.height * 0.3,
      1.5 * this.u,
      1.5 * this.u
    );
    // 门前的雨棚
    const accent = this.accent(seed, 452);
    ctx.fillStyle = accent;
    this.rr(
      lerp(geo.px0, geo.px1, u - w * 1.6),
      geo.pyBottom - 2 * this.u,
      (w * 3.2) * (geo.px1 - geo.px0),
      3 * this.u,
      1.5 * this.u
    );
    ctx.fill();
  }

  drawBalconies(geo, seed) {
    const { ctx } = this;
    const { u } = this;
    const rows = geo.height > 0.36 * this.laneW ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      // 阳台落在窗排之间的楼板位置，避免盖住立面窗户
      const v = rows === 2 ? 0.07 + row * 0.33 : 0.4;
      const a = geo.bottomPt(0.08, v);
      const b = geo.bottomPt(0.5, v);
      const slabH = 3.2 * u;
      ctx.fillStyle = 'rgba(242, 238, 226, 0.8)';
      ctx.fillRect(a.x, a.y, b.x - a.x, slabH);
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.24)';
      ctx.lineWidth = 1 * u;
      ctx.strokeRect(a.x, a.y, b.x - a.x, slabH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + slabH * 0.4);
      ctx.lineTo(b.x, b.y + slabH * 0.4);
      ctx.stroke();
    }
  }

  drawVerticalStripes(geo, seed) {
    const { ctx } = this;
    const litChance = this.theme.litChance;
    const colsN = Math.max(3, Math.min(6, Math.round(geo.roofW / (0.32 * this.laneW))));
    for (let i = 0; i < colsN; i++) {
      const u0 = (i + 0.2) / colsN;
      const u1 = (i + 0.8) / colsN;
      const lit = hash2(seed + i * 4.1, 61) < litChance;
      ctx.fillStyle = lit ? this.theme.windowLit : this.theme.windowGlass;
      this.quad(
        geo.bottomPt(u0, 0.12),
        geo.bottomPt(u1, 0.12),
        geo.bottomPt(u1, 0.9),
        geo.bottomPt(u0, 0.9)
      );
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
      ctx.lineWidth = 1 * this.u;
      this.quad(
        geo.bottomPt(u0, 0.12),
        geo.bottomPt(u1, 0.12),
        geo.bottomPt(u1, 0.9),
        geo.bottomPt(u0, 0.9)
      );
      ctx.stroke();
    }
  }

  drawShopWindow(geo, seed, wide = false) {
    const { ctx } = this;
    ctx.fillStyle = this.theme.windowGlass;
    this.quad(
      geo.bottomPt(0.04, 0.04),
      geo.bottomPt(0.96, 0.04),
      geo.bottomPt(0.96, wide ? 0.48 : 0.36),
      geo.bottomPt(0.04, wide ? 0.48 : 0.36)
    );
    ctx.fill();
    ctx.fillStyle = this.accent(seed, 471);
    this.quad(
      geo.bottomPt(0.04, wide ? 0.5 : 0.38),
      geo.bottomPt(0.96, wide ? 0.5 : 0.38),
      geo.bottomPt(0.96, wide ? 0.6 : 0.48),
      geo.bottomPt(0.04, wide ? 0.6 : 0.48)
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.18)';
    ctx.lineWidth = 1 * this.u;
    for (let i = 1; i < 4; i++) {
      const u = i / 4;
      const a = geo.bottomPt(u, 0.04);
      const b = geo.bottomPt(u, wide ? 0.48 : 0.36);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  drawVent(geo, seed) {
    const { ctx } = this;
    const u = 0.2 + hash2(seed, 481) * 0.6;
    ctx.fillStyle = 'rgba(30, 36, 48, 0.2)';
    this.quad(
      geo.bottomPt(u - 0.05, 0.06),
      geo.bottomPt(u + 0.05, 0.06),
      geo.bottomPt(u + 0.05, 0.3),
      geo.bottomPt(u - 0.05, 0.3)
    );
    ctx.fill();
  }

  drawFlatRoof(geo, color, seed, opts = {}) {
    const { ctx } = this;
    const { u } = this;
    const w = geo.roofX1 - geo.roofX0;
    const h = geo.roofY1 - geo.roofY0;
    if (w <= 0 || h <= 0) return;
    const roof = opts.roofColor || this.roofColor(color);

    ctx.fillStyle = roof;
    ctx.fillRect(geo.roofX0, geo.roofY0, w, h);
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.28)';
    ctx.lineWidth = 1.8 * u;
    ctx.strokeRect(geo.roofX0, geo.roofY0, w, h);

    // 女儿墙
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1.2 * u;
    ctx.strokeRect(
      geo.roofX0 + 3 * u,
      geo.roofY0 + 3 * u,
      Math.max(0, w - 6 * u),
      Math.max(0, h - 6 * u)
    );

    // 屋面拼缝
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.08)';
    ctx.lineWidth = 1 * u;
    const seam = 0.7 * this.laneW;
    for (let x = geo.roofX0 + seam; x < geo.roofX1; x += seam) {
      ctx.beginPath();
      ctx.moveTo(x, geo.roofY0);
      ctx.lineTo(x, geo.roofY1);
      ctx.stroke();
    }
    for (let y = geo.roofY0 + seam; y < geo.roofY1; y += seam) {
      ctx.beginPath();
      ctx.moveTo(geo.roofX0, y);
      ctx.lineTo(geo.roofX1, y);
      ctx.stroke();
    }

    // 靠外沿的采光高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.fillRect(geo.roofX0 + 2 * u, geo.roofY0 + 2 * u, w - 4 * u, 2 * u);
  }

  // ---------------------------------------------------------------- 屋顶零件

  drawRoofUnit(px, py, w, d, lift, color, seed = 0) {
    const { ctx } = this;
    const { u } = this;
    const topColor = shade(color, 0.08);
    const frontColor = shade(color, -0.2);
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    this.rr(px - w * 0.5 + 2 * u, py - d * 0.5 + 3 * u, w, d, 1.5 * u);
    ctx.fill();

    ctx.fillStyle = frontColor;
    ctx.fillRect(px - w * 0.5, py + d * 0.5 - lift, w, lift);
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.24)';
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(px - w * 0.5, py + d * 0.5 - lift, w, lift);

    ctx.fillStyle = topColor;
    this.rr(px - w * 0.5, py - d * 0.5 - lift, w, d, 1.5 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.2)';
    ctx.stroke();

    if (hash2(seed, 611) > 0.4) {
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.18)';
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        const yy = py - d * 0.5 - lift + (d * i) / 3;
        ctx.moveTo(px - w * 0.5 + 1.5 * u, yy);
        ctx.lineTo(px + w * 0.5 - 1.5 * u, yy);
      }
      ctx.stroke();
    }
  }

  drawWaterTank(px, py, r) {
    const { ctx } = this;
    const { u } = this;
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    ctx.beginPath();
    ctx.ellipse(px + 2.5 * u, py + 3 * u, r, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b7ab92';
    ctx.fillRect(px - r * 0.8, py - r * 1.15, r * 1.6, r * 1.7);
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.24)';
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(px - r * 0.8, py - r * 1.15, r * 1.6, r * 1.7);
    ctx.fillStyle = '#e8dfc8';
    ctx.beginPath();
    ctx.ellipse(px, py - r * 1.15, r * 0.8, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70, 60, 48, 0.28)';
    ctx.beginPath();
    ctx.moveTo(px - r * 0.8, py - r * 0.6);
    ctx.lineTo(px + r * 0.8, py - r * 0.6);
    ctx.stroke();
  }

  drawSolarPanel(geo, u0, v0, u1, v1, seed) {
    const { ctx } = this;
    const a = geo.roofPt(u0, v0);
    const b = geo.roofPt(u1, v0);
    const c = geo.roofPt(u1, v1);
    const d = geo.roofPt(u0, v1);
    ctx.fillStyle = 'rgba(38, 58, 82, 0.88)';
    this.quad(a, b, c, d);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 200, 230, 0.28)';
    ctx.lineWidth = 1 * this.u;
    ctx.stroke();
    const rows = 3;
    const cols = 2;
    for (let i = 1; i < cols; i++) {
      const t = i / cols;
      const p0 = {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
      };
      const p1 = {
        x: lerp(d.x, c.x, t),
        y: lerp(d.y, c.y, t),
      };
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    for (let i = 1; i < rows; i++) {
      const t = i / rows;
      const p0 = {
        x: lerp(a.x, d.x, t),
        y: lerp(a.y, d.y, t),
      };
      const p1 = {
        x: lerp(b.x, c.x, t),
        y: lerp(b.y, c.y, t),
      };
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    this.quad(
      geo.roofPt(u0, v0),
      geo.roofPt(u1, v0),
      geo.roofPt(u1, v0 + (v1 - v0) * 0.12),
      geo.roofPt(u0, v0 + (v1 - v0) * 0.12)
    );
    ctx.fill();
  }

  drawSkylight(geo, u0, v0, u1, v1) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(160, 214, 226, 0.62)';
    this.quad(
      geo.roofPt(u0, v0),
      geo.roofPt(u1, v0),
      geo.roofPt(u1, v1),
      geo.roofPt(u0, v1)
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 1 * this.u;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    this.quad(
      geo.roofPt(u0, v0),
      geo.roofPt(u1, v0),
      geo.roofPt(u1, v0 + (v1 - v0) * 0.16),
      geo.roofPt(u0, v0 + (v1 - v0) * 0.16)
    );
    ctx.fill();
  }

  drawRoofGarden(geo, u0, v0, u1, v1, seed) {
    const { ctx } = this;
    ctx.fillStyle = this.theme.grass;
    this.quad(
      geo.roofPt(u0, v0),
      geo.roofPt(u1, v0),
      geo.roofPt(u1, v1),
      geo.roofPt(u0, v1)
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.16)';
    ctx.lineWidth = 1 * this.u;
    ctx.stroke();
    const center = geo.roofPt((u0 + u1) * 0.5, (v0 + v1) * 0.5);
    const rw = Math.abs(geo.roofPt(u1, v0).x - geo.roofPt(u0, v0).x);
    for (let i = 0; i < 3; i++) {
      const px = center.x + (hash2(seed, 641 + i) - 0.5) * rw * 0.6;
      const py = center.y + (hash2(seed, 651 + i) - 0.5) * 10 * this.u;
      this.drawYardTree(px, py, (0.08 + hash2(seed, 661 + i) * 0.04) * this.laneW, seed + i);
    }
  }

  drawAntenna(px, py, h) {
    const { ctx } = this;
    const { u } = this;
    ctx.strokeStyle = 'rgba(42, 50, 58, 0.78)';
    ctx.lineWidth = 1.8 * u;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - h);
    ctx.stroke();
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.arc(px, py - h, 2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(42, 50, 58, 0.36)';
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    ctx.moveTo(px, py - h * 0.72);
    ctx.lineTo(px - h * 0.16, py);
    ctx.moveTo(px, py - h * 0.72);
    ctx.lineTo(px + h * 0.16, py);
    ctx.stroke();
  }

  drawHelipad(geo, uu, vv, r) {
    const { ctx } = this;
    const p = geo.roofPt(uu, vv);
    ctx.fillStyle = 'rgba(230, 225, 210, 0.9)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.35)';
    ctx.lineWidth = 1.4 * this.u;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.55)';
    ctx.lineWidth = Math.max(1.4 * this.u, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(p.x - r * 0.36, p.y - r * 0.42);
    ctx.lineTo(p.x - r * 0.36, p.y + r * 0.42);
    ctx.moveTo(p.x + r * 0.36, p.y - r * 0.42);
    ctx.lineTo(p.x + r * 0.36, p.y + r * 0.42);
    ctx.moveTo(p.x - r * 0.36, p.y);
    ctx.lineTo(p.x + r * 0.36, p.y);
    ctx.stroke();
  }

  drawRoofBillboard(geo, uu, vv, wFrac, accent, seed = 0) {
    const { ctx } = this;
    const { u } = this;
    const anchor = geo.roofPt(uu, vv);
    const boardW = Math.min(geo.roofW * wFrac, 0.9 * this.laneW);
    const boardH = Math.max(7 * u, 0.22 * this.laneW);
    const lift = 7 * u;
    const minX = geo.roofX0 + 2 * u;
    const maxX = geo.roofX1 - boardW - 2 * u;
    const x =
      maxX > minX ? clamp(anchor.x - boardW * 0.5, minX, maxX) : anchor.x - boardW * 0.5;
    const y = anchor.y - boardH - lift;

    ctx.fillStyle = 'rgba(20, 28, 34, 0.18)';
    this.rr(x + 3 * u, y + 4 * u, boardW, boardH, 2 * u);
    ctx.fill();

    ctx.strokeStyle = 'rgba(42, 50, 58, 0.6)';
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(x + boardW * 0.2, y + boardH);
    ctx.lineTo(x + boardW * 0.2, anchor.y);
    ctx.moveTo(x + boardW * 0.8, y + boardH);
    ctx.lineTo(x + boardW * 0.8, anchor.y);
    ctx.stroke();

    ctx.fillStyle = CREAM;
    this.rr(x, y, boardW, boardH, 2 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.3)';
    ctx.lineWidth = 1.1 * u;
    ctx.stroke();

    ctx.fillStyle = accent;
    this.rr(x + boardW * 0.07, y + boardH * 0.2, boardW * 0.86, boardH * 0.22, 1 * u);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    const whiteW = 0.28 + hash2(seed, 861) * 0.12;
    this.rr(
      x + boardW * 0.14,
      y + boardH * 0.56,
      boardW * whiteW,
      boardH * 0.2,
      1 * u
    );
    ctx.fill();
    ctx.fillStyle = accent;
    this.rr(
      x + boardW * (0.56 + hash2(seed, 862) * 0.06),
      y + boardH * 0.56,
      boardW * 0.3,
      boardH * 0.2,
      1 * u
    );
    ctx.fill();
  }

  // ---------------------------------------------------------------- 住宅

  drawHouse(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const front = side < 0 ? px1 : px0;
    const frontYard = (0.55 + hash2(seed, 301) * 0.3) * laneW;
    const w = (1.3 + hash2(seed, 302) * 0.45) * laneW;
    const d = (1.35 + hash2(seed, 303) * 0.5) * laneW;

    let hx0;
    let hx1;
    if (side < 0) {
      hx1 = front - frontYard;
      hx0 = hx1 - w;
      if (hx0 < px0 + 0.18 * laneW) {
        hx0 = px0 + 0.18 * laneW;
        hx1 = hx0 + w;
      }
    } else {
      hx0 = front + frontYard;
      hx1 = hx0 + w;
      if (hx1 > px1 - 0.18 * laneW) {
        hx1 = px1 - 0.18 * laneW;
        hx0 = hx1 - w;
      }
    }

    const cy = pyTop + (pyBottom - pyTop) * (0.44 + hash2(seed, 304) * 0.14);
    let hy0 = cy - d * 0.5;
    let hy1 = cy + d * 0.5;
    const yMin = pyTop + 0.26 * laneW;
    const yMax = pyBottom - 0.3 * laneW;
    if (hy0 < yMin) {
      hy0 = yMin;
      hy1 = hy0 + d;
    }
    if (hy1 > yMax) {
      hy1 = yMax;
      hy0 = hy1 - d;
    }

    const driveY = clamp(
      cy + (hash2(seed, 305) - 0.5) * 0.35 * laneW,
      pyTop + 0.55 * laneW,
      pyBottom - 0.55 * laneW
    );
    const driveW = 0.38 * laneW;
    const walkY = clamp(
      driveY + (hash2(seed, 306) > 0.5 ? 1 : -1) * (0.7 + hash2(seed, 307) * 0.25) * laneW,
      pyTop + 0.3 * laneW,
      pyBottom - 0.3 * laneW
    );

    // 车道和前院小路
    const houseEdge = side < 0 ? hx1 : hx0;
    const dx0 = Math.min(houseEdge, front);
    const dx1 = Math.max(houseEdge, front);
    ctx.fillStyle = this.mix(this.theme.sidewalk, this.theme.road, 0.4);
    this.rr(dx0, driveY - driveW * 0.5, dx1 - dx0, driveW, 2 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.14)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.08)';
    ctx.beginPath();
    ctx.moveTo(dx0 + 3 * u, driveY - driveW * 0.2);
    ctx.lineTo(dx1 - 3 * u, driveY - driveW * 0.2);
    ctx.moveTo(dx0 + 3 * u, driveY + driveW * 0.2);
    ctx.lineTo(dx1 - 3 * u, driveY + driveW * 0.2);
    ctx.stroke();

    ctx.fillStyle = this.theme.path;
    this.rr(dx0, walkY - 0.08 * laneW, dx1 - dx0, 0.16 * laneW, 2 * u);
    ctx.fill();

    // 前院围栏，留出车道和步道开口
    this.drawFrontFence(plot, front, driveY, driveW, walkY);

    // 房子主体
    const wallH = Math.max(6 * u, (0.12 + hash2(seed, 308) * 0.07) * laneW);
    const color = this.baseColor(seed);
    const geo = this.makeBox(hx0, hx1, hy0, hy1, wallH, side);
    this.drawCastShadow(geo, 0.85);
    this.drawWalls(geo, color, seed, 'house');
    this.drawPitchedRoof(geo, seed, color);

    // 门廊
    const porchX = side < 0 ? hx1 : hx0;
    const porchW = 0.22 * laneW;
    const porchY = walkY;
    ctx.fillStyle = this.accent(seed, 312);
    this.rr(
      side < 0 ? porchX - 1 * u : porchX - porchW,
      porchY - 0.18 * laneW,
      porchW,
      0.36 * laneW,
      2 * u
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.26)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    ctx.fillRect(
      side < 0 ? porchX + porchW * 0.55 : porchX - porchW * 1.1,
      porchY - 0.18 * laneW + 2 * u,
      porchW * 0.55,
      0.36 * laneW
    );

    // 院子里的小树和灌木
    const trees = 2 + Math.floor(hash2(seed, 313) * 3);
    for (let i = 0; i < trees; i++) {
      const tx = px0 + w * 0.16 + hash2(seed, 320 + i) * (px1 - px0) * 0.68;
      const ty = pyTop + 0.3 * laneW + hash2(seed, 330 + i) * (pyBottom - pyTop - 0.6 * laneW);
      const tr = (0.16 + hash2(seed, 340 + i) * 0.08) * laneW;
      const insideHouse =
        tx > geo.roofX0 - tr - 0.06 * laneW &&
        tx < geo.roofX1 + tr + 0.06 * laneW &&
        ty > geo.roofY0 - tr - 0.06 * laneW &&
        ty < geo.roofY1 + tr + 0.06 * laneW;
      const onDrive =
        Math.abs(ty - driveY) < driveW * 0.5 + tr &&
        Math.abs(tx - (dx0 + dx1) * 0.5) < (dx1 - dx0) * 0.5 + tr;
      if (insideHouse || onDrive) continue;
      this.drawYardTree(tx, ty, tr, seed + i);
    }

    // 偶尔在车道上停一辆小车，稍微靠外停，避开屋檐
    if (hash2(seed, 351) > 0.45) {
      const px = houseEdge + (side < 0 ? 1 : -1) * (dx1 - dx0) * 0.6;
      const colorList = ['#d9534f', '#4a7fb5', '#e8c25a', '#6aa88a', '#c7c7c7'];
      this.drawParkedCar(
        px,
        driveY,
        Math.PI / 2,
        colorList[Math.floor(hash2(seed, 352) * colorList.length)],
        0.66
      );
    }
  }

  drawFrontFence(plot, front, driveY, driveW, walkY) {
    const { ctx } = this;
    const { u, laneW } = this;
    const { side, seed, pyTop, pyBottom } = plot;
    const fenceX = side < 0 ? front - 1.5 * u : front + 1.5 * u;
    const y0 = pyTop + 0.16 * laneW;
    const y1 = pyBottom - 0.16 * laneW;
    const gaps = [
      [driveY - driveW * 0.7 - 4 * u, driveY + driveW * 0.7 + 4 * u],
      [walkY - 0.14 * laneW - 3 * u, walkY + 0.14 * laneW + 3 * u],
    ];
    const segments = [];
    let cursor = y0;
    for (const [g0, g1] of gaps.sort((a, b) => a[0] - b[0])) {
      if (g0 > cursor) segments.push([cursor, Math.min(g0, y1)]);
      cursor = Math.max(cursor, g1);
    }
    if (cursor < y1) segments.push([cursor, y1]);

    ctx.strokeStyle = shade(this.theme.sidewalk, -0.2);
    ctx.lineWidth = Math.max(1.2 * u, 0.035 * laneW);
    for (const [a, b] of segments) {
      if (b - a < 2 * u) continue;
      ctx.beginPath();
      ctx.moveTo(fenceX, a);
      ctx.lineTo(fenceX, b);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(fenceX - 0.5 * u, a, 1 * u, b - a);
      const posts = Math.max(2, Math.floor((b - a) / (0.24 * laneW)));
      for (let i = 0; i <= posts; i++) {
        const py = lerp(a, b, i / posts);
        ctx.fillStyle = shade(this.theme.sidewalk, -0.26);
        ctx.beginPath();
        ctx.arc(fenceX, py, Math.max(1 * u, 0.022 * laneW), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 侧边灌木
    const hedgeX = side < 0 ? plot.px0 + 0.06 * laneW : plot.px1 - 0.06 * laneW;
    for (let i = 0; i < 3; i++) {
      const hy = pyTop + 0.5 * laneW + hash2(seed, 370 + i) * (pyBottom - pyTop - 1 * laneW);
      ctx.fillStyle = this.theme.tree.dark;
      ctx.beginPath();
      ctx.arc(hedgeX, hy, 0.1 * laneW, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.theme.tree.mid;
      ctx.beginPath();
      ctx.arc(hedgeX - 1 * u, hy - 2 * u, 0.07 * laneW, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPitchedRoof(geo, seed, color) {
    const { ctx } = this;
    const { u, laneW } = this;
    const eave = 0.075 * laneW;
    const rx0 = geo.roofX0 - eave;
    const rx1 = geo.roofX1 + eave;
    const ry0 = geo.roofY0 - eave;
    const ry1 = geo.roofY1 + eave;
    const roofBase = ROOF_TONES[Math.floor(hash2(seed, 321) * ROOF_TONES.length)];
    const roof = shade(mixColor(color, roofBase, 0.56), this.theme.roofShade * 0.32);
    const darkRoof = shade(roof, -0.07);

    // 屋檐在墙面上投下的窄影
    ctx.fillStyle = 'rgba(20, 26, 32, 0.16)';
    ctx.fillRect(geo.px0, ry1, geo.px1 - geo.px0, 3 * u);

    const vertical = hash2(seed, 322) > 0.42;
    if (vertical) {
      const mx = (rx0 + rx1) * 0.5;
      ctx.fillStyle = roof;
      ctx.fillRect(rx0, ry0, mx - rx0, ry1 - ry0);
      ctx.fillStyle = darkRoof;
      ctx.fillRect(mx, ry0, rx1 - mx, ry1 - ry0);
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
      ctx.lineWidth = 1.2 * u;
      ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);

      // 瓦垄
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.09)';
      ctx.lineWidth = 1 * u;
      for (let x = rx0 + 0.14 * laneW; x < rx1; x += 0.14 * laneW) {
        ctx.beginPath();
        ctx.moveTo(x, ry0 + 1.5 * u);
        ctx.lineTo(x, ry1 - 1.5 * u);
        ctx.stroke();
      }

      ctx.strokeStyle = shade(roof, 0.12);
      ctx.lineWidth = Math.max(1.6 * u, 0.035 * laneW);
      ctx.beginPath();
      ctx.moveTo(mx, ry0 + 1.5 * u);
      ctx.lineTo(mx, ry1 - 1.5 * u);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.moveTo(mx + 1 * u, ry0 + 2 * u);
      ctx.lineTo(mx + 1 * u, ry1 - 2 * u);
      ctx.stroke();

      // 烟囱和天窗
      if (hash2(seed, 325) > 0.35) {
        const cx = lerp(rx0, rx1, 0.28 + hash2(seed, 326) * 0.44);
        const cy = lerp(ry0, ry1, 0.3 + hash2(seed, 327) * 0.34);
        this.drawRoofUnit(cx, cy, 0.16 * laneW, 0.14 * laneW, 5 * u, '#b08f7a', seed);
      }
      if (hash2(seed, 328) > 0.62) {
        ctx.fillStyle = 'rgba(160, 214, 226, 0.52)';
        ctx.fillRect(rx0 + (rx1 - rx0) * 0.12, ry0 + (ry1 - ry0) * 0.3, 0.22 * laneW, 0.14 * laneW);
        ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
        ctx.strokeRect(rx0 + (rx1 - rx0) * 0.12, ry0 + (ry1 - ry0) * 0.3, 0.22 * laneW, 0.14 * laneW);
      }
    } else {
      const my = (ry0 + ry1) * 0.5;
      ctx.fillStyle = roof;
      ctx.fillRect(rx0, ry0, rx1 - rx0, my - ry0);
      ctx.fillStyle = darkRoof;
      ctx.fillRect(rx0, my, rx1 - rx0, ry1 - my);
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
      ctx.lineWidth = 1.2 * u;
      ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);

      ctx.strokeStyle = 'rgba(30, 36, 48, 0.09)';
      ctx.lineWidth = 1 * u;
      for (let y = ry0 + 0.14 * laneW; y < ry1; y += 0.14 * laneW) {
        ctx.beginPath();
        ctx.moveTo(rx0 + 1.5 * u, y);
        ctx.lineTo(rx1 - 1.5 * u, y);
        ctx.stroke();
      }

      ctx.strokeStyle = shade(roof, 0.12);
      ctx.lineWidth = Math.max(1.6 * u, 0.035 * laneW);
      ctx.beginPath();
      ctx.moveTo(rx0 + 1.5 * u, my);
      ctx.lineTo(rx1 - 1.5 * u, my);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.moveTo(rx0 + 2 * u, my + 1 * u);
      ctx.lineTo(rx1 - 2 * u, my + 1 * u);
      ctx.stroke();

      if (hash2(seed, 333) > 0.35) {
        const cx = lerp(rx0, rx1, 0.28 + hash2(seed, 334) * 0.44);
        const cy = lerp(ry0, ry1, 0.3 + hash2(seed, 335) * 0.34);
        this.drawRoofUnit(cx, cy, 0.16 * laneW, 0.14 * laneW, 5 * u, '#b08f7a', seed);
      }
    }

    // 屋脊两端的小高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(rx0 + 2 * u, ry0 + 2 * u, rx1 - rx0 - 4 * u, 2 * u);
  }

  // ---------------------------------------------------------------- 公寓

  drawApartment(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const w = (2.0 + hash2(seed, 701) * 0.4) * laneW;
    const d = (2.0 + hash2(seed, 702) * 0.5) * laneW;
    const setback = (0.5 + hash2(seed, 703) * 0.25) * laneW;
    let x0;
    let x1;
    if (side < 0) {
      x1 = px1 - setback;
      x0 = x1 - w;
      if (x0 < px0 + 0.15 * laneW) {
        x0 = px0 + 0.15 * laneW;
        x1 = x0 + w;
      }
    } else {
      x0 = px0 + setback;
      x1 = x0 + w;
      if (x1 > px1 - 0.15 * laneW) {
        x1 = px1 - 0.15 * laneW;
        x0 = x1 - w;
      }
    }
    const cy = pyTop + (pyBottom - pyTop) * (0.48 + hash2(seed, 704) * 0.1);
    let y0 = cy - d * 0.5;
    let y1 = cy + d * 0.5;
    const ym0 = pyTop + 0.22 * laneW;
    const ym1 = pyBottom - 0.26 * laneW;
    if (y0 < ym0) {
      y0 = ym0;
      y1 = y0 + d;
    }
    if (y1 > ym1) {
      y1 = ym1;
      y0 = y1 - d;
    }

    const color = this.baseColor(seed);
    const h = (0.35 + hash2(seed, 705) * 0.17) * laneW;

    // 外侧的副楼先画，再画主楼盖住接缝。
    if (hash2(seed, 706) > 0.42) {
      const ww = w * 0.5;
      const wd = d * 0.62;
      const wx0 = side < 0 ? x0 - ww * 0.78 : x1 - ww * 0.22;
      const wx1 = wx0 + ww;
      const wy0 = y0 + d * 0.12;
      const wy1 = wy0 + wd;
      if (wx0 > px0 + 0.08 * laneW && wx1 < px1 - 0.08 * laneW) {
        const wing = this.makeBox(wx0, wx1, wy0, wy1, h * 0.72, side);
        this.drawCastShadow(wing, 0.7);
        this.drawWalls(wing, shade(color, -0.05), seed + 17.3, 'windows');
        this.drawFlatRoof(wing, shade(color, -0.05), seed + 17.3);
        this.drawRoofUnit(
          (wx0 + wx1) * 0.5,
          (wy0 + wy1) * 0.5 - h * 0.72,
          0.36 * laneW,
          0.3 * laneW,
          4 * u,
          '#b7ab92',
          seed
        );
      }
    }

    // 入口步道 + 雨棚
    const entryY = clamp(
      cy + (hash2(seed, 707) - 0.5) * 0.5 * laneW,
      y0 + 0.35 * laneW,
      y1 - 0.35 * laneW
    );
    const front = side < 0 ? px1 : px0;
    const edge = side < 0 ? x1 : x0;
    ctx.fillStyle = this.theme.path;
    this.rr(
      Math.min(front, edge),
      entryY - 0.09 * laneW,
      Math.abs(front - edge),
      0.18 * laneW,
      2 * u
    );
    ctx.fill();

    const geo = this.makeBox(x0, x1, y0, y1, h, side);
    this.drawCastShadow(geo, 1);
    this.drawWalls(geo, color, seed, 'apartment');
    this.drawFlatRoof(geo, color, seed);

    // 屋顶：楼梯间、水箱、太阳能板、屋顶花园
    const mx = geo.roofX0 + geo.roofW * 0.5;
    const my = geo.roofY0 + geo.roofH * 0.45;
    this.drawRoofUnit(mx, my, 0.44 * laneW, 0.36 * laneW, 8 * u, '#c8c2b4', seed + 1);
    this.drawWaterTank(
      geo.roofX0 + geo.roofW * 0.18,
      geo.roofY0 + geo.roofH * 0.2,
      Math.max(3 * u, 0.07 * laneW)
    );
    if (hash2(seed, 708) > 0.4) {
      this.drawSolarPanel(geo, 0.6, 0.6, 0.9, 0.86, seed);
    }
    if (hash2(seed, 709) > 0.45) {
      this.drawRoofGarden(geo, 0.08, 0.58, 0.34, 0.88, seed);
    } else {
      this.drawSkylight(geo, 0.08, 0.58, 0.3, 0.78);
    }
    this.drawRoofUnit(
      geo.roofX0 + geo.roofW * 0.78,
      geo.roofY0 + geo.roofH * 0.2,
      0.26 * laneW,
      0.2 * laneW,
      4 * u,
      '#b7ab92',
      seed + 2
    );

    // 入口雨棚
    const canopyW = 0.36 * laneW;
    const canopyD = 0.5 * laneW;
    const canopyX = side < 0 ? x1 : x0 - canopyW;
    ctx.fillStyle = this.accent(seed, 711);
    this.rr(canopyX, entryY - canopyD * 0.5, canopyW, canopyD, 2 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.28)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    ctx.fillRect(
      canopyX + 2 * u,
      entryY + canopyD * 0.35,
      canopyW - 4 * u,
      4 * u
    );

    // 前院绿化：沿建筑临路一侧的外沿布置，避开入口雨棚
    const yardDir = side < 0 ? 1 : -1;
    for (let i = 0; i < 2; i++) {
      const tx = edge + yardDir * (0.24 + hash2(seed, 720 + i) * 0.12) * laneW;
      const ty = pyTop + (0.3 + hash2(seed, 730 + i) * 0.5) * (pyBottom - pyTop);
      if (Math.abs(ty - entryY) < 0.35 * laneW) continue;
      this.drawYardTree(
        tx,
        ty,
        (0.1 + hash2(seed, 740 + i) * 0.03) * laneW,
        seed + i
      );
    }
  }

  // ---------------------------------------------------------------- 写字楼

  drawTower(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const w = (2.15 + hash2(seed, 801) * 0.35) * laneW;
    const d = (2.0 + hash2(seed, 802) * 0.35) * laneW;
    const setback = (0.45 + hash2(seed, 803) * 0.25) * laneW;
    let x0;
    let x1;
    if (side < 0) {
      x1 = px1 - setback;
      x0 = x1 - w;
      if (x0 < px0 + 0.12 * laneW) {
        x0 = px0 + 0.12 * laneW;
        x1 = x0 + w;
      }
    } else {
      x0 = px0 + setback;
      x1 = x0 + w;
      if (x1 > px1 - 0.12 * laneW) {
        x1 = px1 - 0.12 * laneW;
        x0 = x1 - w;
      }
    }
    const cy = pyTop + (pyBottom - pyTop) * (0.48 + hash2(seed, 804) * 0.08);
    let y0 = cy - d * 0.5;
    let y1 = cy + d * 0.5;
    const ym0 = pyTop + 0.18 * laneW;
    const ym1 = pyBottom - 0.22 * laneW;
    if (y0 < ym0) {
      y0 = ym0;
      y1 = y0 + d;
    }
    if (y1 > ym1) {
      y1 = ym1;
      y0 = y1 - d;
    }

    const color = this.baseColor(seed);
    const podiumH = (0.15 + hash2(seed, 805) * 0.07) * laneW;
    const podium = this.makeBox(x0, x1, y0, y1, podiumH, side);
    this.drawCastShadow(podium, 1);
    this.drawWalls(podium, color, seed, 'shop');
    this.drawFlatRoof(podium, color, seed);

    // 裙楼屋顶的窄绿化带，放在塔楼近侧的空余屋面上
    ctx.fillStyle = this.theme.grass;
    this.quad(
      podium.roofPt(0.42, 0.86),
      podium.roofPt(0.96, 0.86),
      podium.roofPt(0.96, 0.95),
      podium.roofPt(0.42, 0.95)
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.14)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const p = podium.roofPt(0.52 + i * 0.11, 0.905);
      ctx.fillStyle = this.theme.tree.dark;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.theme.tree.mid;
      ctx.beginPath();
      ctx.arc(p.x - 0.7 * u, p.y - 0.7 * u, 1.2 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    this.drawSkylight(podium, 0.12, 0.86, 0.36, 0.95);

    // 塔楼坐落在裙楼屋顶上，所以基准面抬高了 podiumH。
    const tw = (0.56 + hash2(seed, 806) * 0.1) * w;
    const td = (0.58 + hash2(seed, 807) * 0.1) * d;
    const tc = (podium.roofX0 + podium.roofX1) * 0.5;
    const tm = (podium.roofY0 + podium.roofY1) * 0.5;
    const tx0 = tc - tw * 0.5;
    const tx1 = tc + tw * 0.5;
    const ty0 = tm - td * 0.5;
    const ty1 = tm + td * 0.5;
    const th = (0.68 + hash2(seed, 808) * 0.36) * laneW;
    const tower = this.makeBox(tx0, tx1, ty0, ty1, th, side);
    this.drawWalls(tower, shade(color, 0.05), seed + 5.1, 'tower');
    this.drawFlatRoof(tower, shade(color, 0.05), seed + 5.1);

    // 塔顶设备层 + 天线 / 停机坪
    const topX = tower.roofX0 + tower.roofW * 0.5;
    const topY = tower.roofY0 + tower.roofH * 0.5;
    this.drawRoofUnit(
      topX,
      topY,
      tower.roofW * 0.42,
      tower.roofH * 0.36,
      7 * u,
      '#b9b4a8',
      seed + 3
    );
    if (hash2(seed, 809) > 0.6) {
      this.drawHelipad(
        tower,
        0.16,
        0.84,
        Math.min(tower.roofW, tower.roofH) * 0.12
      );
    } else {
      this.drawAntenna(topX, topY - 5 * u, Math.min(0.5 * laneW, th * 0.62));
    }
    this.drawSkylight(tower, 0.78, 0.08, 0.94, 0.22);

    // 大堂入口
    const front = side < 0 ? px1 : px0;
    const edge = side < 0 ? x1 : x0;
    const entryY = cy;
    ctx.fillStyle = this.theme.path;
    this.rr(
      Math.min(front, edge),
      entryY - 0.11 * laneW,
      Math.abs(front - edge),
      0.22 * laneW,
      2 * u
    );
    ctx.fill();
    const canopyW = 0.38 * laneW;
    const canopyD = 0.55 * laneW;
    ctx.fillStyle = this.accent(seed, 811);
    this.rr(
      side < 0 ? edge : edge - canopyW,
      entryY - canopyD * 0.5,
      canopyW,
      canopyD,
      2 * u
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.3)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();

    // 街角绿化，全部落在临路前场里
    const yardX = side < 0 ? x1 + 0.22 * laneW : x0 - 0.22 * laneW;
    this.drawYardTree(
      yardX,
      pyBottom - 0.25 * laneW,
      0.13 * laneW,
      seed
    );
    this.drawYardTree(
      yardX,
      pyTop + 0.28 * laneW,
      0.11 * laneW,
      seed + 1
    );
  }

  // ---------------------------------------------------------------- 商铺

  drawShop(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const w = (1.5 + hash2(seed, 901) * 0.3) * laneW;
    const d = (2.55 + hash2(seed, 902) * 0.4) * laneW;
    const setback = (0.55 + hash2(seed, 903) * 0.22) * laneW;
    let x0;
    let x1;
    if (side < 0) {
      x1 = px1 - setback;
      x0 = x1 - w;
      if (x0 < px0 + 0.12 * laneW) {
        x0 = px0 + 0.12 * laneW;
        x1 = x0 + w;
      }
    } else {
      x0 = px0 + setback;
      x1 = x0 + w;
      if (x1 > px1 - 0.12 * laneW) {
        x1 = px1 - 0.12 * laneW;
        x0 = x1 - w;
      }
    }
    const cy = pyTop + (pyBottom - pyTop) * (0.5 + (hash2(seed, 904) - 0.5) * 0.12);
    let y0 = cy - d * 0.5;
    let y1 = cy + d * 0.5;
    const ym0 = pyTop + 0.16 * laneW;
    const ym1 = pyBottom - 0.2 * laneW;
    if (y0 < ym0) {
      y0 = ym0;
      y1 = y0 + d;
    }
    if (y1 > ym1) {
      y1 = ym1;
      y0 = y1 - d;
    }

    const color = this.baseColor(seed);
    const h = (0.18 + hash2(seed, 905) * 0.08) * laneW;
    const geo = this.makeBox(x0, x1, y0, y1, h, side);
    this.drawCastShadow(geo, 0.9);
    this.drawWalls(geo, color, seed, 'shop');
    this.drawFlatRoof(geo, color, seed);

    const units = 2 + (hash2(seed, 906) > 0.5 ? 1 : 0);
    const edge = side < 0 ? x1 : x0;
    const dir = side < 0 ? 1 : -1;
    const unitH = (y1 - y0) / units;

    for (let i = 0; i < units; i++) {
      const uy0 = y0 + unitH * i + 2 * u;
      const uy1 = y0 + unitH * (i + 1) - 2 * u;
      const accent = this.accent(seed + i * 3.7, 921);
      const awningW = 0.26 * laneW;
      const ax = side < 0 ? edge : edge - awningW;
      const ay = uy0 + 1 * u;
      const awningH = Math.max(0, uy1 - uy0 - 2 * u);

      // 雨棚投在地面上的影子
      ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
      this.rr(ax + 2 * u, ay + 3 * u, awningW, awningH, 1.5 * u);
      ctx.fill();

      ctx.fillStyle = accent;
      this.rr(ax, ay, awningW, awningH, 1.5 * u);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.3)';
      ctx.lineWidth = 1 * u;
      ctx.stroke();

      // 条纹雨棚
      const stripes = 5;
      for (let s = 0; s < stripes; s++) {
        if (s % 2 === 0) continue;
        ctx.fillStyle = 'rgba(255, 246, 229, 0.82)';
        const sy = ay + (awningH * s) / stripes;
        ctx.fillRect(ax + 1 * u, sy, awningW - 2 * u, awningH / stripes);
      }

      // 店门玻璃
      ctx.fillStyle = this.theme.windowGlass;
      const glassW = Math.max(2 * u, 3 * u);
      ctx.fillRect(
        side < 0 ? edge - glassW : edge,
        uy0 + (uy1 - uy0) * 0.22,
        glassW,
        (uy1 - uy0) * 0.68
      );

      // 屋顶招牌
      this.drawRoofBillboard(
        geo,
        side < 0 ? 0.74 : 0.26,
        (i + 0.5) / units,
        0.34,
        accent,
        seed + i
      );

      // 门口的小桌椅
      if (hash2(seed + i, 931) > 0.5) {
        const tableX = edge + dir * (awningW + 0.16 * laneW);
        const tableY = (uy0 + uy1) * 0.5;
        ctx.fillStyle = 'rgba(20, 28, 34, 0.12)';
        ctx.beginPath();
        ctx.ellipse(tableX + 2 * u, tableY + 2 * u, 0.11 * laneW, 0.06 * laneW, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(tableX, tableY, 0.11 * laneW, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30, 36, 48, 0.25)';
        ctx.lineWidth = 1 * u;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(tableX - 2 * u, tableY - 2 * u, 0.035 * laneW, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 屋顶设备放在远离招牌的一侧，避免和招牌立柱打架
    this.drawRoofUnit(
      geo.roofX0 + geo.roofW * (side < 0 ? 0.18 : 0.82),
      geo.roofY0 + geo.roofH * 0.5,
      0.26 * laneW,
      0.22 * laneW,
      3 * u,
      '#b7ab92',
      seed
    );
  }

  // ---------------------------------------------------------------- 超市

  drawSupermarket(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const parking = (1.68 + hash2(seed, 1001) * 0.22) * laneW;
    const w = (1.35 + hash2(seed, 1002) * 0.25) * laneW;
    const d = (2.55 + hash2(seed, 1003) * 0.35) * laneW;
    let x0;
    let x1;
    if (side < 0) {
      x1 = px1 - parking;
      x0 = x1 - w;
      if (x0 < px0 + 0.1 * laneW) {
        x0 = px0 + 0.1 * laneW;
        x1 = x0 + w;
      }
    } else {
      x0 = px0 + parking;
      x1 = x0 + w;
      if (x1 > px1 - 0.1 * laneW) {
        x1 = px1 - 0.1 * laneW;
        x0 = x1 - w;
      }
    }
    const cy = pyTop + (pyBottom - pyTop) * (0.5 + (hash2(seed, 1004) - 0.5) * 0.1);
    let y0 = cy - d * 0.5;
    let y1 = cy + d * 0.5;
    const ym0 = pyTop + 0.16 * laneW;
    const ym1 = pyBottom - 0.2 * laneW;
    if (y0 < ym0) {
      y0 = ym0;
      y1 = y0 + d;
    }
    if (y1 > ym1) {
      y1 = ym1;
      y0 = y1 - d;
    }
    const entryY = (y0 + y1) * 0.5;
    const canopyW = 0.4 * laneW;
    const canopyD = 0.82 * laneW;

    // 停车场（先画地面，再画建筑）
    const edge = side < 0 ? x1 : x0;
    const front = side < 0 ? px1 : px0;
    const lotX0 = Math.min(edge, front);
    const lotX1 = Math.max(edge, front);
    const lotW = lotX1 - lotX0;
    const stallDepth = Math.min(lotW * 0.58, 0.82 * laneW);
    const stallX0 = side < 0 ? edge : edge - stallDepth;
    const stallX1 = stallX0 + stallDepth;
    const stallGap = 0.52 * laneW;
    const stalls = Math.max(3, Math.floor((y1 - y0) / stallGap));
    const lotY0 = y0 - 0.15 * laneW;
    const lotY1 = y1 + 0.15 * laneW;

    ctx.fillStyle = shade(this.mix(this.theme.road, '#4d545c', 0.5), -0.02);
    this.rr(lotX0, lotY0, lotW, lotY1 - lotY0, 3 * u);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.2 * u;
    for (let i = 0; i <= stalls; i++) {
      const sy = lerp(lotY0 + 0.1 * laneW, lotY1 - 0.1 * laneW, i / stalls);
      ctx.beginPath();
      ctx.moveTo(stallX0, sy);
      ctx.lineTo(stallX1, sy);
      ctx.stroke();
    }
    for (let i = 0; i < stalls; i++) {
      if (hash2(seed + i * 1.7, 1011) < 0.38) continue;
      const sy = lerp(lotY0 + 0.1 * laneW, lotY1 - 0.1 * laneW, (i + 0.5) / stalls);
      // 入口雨棚下方留空，避免和停放的车辆重叠
      if (Math.abs(sy - entryY) < canopyD * 0.5 + 0.14 * laneW) continue;
      const sx = (stallX0 + stallX1) * 0.5;
      const carColor = this.theme.buildings[
        Math.floor(hash2(seed + i, 1021) * this.theme.buildings.length) %
          this.theme.buildings.length
      ];
      this.drawParkedCar(sx, sy, Math.PI / 2, shade(carColor, -0.08), 0.82);
    }
    // 行车通道箭头
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    const aisleX = side < 0 ? stallX1 + (front - stallX1) * 0.55 : stallX0 - (stallX0 - front) * 0.55;
    for (let i = 0; i < 2; i++) {
      const ay = lerp(lotY0 + 0.2 * laneW, lotY1 - 0.2 * laneW, 0.35 + i * 0.28);
      ctx.beginPath();
      ctx.moveTo(aisleX, ay - 5 * u);
      ctx.lineTo(aisleX + 3.5 * u, ay);
      ctx.lineTo(aisleX, ay + 5 * u);
      ctx.lineTo(aisleX - 3.5 * u, ay);
      ctx.closePath();
      ctx.fill();
    }

    const color = this.baseColor(seed);
    const h = (0.24 + hash2(seed, 1005) * 0.08) * laneW;
    const geo = this.makeBox(x0, x1, y0, y1, h, side);
    this.drawCastShadow(geo, 1);
    this.drawWalls(geo, color, seed, 'supermarket');
    this.drawFlatRoof(geo, color, seed);

    // 屋顶：天窗、空调、光伏、招牌
    this.drawSkylight(geo, 0.2, 0.12, 0.45, 0.28);
    this.drawSkylight(geo, 0.2, 0.38, 0.45, 0.54);
    this.drawSkylight(geo, 0.2, 0.64, 0.45, 0.8);
    this.drawSolarPanel(geo, 0.56, 0.12, 0.9, 0.34, seed);
    this.drawRoofUnit(
      geo.roofX0 + geo.roofW * 0.72,
      geo.roofY0 + geo.roofH * 0.72,
      0.32 * laneW,
      0.25 * laneW,
      5 * u,
      '#b7ab92',
      seed
    );
    this.drawRoofBillboard(geo, side < 0 ? 0.8 : 0.2, 0.58, 0.52, this.accent(seed, 1031), seed);

    // 入口雨棚
    ctx.fillStyle = this.accent(seed, 1041);
    this.rr(
      side < 0 ? edge : edge - canopyW,
      entryY - canopyD * 0.5,
      canopyW,
      canopyD,
      2 * u
    );
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.3)';
    ctx.lineWidth = 1.1 * u;
    ctx.stroke();
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    ctx.fillRect(
      side < 0 ? edge + canopyW * 0.4 : edge - canopyW * 1.4,
      entryY - canopyD * 0.5 + 2 * u,
      canopyW,
      3 * u
    );
    ctx.fillStyle = this.theme.windowGlass;
    ctx.fillRect(
      side < 0 ? edge - 2 * u : edge,
      entryY - canopyD * 0.3,
      2 * u,
      canopyD * 0.6
    );

    // 门口广场的小树
    this.drawYardTree(
      side < 0 ? px1 - 0.16 * laneW : px0 + 0.16 * laneW,
      pyBottom - 0.25 * laneW,
      0.12 * laneW,
      seed
    );
    this.drawYardTree(
      side < 0 ? px1 - 0.16 * laneW : px0 + 0.16 * laneW,
      pyTop + 0.3 * laneW,
      0.1 * laneW,
      seed + 1
    );
  }

  // ---------------------------------------------------------------- 体育馆

  drawStadium(plot) {
    const { ctx } = this;
    const { seed, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const cx = (px0 + px1) * 0.5;
    const cy = (pyTop + pyBottom) * 0.5;
    const plotW = px1 - px0;
    const plotH = pyBottom - pyTop;
    const rx = Math.min(plotW * 0.44, 1.45 * laneW);
    const ry = Math.min(plotH * 0.42, 1.78 * laneW);
    const innerRx = rx * 0.66;
    const innerRy = ry * 0.68;

    //  plaza 上的一圈浅色环
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.12, ry * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // 碗体阴影
    ctx.fillStyle = 'rgba(18, 26, 32, 0.18)';
    ctx.beginPath();
    ctx.ellipse(cx + 4 * u, cy + 7 * u, rx * 1.02, ry * 1.02, 0, 0, Math.PI * 2);
    ctx.fill();

    // 外圈石材
    ctx.fillStyle = this.mix(this.theme.sidewalk, '#d8d1c0', 0.35);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.28)';
    ctx.lineWidth = 1.8 * u;
    ctx.stroke();

    // 看台
    const standColor = shade(this.mix(this.theme.sidewalk, '#4f5664', 0.5), -0.08);
    ctx.fillStyle = standColor;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.93, ry * 0.93, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.93, ry * 0.93, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1 * u;
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      ctx.stroke();
    }
    // 观众席的彩色小点
    for (let i = 0; i < 48; i++) {
      const a = hash2(seed + i, 1101) * Math.PI * 2;
      const rr = 0.72 + hash2(seed + i, 1111) * 0.26;
      const px = cx + Math.cos(a) * rx * rr;
      const py = cy + Math.sin(a) * ry * rr;
      ctx.fillStyle =
        hash2(seed + i, 1121) > 0.55
          ? this.theme.shopAccents[i % this.theme.shopAccents.length]
          : 'rgba(255, 246, 229, 0.5)';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.8 * u, 0.016 * laneW), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 内场
    ctx.fillStyle = this.mix(this.theme.grass, '#4f9c60', 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
    ctx.lineWidth = 1.4 * u;
    ctx.stroke();

    // 跑道
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1 * u;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        innerRx * (0.78 + i * 0.08),
        innerRy * (0.78 + i * 0.08),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    // 球场白线
    const pitchW = Math.min(innerRx * 1.25, 1.28 * laneW);
    const pitchH = Math.min(innerRy * 1.52, 1.72 * laneW);
    const px = cx - pitchW * 0.5;
    const py = cy - pitchH * 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 1.2 * u;
    ctx.strokeRect(px, py, pitchW, pitchH);
    ctx.beginPath();
    ctx.moveTo(px, cy);
    ctx.lineTo(px + pitchW, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(pitchW, pitchH) * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    const boxW = pitchW * 0.46;
    const boxH = pitchH * 0.14;
    ctx.strokeRect(cx - boxW * 0.5, py, boxW, boxH);
    ctx.strokeRect(cx - boxW * 0.5, py + pitchH - boxH, boxW, boxH);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(cx - pitchW * 0.16, py - 2 * u, pitchW * 0.32, 2 * u);
    ctx.fillRect(cx - pitchW * 0.16, py + pitchH, pitchW * 0.32, 2 * u);

    // 四角灯塔
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * 0.25 + (i * Math.PI) / 2;
      const lx = cx + Math.cos(a) * rx * 0.9;
      const ly = cy + Math.sin(a) * ry * 0.9;
      ctx.fillStyle = 'rgba(18, 26, 32, 0.28)';
      ctx.beginPath();
      ctx.ellipse(lx + 2 * u, ly + 3 * u, 3 * u, 1.6 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.theme.lampColor;
      ctx.beginPath();
      ctx.arc(lx, ly, 2.4 * u, 0, Math.PI * 2);
      ctx.fill();
      if (this.theme.lampGlow > 0.15) {
        ctx.fillStyle = `rgba(255, 226, 158, ${0.12 * this.theme.lampGlow})`;
        ctx.beginPath();
        ctx.arc(lx, ly, 9 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- 公园

  drawPark(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const w = px1 - px0;
    const h = pyBottom - pyTop;
    const front = side < 0 ? px1 : px0;
    const dir = side < 0 ? -1 : 1;

    // 入口小路
    const entryY = pyTop + h * (0.5 + (hash2(seed, 1201) - 0.5) * 0.16);
    ctx.strokeStyle = this.theme.path;
    ctx.lineWidth = Math.max(3 * u, 0.16 * laneW);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(front, entryY);
    ctx.quadraticCurveTo(
      front + dir * 0.55 * laneW,
      entryY - 0.25 * laneW,
      front + dir * 1.0 * laneW,
      pyTop + h * 0.46
    );
    ctx.stroke();

    // 中央水池
    const pondX = (px0 + px1) * 0.5 + (hash2(seed, 1202) - 0.5) * 0.3 * laneW;
    const pondY = pyTop + h * 0.48;
    const prx = Math.min(w * 0.22, 0.44 * laneW);
    const pry = Math.min(h * 0.16, 0.34 * laneW);

    // 环形步道
    ctx.strokeStyle = this.theme.path;
    ctx.lineWidth = Math.max(2.5 * u, 0.12 * laneW);
    ctx.beginPath();
    ctx.ellipse(pondX, pondY, prx * 1.65, pry * 1.8, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    ctx.beginPath();
    ctx.ellipse(pondX + 2 * u, pondY + 3 * u, prx, pry, 0, 0, Math.PI * 2);
    ctx.fill();
    const water = this.mix(this.theme.windowGlass, '#3d86a8', 0.55);
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.ellipse(pondX, pondY, prx, pry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 1.2 * u;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.beginPath();
    ctx.ellipse(pondX - prx * 0.25, pondY - pry * 0.2, prx * 0.4, pry * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // 喷泉
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(pondX, pondY, Math.max(1.4 * u, prx * 0.1), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 1 * u;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(pondX, pondY, prx * 0.16 + i * prx * 0.13, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 树和花坛
    const treeCount = 5 + Math.floor(hash2(seed, 1203) * 3);
    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + hash2(seed, 1210 + i) * 0.5;
      const rr = 0.42 + hash2(seed, 1220 + i) * 0.46;
      const tx = pondX + Math.cos(angle) * prx * 2.2 * rr;
      const ty = pondY + Math.sin(angle) * pry * 2.6 * rr;
      if (tx < px0 + 0.18 * laneW || tx > px1 - 0.18 * laneW) continue;
      if (ty < pyTop + 0.18 * laneW || ty > pyBottom - 0.18 * laneW) continue;
      this.drawYardTree(
        tx,
        ty,
        (0.15 + hash2(seed, 1230 + i) * 0.08) * laneW,
        seed + i
      );
    }
    for (let i = 0; i < 3; i++) {
      const fx = px0 + 0.2 * laneW + hash2(seed, 1240 + i) * (w - 0.4 * laneW);
      const fy = pyTop + 0.2 * laneW + hash2(seed, 1250 + i) * (h - 0.4 * laneW);
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle =
          this.theme.tree.fruit[(i + j) % this.theme.tree.fruit.length];
        ctx.beginPath();
        ctx.arc(
          fx + (j - 1.5) * 0.09 * laneW,
          fy + Math.sin(j * 2.1) * 0.04 * laneW,
          Math.max(1.2 * u, 0.025 * laneW),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    // 长椅
    for (let i = 0; i < 2; i++) {
      const bx = pondX + (i === 0 ? -1 : 1) * prx * 1.9;
      const by = pondY + (i === 0 ? 1 : -1) * pry * 2.0;
      ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
      this.rr(bx - 0.11 * laneW + 2 * u, by - 0.03 * laneW + 2 * u, 0.22 * laneW, 0.06 * laneW, 1 * u);
      ctx.fill();
      ctx.fillStyle = '#8a6b4a';
      this.rr(bx - 0.11 * laneW, by - 0.03 * laneW, 0.22 * laneW, 0.06 * laneW, 1 * u);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.25)';
      ctx.lineWidth = 1 * u;
      ctx.stroke();
    }

    // 入口两侧的绿篱
    ctx.strokeStyle = this.theme.tree.dark;
    ctx.lineWidth = Math.max(2 * u, 0.08 * laneW);
    ctx.lineCap = 'round';
    const hedgeX = side < 0 ? px1 - 0.08 * laneW : px0 + 0.08 * laneW;
    ctx.beginPath();
    ctx.moveTo(hedgeX, pyTop + 0.2 * laneW);
    ctx.lineTo(hedgeX, entryY - 0.25 * laneW);
    ctx.moveTo(hedgeX, entryY + 0.25 * laneW);
    ctx.lineTo(hedgeX, pyBottom - 0.2 * laneW);
    ctx.stroke();

    // 小凉亭放在远离入口的一侧
    if (hash2(seed, 1261) > 0.55) {
      const gx = side < 0 ? px0 + 0.28 * laneW : px1 - 0.28 * laneW;
      const gy = pyBottom - 0.32 * laneW;
      ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
      ctx.beginPath();
      ctx.arc(gx + 2 * u, gy + 3 * u, 0.18 * laneW, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(238, 232, 216, 0.9)';
      ctx.beginPath();
      ctx.arc(gx, gy, 0.16 * laneW, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.accent(seed, 1271);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const px = gx + Math.cos(a) * 0.13 * laneW;
        const py = gy + Math.sin(a) * 0.13 * laneW;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 36, 48, 0.28)';
      ctx.lineWidth = 1 * u;
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- 停车场

  drawParkingLot(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const w = px1 - px0;
    const h = pyBottom - pyTop;

    ctx.fillStyle = shade(this.mix(this.theme.road, '#4d545c', 0.5), -0.02);
    this.rr(px0 + 0.06 * laneW, pyTop + 0.12 * laneW, w - 0.12 * laneW, h - 0.24 * laneW, 3 * u);
    ctx.fill();

    const rowDepth = Math.min(w * 0.28, 0.75 * laneW);
    const rowNear = side < 0
      ? { x0: px1 - rowDepth, x1: px1 - 0.12 * laneW }
      : { x0: px0 + 0.12 * laneW, x1: px0 + rowDepth };
    const rowFar = side < 0
      ? { x0: px0 + 0.12 * laneW, x1: px0 + rowDepth }
      : { x0: px1 - rowDepth, x1: px1 - 0.12 * laneW };
    const stallGap = 0.54 * laneW;
    const stalls = Math.max(3, Math.floor((h - 0.5 * laneW) / stallGap));

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    ctx.lineWidth = 1.2 * u;
    for (const row of [rowNear, rowFar]) {
      for (let i = 0; i <= stalls; i++) {
        const sy = lerp(pyTop + 0.3 * laneW, pyBottom - 0.24 * laneW, i / stalls);
        ctx.beginPath();
        ctx.moveTo(row.x0, sy);
        ctx.lineTo(row.x1, sy);
        ctx.stroke();
      }
    }

    for (const [ri, row] of [rowNear, rowFar].entries()) {
      for (let i = 0; i < stalls; i++) {
        if (hash2(seed + ri * 7.7 + i, 1301) < 0.32) continue;
        const sy = lerp(pyTop + 0.3 * laneW, pyBottom - 0.24 * laneW, (i + 0.5) / stalls);
        const sx = (row.x0 + row.x1) * 0.5;
        const carColor = this.theme.buildings[
          Math.floor(hash2(seed + i + ri * 3.3, 1321) * this.theme.buildings.length) %
            this.theme.buildings.length
        ];
        this.drawParkedCar(sx, sy, Math.PI / 2, shade(carColor, -0.06), 0.82);
      }
    }

    // 通道中线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.4 * u;
    const aisleX = side < 0
      ? (rowNear.x0 + rowFar.x1) * 0.5
      : (rowNear.x1 + rowFar.x0) * 0.5;
    ctx.beginPath();
    ctx.moveTo(aisleX, pyTop + 0.5 * laneW);
    ctx.lineTo(aisleX, pyBottom - 0.4 * laneW);
    ctx.stroke();

    // 收费亭放在通道入口，避免压到车位里的车
    const boothW = 0.5 * laneW;
    const boothD = 0.4 * laneW;
    const boothX = aisleX;
    const boothY = pyTop + 0.42 * laneW;
    this.drawRoofUnit(
      boothX,
      boothY,
      boothW,
      boothD,
      8 * u,
      '#d8d0bd',
      seed
    );
    ctx.fillStyle = this.theme.windowLit;
    ctx.fillRect(
      boothX - boothW * 0.28,
      boothY - boothD * 0.2,
      boothW * 0.2,
      boothD * 0.24
    );

    // P 字牌放在通道末端，避开两侧车位
    const signX = aisleX;
    const signY = pyBottom - 0.35 * laneW;
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    this.rr(signX - 0.13 * laneW + 2 * u, signY - 0.3 * laneW + 3 * u, 0.26 * laneW, 0.3 * laneW, 2 * u);
    ctx.fill();
    ctx.fillStyle = '#3c73b8';
    this.rr(signX - 0.13 * laneW, signY - 0.3 * laneW, 0.26 * laneW, 0.3 * laneW, 2 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.34)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    this.text(
      'P',
      signX,
      signY - 0.15 * laneW,
      Math.max(7 * u, 0.13 * laneW),
      CREAM,
      { align: 'center', weight: 700 }
    );

    // 夜间灯杆
    for (let i = 0; i < 2; i++) {
      const lx = aisleX;
      const ly = pyTop + (0.36 + i * 0.38) * h;
      ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
      ctx.beginPath();
      ctx.arc(lx + 2 * u, ly + 3 * u, 3 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.theme.lampColor;
      ctx.beginPath();
      ctx.arc(lx, ly, 2 * u, 0, Math.PI * 2);
      ctx.fill();
      if (this.theme.lampGlow > 0.15) {
        ctx.fillStyle = `rgba(255, 226, 158, ${0.1 * this.theme.lampGlow})`;
        ctx.beginPath();
        ctx.arc(lx, ly, 8 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- 工地

  drawConstruction(plot) {
    const { ctx } = this;
    const { seed, side, px0, px1, pyTop, pyBottom } = plot;
    const { u, laneW } = this;
    const roadSide = side < 0 ? px1 : px0;

    // 围挡
    ctx.strokeStyle = 'rgba(226, 112, 56, 0.85)';
    ctx.lineWidth = Math.max(1.6 * u, 0.045 * laneW);
    ctx.setLineDash([0.18 * laneW, 0.1 * laneW]);
    ctx.strokeRect(px0 + 0.08 * laneW, pyTop + 0.12 * laneW, px1 - px0 - 0.16 * laneW, pyBottom - pyTop - 0.22 * laneW);
    ctx.setLineDash([]);

    // 土堆和材料
    const pileX = side < 0 ? px0 + 0.5 * laneW : px1 - 0.5 * laneW;
    const pileY = pyBottom - 0.32 * laneW;
    ctx.fillStyle = 'rgba(80, 62, 44, 0.22)';
    ctx.beginPath();
    ctx.ellipse(pileX, pileY, 0.3 * laneW, 0.13 * laneW, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.mix('#b08a5a', this.theme.grass, 0.2);
    ctx.beginPath();
    ctx.ellipse(pileX - 4 * u, pileY - 0.03 * laneW, 0.25 * laneW, 0.1 * laneW, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 半成品楼板与柱网
    const bx = (px0 + px1) * 0.5;
    const by = pyTop + (pyBottom - pyTop) * 0.55;
    const bw = Math.min(2.2 * laneW, px1 - px0 - 0.6 * laneW);
    const bd = Math.min(1.6 * laneW, pyBottom - pyTop - 1.4 * laneW);
    ctx.fillStyle = 'rgba(20, 28, 34, 0.14)';
    ctx.fillRect(bx - bw * 0.5 + 3 * u, by - bd * 0.5 + 5 * u, bw, bd);
    ctx.fillStyle = 'rgba(208, 202, 188, 0.9)';
    ctx.fillRect(bx - bw * 0.5, by - bd * 0.5, bw, bd);
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.26)';
    ctx.lineWidth = 1.2 * u;
    ctx.strokeRect(bx - bw * 0.5, by - bd * 0.5, bw, bd);

    const cols = 3;
    const rows = 2;
    const points = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const cxp = lerp(bx - bw * 0.5 + 0.2 * laneW, bx + bw * 0.5 - 0.2 * laneW, i / (cols - 1));
        const cyp = lerp(by - bd * 0.5 + 0.22 * laneW, by + bd * 0.5 - 0.22 * laneW, j / (rows - 1));
        points.push([cxp, cyp]);
        ctx.fillStyle = 'rgba(20, 28, 34, 0.18)';
        ctx.fillRect(cxp - 0.055 * laneW + 2 * u, cyp - 0.055 * laneW + 3 * u, 0.11 * laneW, 0.11 * laneW);
        ctx.fillStyle = '#bdb5a4';
        ctx.fillRect(cxp - 0.055 * laneW, cyp - 0.055 * laneW, 0.11 * laneW, 0.11 * laneW);
        ctx.strokeStyle = 'rgba(30, 36, 48, 0.3)';
        ctx.lineWidth = 1 * u;
        ctx.strokeRect(cxp - 0.055 * laneW, cyp - 0.055 * laneW, 0.11 * laneW, 0.11 * laneW);
        ctx.strokeStyle = 'rgba(190, 120, 78, 0.75)';
        ctx.beginPath();
        ctx.moveTo(cxp, cyp - 0.055 * laneW);
        ctx.lineTo(cxp, cyp - 0.16 * laneW);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.22)';
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    ctx.lineTo(points[2][0], points[2][1]);
    ctx.moveTo(points[3][0], points[3][1]);
    ctx.lineTo(points[5][0], points[5][1]);
    ctx.stroke();

    // 塔吊立在围挡上沿，吊臂朝场地外侧横跨，避开下方楼板
    const mastX = roadSide + (side < 0 ? -0.28 * laneW : 0.28 * laneW);
    const mastY = pyTop + 0.45 * laneW;
    const jibLen = Math.min(1.65 * laneW, px1 - px0 - 0.3 * laneW);
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.25)';
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    ctx.moveTo(mastX + 3 * u, mastY + 4 * u);
    ctx.lineTo(mastX + side * jibLen * 0.8 + 3 * u, mastY + 4 * u);
    ctx.stroke();

    ctx.strokeStyle = '#d8d0bd';
    ctx.lineWidth = Math.max(1.4 * u, 0.03 * laneW);
    ctx.beginPath();
    ctx.moveTo(mastX, mastY);
    ctx.lineTo(mastX + side * jibLen, mastY - 0.06 * laneW);
    ctx.stroke();
    ctx.strokeStyle = '#c86a43';
    ctx.lineWidth = 1.2 * u;
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const jx = lerp(mastX, mastX + side * jibLen, t);
      ctx.beginPath();
      ctx.moveTo(jx, mastY - 0.06 * laneW);
      ctx.lineTo(jx, mastY);
      ctx.stroke();
    }
    ctx.fillStyle = '#8d8678';
    ctx.fillRect(mastX - 0.06 * laneW, mastY - 0.06 * laneW, 0.12 * laneW, 0.12 * laneW);
    ctx.fillStyle = '#9a4f38';
    ctx.fillRect(
      mastX + side * jibLen * 0.92,
      mastY - 0.1 * laneW,
      0.14 * laneW,
      0.12 * laneW
    );
    // 吊钩
    const hookX = mastX + side * jibLen * 0.72;
    ctx.strokeStyle = 'rgba(40, 46, 52, 0.6)';
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    ctx.moveTo(hookX, mastY - 0.06 * laneW);
    ctx.lineTo(hookX, mastY + 0.12 * laneW);
    ctx.stroke();
    ctx.fillStyle = '#5f6468';
    ctx.fillRect(hookX - 3 * u, mastY + 0.12 * laneW, 6 * u, 4 * u);

    // 简易工棚，放在楼板和围挡之间的空档
    const shedX = roadSide + (side < 0 ? -0.28 * laneW : 0.28 * laneW);
    const shedY = pyBottom - 0.3 * laneW;
    this.drawRoofUnit(shedX, shedY, 0.42 * laneW, 0.26 * laneW, 6 * u, '#b9b2a2', seed);
    ctx.fillStyle = this.theme.windowLit;
    ctx.fillRect(shedX - 0.12 * laneW, shedY - 0.06 * laneW, 0.1 * laneW, 0.05 * laneW);

    // 锥桶
    for (let i = 0; i < 3; i++) {
      const cx = roadSide + (side < 0 ? -0.12 : 0.12) * laneW;
      const cy = pyTop + 0.45 * laneW + i * 0.42 * laneW;
      ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
      ctx.beginPath();
      ctx.ellipse(cx + 1 * u, cy + 2 * u, 4 * u, 1.6 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8763c';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5 * u);
      ctx.lineTo(cx + 4 * u, cy + 2 * u);
      ctx.lineTo(cx - 4 * u, cy + 2 * u);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- 小物件

  drawYardTree(px, py, r, seed) {
    const { ctx } = this;
    const { u } = this;
    if (!Number.isFinite(px) || !Number.isFinite(py) || r <= 0) return;
    const tint = (c) => shade(c, (hash2(seed, 1401) - 0.5) * 0.06);
    ctx.fillStyle = 'rgba(20, 28, 34, 0.16)';
    ctx.beginPath();
    ctx.ellipse(px + 2 * u, py + 3 * u, r * 1.05, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = tint(this.theme.tree.dark);
    ctx.beginPath();
    ctx.arc(px - r * 0.22, py - r * 0.12, r * 0.82, 0, Math.PI * 2);
    ctx.arc(px + r * 0.42, py - r * 0.06, r * 0.66, 0, Math.PI * 2);
    ctx.arc(px + r * 0.06, py - r * 0.46, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tint(this.theme.tree.mid);
    ctx.beginPath();
    ctx.arc(px - r * 0.3, py - r * 0.36, r * 0.42, 0, Math.PI * 2);
    ctx.arc(px + r * 0.2, py - r * 0.3, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(px - r * 0.34, py - r * 0.48, r * 0.2, 0, Math.PI * 2);
    ctx.fill();

    if (hash2(seed, 1411) > 0.72) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = this.theme.tree.fruit[i % this.theme.tree.fruit.length];
        ctx.beginPath();
        ctx.arc(
          px + Math.sin(i * 2.2 + seed) * r * 0.55,
          py + Math.cos(i * 1.8 + seed) * r * 0.4,
          Math.max(1 * u, r * 0.07),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }
  }

  drawParkedCar(px, py, angle, color, scale = 1) {
    const { ctx } = this;
    const { u, laneW } = this;
    const w = 0.3 * laneW * scale;
    const l = 0.58 * laneW * scale;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(18, 26, 32, 0.18)';
    this.rr(-w * 0.5 + 1.5 * u, -l * 0.5 + 2 * u, w, l, w * 0.3);
    ctx.fill();
    ctx.fillStyle = color;
    this.rr(-w * 0.5, -l * 0.5, w, l, w * 0.28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 36, 48, 0.3)';
    ctx.lineWidth = 1 * u;
    ctx.stroke();
    ctx.fillStyle = 'rgba(42, 60, 72, 0.5)';
    this.rr(-w * 0.34, -l * 0.25, w * 0.68, l * 0.16, 1 * u);
    ctx.fill();
    this.rr(-w * 0.34, l * 0.1, w * 0.68, l * 0.14, 1 * u);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    this.rr(-w * 0.28, -l * 0.05, w * 0.56, l * 0.12, 1 * u);
    ctx.fill();
    ctx.restore();
  }
}
