import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from "node:sqlite";
import { createRequire } from "node:module";
// 与宿主既有 SQLite Repo 一致，避免旧构建器把原生 node:sqlite 改写为 npm sqlite。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
import type {
  Attachment,
  ChatMessage,
  Conversation,
  MemoryItem,
  ResearchProgress,
  Role,
} from "@mycode/shared/mychat";

let db: SQLiteDatabase | null = null;
let filePath = "";
export function databasePath(): string {
  return filePath;
}
function run(sql: string, params: unknown[] = []): void {
  db!.prepare(sql).run(...(params as SQLInputValue[]));
}
export function transaction(action: () => void): void {
  db!.exec("BEGIN IMMEDIATE");
  try {
    action();
    db!.exec("COMMIT");
  } catch (error) {
    db!.exec("ROLLBACK");
    throw error;
  }
}
function all<T>(sql: string, params: unknown[] = []): T[] {
  return db!.prepare(sql).all(...(params as SQLInputValue[])) as T[];
}
export function readSetting<T>(key: string, fallback: T): T {
  const row = all<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])[0];
  return row ? (JSON.parse(row.value) as T) : fallback;
}
export function writeSetting(key: string, value: unknown): void {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, JSON.stringify(value)],
  );
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseAttachments(value: string | null | undefined): Attachment[] {
  const list = parseJson<unknown[]>(value, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Attachment =>
      Boolean(item && typeof item === "object" && "name" in item && "mime" in item),
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
      mime: String(item.mime || "application/octet-stream"),
      name: String(item.name || "attachment"),
      dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : undefined,
      path: typeof item.path === "string" ? item.path : undefined,
      relativePath: typeof item.relativePath === "string" ? item.relativePath : undefined,
      size: typeof item.size === "number" ? item.size : undefined,
      kind: typeof item.kind === "string" ? (item.kind as Attachment["kind"]) : undefined,
      frames: Array.isArray(item.frames)
        ? item.frames.filter((frame): frame is string => typeof frame === "string")
        : undefined,
      duration: typeof item.duration === "number" ? item.duration : undefined,
      text: typeof item.text === "string" ? item.text : undefined,
    }));
}

