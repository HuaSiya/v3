// 所有玩法数值集中在这里，改完刷新即可；调试面板会读写同一份对象。
// URL 参数可以覆盖任意数值，例如 ?bulletTimeScale=0.08&scoreSedan=12

export const DEFAULTS = {
  // 时间 / 子弹时间
  bulletTimeDuration: 2.0, // 子弹时间时长（秒）
  bulletTimeScale: 0.2, // 子弹时间世界流速，20%
  deathSlowScale: 0.25, // 死亡慢放流速，25%
  hijackFlipTime: 0.28, // 抢到迎面车后的 180° 甩尾时长（秒）

  // 飞扑（世界单位：1 = 一条车道宽）
  diveTime: 0.34, // 飞行时间
  diveForwardImpulse: 4.6, // 向前冲量
  diveLateralImpulse: 3.7, // 横向冲量
  diveHitRadius: 0.26, // 碰撞半径
  escapeProtection: 0.5, // 抢到迎面车后的碰撞保护窗口（秒）

  // 车辆巡航速度（车道宽 / 秒）
  sedanSpeed: 6.0, // 轿车速度
  sportsSpeed: 7.0, // 跑车速度
  truckSpeed: 5.0, // 卡车速度
  busSpeed: 4.0, // 巴士速度
  aiSpeedVariance: 0.30, // AI车速浮动

  // 分数
  scoreSedan: 10, // 轿车分/秒
  scoreSports: 15, // 跑车分/秒
  scoreTruck: 8, // 卡车分/秒
  scoreBus: 6, // 巴士分/秒
  wrongWayMultiplier: 2, // 逆行分数倍率
  hijackBonus: 50, // 抢车基础分
  comboWindow: 2, // 连击窗口（秒）
  comboStep: 50, // 连击递增分数

  // 耐久 / 爆炸（秒）
  durabilitySedan: 6, // 轿车耐久
  durabilitySports: 5, // 跑车耐久
  durabilityTruck: 7, // 卡车耐久
  durabilityBus: 8, // 巴士耐久
  durabilityWarnTime: 2, // 爆炸预警
  collisionDurabilityPenalty: 2, // 碰撞扣耐久
  firstCarDurability: 8, // 首辆车耐久

  // 同向碰撞
  bumpSlowFactor: 0.65, // 追尾减速
  bumpSlowTime: 0.5, // 减速持续时间（秒）
  bumpShoveFactor: 1.15, // 被追尾推离距离
  bumpCooldown: 0.4, // 碰撞反馈时间

  // AI 跟车与拥堵控制
  aiFollowGap: 0.75, // AI 跟车时保险杠之间的最小距离（车道宽）
  laneCarCap: 5, // 单条车道在屏幕附近的最大 AI 车数
  laneCongestionSpeedFactor: 0.6, // 车道均速低于玩家巡航的该比例时暂停生成
  playerLaneCushion: 2, // 玩家周围多少条车道内不再生成“后方快车”
  playerLaneSpeedFactor: 0.85, // 玩家同车道新生车辆的速度上限（相对玩家巡航）
  behindSpawnSpeedGap: 0.4, // 只有比玩家快至少这么多才允许从后方生成

  // 车流与难度
  trafficBaseInterval: 2.2, // 每条车道 spawn 间隔（难度不再缩短）
  speedRampPerSecond: 0.04, // 每秒为新车增加的车速（车道宽/秒）
  speedRampMax: 0, // 速度提升上限，0 = 不限制
  laneShrinkAt1: 30, // 首次收窄：双向八车道 → 六车道（秒）
  laneShrinkAt2: 60, // 二次收窄：六车道 → 四车道（秒）
  laneShrinkTime: 2.6, // 单次收窄的过渡时长（秒）
  sceneBlendTime: 3.2, // 场景主题过渡时长（秒）
  spawnGap: 1.2, // 同车道最小车距（车身边缘）
  spawnAheadExtra: 3.0, // 出生点在屏幕外多远
  spawnBehindExtra: 3.0, // 
  opportunityInterval: 2.5, // 可抢机会检查
  opportunityRadiusX: 2.4, // 
  opportunityRadiusY: 7, //
  opportunityMinCars: 2, // 

  // 操控
  maxLateralSpeed: 2.8, // 最大横移速度
  lateralAccel: 16, // 横移加速度
  lateralDecel: 22, // 横移松开减速

  // 镜头与辅助
  playerScreenY: 0.74, // 玩家车辆在屏幕上的纵向位置（0~1）
  assistLevel: 0, // 0 无 / 1 高亮可抢车 / 2 轨迹与落点预览
  showFps: 0, // 显示FPS
  screenShake: 1, // 屏幕震动开关
  autoStart: 0, // URL 调试用
};

