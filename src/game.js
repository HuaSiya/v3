import {
  config,
  flags,
  getBestScore,
  setBestScore,
  getTutorialDone,
  setTutorialDone,
} from './config.js';
import { SCENES } from './scenes.js';
import {
  CONTRACTS,
  contractTarget,
  contractReward,
} from './contracts.js';
import {
  clamp,
  lerp,
  damp,
  approach,
  mulberry32,
  aabbOverlap,
  circleRectOverlap,
  easeInOutCubic,
} from './math.js';

export const ROAD_MIN = 0;
export const ROAD_MAX = 8;
export const CENTER_X = 4;
export const LANE_COUNT = 8;
export const LANE_SPLIT = 4;
export const LANE_CENTERS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];

const laneDir = (lane) => (lane < LANE_SPLIT ? -1 : 1);

const TYPE_SPEED_KEY = {
  sedan: 'sedanSpeed',
  sports: 'sportsSpeed',
  truck: 'truckSpeed',
  bus: 'busSpeed',
};
const TYPE_SCORE_KEY = {
  sedan: 'scoreSedan',
  sports: 'scoreSports',
  truck: 'scoreTruck',
  bus: 'scoreBus',
};
const TYPE_DUR_KEY = {
  sedan: 'durabilitySedan',
  sports: 'durabilitySports',
  truck: 'durabilityTruck',
  bus: 'durabilityBus',
};
const TYPE_NAME = { sedan: '轿车', sports: '跑车', truck: '卡车', bus: '巴士' };
const TYPE_SIZE = {
  // w 只是配置缺失时的兜底；实际车宽读取 config.widthXxx。
  // 车道宽为 1，车身只占 0.60~0.80，给擦身而过留出侧向余量。
  sedan: { w: 0.68, l: 1.42 },
  sports: { w: 0.60, l: 1.32 },
  truck: { w: 0.76, l: 1.98 },
  bus: { w: 0.80, l: 2.55 },
};
const TYPE_WIDTH_KEY = {
  sedan: 'widthSedan',
  sports: 'widthSports',
  truck: 'widthTruck',
  bus: 'widthBus',
};
const TYPE_LATERAL_KEY = {
  sedan: {
    speed: 'lateralSpeedSedan',
    accel: 'lateralAccelSedan',
    decel: 'lateralDecelSedan',
  },
  sports: {
    speed: 'lateralSpeedSports',
    accel: 'lateralAccelSports',
    decel: 'lateralDecelSports',
  },
  truck: {
    speed: 'lateralSpeedTruck',
    accel: 'lateralAccelTruck',
    decel: 'lateralDecelTruck',
  },
  bus: {
    speed: 'lateralSpeedBus',
    accel: 'lateralAccelBus',
    decel: 'lateralDecelBus',
  },
};
const DEFAULT_LATERAL = { speed: 2.8, accel: 16, decel: 22 };
const TYPE_WEIGHTS = [
  ['sedan', 0.42],
  ['truck', 0.26],
  ['sports', 0.18],
  ['bus', 0.14],
];
// 同向车道少放慢车：慢车容易当“领头车”把后面压成一整排。
const SAME_DIR_WEIGHTS = [
  ['sedan', 0.52],
  ['sports', 0.24],
  ['truck', 0.16],
  ['bus', 0.08],
];
const PALETTES = {
  sedan: ['#5f8fd9', '#e97c5b', '#8ac6a2', '#d9c25f', '#a78fd9', '#e4e4de', '#7d8aa0'],
  sports: ['#ff5d5d', '#ffb020', '#33c4a6', '#5e7cff', '#ff7ac8', '#f4f4f0'],
  truck: ['#4f7fb8', '#c9744d', '#6f9e6f', '#b7b2a4', '#8d6e63'],
  bus: ['#f2c14e', '#4fa3d1', '#e26969', '#7aae7a', '#b18fd4'],
};

const typeSpeed = (type) => config[TYPE_SPEED_KEY[type]];
const typeScore = (type) => config[TYPE_SCORE_KEY[type]];
const typeDurability = (type) => config[TYPE_DUR_KEY[type]];
const typeName = (type) => TYPE_NAME[type];
const typeW = (type) => {
  const value = Number(config[TYPE_WIDTH_KEY[type]]);
  return Number.isFinite(value)
    ? clamp(value, 0.4, 0.95)
    : TYPE_SIZE[type].w;
};
const typeL = (type) => TYPE_SIZE[type].l;

export function typeLateralStats(type) {
  const keys = TYPE_LATERAL_KEY[type] || TYPE_LATERAL_KEY.sedan;
  const speed = Number(config[keys.speed]);
  const accel = Number(config[keys.accel]);
  const decel = Number(config[keys.decel]);
  return {
    speed: Number.isFinite(speed)
      ? Math.max(0.1, speed)
      : DEFAULT_LATERAL.speed,
    accel: Number.isFinite(accel)
      ? Math.max(0.1, accel)
      : DEFAULT_LATERAL.accel,
    decel: Number.isFinite(decel)
      ? Math.max(0.1, decel)
      : DEFAULT_LATERAL.decel,
  };
}

const formatTraitValue = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
};

export function typePassiveText(type) {
  switch (type) {
    case 'sedan':
      return config.sedanComboBonus > 0
        ? `连击窗口 +${formatTraitValue(config.sedanComboBonus)}s`
        : '';
    case 'sports':
      return config.sportsWrongWayBonus > 0
        ? `逆行倍率 +${formatTraitValue(config.sportsWrongWayBonus)}×`
        : '';
    case 'truck':
      if (config.truckBumpPenaltyImmune > 0) {
        return '同向碰撞不扣耐久，顶开前车';
      }
      return config.truckBumpShoveExtra > 0 ? '同向碰撞顶开前车' : '';
    case 'bus':
      return config.busBulletTimeBonus > 0
        ? `子弹时间 +${formatTraitValue(config.busBulletTimeBonus)}s`
        : '';
    default:
      return '';
  }
}

export function typePassiveShort(type) {
  switch (type) {
    case 'sedan':
      return config.sedanComboBonus > 0
        ? `连击+${formatTraitValue(config.sedanComboBonus)}s`
        : '';
    case 'sports':
      return config.sportsWrongWayBonus > 0
        ? `逆行+${formatTraitValue(config.sportsWrongWayBonus)}×`
        : '';
    case 'truck':
      if (config.truckBumpPenaltyImmune > 0) return '碰撞免伤';
      return config.truckBumpShoveExtra > 0 ? '顶开前车' : '';
    case 'bus':
      return config.busBulletTimeBonus > 0
        ? `弹时+${formatTraitValue(config.busBulletTimeBonus)}s`
        : '';
    default:
      return '';
  }
}

let carIdCounter = 0;

function pickWeightedType(rng, weights) {
  let r = rng();
  for (const [type, weight] of weights) {
    r -= weight;
    if (r <= 0) return type;
  }
  return 'sedan';
}

function pickType(rng) {
  return pickWeightedType(rng, TYPE_WEIGHTS);
}

function pickSpawnType(rng, lane) {
  return pickWeightedType(
    rng,
    lane < LANE_SPLIT ? TYPE_WEIGHTS : SAME_DIR_WEIGHTS
  );
}

function pickColor(type, rng) {
  const palette = PALETTES[type] || PALETTES.sedan;
  return palette[Math.floor(rng() * palette.length) % palette.length];
}

