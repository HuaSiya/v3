// 悬赏目标定义。
// 每完成一个目标，contractsCompleted + 1；目标值和奖励随完成数递增，
// 到 maxTarget / maxReward 后封顶。想调整悬赏池的难度和收益，改这里即可。

export const CONTRACTS = [
  {
    id: 'hijack',
    title: '连环夺车',
    describe: (target) => `抢到 ${target} 辆车`,
    baseTarget: 3,
    targetStep: 1,
    maxTarget: 8,
    baseReward: 300,
    rewardStep: 80,
    maxReward: 1200,
    timeBased: false,
  },
  {
    id: 'wrongWay',
    title: '逆行狂人',
    describe: (target) => `累计逆行 ${target} 秒`,
    baseTarget: 8,
    targetStep: 1.5,
    maxTarget: 20,
    baseReward: 350,
    rewardStep: 80,
    maxReward: 1300,
    timeBased: true,
  },
  {
    id: 'nearMiss',
    title: '刀尖舞者',
    describe: (target) => `擦身而过 ${target} 次`,
    baseTarget: 2,
    targetStep: 1,
    maxTarget: 6,
    baseReward: 300,
    rewardStep: 90,
    maxReward: 1200,
    timeBased: false,
  },
  {
    id: 'oncoming',
    title: '迎面豪夺',
    describe: (target) => `抢到 ${target} 辆迎面车`,
    baseTarget: 1,
    targetStep: 1,
    maxTarget: 4,
    baseReward: 350,
    rewardStep: 100,
    maxReward: 1400,
    timeBased: false,
  },
  {
    id: 'types',
    title: '车型收藏家',
    describe: (target) => `抢到 ${target} 种不同车型`,
    baseTarget: 3,
    targetStep: 1,
    maxTarget: 4,
    baseReward: 400,
    rewardStep: 100,
    maxReward: 1400,
    timeBased: false,
  },
  {
    id: 'sameCar',
    title: '人车合一',
    describe: (target) => `同一辆车坚持 ${target} 秒`,
    baseTarget: 3.5,
    targetStep: 0.5,
    maxTarget: 4.5,
    baseReward: 300,
    rewardStep: 80,
    maxReward: 1200,
    timeBased: true,
  },
];

export function contractTarget(def, level) {
  const value = Math.min(
    def.maxTarget,
    def.baseTarget + def.targetStep * level
  );
  return def.timeBased
    ? Math.round(value * 10) / 10
    : Math.round(value);
}

export function contractReward(def, level) {
  return Math.round(
    Math.min(def.maxReward, def.baseReward + def.rewardStep * level)
  );
}
