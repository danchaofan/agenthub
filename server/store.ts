import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config, Discovery, Model, Quota, Task } from './types.js';

export class Store {
  private db: DatabaseSync;
  private ownsLease = false;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, body TEXT NOT NULL);',
    );
    if (path !== ':memory:') chmodSync(path, 0o600);
  }
  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  config() {
    return this.get<Config>('config');
  }
  discovery() {
    return this.get<Discovery>('discovery');
  }
  quota() {
    return this.get<Quota>('quota');
  }
  models() {
    return this.get<Model[]>('models');
  }
  task(id: string): Task | undefined {
    const row = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id) as
      { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  saveTask(task: Task) {
    task.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO tasks(id,updated_at,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,body=excluded.body',
      )
      .run(task.id, task.updatedAt, JSON.stringify(task));
  }
  tasks(): Task[] {
    return (
      this.db.prepare('SELECT body FROM tasks ORDER BY updated_at DESC').all() as { body: string }[]
    ).map((row) => JSON.parse(row.body));
  }
  recoverInterrupted() {
    for (const task of this.tasks()) {
      if (
        ['planning', 'executing', 'reviewing', 'reworking', 'summarizing'].includes(task.status) ||
        task.pendingInputs.length
      ) {
        task.status = 'interrupted';
        task.error =
          '服务重启中断了这一轮。请检查现有产物，再反馈并重新确认分工；不会自动重放命令。';
        task.pendingInputs = [];
        for (const log of task.logs)
          if (log.execution?.status === 'running') {
            log.execution.status = 'interrupted';
            log.execution.finishedAt = new Date().toISOString();
          }
        this.saveTask(task);
      }
    }
  }
  summaries() {
    return this.db
      .prepare(
        "SELECT id, json_extract(body,'$.title') AS title, json_extract(body,'$.projectPath') AS projectPath, json_extract(body,'$.status') AS status, json_array_length(json_extract(body,'$.rounds')) AS rounds, updated_at AS updatedAt FROM tasks ORDER BY updated_at DESC",
      )
      .all();
  }
  acquireService() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.get<{ pid: number }>('_runtime');
      if (previous?.pid) {
        let alive = true;
        try {
          process.kill(previous.pid, 0);
        } catch (e: any) {
          if (e.code === 'ESRCH') alive = false;
        }
        if (alive)
          throw new Error('该数据目录已有服务运行，请先停止，或使用另一个 AGENTHUB_DATA_DIR');
      }
      this.set('_runtime', { pid: process.pid });
      this.db.exec('COMMIT');
      this.ownsLease = true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    if (this.ownsLease) this.db.prepare('DELETE FROM settings WHERE key=?').run('_runtime');
    this.db.close();
  }
}
