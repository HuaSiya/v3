// 全球排行榜的浏览器端客户端。
// 默认调用同源的 Cloudflare Pages Function: /api/scores。

const API_URL = '/api/scores';
const CLIENT_KEY = 'qiangche.clientId.v1';
const NAME_KEY = 'qiangche.playerName.v1';
const AUTO_KEY = 'qiangche.autoSubmit.v1';

function readStorage(key, fallback = '') {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function randomId() {
  try {
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `id-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export class LeaderboardError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'LeaderboardError';
    this.status = status;
    this.code = code;
  }
}

export function getClientId() {
  let id = readStorage(CLIENT_KEY);
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) {
    id = randomId();
    writeStorage(CLIENT_KEY, id);
  }
  return id;
}

export function getNickname() {
  return readStorage(NAME_KEY).trim();
}

export function setNickname(name) {
  writeStorage(NAME_KEY, name.trim());
}

export function getAutoSubmit() {
  return readStorage(AUTO_KEY, '1') !== '0';
}

export function setAutoSubmit(enabled) {
  writeStorage(AUTO_KEY, enabled ? '1' : '0');
}

export function makeRunId(runSerial) {
  return `${getClientId()}-${runSerial}-${Date.now().toString(36)}`;
}

async function request(url, options, timeoutMs) {
  if (typeof fetch !== 'function') {
    throw new LeaderboardError('fetch_unavailable');
  }
  if (location.protocol === 'file:') {
    throw new LeaderboardError('offline');
  }
  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    throw new LeaderboardError(
      error && error.name === 'AbortError' ? 'timeout' : 'network'
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new LeaderboardError(
      (data && data.error) || `http_${res.status}`,
      res.status,
      data && data.error
    );
  }
  return data || {};
}

export async function fetchTop(period = 'all', limit = 10) {
  const safePeriod = period === 'week' ? 'week' : 'all';
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  const data = await request(
    `${API_URL}?period=${safePeriod}&limit=${safeLimit}`,
    { method: 'GET', headers: { accept: 'application/json' } },
    6000
  );
  if (!Array.isArray(data.entries)) {
    throw new LeaderboardError('bad_response');
  }
  return data.entries;
}

export async function submitScore({
  name,
  score,
  duration,
  hijacks,
  runId,
}) {
  const data = await request(
    API_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        name,
        score,
        duration,
        hijacks,
        clientId: getClientId(),
        runId,
      }),
    },
    9000
  );
  return data;
}

export function leaderboardErrorMessage(error) {
  const code = error && error.code;
  if (code === 'rate_limited') return '提交太频繁，稍后再试';
  if (code === 'd1_not_bound') return '排行榜数据库尚未绑定';
  if (code === 'invalid_score' || code === 'invalid_duration') {
    return '成绩数据不合法';
  }
  if (code && String(code).startsWith('implausible')) {
    return '成绩未通过合理性校验';
  }
  if (code === 'timeout') return '网络超时，请稍后重试';
  if (code === 'offline') return '当前不是在线页面，无法上传';
  if (error && error.status === 404) return '排行榜接口未部署';
  return '排行榜暂时不可用';
}
