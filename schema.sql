-- 可选：在 Cloudflare D1 控制台手动执行。
-- /api/scores 在第一次请求时也会自动创建同样的表结构。

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  duration REAL NOT NULL,
  hijacks INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_score
  ON scores (score DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_scores_created
  ON scores (created_at);

CREATE INDEX IF NOT EXISTS idx_scores_ip
  ON scores (ip_hash, created_at);
