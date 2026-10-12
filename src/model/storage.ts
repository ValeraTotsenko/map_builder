import { BACKUP_FORMAT, SCHEMA_VERSION, createEmptySnapshot, getSnapshotSummary } from './index'
import type { Backup, ImportPreview, Snapshot, SnapshotSummary } from './index'
import { validateSnapshot } from './validation'

const DB_NAME = 'process-planner-workspace'
const STORE = 'snapshots'
const CURRENT = 'current'
const ROLLBACK = 'rollback'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Ошибка IndexedDB'))
  })
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Транзакция IndexedDB отменена'))
    tx.onerror = () => reject(tx.error ?? new Error('Ошибка записи IndexedDB'))
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Этот браузер не поддерживает IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Не удалось открыть IndexedDB'))
    req.onblocked = () => reject(new Error('Хранилище заблокировано другой вкладкой. Закройте её и повторите действие.'))
  })
}

async function readKey(key: string): Promise<Snapshot | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const done = completed(tx)
    const value = await request<Snapshot | undefined>(tx.objectStore(STORE).get(key))
    await done
    return value ?? null
  } finally {
    db.close()
  }
}

/** Reads the persisted workspace, creating a truly empty one on first launch. */
export async function loadSnapshot(): Promise<Snapshot> {
  const existing = await readKey(CURRENT)
  if (existing) {
    validateSnapshot(existing)
    return existing
  }
  const fresh = createEmptySnapshot()
  await saveSnapshot(fresh)
  return fresh
}

/** Persists a complete, validated snapshot as a single IndexedDB value. */
export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  validateSnapshot(snapshot)
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const done = completed(tx)
    tx.objectStore(STORE).put(snapshot, CURRENT)
    await done
  } finally {
    db.close()
  }
}

export function validateBackup(value: unknown): asserts value is Backup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON-копия должна быть объектом')
  const raw = value as Record<string, unknown>
  if (raw.format !== BACKUP_FORMAT) throw new Error(`Неверный идентификатор формата: ожидается ${BACKUP_FORMAT}`)
  if (!Number.isInteger(raw.schemaVersion)) throw new Error('Отсутствует целая версия схемы')
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    if ((raw.schemaVersion as number) > SCHEMA_VERSION) throw new Error(`Копия создана в более новой версии схемы (${raw.schemaVersion}); поддерживается ${SCHEMA_VERSION}`)
    throw new Error(`Версия схемы ${raw.schemaVersion} не поддерживается: миграция не реализована`)
  }
  if (typeof raw.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(raw.exportedAt) || !Number.isFinite(Date.parse(raw.exportedAt)) || new Date(raw.exportedAt).toISOString().slice(0, 19) !== raw.exportedAt.slice(0, 19)) {
    throw new Error('Неверная дата создания копии exportedAt: нужна ISO 8601 UTC')
  }
  validateSnapshot(value)
}

export type PreparedBackup = {
  backup: Backup
  json: string
  filename: string
  summary: SnapshotSummary
}

/** Exports every entity, including objects hidden by current UI filters. */
export async function createBackup(): Promise<PreparedBackup> {
  const snapshot = await loadSnapshot()
  validateSnapshot(snapshot)
  const exportedAt = new Date().toISOString()
  const backup: Backup = { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt, ...snapshot }
  const stamp = exportedAt.slice(0, 16).replace('T', '_').replace(':', '')
  return {
    backup,
    json: JSON.stringify(backup, null, 2),
    filename: `workspace-backup-${stamp}.json`,
    summary: getSnapshotSummary(snapshot),
  }
}

/** Parses and checks the file without changing the current workspace. */
export async function parseBackup(json: string): Promise<ImportPreview> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Неверный JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  validateBackup(parsed)
  const current = await loadSnapshot()
  return {
    backup: parsed,
    incoming: getSnapshotSummary(parsed),
    current: getSnapshotSummary(current),
  }
}

/**
 * Saves the previous state and replaces the entire workspace in one IDB
 * readwrite transaction. Failure aborts both writes; no partial restore.
 */
export async function restoreBackup(backup: Backup): Promise<Snapshot> {
  validateBackup(backup)
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const done = completed(tx)
    const store = tx.objectStore(STORE)
    const previous = await request<Snapshot | undefined>(store.get(CURRENT))
    if (previous) validateSnapshot(previous)
    const rollback = previous ?? createEmptySnapshot()
    store.put(rollback, ROLLBACK)
    store.put({ workspace: backup.workspace, data: backup.data }, CURRENT)
    await done
  } finally {
    db.close()
  }
  return loadSnapshot()
}

/** The previous state remains available until the next successful restore. */
export async function getRollbackSnapshot(): Promise<Snapshot | null> {
  const value = await readKey(ROLLBACK)
  if (value) validateSnapshot(value)
  return value
}

/** Atomically returns to the state saved before the last successful restore. */
export async function rollbackRestore(): Promise<Snapshot> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const done = completed(tx)
    const store = tx.objectStore(STORE)
    const rollback = await request<Snapshot | undefined>(store.get(ROLLBACK))
    if (!rollback) {
      tx.abort()
      throw new Error('Точка возврата отсутствует')
    }
    validateSnapshot(rollback)
    store.put(rollback, CURRENT)
    store.delete(ROLLBACK)
    await done
  } finally {
    db.close()
  }
  return loadSnapshot()
}
