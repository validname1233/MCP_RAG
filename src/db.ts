// src/db.ts —— 存储层：SQLite 打开/建表/prepared statements + 文件落盘路径。
// 全部同步 API（node:sqlite 的 DatabaseSync）——家用量级（千级条目）下同步读写
// 简单可靠，且都在请求处理器里执行，天然串行化，不需要连接池。

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// 数据目录可注入（tests/ 的白盒脚本用 KB_DATA_DIR=data-test 连独立测试库，
// 绝不碰生产 data/）。注意：模块加载时即连库——使用方必须"先设 env 再 import"
//（两段式动态加载，见 tests/ingest.ts 头部说明）。生产不设该变量，行为不变。
export const DATA_DIR = env.KB_DATA_DIR !== undefined && env.KB_DATA_DIR !== ""
  ? join(ROOT, env.KB_DATA_DIR)
  : join(ROOT, "data");
export const FILES_DIR = join(DATA_DIR, "files");
mkdirSync(FILES_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "kb.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    scope      TEXT PRIMARY KEY,
    token      TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope       TEXT NOT NULL,
    filename    TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    size        INTEGER NOT NULL,
    mime        TEXT,
    status      TEXT NOT NULL DEFAULT 'queued',
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_entries_scope ON entries(scope);
  CREATE TABLE IF NOT EXISTS chunks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    idx      INTEGER NOT NULL,
    heading  TEXT NOT NULL DEFAULT '',
    prefix   TEXT NOT NULL DEFAULT '',
    text     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_entry ON chunks(entry_id);
`);

// vectors 桩表已退役（2026-09-18 迁移至 LanceDB，data/vectors.lance/ 目录，
// 见 src/vector-store.ts）。新库不再建该表；旧库由 scripts/migrate-vectors-to-lance.ts DROP。

// ---------- tokens ----------
export const tokenByScope = db.prepare("SELECT token FROM tokens WHERE scope = ?");
export const scopeByToken = db.prepare("SELECT scope FROM tokens WHERE token = ?");
export const insertToken = db.prepare(
  "INSERT INTO tokens (scope, token) VALUES (?, ?) ON CONFLICT(scope) DO NOTHING",
);

// ---------- entries ----------
// 隔离约定：所有查询都带 scope 条件，由 web.ts 用 token 解析出的 scope 传入——
// SQL 层面强制，前端永远拿不到别的库的 id。
export const insertEntry = db.prepare(
  "INSERT INTO entries (scope, filename, stored_path, size, mime) VALUES (?, ?, ?, ?, ?)",
);
export const entriesByScope = db.prepare(
  "SELECT id, filename, size, mime, status, created_at FROM entries WHERE scope = ? ORDER BY id DESC",
);
export const entryById = db.prepare(
  "SELECT id, scope, filename, stored_path, size, mime FROM entries WHERE id = ? AND scope = ?",
);
export const deleteEntry = db.prepare("DELETE FROM entries WHERE id = ? AND scope = ?");

// 条目文件所在目录：data/files/<scope>/<id>/（scope 的冒号在 ext4 上是合法文件名字符）
export function entryDir(scope: string, id: number): string {
  return join(FILES_DIR, scope, String(id));
}
