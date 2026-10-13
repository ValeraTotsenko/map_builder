import { BACKUP_FORMAT, SCHEMA_VERSION, createEmptyCanvas, createEmptySnapshot, getSnapshotSummary } from './index'
import type { Backup, ImportPreview, Snapshot, SnapshotSummary } from './index'
import { validateLegacySnapshot, validateSnapshot, validateV2Snapshot } from './validation'

const DB_NAME = 'process-planner-workspace-v1'
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

async function readKey(key: string): Promise<unknown | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const done = completed(tx)
    const value = await request<unknown>(tx.objectStore(STORE).get(key))
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
    const snapshot = migrateSnapshot(existing)
    if (snapshot !== existing) await saveSnapshot(snapshot)
    return snapshot
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

export function migrateSnapshot(value: unknown): Snapshot {
  const raw = value as { data?: Record<string, unknown> } | null
  if (raw?.data && !('canvas' in raw.data) && !('canvasZones' in raw.data) && !('canvasNodes' in raw.data) && !('canvasEdges' in raw.data)) {
    validateLegacySnapshot(value)
    const old = value as Omit<Snapshot, 'data'> & { data: Omit<Snapshot['data'], 'canvas' | 'canvasZones' | 'canvasNodes' | 'canvasEdges'> }
    const canvas = createEmptyCanvas()
    const migrated: Snapshot = {
      workspace: old.workspace,
      data: { ...old.data, canvas, canvasZones: [], canvasNodes: [], canvasEdges: [], weeklyAssignments: [] },
    }
    validateSnapshot(migrated)
    return migrated
  }
  if (raw?.data && !('weeklyAssignments' in raw.data)) {
    validateV2Snapshot(value)
    const migrated = { ...(value as Snapshot), data: { ...(value as Snapshot).data, weeklyAssignments: [] } }
    validateSnapshot(migrated)
    return migrated
  }
  validateSnapshot(value)
  return value
}

type LegacyBackup = Omit<Backup, 'schemaVersion' | 'data'> & {
  schemaVersion: 1
  data: Omit<Snapshot['data'], 'canvas' | 'canvasZones' | 'canvasNodes' | 'canvasEdges' | 'weeklyAssignments'>
}

type V2Backup = Omit<Backup, 'schemaVersion' | 'data'> & { schemaVersion: 2; data: Omit<Snapshot['data'], 'weeklyAssignments'> }

export function validateBackup(value: unknown): asserts value is Backup | LegacyBackup | V2Backup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON-копия должна быть объектом')
  const raw = value as Record<string, unknown>
  if (raw.format !== BACKUP_FORMAT) throw new Error(`Неверный идентификатор формата: ожидается ${BACKUP_FORMAT}`)
  if (!Number.isInteger(raw.schemaVersion)) throw new Error('Отсутствует целая версия схемы')
  if (raw.schemaVersion !== SCHEMA_VERSION && raw.schemaVersion !== 1 && raw.schemaVersion !== 2) {
    if ((raw.schemaVersion as number) > SCHEMA_VERSION) throw new Error(`Копия создана в более новой версии схемы (${raw.schemaVersion}); поддерживается ${SCHEMA_VERSION}`)
    throw new Error(`Версия схемы ${raw.schemaVersion} не поддерживается: миграция не реализована`)
  }
  if (typeof raw.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(raw.exportedAt) || !Number.isFinite(Date.parse(raw.exportedAt)) || new Date(raw.exportedAt).toISOString().slice(0, 19) !== raw.exportedAt.slice(0, 19)) {
    throw new Error('Неверная дата создания копии exportedAt: нужна ISO 8601 UTC')
  }
  if (raw.schemaVersion === 1) validateLegacySnapshot(value)
  else if (raw.schemaVersion === 2) validateV2Snapshot(value)
  else validateSnapshot(value)
}

export function normalizeBackup(value: unknown): Backup {
  validateBackup(value)
  if (value.schemaVersion === SCHEMA_VERSION) return value
  const snapshot = migrateSnapshot({ workspace: value.workspace, data: value.data })
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: value.exportedAt, ...snapshot }
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
  const backup = normalizeBackup(parsed)
  const current = await loadSnapshot()
  return {
    backup,
    incoming: getSnapshotSummary(backup),
    current: getSnapshotSummary(current),
  }
}

/**
 * Saves the previous state and replaces the entire workspace in one IDB
 * readwrite transaction. Failure aborts both writes; no partial restore.
 */
export async function restoreBackup(backup: Backup | LegacyBackup | V2Backup): Promise<Snapshot> {
  const normalized = normalizeBackup(backup)
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const done = completed(tx)
    const store = tx.objectStore(STORE)
    const previous = await request<unknown>(store.get(CURRENT))
    const rollback = previous ? migrateSnapshot(previous) : createEmptySnapshot()
    store.put(rollback, ROLLBACK)
    store.put({ workspace: normalized.workspace, data: normalized.data }, CURRENT)
    await done
  } finally {
    db.close()
  }
  return loadSnapshot()
}

/** The previous state remains available until the next successful restore. */
export async function getRollbackSnapshot(): Promise<Snapshot | null> {
  const value = await readKey(ROLLBACK)
  return value ? migrateSnapshot(value) : null
}

/** Atomically returns to the state saved before the last successful restore. */
export async function rollbackRestore(): Promise<Snapshot> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const done = completed(tx)
    const store = tx.objectStore(STORE)
    const rollback = await request<unknown>(store.get(ROLLBACK))
    if (!rollback) {
      tx.abort()
      throw new Error('Точка возврата отсутствует')
    }
    store.put(migrateSnapshot(rollback), CURRENT)
    store.delete(ROLLBACK)
    await done
  } finally {
    db.close()
  }
  return loadSnapshot()
}