function parseResearch(value: string | null | undefined): ResearchProgress | undefined {
  const fallback = undefined;
  if (!value) return fallback;
  try {
    const obj = JSON.parse(value);
    if (obj && typeof obj === "object" && Array.isArray(obj.steps)) {
      return obj as ResearchProgress;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function initDb(dataDir: string): Promise<void> {
  if (db) {
    if (filePath !== join(dataDir, "mychat.sqlite"))
      throw new Error("MyChat database owner cannot change data directories");
    return;
  }
  await mkdir(dataDir, { recursive: true });
  filePath = join(dataDir, "mychat.sqlite");
  db = new DatabaseSync(filePath);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      thinking TEXT NOT NULL DEFAULT '',
      attachments TEXT NOT NULL DEFAULT '[]',
      research TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
  `);
  try {
    db.exec("ALTER TABLE messages ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Existing databases with the column need no migration.
  }
  try {
    db.exec("ALTER TABLE messages ADD COLUMN research TEXT NOT NULL DEFAULT ''");
  } catch {
    // Existing databases with the column need no migration.
  }
}

export function listConversations(): Conversation[] {
  return all<{ id: string; title: string; created_at: number; updated_at: number }>(
    "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC",
  ).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function searchConversations(query: string): Conversation[] {
  const q = `%${escapeLike(query.trim())}%`;
  if (!query.trim()) return listConversations();
  return all<{ id: string; title: string; created_at: number; updated_at: number }>(
    `SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at
     FROM conversations c
     LEFT JOIN messages m ON m.conversation_id = c.id
     WHERE c.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\'
     ORDER BY c.updated_at DESC`,
    [q, q],
  ).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export function getConversation(id: string): Conversation | null {
  const row = all<{ id: string; title: string; created_at: number; updated_at: number }>(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?",
    [id],
  )[0];
  if (!row) return null;
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createConversation(title = "新对话"): Conversation {
  const id = crypto.randomUUID();
  const now = Date.now();
  run("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", [
    id,
    title,
    now,
    now,
  ]);
  return { id, title, createdAt: now, updatedAt: now };
}

export function renameConversation(id: string, title: string): void {
  run("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?", [title, Date.now(), id]);
}

export function touchConversation(id: string): void {
  run("UPDATE conversations SET updated_at = ? WHERE id = ?", [Date.now(), id]);
}

export function deleteConversation(id: string): void {
  transaction(() => {
    run("DELETE FROM messages WHERE conversation_id = ?", [id]);
    run("DELETE FROM conversations WHERE id = ?", [id]);
  });
}

export function deleteAllConversations(): void {
  transaction(() => {
    run("DELETE FROM messages");
    run("DELETE FROM conversations");
  });
}

function rowToMessage(row: {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  thinking: string;
  attachments: string;
  research: string;
  duration_seconds: number;
  created_at: number;
}): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Role,
    content: row.content,
    thinking: row.thinking,
    attachments: parseAttachments(row.attachments),
    research: parseResearch(row.research),
    durationSeconds: row.duration_seconds || undefined,
    createdAt: row.created_at,
  };
}

export function listMessages(conversationId: string): ChatMessage[] {
  return all<{
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    thinking: string;
    attachments: string;
    research: string;
    duration_seconds: number;
    created_at: number;
  }>(
    "SELECT id, conversation_id, role, content, thinking, attachments, research, duration_seconds, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
    [conversationId],
  ).map(rowToMessage);
}

export function insertMessage(message: ChatMessage): void {
  run(
    "INSERT INTO messages (id, conversation_id, role, content, thinking, attachments, research, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.thinking,
      JSON.stringify(message.attachments),
      message.research ? JSON.stringify(message.research) : "",
      message.durationSeconds || 0,
      message.createdAt,
    ],
  );
  touchConversation(message.conversationId);
}

export function updateMessage(
  id: string,
  patch: {
    content?: string;
    thinking?: string;
    research?: ResearchProgress;
    durationSeconds?: number;
  },
): void {
  const current = all<{
    content: string;
    thinking: string;
    research: string;
    duration_seconds: number;
  }>("SELECT content, thinking, research, duration_seconds FROM messages WHERE id = ?", [id])[0];
  if (!current) return;
  run(
    "UPDATE messages SET content = ?, thinking = ?, research = ?, duration_seconds = ? WHERE id = ?",
    [
      patch.content ?? current.content,
      patch.thinking ?? current.thinking,
      patch.research ? JSON.stringify(patch.research) : current.research,
      patch.durationSeconds ?? current.duration_seconds,
      id,
    ],
  );
}

export function deleteMessage(id: string): void {
  run("DELETE FROM messages WHERE id = ?", [id]);
}

export function listMemories(): MemoryItem[] {
  return all<{ id: string; content: string; source_id: string; created_at: number }>(
    "SELECT id, content, source_id, created_at FROM memories ORDER BY created_at DESC LIMIT 200",
  ).map((row) => ({
    id: row.id,
    content: row.content,
    sourceId: row.source_id,
    createdAt: row.created_at,
  }));
}

export function addMemory(content: string, sourceId: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  const exists = all<{ id: string }>(
    "SELECT id FROM memories WHERE content = ? AND source_id = ?",
    [trimmed, sourceId],
  )[0];
  if (exists) return;
  run("INSERT INTO memories (id, content, source_id, created_at) VALUES (?, ?, ?, ?)", [
    crypto.randomUUID(),
    trimmed,
    sourceId,
    Date.now(),
  ]);
}

export function searchMemories(query: string, sourceId: string, limit = 8): MemoryItem[] {
  const q = `%${escapeLike(query.trim())}%`;
  return all<{ id: string; content: string; source_id: string; created_at: number }>(
    "SELECT id, content, source_id, created_at FROM memories WHERE source_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?",
    [sourceId, q, limit],
  ).map((row) => ({
    id: row.id,
    content: row.content,
    sourceId: row.source_id,
    createdAt: row.created_at,
  }));
}

export function recentMemories(sourceId: string, limit = 12): MemoryItem[] {
  return all<{ id: string; content: string; source_id: string; created_at: number }>(
    "SELECT id, content, source_id, created_at FROM memories WHERE source_id = ? ORDER BY created_at DESC LIMIT ?",
    [sourceId, limit],
  ).map((row) => ({
    id: row.id,
    content: row.content,
    sourceId: row.source_id,
    createdAt: row.created_at,
  }));
}

export function clearMemories(): void {
  run("DELETE FROM memories");
}

export function flushDb(): void {
  db?.exec("PRAGMA wal_checkpoint(PASSIVE)");
}
export function closeDb(): void {
  db?.close();
  db = null;
}
