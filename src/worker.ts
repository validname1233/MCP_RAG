// src/worker.ts —— 入库流水线 worker：进程内异步队列（方案 §8.3）。
// 上传 API 只负责落盘 + 置 queued + enqueue，秒回；本循环串行消化：
// 解析（parsers/registry 回退链）→ 切块（chunker）→ embedding（embed.ts，
// 未配 key 时假向量联调）→ 向量落库（vectorStore 接口，阶段二后段接 LanceDB，
// 当前用 SQLite chunks 表的桩实现）。状态推进 queued→processing→searchable/failed。
//
// 可靠性：队列存内存（Set）+ 状态存 SQLite——启动时扫表把非终态条目重新入队，
// 进程重启不丢任务（"传了文件永远没建索引"不会发生）。

import { readFile } from "node:fs/promises";
import { db } from "./db.ts";
import { parseDocument } from "./parsers/registry.ts";
import { chunkDocument } from "./chunker.ts";
import { embedBatch, embeddingEnabled } from "./embed.ts";
import { vectorStore } from "./vector-store.ts";

const setStatus = db.prepare(
  "UPDATE entries SET status = ?, error = NULL WHERE id = ?",
);
const setFailed = db.prepare(
  "UPDATE entries SET status = 'failed', error = ? WHERE id = ?",
);
const pendingEntries = db.prepare(
  "SELECT id, scope, filename, stored_path FROM entries WHERE status IN ('queued', 'processing') ORDER BY id",
);

// 去重队列：同一条目重复 enqueue 无害（上传重试/启动扫表与内存队列重叠）
const queue = new Set<number>();
let running = false;

export function enqueue(id: number): void {
  queue.add(id);
}

export function startWorker(): void {
  // 启动恢复：非终态条目重新入队（断电/重启前没跑完的）
  const pending = pendingEntries.all() as Array<{ id: number }>;
  for (const p of pending) enqueue(p.id);
  if (pending.length > 0) {
    console.log(`[worker] 启动恢复：${pending.length} 个未完成条目重新入队`);
  }
  running = true;
  void drain();
}

async function drain(): Promise<void> {
  while (running) {
    const id = queue.values().next().value as number | undefined;
    if (id === undefined) {
      // 队列空：轻询（不引入条件变量——家用吞吐下 500ms 轮询开销可忽略）
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    queue.delete(id);
    await processEntry(id);
  }
}

export async function processEntry(id: number): Promise<void> {
  const entry = db.prepare(
    "SELECT id, scope, filename, stored_path FROM entries WHERE id = ?",
  ).get(id) as { id: number; scope: string; filename: string; stored_path: string } | undefined;
  if (entry === undefined || entry.stored_path === "") return;

  setStatus.run("processing", id);
  const t0 = Date.now();
  try {
    const data = await readFile(entry.stored_path);
    const parsed = await parseDocument({
      filename: entry.filename,
      mime: null,
      data,
    });
    const chunks = chunkDocument(entry.filename, parsed.doc.text);
    if (chunks.length === 0) throw new Error("解析出的文本切不出任何块");

    const { vectors, fake } = await embedBatch(
      chunks.map((c) => `${c.prefix}\n${c.text}`),
      id * 1000,
    );

    // 事务性落库：chunks 表 + 向量存储同写同删（删除条目时也走 vectorStore.remove）
    const insertChunk = db.prepare(
      "INSERT INTO chunks (entry_id, idx, heading, prefix, text) VALUES (?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    db.prepare("DELETE FROM chunks WHERE entry_id = ?").run(id); // 重跑场景先清旧块
    for (const c of chunks) insertChunk.run(id, c.index, c.heading, c.prefix, c.text);
    await vectorStore.upsert(entry.scope, id, chunks, vectors);
    db.exec("COMMIT");

    setStatus.run("searchable", id);
    console.log(
      `[worker] #${id} ${entry.filename} 入库完成：${chunks.length} 块，` +
      `${fake ? "假向量" : "真向量"}，+${Date.now() - t0}ms` +
      (parsed.usedParser !== "plain" || parsed.fellBackTo ? `（解析器 ${parsed.usedParser}${parsed.fellBackTo ? "，跳过 " + parsed.fellBackTo : ""}）` : ""),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFailed.run(message.slice(0, 500), id);
    console.error(`[worker] #${id} ${entry.filename} 处理失败：${message.slice(0, 200)}`);
  }
}
