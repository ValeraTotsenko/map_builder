import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [new URL('./storage.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const { migrateSnapshot, normalizeBackup } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`)

const instant = '2026-10-12T00:00:00.000Z'
const base = id => ({ id, createdAt: instant, updatedAt: instant })
const legacy = () => ({
  workspace: { ...base('workspace'), name: 'Старое пространство', locale: 'ru-RU', weekStartsOn: 1, display: { processScale: 'month', planScale: 'week' } },
  data: {
    groups: [], processes: [{ ...base('process'), name: 'Старый процесс', currentState: '', targetState: '', reason: '', expectedResult: '', status: 'planned', order: 0 }],
    stages: [], checkpoints: [], sharedMilestones: [], dependencies: [], actors: [], participations: [], handovers: [],
    projects: [{ ...base('project'), name: 'Старый проект', type: '', order: 0, status: 'planned' }],
    deliveries: [], lanes: [], weekBlocks: [], planEvents: [], estimates: [], crossLinks: [],
  },
})

test('v1 local snapshot migrates to empty canvas and retains roadmap and plan', () => {
  const old = legacy()
  const migrated = migrateSnapshot(old)
  assert.equal(migrated.workspace.id, old.workspace.id)
  assert.deepEqual(migrated.data.processes, old.data.processes)
  assert.deepEqual(migrated.data.projects, old.data.projects)
  assert.equal(migrated.data.canvas.name, 'Схема')
  assert.deepEqual(migrated.data.canvasZones, [])
  assert.deepEqual(migrated.data.canvasNodes, [])
  assert.deepEqual(migrated.data.canvasEdges, [])
  assert.equal(migrateSnapshot(migrated), migrated)
})

test('v1 backup normalizes to v4 while preserving the original sections', () => {
  const old = legacy()
  const normalized = normalizeBackup({ format: 'process-planner-workspace', schemaVersion: 1, exportedAt: instant, ...old })
  assert.equal(normalized.schemaVersion, 4)
  assert.equal(normalized.exportedAt, instant)
  assert.deepEqual(normalized.data.processes, old.data.processes)
  assert.deepEqual(normalized.data.projects, old.data.projects)
  assert.deepEqual(normalized.data.canvasEdges, [])
  assert.deepEqual(normalized.data.personalTasks, [])
})

test('v3 local snapshot and backup gain empty personal tasks without changing existing data', () => {
  const old = migrateSnapshot(legacy())
  delete old.data.personalTasks
  old.data.weeklyAssignments.push({ ...base('assignment'), weekStart: '2026-10-12', projectId: 'project', deliveryId: null, personId: null, title: 'Работа', count: null, note: '' })
  const migrated = migrateSnapshot(old)
  assert.deepEqual(migrated.data.personalTasks, [])
  assert.deepEqual(migrated.data.weeklyAssignments, old.data.weeklyAssignments)
  assert.deepEqual(migrated.data.projects, old.data.projects)
  const normalized = normalizeBackup({ format: 'process-planner-workspace', schemaVersion: 3, exportedAt: instant, ...old })
  assert.equal(normalized.schemaVersion, 4)
  assert.deepEqual(normalized.data.weeklyAssignments, old.data.weeklyAssignments)
  assert.deepEqual(normalized.data.personalTasks, [])
})

test('malformed v1 data and malformed v2 links are rejected', () => {
  const old = legacy()
  old.data.projects[0].id = 'process'
  assert.throws(() => migrateSnapshot(old), /повторяющийся id/)
  old.data.projects[0].id = 'project'
  const latest = migrateSnapshot(old)
  latest.data.canvasEdges.push({ ...base('edge'), sourceId: 'missing', targetId: 'missing-2', label: '', arrow: 'forward' })
  assert.throws(() => normalizeBackup({ format: 'process-planner-workspace', schemaVersion: 2, exportedAt: instant, ...latest }), /canvasEdges\[0\]\.sourceId/)
})