export const TUNABLE_GROUPS = [
  {
    title: '时间与子弹时间',
    items: [
      { key: 'bulletTimeDuration', label: '子弹时间时长', min: 1, max: 8, step: 0.1, unit: 's' },
      { key: 'bulletTimeScale', label: '子弹时间流速', min: 0.02, max: 0.6, step: 0.01 },
      { key: 'hijackFlipTime', label: '夺车甩尾时长', min: 0.1, max: 0.8, step: 0.01, unit: 's' },
      { key: 'deathSlowScale', label: '死亡慢放流速', min: 0.05, max: 1, step: 0.01 },
    ],
  },
  {
    title: '飞扑',
    items: [
      { key: 'diveTime', label: '飞行时间', min: 0.15, max: 0.8, step: 0.01, unit: 's' },
      { key: 'diveForwardImpulse', label: '向前冲量', min: 1, max: 10, step: 0.1 },
      { key: 'diveLateralImpulse', label: '横向冲量', min: 1, max: 10, step: 0.1 },
      { key: 'diveHitRadius', label: '碰撞半径', min: 0.1, max: 0.6, step: 0.01 },
      { key: 'escapeProtection', label: '夺车保护窗口', min: 0, max: 4, step: 0.1, unit: 's' },
    ],
  },
  {
    title: '车辆速度',
    items: [
      { key: 'sedanSpeed', label: '轿车速度', min: 1, max: 10, step: 0.1 },
      { key: 'sportsSpeed', label: '跑车速度', min: 1, max: 12, step: 0.1 },
      { key: 'truckSpeed', label: '卡车速度', min: 1, max: 10, step: 0.1 },
      { key: 'busSpeed', label: '巴士速度', min: 1, max: 10, step: 0.1 },
      { key: 'aiSpeedVariance', label: 'AI 车速浮动', min: 0, max: 0.3, step: 0.01 },
    ],
  },
  {
    title: '分数',
    items: [
      { key: 'scoreSedan', label: '轿车 分/秒', min: 1, max: 40, step: 1 },
      { key: 'scoreSports', label: '跑车 分/秒', min: 1, max: 60, step: 1 },
      { key: 'scoreTruck', label: '卡车 分/秒', min: 1, max: 40, step: 1 },
      { key: 'scoreBus', label: '巴士 分/秒', min: 1, max: 40, step: 1 },
      { key: 'wrongWayMultiplier', label: '逆行倍率', min: 1, max: 5, step: 0.5 },
      { key: 'hijackBonus', label: '抢车基础分', min: 0, max: 500, step: 10 },
      { key: 'comboWindow', label: '连击窗口', min: 2, max: 15, step: 0.5, unit: 's' },
      { key: 'comboStep', label: '连击递增', min: 0, max: 200, step: 10 },
    ],
  },
  {
    title: '耐久与爆炸',
    items: [
      { key: 'durabilitySedan', label: '轿车耐久', min: 4, max: 40, step: 1, unit: 's' },
      { key: 'durabilitySports', label: '跑车耐久', min: 3, max: 40, step: 1, unit: 's' },
      { key: 'durabilityTruck', label: '卡车耐久', min: 4, max: 50, step: 1, unit: 's' },
      { key: 'durabilityBus', label: '巴士耐久', min: 4, max: 50, step: 1, unit: 's' },
      { key: 'durabilityWarnTime', label: '爆炸预警', min: 1, max: 8, step: 0.5, unit: 's' },
      { key: 'collisionDurabilityPenalty', label: '碰撞扣耐久', min: 0, max: 6, step: 0.5, unit: 's' },
      { key: 'firstCarDurability', label: '首辆车耐久', min: 4, max: 20, step: 1, unit: 's' },
    ],
  },
  {
    title: '同向碰撞',
    items: [
      { key: 'bumpSlowFactor', label: '追尾减速', min: 0.2, max: 1, step: 0.05 },
      { key: 'bumpSlowTime', label: '减速持续', min: 0.1, max: 2, step: 0.05, unit: 's' },
      { key: 'bumpShoveFactor', label: '被追尾推离', min: 1, max: 2, step: 0.05 },
      { key: 'bumpCooldown', label: '碰撞反馈间隔', min: 0.1, max: 1.5, step: 0.05, unit: 's' },
    ],
  },
  {
    title: '车流与难度',
    items: [
      { key: 'aiFollowGap', label: 'AI 跟车间距', min: 0.1, max: 2, step: 0.05 },
      { key: 'laneCarCap', label: '同车道车数上限', min: 2, max: 10, step: 1 },
      { key: 'laneCongestionSpeedFactor', label: '拥堵暂停生成', min: 0.2, max: 1, step: 0.05 },
      { key: 'playerLaneCushion', label: '玩家车道缓冲', min: 0, max: 4, step: 0.5, unit: '车道' },
      { key: 'playerLaneSpeedFactor', label: '同车道车速上限', min: 0.4, max: 1.2, step: 0.05 },
      { key: 'behindSpawnSpeedGap', label: '后车超速阈值', min: 0, max: 2, step: 0.05 },
      { key: 'trafficBaseInterval', label: '每车道 spawn 间隔', min: 0.4, max: 5, step: 0.1, unit: 's' },
      { key: 'speedRampPerSecond', label: '新车每秒提速', min: 0, max: 0.2, step: 0.005, unit: '/s' },
      { key: 'speedRampMax', label: '提速上限(0不限)', min: 0, max: 12, step: 0.5 },
      { key: 'laneShrinkAt1', label: '首次收窄 8→6', min: 5, max: 180, step: 1, unit: 's' },
      { key: 'laneShrinkAt2', label: '二次收窄 6→4', min: 10, max: 300, step: 1, unit: 's' },
      { key: 'laneShrinkTime', label: '收窄过渡时长', min: 0.5, max: 10, step: 0.1, unit: 's' },
      { key: 'sceneBlendTime', label: '场景过渡时长', min: 0.5, max: 10, step: 0.1, unit: 's' },
      { key: 'spawnGap', label: '同车道最小车距', min: 0.3, max: 4, step: 0.1 },
      { key: 'opportunityInterval', label: '可抢机会检查', min: 0.5, max: 8, step: 0.1, unit: 's' },
      { key: 'opportunityMinCars', label: '附近最少车辆', min: 0, max: 6, step: 1 },
    ],
  },
  {
    title: '操控与辅助',
    items: [
      { key: 'maxLateralSpeed', label: '最大横移速度', min: 0.5, max: 6, step: 0.1 },
      { key: 'lateralAccel', label: '横移加速度', min: 4, max: 40, step: 1 },
      { key: 'lateralDecel', label: '松开减速', min: 4, max: 50, step: 1 },
      { key: 'assistLevel', label: '飞扑辅助 0/1/2', min: 0, max: 2, step: 1 },
      { key: 'screenShake', label: '画面震动', min: 0, max: 2, step: 0.1 },
      { key: 'showFps', label: '显示 FPS', min: 0, max: 1, step: 1 },
    ],
  },
];

