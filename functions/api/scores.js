// Cloudflare Pages Function: /api/scores
// GET  ?period=all|week&limit=10   -> 排行榜
// POST { name, score, duration, hijacks, clientId, runId } -> 提交成绩
//
// 需要在 Pages 项目里绑定 D1：变量名 DB。
// 表结构会在第一次请求时自动创建，也可以手动执行 schema.sql。

const MAX_LIMIT = 50;
const MAX_NAME_LENGTH = 12;
const MAX_SCORE = 5_000_000;
const MAX_DURATION = 6 * 60 * 60;
const MAX_HIJACKS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let schemaPromise = null;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function ensureSchema(env) {
  if (!env || !env.DB) throw new Error('D1_NOT_BOUND');
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          score INTEGER NOT NULL,
          duration REAL NOT NULL,
          hijacks INTEGER NOT NULL,
          client_id TEXT NOT NULL,
          run_id TEXT NOT NULL UNIQUE,
          ip_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`
      ).run();
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_scores_score
         ON scores (score DESC, created_at ASC)`
      ).run();
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_scores_created
         ON scores (created_at)`
      ).run();
      await env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_scores_ip
         ON scores (ip_hash, created_at)`
      ).run();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function cleanName(raw) {
  if (typeof raw !== 'string') return '匿名车手';
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('') || '匿名车手';
}

function validId(value) {
  return /^[A-Za-z0-9_-]{6,80}$/.test(value);
}

async function hashIp(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const salt = env.IP_SALT || 'qiangche-leaderboard-v1';
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function errorResponse(error) {
  if (String(error && error.message) === 'D1_NOT_BOUND') {
    return json({ error: 'd1_not_bound' }, 503);
  }
  console.error('leaderboard error', error);
  return json({ error: 'server_error' }, 500);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);

    const url = new URL(request.url);
    const rawLimit = Number.parseInt(url.searchParams.get('limit') || '10', 10);
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, Number.isFinite(rawLimit) ? rawLimit : 10)
    );
    const period = url.searchParams.get('period') === 'week' ? 'week' : 'all';

    const params = [];
    let where = '';
    if (period === 'week') {
      where = 'WHERE created_at >= ?';
      params.push(Date.now() - WEEK_MS);
    }

    const result = await env.DB.prepare(
      `SELECT name, score, duration, hijacks, created_at
       FROM scores
       ${where}
       ORDER BY score DESC, created_at ASC
       LIMIT ?`
    )
      .bind(...params, limit)
      .all();

    const entries = (result.results || []).map((row) => ({
      name: String(row.name || '匿名车手'),
      score: Number(row.score) || 0,
      duration: Number(row.duration) || 0,
      hijacks: Number(row.hijacks) || 0,
      createdAt: Number(row.created_at) || 0,
    }));

    return json({ ok: true, period, entries });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    if (!body || typeof body !== 'object') {
      return json({ error: 'invalid_payload' }, 400);
    }

    const score = Math.floor(Number(body.score));
    const duration = Number(body.duration);
    const hijacks = Math.floor(Number(body.hijacks));
    const clientId = String(body.clientId || '');
    const runId = String(body.runId || '');

    if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
      return json({ error: 'invalid_score' }, 400);
    }
    if (
      !Number.isFinite(duration) ||
      duration < 0.1 ||
      duration > MAX_DURATION
    ) {
      return json({ error: 'invalid_duration' }, 400);
    }
    if (!Number.isFinite(hijacks) || hijacks < 0 || hijacks > MAX_HIJACKS) {
      return json({ error: 'invalid_hijacks' }, 400);
    }
    if (!validId(clientId) || !validId(runId)) {
      return json({ error: 'invalid_payload' }, 400);
    }

    // 宽松的合理性检查：主要拦截明显离谱的数据，不追求完全防作弊。
    if (hijacks > duration * 5 + 20) {
      return json({ error: 'implausible_run' }, 422);
    }
    const maxScore = duration * 120 + hijacks * 600 + 5000;
    if (score > maxScore) {
      return json({ error: 'implausible_score' }, 422);
    }

    const name = cleanName(body.name);
    const ipHash = await hashIp(request, env);
    const now = Date.now();

    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM scores
       WHERE ip_hash = ? AND created_at > ?`
    )
      .bind(ipHash, now - RATE_LIMIT_WINDOW_MS)
      .first();
    if (recent && Number(recent.n) >= RATE_LIMIT_MAX) {
      return json({ error: 'rate_limited' }, 429);
    }

    const insert = await env.DB.prepare(
      `INSERT OR IGNORE INTO scores
        (name, score, duration, hijacks, client_id, run_id, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(name, score, duration, hijacks, clientId, runId, ipHash, now)
      .run();

    const changes = Number(insert && insert.meta && insert.meta.changes) || 0;
    if (changes === 0) {
      return json({ ok: true, duplicate: true });
    }

    const higher = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM scores
       WHERE score > ? OR (score = ? AND created_at < ?)`
    )
      .bind(score, score, now)
      .first();
    const rank = (Number(higher && higher.n) || 0) + 1;

    return json({
      ok: true,
      rank,
      entry: { name, score, duration, hijacks, createdAt: now },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { allow: 'GET, POST, OPTIONS' },
  });
}