function makeCar(type, lane, y, dir, opts = {}) {
  const baseSpeed = opts.speed ?? typeSpeed(type);
  const speed = opts.speed ?? baseSpeed;
  const durability = opts.durability ?? typeDurability(type);
  return {
    id: ++carIdCounter,
    type,
    lane,
    x: opts.x ?? lane + 0.5,
    y,
    dir,
    w: typeW(type),
    l: typeL(type),
    speed,
    baseSpeed,
    cruiseSpeed: opts.cruiseSpeed ?? baseSpeed,
    vx: 0,
    speedEffective: speed,
    color: opts.color ?? pickColor(type, opts.rng ?? Math.random),
    isPlayer: !!opts.isPlayer,
    displayName: opts.displayName ?? typeName(type),
    ghost: false,
    ghostTime: 0,
    ghostAlpha: 1,
    destroyed: false,
    durability,
    durabilityMax: opts.durabilityMax ?? durability,
    bumpFxCooldown: 0,
    bumpSlowTimer: 0,
    bumpBoostTimer: 0,
    bumpBoostSpeed: 0,
    flip: null,
    renderRot: dir === 1 ? 0 : Math.PI,
    nearMissRelY: null,
    nearMissHandled: false,
  };
}

export class Game {
  constructor(audio) {
    this.audio = audio;
    this.layout = {
      W: 1280,
      H: 720,
      laneW: 70,
      topWorld: 7.5,
      bottomWorld: 2.6,
    };
    this.mode = 'title'; // title | playing | gameover
    this.paused = false;
    this.realTime = 0;
    this.timeScale = 1;
    this.state = 'driving'; // driving | roof | diving | hijack | dead
    this.wrongWayHeat = 0;
    this.wrongWayGrace = 0;
    this.lastWrongWayTier = 0;
    this.nearMissPlayerCar = null;
    this.nearMissCount = 0;
    this.oncomingHijackCount = 0;
    this.wrongWayTime = 0;
    this.sameCarTime = 0;
    this.contract = null;
    this.contractsCompleted = 0;
    this.contractTypes = new Set();
    this.contractFlash = 0;
    this.contractFlashText = '';
    this.bestScore = getBestScore();
    this.tutorialDone = getTutorialDone();
    this.acc = 0;
    this.fps = 60;
    this.deathReason = null;
    this.finalScore = 0;
    this.newBest = false;
    this.runSerial = 0;

    this.resetTitleDemo();
    if (flags.autostart) this.startRun();
  }

  setLayout(layout) {
    this.layout = layout;
  }

  // ---------------------------------------------------------------- 标题演示

  resetTitleDemo() {
    this.mode = 'title';
    this.paused = false;
    this.demoCameraY = 0;
    this.demoCars = [];
    this.demoSpawnTimer = 0;
    this.demoRng = mulberry32(424242);
    this.acc = 0;
    this.laneMin = 0;
    this.laneMax = 8;
    this.laneMinTarget = 0;
    this.laneMaxTarget = 8;
    this.laneStage = 0;
    this.laneShrink = null;
    this.speedRamp = 0;
    this.sceneFrom = 0;
    this.sceneTo = 0;
    this.sceneMix = 1;
    this.laneNoticeTimer = 0;
    this.laneNoticeText = '';
    this.laneNoticeSub = '';

    for (let i = 0; i < 18; i++) {
      const lane = Math.floor(this.demoRng() * LANE_COUNT);
      const type = pickType(this.demoRng);
      const dir = laneDir(lane);
      const speed =
        dir === 1 ? 1.3 + this.demoRng() * 1.5 : 2.8 + this.demoRng() * 2.2;
      const y = 1 + this.demoRng() * 14;
      this.demoCars.push(
        makeCar(type, lane, y, dir, { speed, rng: this.demoRng })
      );
    }
  }

  updateTitle(dt) {
    this.demoCameraY += 2.35 * dt;
    for (const car of this.demoCars) {
      car.y += car.dir * car.speed * dt;
    }

    this.demoSpawnTimer -= dt;
    if (this.demoSpawnTimer <= 0) {
      this.demoSpawnTimer = 0.32 + this.demoRng() * 0.42;
      const lane = Math.floor(this.demoRng() * LANE_COUNT);
      const type = pickType(this.demoRng);
      const dir = laneDir(lane);
      const speed =
        dir === 1 ? 1.3 + this.demoRng() * 1.5 : 2.8 + this.demoRng() * 2.2;
      const y =
        this.demoCameraY + this.layout.topWorld + 1 + this.demoRng() * 2.4;
      const len = typeL(type);
      let clear = true;
      for (const car of this.demoCars) {
        if (car.lane !== lane) continue;
        if (Math.abs(car.y - y) < (car.l + len) * 0.5 + 1) {
          clear = false;
          break;
        }
      }
      if (clear) {
        this.demoCars.push(
          makeCar(type, lane, y, dir, { speed, rng: this.demoRng })
        );
      }
    }

    this.demoCars = this.demoCars.filter(
      (car) =>
        car.y > this.demoCameraY - 9 && car.y < this.demoCameraY + 22
    );
  }

  // ---------------------------------------------------------------- 开局 / 重置

  startRun() {
    this.mode = 'playing';
    this.paused = false;
    this.pausedAt = 0;
    this.state = 'driving';
    this.acc = 0;
    this.timeScale = 1;
    this.runSerial = (this.runSerial || 0) + 1;
    this.worldTime = 0;
    this.elapsed = 0;
    this.runRealTime = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboWindowEffective = config.comboWindow;
    this.maxCombo = 0;
    this.hijackCount = 0;
    this.cars = [];
    this.particles = [];
    this.popups = [];
    this.diveTrail = [];
    this.character = null;
    this.deathCharacter = null;
    this.playerCar = null;
    this.deathReason = null;
    this.deathTimer = 0;
    this.finalScore = 0;
    this.newBest = false;
    this.cameraY = 0;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.comboFlash = 0;
    this.comboFlashText = '';
    this.wrongWayFlash = 0;
    this.wasWrongWay = false;
    this.wrongWayHeat = 0;
    this.wrongWayGrace = 0;
    this.lastWrongWayTier = 0;
    this.nearMissPlayerCar = null;
    this.nearMissCount = 0;
    this.oncomingHijackCount = 0;
    this.wrongWayTime = 0;
    this.sameCarTime = 0;
    this.contract = null;
    this.contractsCompleted = 0;
    this.contractTypes = new Set();
    this.contractFlash = 0;
    this.contractFlashText = '';
    this.escapeTimer = 0;
    this.escapeMax = 0;
    this.tutorialTime = 0;
    this.tutorialTarget = null;
    this.bulletTimeRemaining = 0;
    this.bulletTimeMax = config.bulletTimeDuration;
    this.btEmptyNotified = false;
    this.smokeTimer = 0;
    this.opportunityTimer = config.opportunityInterval;
    this.spawnTimers = [0.25, 0.9, 0.55, 1.25, 0.3, 1.0, 0.65, 1.4];
    this.lastPlayerSpeed = config.sedanSpeed;
    this.tutorialDone = getTutorialDone();
    this.tutorialStage = this.tutorialDone ? 'done' : 'start';
    this.bestScore = getBestScore();

    // 难度与场景状态
    this.laneMin = 0;
    this.laneMax = 8;
    this.laneMinTarget = 0;
    this.laneMaxTarget = 8;
    this.laneStage = 0;
    this.laneShrink = null;
    this.speedRamp = 0;
    this.sceneFrom = 0;
    this.sceneTo = 0;
    this.sceneMix = 1;
    this.laneNoticeTimer = 0;
    this.laneNoticeText = '';
    this.laneNoticeSub = '';

    this.seed = flags.seed != null && Number.isFinite(flags.seed)
      ? flags.seed
      : (Math.random() * 1e9) | 0;
    this.rng = mulberry32(this.seed);
    this.contractRng = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);