const STORAGE_CONFIG = 'qiangche.config.v1';
const STORAGE_BEST = 'qiangche.best.v1';
const STORAGE_TUTORIAL = 'qiangche.tutorialDone.v1';
const STORAGE_MUTE = 'qiangche.muted.v1';
const STORAGE_CONTROL = 'qiangche.controlMode.v1';

function readStoredOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readUrlOverrides() {
  const out = {};
  try {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of params) {
      if (!(key in DEFAULTS)) continue;
      const num = Number(value);
      if (Number.isFinite(num)) out[key] = num;
    }
  } catch {
    /* ignore */
  }
  return out;
}

export const config = {
  ...DEFAULTS,
  ...readStoredOverrides(),
  ...readUrlOverrides(),
};

export function saveOverrides() {
  try {
    const diff = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (config[key] !== DEFAULTS[key]) diff[key] = config[key];
    }
    localStorage.setItem(STORAGE_CONFIG, JSON.stringify(diff));
  } catch {
    /* ignore */
  }
}

export function clearOverrides() {
  try {
    localStorage.removeItem(STORAGE_CONFIG);
  } catch {
    /* ignore */
  }
}

export function getBestScore() {
  try {
    const n = Number(localStorage.getItem(STORAGE_BEST) || 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function setBestScore(score) {
  try {
    localStorage.setItem(STORAGE_BEST, String(Math.max(0, Math.floor(score))));
  } catch {
    /* ignore */
  }
}

export function getTutorialDone() {
  try {
    return localStorage.getItem(STORAGE_TUTORIAL) === '1';
  } catch {
    return false;
  }
}

export function setTutorialDone(done) {
  try {
    localStorage.setItem(STORAGE_TUTORIAL, done ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getMuted() {
  try {
    return localStorage.getItem(STORAGE_MUTE) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted) {
  try {
    localStorage.setItem(STORAGE_MUTE, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getControlMode() {
  try {
    return localStorage.getItem(STORAGE_CONTROL) === 'gesture'
      ? 'gesture'
      : 'buttons';
  } catch {
    return 'buttons';
  }
}

export function setControlMode(mode) {
  try {
    localStorage.setItem(
      STORAGE_CONTROL,
      mode === 'gesture' ? 'gesture' : 'buttons'
    );
  } catch {
    /* ignore */
  }
}

export const flags = (() => {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    params = new URLSearchParams('');
  }
  return {
    autostart: params.has('autostart') && params.get('autostart') !== '0',
    debug: params.has('debug') && params.get('debug') !== '0',
    touch: params.has('touch') && params.get('touch') !== '0',
    seed: params.has('seed') ? Number(params.get('seed')) : null,
  };
})();
