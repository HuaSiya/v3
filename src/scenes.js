import { clamp } from './math.js';

// 三套场景：晴日 → 黄昏 → 霓虹夜城。车道每收窄一次，场景跟着切换。
export const SCENES = [
  {
    name: '晴日街区',
    ground: '#c9d6cf',
    grass: '#b5c9ad',
    path: 'rgba(226, 220, 203, 0.72)',
    sidewalk: '#ded9cc',
    sidewalkJoint: 'rgba(30, 36, 48, 0.10)',
    sidewalkEdge: 'rgba(30, 36, 48, 0.13)',
    buildings: [
      '#f2b880',
      '#e98a78',
      '#8fc7c4',
      '#f2d06b',
      '#b6a7d8',
      '#a8c98a',
      '#f0a6b5',
      '#9db8d9',
    ],
    shopAccents: ['#e05c4b', '#3f8f7a', '#4a78b8', '#d99b3f'],
    roofShade: -0.24,
    windowDark: 'rgba(52, 78, 90, 0.72)',
    windowGlass: 'rgba(150, 205, 220, 0.5)',
    windowLit: 'rgba(255, 226, 140, 0.78)',
    litChance: 0.2,
    storefront: 'rgba(44, 66, 76, 0.7)',
    road: '#efe8da',
    roadCool: 'rgba(94, 145, 180, 0.10)',
    roadWarm: 'rgba(232, 133, 62, 0.07)',
    laneLine: 'rgba(255, 255, 255, 0.82)',
    centerLine: '#e0b23c',
    edgeLine: 'rgba(255, 255, 255, 0.9)',
    arrowCool: 'rgba(74, 132, 168, 0.38)',
    arrowWarm: 'rgba(214, 124, 54, 0.38)',
    tree: {
      dark: '#4b9663',
      mid: '#5fae76',
      light: '#7dca8f',
      trunk: '#8b6b4a',
      fruit: ['#e05c4b', '#f09b3f', '#f2d06b'],
    },
    lampPole: '#70757a',
    lampColor: 'rgba(255, 232, 180, 0.9)',
    lampGlow: 0.04,
    ambient: 'rgba(0, 0, 0, 0)',
  },
  {
    name: '黄昏街区',
    ground: '#cdb7a5',
    grass: '#b3a468',
    path: 'rgba(238, 211, 174, 0.72)',
    sidewalk: '#e2c9b2',
    sidewalkJoint: 'rgba(70, 45, 40, 0.12)',
    sidewalkEdge: 'rgba(70, 45, 40, 0.16)',
    buildings: [
      '#e7a268',
      '#d97a66',
      '#c28f9a',
      '#e5c36f',
      '#a986a8',
      '#c9a06a',
      '#e2a084',
      '#a88b90',
    ],
    shopAccents: ['#d94f45', '#b56a2d', '#5a6fa8', '#8a5a9e'],
    roofShade: -0.3,
    windowDark: 'rgba(62, 50, 66, 0.72)',
    windowGlass: 'rgba(255, 190, 140, 0.42)',
    windowLit: 'rgba(255, 201, 112, 0.86)',
    litChance: 0.4,
    storefront: 'rgba(58, 46, 52, 0.72)',
    road: '#e6d2bf',
    roadCool: 'rgba(120, 92, 134, 0.12)',
    roadWarm: 'rgba(238, 128, 62, 0.12)',
    laneLine: 'rgba(255, 244, 224, 0.85)',
    centerLine: '#e8a94a',
    edgeLine: 'rgba(255, 244, 224, 0.9)',
    arrowCool: 'rgba(125, 100, 155, 0.42)',
    arrowWarm: 'rgba(218, 112, 55, 0.45)',
    tree: {
      dark: '#8a5f35',
      mid: '#b57a3e',
      light: '#d7a052',
      trunk: '#6f4d35',
      fruit: ['#d94f45', '#f0a23f', '#ffd36b'],
    },
    lampPole: '#5d4b47',
    lampColor: 'rgba(255, 209, 128, 1)',
    lampGlow: 0.55,
    ambient: 'rgba(255, 118, 48, 0.06)',
  },
  {
    name: '霓虹夜城',
    ground: '#2b3644',
    grass: '#2e473f',
    path: 'rgba(92, 108, 124, 0.5)',
    sidewalk: '#3b4656',
    sidewalkJoint: 'rgba(10, 16, 24, 0.28)',
    sidewalkEdge: 'rgba(10, 16, 24, 0.35)',
    buildings: [
      '#565f78',
      '#6a5876',
      '#4d6870',
      '#786552',
      '#5a5682',
      '#4f6477',
      '#77555f',
      '#556d60',
    ],
    shopAccents: ['#ff4f9a', '#3fd6ff', '#ffd23f', '#7dffb2'],
    roofShade: -0.34,
    windowDark: 'rgba(18, 26, 38, 0.88)',
    windowGlass: 'rgba(96, 150, 180, 0.32)',
    windowLit: 'rgba(255, 214, 120, 0.95)',
    litChance: 0.62,
    storefront: 'rgba(16, 24, 36, 0.8)',
    road: '#39424f',
    roadCool: 'rgba(64, 116, 170, 0.18)',
    roadWarm: 'rgba(210, 112, 50, 0.12)',
    laneLine: 'rgba(220, 235, 255, 0.72)',
    centerLine: '#d8a83a',
    edgeLine: 'rgba(225, 238, 255, 0.8)',
    arrowCool: 'rgba(92, 155, 210, 0.5)',
    arrowWarm: 'rgba(228, 138, 72, 0.5)',
    tree: {
      dark: '#2c5b45',
      mid: '#3b7256',
      light: '#4f8a68',
      trunk: '#4f3f31',
      fruit: ['#ff6f9c', '#ffd23f', '#7dffb2'],
    },
    lampPole: '#2c3642',
    lampColor: 'rgba(255, 220, 150, 1)',
    lampGlow: 1,
    ambient: 'rgba(8, 16, 42, 0.24)',
  },
];