    const tutorial = !this.tutorialDone;
    const dur = tutorial ? config.firstCarDurability : typeDurability('sedan');
    this.playerCar = makeCar('sedan', 5, 0, 1, {
      x: 5.5,
      speed: config.sedanSpeed,
      baseSpeed: config.sedanSpeed,
      cruiseSpeed: config.sedanSpeed,
      isPlayer: true,
      durability: dur,
      durabilityMax: dur,
      color: tutorial ? '#b06a45' : '#ff6a3d',
      displayName: tutorial ? '破车' : '轿车',
      rng: this.rng,
    });
    this.cars.push(this.playerCar);

    this.spawnInitialTraffic(tutorial);
    this.startNextContract();
    this.audio.startRun();
  }

  spawnInitialTraffic(tutorial) {
    if (tutorial) {
      // 第一局的“教学目标”：同一车道正前方的一辆车，用 ↑ 飞扑就能抢到。
      this.tutorialTarget = this.addAICar(5, 2.0, 'sedan', 3.9, '#5f8fd9');
    } else {
      // 非教学局也给一辆近处的慢车，避免开局前几秒无车可抢。
      this.addAICar(5, 4.6, 'sedan', 3.4, '#5f8fd9');
    }
    const laneYs = [
      [6, 12.5],
      [5, 11],
      [7, 13],
      [5.5, 11.5],
      [8.5],
      [8.5],
      [7.5],
      [8.5],
    ];
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      for (const baseY of laneYs[lane]) {
        const type = pickSpawnType(this.rng, lane);
        const speed = this.aiSpawnSpeed(type);
        const y = baseY + (this.rng() - 0.5) * 1.4;
        if (this.laneHasGap(lane, y, typeL(type), 1.0)) {
          this.addAICar(lane, y, type, speed);
        }
      }
    }
  }

  addAICar(lane, y, type, speed, color) {
    const dir = laneDir(lane);
    const car = makeCar(type, lane, y, dir, {
      speed,
      baseSpeed: speed,
      cruiseSpeed: speed,
      color,
      rng: this.rng,
    });
    this.cars.push(car);
    return car;
  }

  laneHasGap(lane, y, len, gap) {
    for (const car of this.cars) {
      if (car.ghost || car.isPlayer || car.lane !== lane || car.destroyed) {
        continue;
      }
      if (Math.abs(car.y - y) < (car.l + len) * 0.5 + gap) return false;
    }
    return true;
  }

  aiSpawnSpeed(type) {
    // 只有新生成的车吃到当前的速度爬升，已经在路上的车保持原速。
    const base = typeSpeed(type) + this.speedRamp;
    return Math.max(
      0.8,
      base * (1 + config.aiSpeedVariance * (this.rng() * 2 - 1))
    );
  }

  activeLanes() {
    const lanes = [];
    const min = Math.ceil(this.laneMinTarget);
    const max = Math.floor(this.laneMaxTarget);
    for (let lane = min; lane < max; lane++) lanes.push(lane);
    return lanes;
  }

  updateDifficulty(realStep) {
    const cap =
      config.speedRampMax > 0 ? config.speedRampMax : Number.POSITIVE_INFINITY;
    this.speedRamp = Math.min(
      cap,
      this.speedRamp + config.speedRampPerSecond * realStep
    );

    if (this.laneStage === 0 && this.runRealTime >= config.laneShrinkAt1) {
      this.startLaneShrink(6, 1);
    } else if (
      this.laneStage === 1 &&
      this.runRealTime >= config.laneShrinkAt2
    ) {
      this.startLaneShrink(4, 2);
    }

    if (this.laneShrink) {
      const ls = this.laneShrink;
      ls.t += realStep;
      const p = clamp(ls.t / ls.dur, 0, 1);
      const e = easeInOutCubic(p);
      this.laneMin = lerp(ls.fromMin, ls.toMin, e);
      this.laneMax = lerp(ls.fromMax, ls.toMax, e);
      if (p >= 1) {
        this.laneMin = ls.toMin;
        this.laneMax = ls.toMax;
        this.laneShrink = null;
      }
    }

    if (this.sceneMix < 1) {
      this.sceneMix = Math.min(
        1,
        this.sceneMix + realStep / Math.max(0.1, config.sceneBlendTime)
      );
      if (this.sceneMix >= 1) this.sceneFrom = this.sceneTo;
    }
  }

  startLaneShrink(laneCount, nextStage) {
    const removed = (LANE_COUNT - laneCount) / 2;
    const toMin = removed;
    const toMax = LANE_COUNT - removed;
    const dur = Math.max(0.2, config.laneShrinkTime);

    this.laneShrink = {
      fromMin: this.laneMin,
      fromMax: this.laneMax,
      toMin,
      toMax,
      t: 0,
      dur,
    };
    this.laneStage = nextStage;
    this.laneMinTarget = toMin;
    this.laneMaxTarget = toMax;
    this.prepareLaneMerge(toMin, toMax);

    // 场景跟着车道数一起切换，颜色用 sceneMix 平滑过渡。
    this.sceneFrom = this.sceneTo;
    this.sceneTo = Math.min(SCENES.length - 1, nextStage);
    this.sceneMix = 0;

    this.laneNoticeText = `道路收窄 · 双向 ${laneCount} 车道`;
    this.laneNoticeSub = SCENES[this.sceneTo].name;
    this.laneNoticeTimer = 3.4;
    if (this.audio && this.audio.laneShrink) this.audio.laneShrink();
  }

  prepareLaneMerge(toMin, toMax) {
    for (const car of this.cars) {
      if (car.isPlayer || car.destroyed || car.ghost) continue;
      const laneNow = car.merge ? car.merge.targetLane : car.lane;
      if (laneNow >= toMin && laneNow < toMax) continue;

      const targetLane =
        laneNow < toMin ? Math.ceil(toMin) : Math.floor(toMax) - 1;
      if (this.laneMergeSlotClear(car, targetLane)) {
        car.merge = {
          fromX: car.x,
          toX: targetLane + 0.5,
          t: 0,
          dur: Math.max(0.2, config.laneShrinkTime),
          targetLane,
        };
      } else {
        this.retireCar(car);
      }
    }

    // 被收掉的外侧车道上如果停着残骸，直接清理掉。
    this.cars = this.cars.filter(
      (car) =>
        !(
          car.destroyed &&
          (car.lane < toMin || car.lane >= toMax)
        )
    );
  }

  laneMergeSlotClear(car, targetLane) {
    for (const other of this.cars) {
      if (other === car || other.ghost || other.destroyed || other.isPlayer) {
        continue;
      }
      const otherLane = other.merge ? other.merge.targetLane : other.lane;
      if (otherLane !== targetLane) continue;
      if (
        Math.abs(other.y - car.y) <
        (other.l + car.l) * 0.5 + config.spawnGap
      ) {
        return false;
      }
    }
    return true;
  }

  retireCar(car) {
    car.merge = null;
    car.ghost = true;
    car.ghostTime = 0;
    car.ghostDur = 0.55;
    car.ghostAlpha = 1;
  }

  // ---------------------------------------------------------------- 主循环

  frame(realDt, input, uiBlocked) {
    this.realTime += realDt;
    this.fps = lerp(this.fps, 1 / Math.max(realDt, 1e-4), 0.05);

    if (uiBlocked) return;

    if (this.mode === 'title') {
      this.updateTitle(realDt);
      if (
        input.justPressed('Space') ||
        input.justPressed('Enter') ||
        input.mouseClicked
      ) {
        this.startRun();
      }
      return;
    }

    if (this.mode === 'gameover') {
      if (
        this.realTime - this.gameOverAt > 0.35 &&
        (input.justPressed('KeyR') ||
          input.justPressed('Space') ||
          input.justPressed('Enter') ||
          input.mouseClicked)
      ) {
        this.startRun();
      }
      return;
    }

    // playing
    if (input.justPressed('KeyP') || input.justPressed('Escape')) {
      this.paused = !this.paused;
      this.pausedAt = this.realTime;
      this.acc = 0;
      return;
    }
    if (this.paused) {
      // 手机端没有键盘，点一下画面继续。
      if (
        input.mouseClicked &&
        this.realTime - (this.pausedAt || 0) > 0.2
      ) {
        this.paused = false;
        this.acc = 0;
      }
      return;
    }

    if (this.state === 'driving') {
      if (input.justPressed('ArrowDown') || input.justPressed('KeyS')) {
        this.climbRoof();
      }
    } else if (this.state === 'roof') {
      if (input.justPressed('ArrowUp') || input.justPressed('KeyW')) {
        this.dive(0, 1);
      } else if (input.justPressed('ArrowLeft') || input.justPressed('KeyA')) {
        this.dive(-1, 0);
      } else if (input.justPressed('ArrowRight') || input.justPressed('KeyD')) {
        this.dive(1, 0);
      }
    }

    this.acc += realDt;
    const fixed = 1 / 120;
    let steps = 0;
    while (this.acc >= fixed && steps < 10) {
      this.acc -= fixed;
      this.step(fixed, input);
      steps++;
    }
    if (steps >= 10) this.acc = 0;
  }

  step(realStep, input) {
    const targetScale =
      this.state === 'roof' && this.bulletTimeRemaining > 0
        ? config.bulletTimeScale
        : this.state === 'dead'
          ? config.deathSlowScale
          : 1;
    this.timeScale = damp(this.timeScale, targetScale, 22, realStep);
    const dt = realStep * this.timeScale;

    if (this.state !== 'dead') {
      this.elapsed += dt;
      this.runRealTime += realStep;
      this.updateDifficulty(realStep);
    }
    this.worldTime += dt;
    if (this.escapeTimer > 0) {
      this.escapeTimer = Math.max(0, this.escapeTimer - realStep);
    }
    this.updateWrongWayHeat(dt);

    switch (this.state) {
      case 'driving':
        this.updateDriving(dt, input);
        break;
      case 'roof':
        this.updateRoof(dt, realStep);
        break;
      case 'diving':
        this.updateDiving(dt);
        break;
      case 'hijack':
        this.updateHijack(dt);
        break;
      default:
        break;
    }

    this.updateAICars(dt, realStep);
    this.updateGhosts(dt, realStep);
    this.resolveCollisions(dt);
    this.updateNearMisses();
    if (this.playerCar && this.state !== 'diving' && this.state !== 'dead') {
      this.sameCarTime += dt;
    }
    this.updateContract();

    if (this.state === 'diving' && this.diveTimer >= config.diveTime) {
      this.die('dive_miss');
    }

    this.updateSpawner(dt);
    this.updateCamera(realStep);
    this.updateParticles(dt);
    this.updatePopups(realStep);
    this.updateTimers(realStep);
    this.updateDeath(realStep);
  }

  // ---------------------------------------------------------------- 玩家状态

  climbRoof() {
    if (this.state !== 'driving' || !this.playerCar) return;
    const car = this.playerCar;
    this.state = 'roof';
    const bulletBonus =
      car.type === 'bus' ? config.busBulletTimeBonus : 0;
    this.bulletTimeMax = config.bulletTimeDuration + bulletBonus;
    this.bulletTimeRemaining = this.bulletTimeMax;
    this.btEmptyNotified = false;
    car.vx = 0;
    // combo 计时在车顶/飞扑期间自然暂停，不在这里扣。
    if (this.tutorialStage === 'start') {
      this.tutorialStage = 'roof';
      this.tutorialTime = 0;
    }
    this.audio.bulletTimeEnter();
  }

  dive(dirX, dirY) {
    if (this.state !== 'roof' || !this.playerCar) return;
    const car = this.playerCar;
    this.state = 'diving';
    this.diveTimer = 0;
    this.diveTrail = [];
    this.diveTrailTimer = 0;
    this.character = {
      x: car.x,
      y: car.y + 0.02,
      vx: dirX * config.diveLateralImpulse,
      vy: car.cruiseSpeed + (dirY > 0 ? config.diveForwardImpulse : 0),
      rot: 0,
      mode: 'diving',
    };
    this.character.rot = Math.atan2(this.character.vx, this.character.vy);

    car.ghost = true;
    car.isPlayer = false;
    car.ghostTime = 0;
    car.ghostAlpha = 1;
    this.playerCar = null;
    this.sameCarTime = 0;
    this.wasWrongWay = false;
    this.timeScale = Math.max(this.timeScale, 0.6);
    this.audio.dive();
    this.audio.bulletTimeExit();
  }

  updateDriving(dt, input) {
    const car = this.playerCar;
    if (!car) return;

    const steer = input.getSteer();
    const lateral = typeLateralStats(car.type);
    const targetVx = steer * lateral.speed;
    const accel =
      Math.abs(steer) > 0.08 ? lateral.accel : lateral.decel;
    car.vx = approach(car.vx, targetVx, accel * dt);
    car.x = clamp(
      car.x + car.vx * dt,
      this.laneMin + car.w * 0.5,
      this.laneMax - car.w * 0.5
    );

    car.bumpFxCooldown = Math.max(0, car.bumpFxCooldown - dt);
    car.bumpSlowTimer = Math.max(0, car.bumpSlowTimer - dt);
    car.bumpBoostTimer = Math.max(0, car.bumpBoostTimer - dt);

    let speed = car.cruiseSpeed;
    if (car.bumpSlowTimer > 0) speed *= config.bumpSlowFactor;
    if (car.bumpBoostTimer > 0) speed = Math.max(speed, car.bumpBoostSpeed);
    car.y += speed * dt;
    car.speedEffective = speed;
    this.lastPlayerSpeed = speed;

    car.durability -= dt;
    if (car.durability <= 0) {
      car.durability = 0;
      this.die('explosion');
      return;
    }

    const mult = this.isWrongWay ? this.wrongWayMultiplier : 1;
    this.score += typeScore(car.type) * mult * dt;

    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer === 0) this.combo = 0;
    }

    const wrongWay = this.isWrongWay;
    if (wrongWay && !this.wasWrongWay) {
      // 顶部已经常驻逆行倍率徽章，这里只做红晕和提示音，避免文字重叠。
      this.wrongWayFlash = 1;
      this.audio.wrongWay();
    }
    this.wasWrongWay = wrongWay;
    if (!wrongWay && this.escapeTimer > 0) {
      this.escapeTimer = 0;
    }

    this.updateCarWarnings(dt);
  }

  updateRoof(dt, realStep) {
    const car = this.playerCar;
    if (!car) return;

    this.bulletTimeRemaining = Math.max(
      0,
      this.bulletTimeRemaining - realStep
    );
    if (this.bulletTimeRemaining <= 0 && !this.btEmptyNotified) {
      this.btEmptyNotified = true;
      this.addPopup('子弹时间结束！立即飞扑', car.x, car.y + 1.7, '#ffdf6b', 22);
      this.audio.bulletTimeEnd();
    }

    car.vx = 0;
    car.x = clamp(
      car.x,
      this.laneMin + car.w * 0.5,
      this.laneMax - car.w * 0.5
    );
    car.y += car.cruiseSpeed * dt;
    car.speedEffective = car.cruiseSpeed;
    this.lastPlayerSpeed = car.cruiseSpeed;

    car.durability -= dt;
    if (car.durability <= 0) {
      car.durability = 0;
      this.die('explosion');
      return;
    }

    this.updateCarWarnings(dt);
  }

  updateHijack(dt) {
    const car = this.playerCar;
    if (!car) return;
    this.hijackTimer += dt;

    if (car.flip) {
      car.flip.t += dt;
      const t = clamp(car.flip.t / car.flip.dur, 0, 1);
      const e = easeInOutCubic(t);
      const v = lerp(car.flip.from, car.flip.to, e);
      car.y += v * dt;
      car.renderRot =
        Math.PI * (1 - e) + Math.sin(t * Math.PI) * 0.18;
      if (t >= 1) {
        car.flip = null;
        car.dir = 1;
        car.renderRot = 0;
      }
    } else {
      car.y += car.cruiseSpeed * dt;
      car.renderRot = 0;
    }

    car.x = clamp(
      car.x,
      this.laneMin + car.w * 0.5,
      this.laneMax - car.w * 0.5
    );

    if (this.character) {
      this.character.x = car.x;
      this.character.y = car.y;
    }

    if (this.hijackTimer >= this.hijackDuration) {
      this.state = 'driving';
      this.character = null;
      this.wasWrongWay = false;
    }
  }

  updateDiving(dt) {
    const ch = this.character;
    if (!ch) return;
    this.diveTimer += dt;
    ch.x += ch.vx * dt;
    ch.y += ch.vy * dt;
    ch.rot = Math.atan2(ch.vx, ch.vy);

    this.diveTrailTimer -= dt;
    if (this.diveTrailTimer <= 0) {
      this.diveTrail.push({ x: ch.x, y: ch.y, rot: ch.rot, life: 0.18 });
      this.diveTrailTimer = 0.022;
    }
  }

  updateCarWarnings(dt) {
    const car = this.playerCar;
    if (!car) return;
    if (car.durability <= config.durabilityWarnTime) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.1 + this.rng() * 0.08;
        this.addSmoke(car.x + (this.rng() - 0.5) * 0.35, car.y + 0.3, 1);
      }
    }
  }

  get isWrongWay() {
    return !!this.playerCar && this.playerCar.x < CENTER_X;
  }

  wrongWayTier() {
    const t1 = Math.max(0, Number(config.wrongWayRampTime1) || 0);
    const t2 = Math.max(t1, Number(config.wrongWayRampTime2) || 0);
    // 热度按 dt 累加，6 秒可能是 5.999999…；留一点容差，避免卡在上一档。
    const eps = 1e-6;
    if (this.wrongWayHeat >= t2 - eps) return 2;
    if (this.wrongWayHeat >= t1 - eps) return 1;
    return 0;
  }

  wrongWayMultiplierForTier(tier) {
    if (tier === 2) return config.wrongWayMultiplier3;
    if (tier === 1) return config.wrongWayMultiplier2;
    return config.wrongWayMultiplier;
  }

  get wrongWayTierMultiplier() {
    return this.wrongWayMultiplierForTier(this.wrongWayTier());
  }

  get wrongWayMultiplier() {
    const bonus =
      this.playerCar && this.playerCar.type === 'sports'
        ? config.sportsWrongWayBonus
        : 0;
    return this.wrongWayTierMultiplier + bonus;
  }

  get wrongWayInfo() {
    const t1 = Math.max(0, Number(config.wrongWayRampTime1) || 0);
    const t2 = Math.max(t1, Number(config.wrongWayRampTime2) || 0);
    const tier = this.wrongWayTier();
    const tierMultiplier = this.wrongWayMultiplierForTier(tier);
    const bonus =
      this.playerCar && this.playerCar.type === 'sports'
        ? config.sportsWrongWayBonus
        : 0;
    let progress = 1;
    if (tier === 0) {
      progress = t1 > 0 ? clamp(this.wrongWayHeat / t1, 0, 1) : 1;
    } else if (tier === 1) {
      progress =
        t2 > t1
          ? clamp((this.wrongWayHeat - t1) / (t2 - t1), 0, 1)
          : 1;
    }
    return {
      tier,
      heat: this.wrongWayHeat,
      multiplier: tierMultiplier + bonus,
      tierMultiplier,
      progress,
      nextTime: tier === 0 ? t1 : tier === 1 ? t2 : null,
    };
  }

  updateWrongWayHeat(dt) {
    if (this.state === 'dead') return;

    const wrong = !!this.playerCar && this.playerCar.x < CENTER_X;
    const grace = Math.max(0, Number(config.wrongWayHeatGrace) || 0);
    const decay = Math.max(0, Number(config.wrongWayHeatDecay) || 0);

    if (wrong) {
      this.wrongWayHeat += dt;
      this.wrongWayTime += dt;
      this.wrongWayGrace = grace;
    } else {
      this.wrongWayGrace = Math.max(0, this.wrongWayGrace - dt);
      if (this.wrongWayGrace <= 0) {
        this.wrongWayHeat = Math.max(0, this.wrongWayHeat - decay * dt);
      }
    }

    const tier = this.wrongWayTier();
    if (wrong && tier > this.lastWrongWayTier) {
      this.wrongWayFlash = Math.max(this.wrongWayFlash, 0.8);
      this.audio.wrongWayTier(tier);
    }
    this.lastWrongWayTier = tier;
  }

  // ---------------------------------------------------------------- 碰撞

  resolveCollisions(dt) {
    if (this.state === 'diving') {
      const ch = this.character;
      if (!ch) return;
      for (const car of this.cars) {
        if (car.ghost || car.isPlayer || car.destroyed) continue;
        if (
          circleRectOverlap(ch.x, ch.y, config.diveHitRadius, car)
        ) {
          this.hijack(car);
          return;
        }
      }
      return;
    }

    const pc = this.playerCar;
    if (!pc || this.state === 'dead' || this.state === 'hijack') return;
    if (this.escapeTimer > 0) return;

    for (const car of this.cars) {
      if (car === pc || car.ghost || car.isPlayer || car.destroyed) continue;
      if (!aabbOverlap(pc, car)) continue;

      if (this.state === 'roof') {
        this.die('roof_crash');
        return;
      }
      if (car.dir === -1) {
        this.die('oncoming');
        return;
      }
      this.resolveBump(pc, car);
    }
  }

  resolveBump(pc, car) {
    const dx = pc.x - car.x;
    const dy = pc.y - car.y;
    const overlapX = (pc.w + car.w) * 0.5 - Math.abs(dx);
    const overlapY = (pc.l + car.l) * 0.5 - Math.abs(dy);
    if (overlapX <= 0 || overlapY <= 0) return;

    const truck = pc.type === 'truck';
    const truckImmune = truck && config.truckBumpPenaltyImmune > 0;

    if (pc.bumpFxCooldown <= 0) {
      pc.bumpFxCooldown = config.bumpCooldown;
      if (!truckImmune) {
        // 同向碰撞本身不致死：耐久最低只扣到 0.4s，保证不会因为一次碰撞直接爆炸。
        pc.durability = Math.max(
          0.4,
          pc.durability - config.collisionDurabilityPenalty
        );
      }
      this.shake = Math.max(this.shake, 0.8 * config.screenShake);
      this.addBumpFx((pc.x + car.x) * 0.5, (pc.y + car.y) * 0.5);
      this.audio.bump();
    }

    if (overlapY < overlapX) {
      const playerAhead = dy > 0;
      if (playerAhead) {
        pc.y += overlapY;
        pc.bumpBoostTimer = Math.max(pc.bumpBoostTimer, config.bumpSlowTime);
        pc.bumpBoostSpeed =
          Math.max(pc.cruiseSpeed, car.speed) * config.bumpShoveFactor;
      } else if (truck) {
        // 卡车被动：追尾同向车时把对方顶开，自己不减速；给被顶车一个临时速度，
        // 避免两车下一帧又贴在一起。
        car.y += overlapY + config.truckBumpShoveExtra;
        car.speed = Math.max(car.speed, pc.cruiseSpeed);
      } else {
        pc.y -= overlapY;
        pc.bumpSlowTimer = Math.max(pc.bumpSlowTimer, config.bumpSlowTime);
      }
    } else {
      pc.x += (dx >= 0 ? 1 : -1) * overlapX;
      pc.x = clamp(
        pc.x,
        this.laneMin + pc.w * 0.5,
        this.laneMax - pc.w * 0.5
      );
      pc.vx *= 0.4;
      pc.bumpSlowTimer = Math.max(
        pc.bumpSlowTimer,
        config.bumpSlowTime * 0.6
      );
    }
  }

  updateNearMisses() {
    const pc = this.playerCar;

    // 换车/飞扑时重建参考系，避免跨越不同车辆的相对位置造成误判。
    if (pc !== this.nearMissPlayerCar) {
      this.nearMissPlayerCar = pc;
      for (const car of this.cars) {
        if (car.dir === -1) car.nearMissRelY = null;
      }
      return;
    }

    for (const car of this.cars) {
      if (car.ghost || car.isPlayer || car.destroyed || car.dir !== -1) {
        continue;
      }

      const relY = pc ? car.y - pc.y : null;
      const prevRelY = car.nearMissRelY;
      car.nearMissRelY = relY;

      if (!pc || this.state !== 'driving' || car.nearMissHandled) continue;
      if (prevRelY == null || prevRelY <= 0 || relY > 0) continue;

      car.nearMissHandled = true;
      const gap = Math.abs(car.x - pc.x) - (car.w + pc.w) * 0.5;
      if (gap < 0 || gap > config.nearMissGap) continue;

      this.nearMissCount++;
      const bonus = Math.max(0, Number(config.nearMissScore) || 0);
      if (bonus <= 0) continue;
      this.score += bonus;
      this.addPopup(
        `擦身而过 +${bonus}`,
        pc.x,
        pc.y + 1.3,
        '#7fdcff',
        20
      );
      this.shake = Math.max(this.shake, 0.18 * config.screenShake);
      this.audio.nearMiss();
    }
  }

  hijack(target) {
    if (this.state !== 'diving') return;
    this.state = 'hijack';
    this.hijackTimer = 0;
    this.hijackCount++;
    this.contractTypes.add(target.type);
    this.diveTrail = [];

    this.playerCar = target;
    this.sameCarTime = 0;
    target.isPlayer = true;
    target.ghost = false;
    target.ghostAlpha = 1;
    target.merge = null;
    target.destroyed = false;
    target.durabilityMax = typeDurability(target.type);
    target.durability = target.durabilityMax;
    target.bumpFxCooldown = 0;
    target.bumpSlowTimer = 0;
    target.bumpBoostTimer = 0;
    target.vx = 0;
    target.cruiseSpeed = target.baseSpeed;
    target.speedEffective = target.cruiseSpeed;

    if (target.dir === -1) {
      this.oncomingHijackCount++;
      target.flip = {
        t: 0,
        dur: config.hijackFlipTime,
        from: -target.cruiseSpeed,
        to: target.cruiseSpeed,
      };
      target.renderRot = Math.PI;
      this.hijackDuration = target.flip.dur + 0.08;
    } else {
      target.flip = null;
      target.renderRot = 0;
      this.hijackDuration = 0.22;
    }

    this.character = {
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      rot: 0,
      mode: 'hijack',
    };
    this.wasWrongWay = false;

    // 抢到迎面车后，甩尾会把你放进迎面车道。给一段碰撞保护窗口
    // （config.escapeProtection），让玩家有机会按 → 回到右侧；
    // 否则同车道的迎面车会在翻转结束时立刻撞死你。
    if (target.dir === -1) {
      this.escapeTimer = config.escapeProtection;
      this.escapeMax = config.escapeProtection;
    } else {
      this.escapeTimer = 0;
      this.escapeMax = 0;
    }

    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const bonus =
      config.hijackBonus + Math.max(0, this.combo - 1) * config.comboStep;
    this.score += bonus;
    this.comboWindowEffective =
      config.comboWindow +
      (target.type === 'sedan' ? config.sedanComboBonus : 0);
    this.comboTimer = this.comboWindowEffective;
    this.comboFlash = 1;
    this.comboFlashText =
      this.combo > 1 ? `连击 ×${this.combo}` : '抢到了！';
    this.addPopup(`+${bonus}`, target.x, target.y + 1.2, '#ffd23f', 32);
    this.addHijackFx(target.x, target.y);
    this.shake = Math.max(this.shake, 0.35 * config.screenShake);
    this.audio.hijack(this.combo);

    if (this.tutorialStage !== 'done' && this.tutorialStage !== 'hijacked') {
      this.tutorialDone = true;
      setTutorialDone(true);
      this.tutorialStage = 'hijacked';
      this.tutorialTime = 0;
    }
  }

  // ---------------------------------------------------------------- 悬赏目标

  startNextContract() {
    const currentId = this.contract ? this.contract.def.id : null;
    let pool = CONTRACTS.filter((def) => def.id !== currentId);
    if (pool.length === 0) pool = CONTRACTS;

    const roll = this.contractRng ? this.contractRng() : Math.random();
    const def = pool[Math.floor(roll * pool.length) % pool.length];
    const level = this.contractsCompleted;
    if (def.id === 'types') this.contractTypes.clear();

    this.contract = {
      def,
      target: contractTarget(def, level),
      reward: contractReward(def, level),
      baseline: this.contractBaseline(def.id),
      progress: 0,
    };
  }

  contractBaseline(id) {
    switch (id) {
      case 'hijack':
        return this.hijackCount;
      case 'nearMiss':
        return this.nearMissCount;
      case 'oncoming':
        return this.oncomingHijackCount;
      case 'wrongWay':
        return this.wrongWayTime;
      case 'sameCar':
        return this.sameCarTime;
      default:
        return 0;
    }
  }

  contractProgressFor(contract) {
    switch (contract.def.id) {
      case 'hijack':
        return Math.max(0, this.hijackCount - contract.baseline);
      case 'nearMiss':
        return Math.max(0, this.nearMissCount - contract.baseline);
      case 'oncoming':
        return Math.max(0, this.oncomingHijackCount - contract.baseline);
      case 'wrongWay':
        return Math.max(0, this.wrongWayTime - contract.baseline);
      case 'types':
        return this.contractTypes.size;
      case 'sameCar':
        return Math.max(0, this.sameCarTime - contract.baseline);
      default:
        return 0;
    }
  }

  updateContract() {
    const contract = this.contract;
    if (!contract || this.state === 'dead') return;

    contract.progress = this.contractProgressFor(contract);
    if (contract.progress < contract.target) return;

    this.score += contract.reward;
    this.contractsCompleted++;
    this.contractFlash = 1;
    this.contractFlashText = `悬赏完成 +${contract.reward}`;
    this.audio.contractComplete();
    this.startNextContract();
  }

  // ---------------------------------------------------------------- 死亡

  die(reason) {
    if (this.state === 'dead' || this.mode !== 'playing') return;
    this.state = 'dead';
    this.deathReason = reason;
    this.deathTimer = 0;
    this.shake = Math.max(this.shake, 1.2 * config.screenShake);
    this.flash = reason === 'explosion' ? 0.85 : 0.55;
    this.flashColor = reason === 'explosion' ? '#ff9f43' : '#ff3b30';
    this.bulletTimeRemaining = 0;
    this.audio.crash(reason);

    const car = this.playerCar;
    const px = car ? car.x : this.character ? this.character.x : 2;
    const py = car ? car.y : this.character ? this.character.y : this.cameraY;

    if (reason === 'dive_miss') {
      if (this.character) this.character.mode = 'splat';
      this.deathCharacter = null;
      this.addSplatFx(px, py);
    } else {
      this.deathCharacter = {
        x: px,
        y: py + 0.2,
        vx: (this.rng() - 0.5) * 3,
        vy: 5 + this.rng() * 2,
        rot: 0,
        rotV: (this.rng() - 0.5) * 12,
        mode: 'fly',
      };
      if (reason === 'explosion') {
        if (car) this.explodeCar(car);
        this.addExplosionFx(px, py);
        this.audio.explosion();
      } else {
        this.addCrashFx(px, py);
      }
    }

    if (car) car.vx = 0;
  }

  explodeCar(car) {
    car.destroyed = true;
    car.isPlayer = false;
    car.ghost = false;
    car.ghostAlpha = 1;
    car.speed = 0;
    car.baseSpeed = 0;
    car.cruiseSpeed = 0;
    const idx = this.cars.indexOf(car);
    if (idx >= 0) this.cars[idx] = car;
  }

  updateDeath(realStep) {
    if (this.state !== 'dead') return;
    this.deathTimer += realStep;
    const d = this.deathCharacter;
    if (d) {
      d.x += d.vx * realStep;
      d.y += d.vy * realStep;
      d.vy -= 20 * realStep;
      d.rot += d.rotV * realStep;
      if (d.y < this.cameraY - 7) {
        d.y = this.cameraY - 7;
        d.vy = 0;
        d.vx *= 0.8;
      }
    }
    if (this.deathTimer >= 0.9) this.showGameOver();
  }

  showGameOver() {
    if (this.mode !== 'playing') return;
    this.mode = 'gameover';
    this.gameOverAt = this.realTime;
    this.finalScore = Math.floor(this.score);
    const prevBest = Math.max(this.bestScore, getBestScore());
    this.newBest = this.finalScore > prevBest;
    if (this.newBest) {
      this.bestScore = this.finalScore;
      setBestScore(this.finalScore);
    } else {
      this.bestScore = prevBest;
    }
    this.audio.gameOver();
  }

  // ---------------------------------------------------------------- 车流

  updateAICars(dt, realStep) {
    for (const car of this.cars) {
      if (car.isPlayer || car.ghost || car.destroyed) continue;
      car.speed = approach(car.speed, car.baseSpeed, 0.9 * dt);
      car.y += car.dir * car.speed * dt;

      // 外侧车道收窄时，车辆平滑并入相邻车道；并线期间保持原车道逻辑。
      if (car.merge) {
        car.merge.t += realStep;
        const p = clamp(car.merge.t / car.merge.dur, 0, 1);
        const e = easeInOutCubic(p);
        car.x = lerp(car.merge.fromX, car.merge.toX, e);
        if (p >= 1) {
          car.x = car.merge.toX;
          car.lane = car.merge.targetLane;
          car.merge = null;
        }
      }
    }

    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const dir = laneDir(lane);
      const list = this.cars
        .filter((c) => !c.isPlayer && !c.ghost && !c.destroyed && c.lane === lane)
        .sort((a, b) => (dir === 1 ? b.y - a.y : a.y - b.y));
      for (let i = 1; i < list.length; i++) {
        const ahead = list[i - 1];
        const rear = list[i];
        const need =
          (ahead.l + rear.l) * 0.5 + config.aiFollowGap;
        const gap = (ahead.y - rear.y) * dir;
        if (gap < need) {
          rear.y = ahead.y - dir * need;
          rear.speed = Math.min(rear.speed, ahead.speed);
        }
      }
    }
  }

  updateGhosts(dt, realStep) {
    for (const car of this.cars) {
      if (!car.ghost) continue;
      car.ghostTime += realStep;
      const dur = car.ghostDur || 1.3;
      car.ghostAlpha = 1 - clamp(car.ghostTime / dur, 0, 1);
      car.y += car.dir * car.speed * dt;
    }
    this.cars = this.cars.filter((car) => {
      if (!car.ghost) return true;
      if (car.ghostAlpha <= 0) return false;
      const dy = car.y - this.cameraY;
      return dy > -10 && dy < 24;
    });
  }

  updateSpawner(dt) {
    if (this.state === 'dead') return;
    const interval = Math.max(0.2, config.trafficBaseInterval);
    for (const lane of this.activeLanes()) {
      this.spawnTimers[lane] -= dt;
      if (this.spawnTimers[lane] <= 0) {
        if (this.trySpawn(lane, false)) {
          this.spawnTimers[lane] = interval * (0.7 + this.rng() * 0.6);
        } else {
          this.spawnTimers[lane] = interval * 0.3;
        }
      }
    }

    this.opportunityTimer -= dt;
    if (this.opportunityTimer <= 0) {
      this.opportunityTimer = config.opportunityInterval;
      this.ensureOpportunity();
    }

    this.cars = this.cars.filter((car) => {
      if (car.isPlayer || car.ghost) return true;
      if (car.destroyed) return true;
      const dy = car.y - this.cameraY;
      return dy > -9 && dy < 25;
    });
  }

  playerSpawnSpeed() {
    if (this.playerCar) return this.playerCar.cruiseSpeed;
    return this.lastPlayerSpeed || config.sedanSpeed;
  }

  laneStats(lane) {
    let count = 0;
    let speedSum = 0;
    const yMin = this.cameraY - this.layout.bottomWorld - 3;
    const yMax = this.cameraY + this.layout.topWorld + 3;
    for (const car of this.cars) {
      if (car.ghost || car.isPlayer || car.destroyed || car.lane !== lane) {
        continue;
      }
      if (car.y < yMin || car.y > yMax) continue;
      count++;
      speedSum += car.speed;
    }
    return {
      count,
      avgSpeed: count > 0 ? speedSum / count : 0,
    };
  }

  trySpawn(lane, forceAhead) {
    const playerSpeed = this.playerSpawnSpeed();
    const stats = this.laneStats(lane);

    // 拥堵控制：屏幕附近已经排满，或者整条车道被慢车压住时，先不再生成。
    if (stats.count >= config.laneCarCap) return false;
    if (
      stats.count > 0 &&
      stats.avgSpeed < playerSpeed * config.laneCongestionSpeedFactor
    ) {
      return false;
    }

    const type = pickSpawnType(this.rng, lane);
    let speed = this.aiSpawnSpeed(type);
    let side = 'ahead';

    if (lane >= LANE_SPLIT) {
      const playerX = this.playerCar
        ? this.playerCar.x
        : this.character
          ? this.character.x
          : CENTER_X;
      const dist = Math.abs(lane + 0.5 - playerX);
      const nearPlayer = dist <= config.playerLaneCushion;
      const sameLane = dist <= 0.8;

      if (nearPlayer) {
        // 玩家周围不再生成“后方快车”，避免被前后夹住。
        side = 'ahead';
        if (sameLane) {
          speed = Math.min(
            speed,
            Math.max(1.4, playerSpeed * config.playerLaneSpeedFactor)
          );
        }
      } else if (
        !forceAhead &&
        speed > playerSpeed + config.behindSpawnSpeedGap
      ) {
        side = 'behind';
      }

      if (forceAhead) {
        side = 'ahead';
        speed = Math.min(speed, Math.max(1.4, playerSpeed * 0.7));
      }
    }

    const extraAhead =
      this.layout.topWorld + config.spawnAheadExtra * (0.4 + this.rng() * 0.6);
    const extraBehind =
      this.layout.bottomWorld +
      config.spawnBehindExtra * (0.4 + this.rng() * 0.6);
    const y =
      side === 'ahead'
        ? this.cameraY + extraAhead
        : this.cameraY - extraBehind;

    const len = typeL(type);
    if (side === 'ahead') {
      let nearest = null;
      for (const car of this.cars) {
        if (car.ghost || car.isPlayer || car.destroyed || car.lane !== lane) {
          continue;
        }
        if (car.y < y && (!nearest || car.y > nearest.y)) nearest = car;
      }
      if (
        nearest &&
        y - nearest.y < (nearest.l + len) * 0.5 + config.spawnGap
      ) {
        return false;
      }
    } else {
      let nearest = null;
      for (const car of this.cars) {
        if (car.ghost || car.isPlayer || car.destroyed || car.lane !== lane) {
          continue;
        }
        if (car.y > y && (!nearest || car.y < nearest.y)) nearest = car;
      }
      if (
        nearest &&
        nearest.y - y < (nearest.l + len) * 0.5 + config.spawnGap
      ) {
        return false;
      }
    }

    this.addAICar(lane, y, type, speed);
    return true;
  }

  ensureOpportunity() {
    const px = this.playerCar
      ? this.playerCar.x
      : this.character
        ? this.character.x
        : CENTER_X;
    const py = this.playerCar
      ? this.playerCar.y
      : this.character
        ? this.character.y
        : this.cameraY;

    let count = 0;
    for (const car of this.cars) {
      if (car.ghost || car.isPlayer || car.destroyed) continue;
      if (Math.abs(car.x - px) > config.opportunityRadiusX) continue;
      if (car.y < py - 2 || car.y > py + config.opportunityRadiusY) continue;
      count++;
    }
    if (count >= config.opportunityMinCars) return;

    const order = this.activeLanes().sort(
      (a, b) => Math.abs(a + 0.5 - px) - Math.abs(b + 0.5 - px)
    );
    for (const lane of order) {
      if (this.trySpawn(lane, true)) break;
    }
  }

  // ---------------------------------------------------------------- 镜头 / 特效 / 计时

  updateCamera(realStep) {
    if (this.state === 'dead' || this.mode === 'gameover') return;
    let target = this.cameraY;
    if (this.state === 'diving' && this.character) {
      target = this.character.y;
    } else if (this.playerCar) {
      target = this.playerCar.y;
    }
    this.cameraY = damp(this.cameraY, target, 24, realStep);
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'spark' || p.type === 'star') {
        p.vy -= 8 * dt;
        p.rot += p.rotV * dt;
      } else if (p.type === 'smoke') {
        p.vy += 0.5 * dt;
        p.size += 0.35 * dt;
      } else if (p.type === 'ring') {
        p.size += 2.6 * dt;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 420) {
      this.particles.splice(0, this.particles.length - 420);
    }
  }

  updatePopups(realStep) {
    for (const p of this.popups) p.life -= realStep;
    this.popups = this.popups.filter((p) => p.life > 0);
  }

  updateTimers(realStep) {
    this.tutorialTime += realStep;
    if (this.tutorialStage === 'hijacked' && this.tutorialTime > 5) {
      this.tutorialStage = 'done';
    }
    this.laneNoticeTimer = Math.max(0, this.laneNoticeTimer - realStep);
    this.shake *= Math.exp(-7 * realStep);
    if (this.shake < 0.01) this.shake = 0;
    this.flash = Math.max(0, this.flash - realStep * 2.2);
    this.comboFlash = Math.max(0, this.comboFlash - realStep * 1.7);
    this.contractFlash = Math.max(0, this.contractFlash - realStep * 1.4);
    this.wrongWayFlash = Math.max(0, this.wrongWayFlash - realStep * 2);
    for (const t of this.diveTrail) t.life -= realStep;
    this.diveTrail = this.diveTrail.filter((t) => t.life > 0);
  }

  // ---------------------------------------------------------------- 粒子

  addParticle(x, y, opts) {
    this.particles.push({
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      life: opts.life ?? 0.5,
      maxLife: opts.life ?? 0.5,
      size: opts.size ?? 0.1,
      color: opts.color ?? '#ffd23f',
      type: opts.type ?? 'spark',
      rot: opts.rot ?? 0,
      rotV: opts.rotV ?? 0,
    });
  }

  addSmoke(x, y, count = 1) {
    for (let i = 0; i < count; i++) {
      this.addParticle(x, y, {
        vx: (this.rng() - 0.5) * 0.7,
        vy: 0.4 + this.rng() * 0.7,
        life: 0.8 + this.rng() * 0.7,
        size: 0.13 + this.rng() * 0.12,
        color: this.rng() < 0.5 ? '#b9b4ab' : '#8d8880',
        type: 'smoke',
      });
    }
  }

  addSparks(x, y, count = 8, palette = ['#ffd23f', '#ff9f43', '#fff2b0']) {
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const sp = 1.2 + this.rng() * 3.6;
      this.addParticle(x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.22 + this.rng() * 0.32,
        size: 0.03 + this.rng() * 0.045,
        color: palette[Math.floor(this.rng() * palette.length)],
        type: 'spark',
        rot: a,
        rotV: (this.rng() - 0.5) * 10,
      });
    }
  }

  addStars(x, y, count = 10, palette = ['#ffd23f', '#fff6c9', '#ffffff']) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.rng() * 0.4;
      const sp = 1.8 + this.rng() * 2.6;
      this.addParticle(x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + this.rng() * 0.4,
        size: 0.07 + this.rng() * 0.08,
        color: palette[Math.floor(this.rng() * palette.length)],
        type: 'star',
        rot: a,
        rotV: (this.rng() - 0.5) * 6,
      });
    }
  }

  addRing(x, y, color, size = 0.25) {
    this.addParticle(x, y, {
      life: 0.32,
      size,
      color,
      type: 'ring',
    });
  }

  addBumpFx(x, y) {
    this.addSparks(x, y, 8);
    this.addSmoke(x, y, 1);
  }

  addHijackFx(x, y) {
    this.addStars(x, y, 12);
    this.addRing(x, y, '#ffd23f', 0.25);
    this.addSparks(x, y, 5, ['#ffffff', '#ffd23f']);
  }

  addCrashFx(x, y) {
    this.addSparks(x, y, 18, ['#ff9f43', '#ff5a3c', '#fff2b0']);
    this.addSmoke(x, y, 5);
    this.addRing(x, y, '#ff5a3c', 0.3);
  }

  addExplosionFx(x, y) {
    this.addSparks(x, y, 28, ['#ffd23f', '#ff9f43', '#ff5a3c', '#ffffff']);
    this.addSmoke(x, y, 12);
    this.addRing(x, y, '#ffd23f', 0.35);
    this.addRing(x, y, '#ff5a3c', 0.6);
  }

  addSplatFx(x, y) {
    this.addSparks(x, y, 6, ['#ffffff', '#c9c2b4']);
    this.addSmoke(x, y, 2);
  }

  addPopup(text, x, y, color = '#ffffff', size = 24) {
    this.popups.push({
      text,
      x,
      y,
      color,
      size,
      life: 1.15,
      maxLife: 1.15,
    });
  }

  // ---------------------------------------------------------------- 辅助预测

  predictDive(dirX, dirY) {
    if (this.state !== 'roof' || !this.playerCar) return null;
    const car = this.playerCar;
    const vx = dirX * config.diveLateralImpulse;
    const vy =
      car.cruiseSpeed + (dirY > 0 ? config.diveForwardImpulse : 0);
    let x = car.x;
    let y = car.y + 0.02;
    let t = 0;
    const points = [{ x, y }];
    const steps = 28;
    const stepT = config.diveTime / steps;
    const candidates = this.cars.filter(
      (c) => !c.ghost && !c.isPlayer && !c.destroyed
    );

    for (let i = 0; i < steps; i++) {
      x += vx * stepT;
      y += vy * stepT;
      t += stepT;
      points.push({ x, y });
      for (const c of candidates) {
        const predicted = {
          x: c.x,
          y: c.y + c.dir * c.speed * t,
          w: c.w,
          l: c.l,
        };
        if (
          circleRectOverlap(x, y, config.diveHitRadius, predicted)
        ) {
          return { car: c, points, landing: { x, y } };
        }
      }
    }
    return { car: null, points, landing: { x, y } };
  }
}