function parseColor(input) {
  if (input.startsWith('#')) {
    const clean = input.replace('#', '');
    const n = parseInt(clean, 16);
    return [((n >> 16) & 255), ((n >> 8) & 255), (n & 255), 1];
  }
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) return [200, 200, 200, 1];
  const parts = m[1].split(',').map(Number);
  return [
    parts[0] || 0,
    parts[1] || 0,
    parts[2] || 0,
    parts.length > 3 ? parts[3] : 1,
  ];
}

// 明暗微调：兼容 #rrggbb 与 rgba(...)，城市和车辆共用。
export function shadeColor(input, amount) {
  const [r0, g0, b0] = parseColor(input);
  const r = clamp(Math.round(r0 + 255 * amount), 0, 255);
  const g = clamp(Math.round(g0 + 255 * amount), 0, 255);
  const b = clamp(Math.round(b0 + 255 * amount), 0, 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function mixColor(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const mix = (x, y) => Math.round(x + (y - x) * t);
  return `rgba(${mix(ca[0], cb[0])}, ${mix(ca[1], cb[1])}, ${mix(
    ca[2],
    cb[2]
  )}, ${clamp(ca[3] + (cb[3] - ca[3]) * t, 0, 1).toFixed(3)})`;
}

const mixArray = (a, b, t) => a.map((c, i) => mixColor(c, b[i], t));

function mixTree(a, b, t) {
  return {
    dark: mixColor(a.dark, b.dark, t),
    mid: mixColor(a.mid, b.mid, t),
    light: mixColor(a.light, b.light, t),
    trunk: mixColor(a.trunk, b.trunk, t),
    fruit: mixArray(a.fruit, b.fruit, t),
  };
}

export function mixTheme(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    name: t < 0.5 ? a.name : b.name,
    ground: mixColor(a.ground, b.ground, t),
    grass: mixColor(a.grass, b.grass, t),
    path: mixColor(a.path, b.path, t),
    sidewalk: mixColor(a.sidewalk, b.sidewalk, t),
    sidewalkJoint: mixColor(a.sidewalkJoint, b.sidewalkJoint, t),
    sidewalkEdge: mixColor(a.sidewalkEdge, b.sidewalkEdge, t),
    buildings: mixArray(a.buildings, b.buildings, t),
    shopAccents: mixArray(a.shopAccents, b.shopAccents, t),
    roofShade: a.roofShade + (b.roofShade - a.roofShade) * t,
    windowDark: mixColor(a.windowDark, b.windowDark, t),
    windowGlass: mixColor(a.windowGlass, b.windowGlass, t),
    windowLit: mixColor(a.windowLit, b.windowLit, t),
    litChance: a.litChance + (b.litChance - a.litChance) * t,
    storefront: mixColor(a.storefront, b.storefront, t),
    road: mixColor(a.road, b.road, t),
    roadCool: mixColor(a.roadCool, b.roadCool, t),
    roadWarm: mixColor(a.roadWarm, b.roadWarm, t),
    laneLine: mixColor(a.laneLine, b.laneLine, t),
    centerLine: mixColor(a.centerLine, b.centerLine, t),
    edgeLine: mixColor(a.edgeLine, b.edgeLine, t),
    arrowCool: mixColor(a.arrowCool, b.arrowCool, t),
    arrowWarm: mixColor(a.arrowWarm, b.arrowWarm, t),
    tree: mixTree(a.tree, b.tree, t),
    lampPole: mixColor(a.lampPole, b.lampPole, t),
    lampColor: mixColor(a.lampColor, b.lampColor, t),
    lampGlow: a.lampGlow + (b.lampGlow - a.lampGlow) * t,
    ambient: mixColor(a.ambient, b.ambient, t),
  };
}
