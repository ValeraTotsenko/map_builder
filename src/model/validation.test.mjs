import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('./validation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { validateSnapshot } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`)

const instant = '2026-10-12T00:00:00.000Z'
const base = id => ({ id, createdAt: instant, updatedAt: instant })
const exact = date => ({ kind: 'exact', date })
const range = (start, end) => ({ kind: 'range', start, end })
const unknown = () => ({ kind: 'unknown' })

function snapshot() {
  return {
    workspace: {
      ...base('workspace'), name: 'Проверка дат', locale: 'ru-RU', weekStartsOn: 1,
      display: { processScale: 'month', planScale: 'week' },
    },
    data: {
      canvas: { ...base('canvas'), name: 'Схема', viewport: { x: 0, y: 0, zoom: 1 } },
      canvasZones: [], canvasNodes: [], canvasEdges: [],
      groups: [], processes: [{ ...base('process'), name: 'Процесс', currentState: '', targetState: '', reason: '', expectedResult: '', status: 'planned', order: 0 }],
      stages: [{ ...base('stage'), processId: 'process', name: 'Этап', purpose: '', plannedStart: exact('2026-10-19'), plannedEnd: exact('2026-10-30'), expectedOutput: '', status: 'planned', order: 0 }],
      checkpoints: [], sharedMilestones: [], dependencies: [], actors: [], participations: [], handovers: [],
      projects: [{ ...base('project'), name: 'Проект', type: '', order: 0, status: 'planned' }],
      deliveries: [{ ...base('delivery'), projectId: 'project', kind: '', name: 'Поставка', startDate: exact('2026-10-19'), checkpointDate: exact('2026-10-23'), deadline: exact('2026-10-30'), status: 'planned', note: '' }],
      lanes: [], weekBlocks: [], weeklyAssignments: [], personalTasks: [], planEvents: [], estimates: [], crossLinks: [],
    },
  }
}

test('personal tasks accept a valid daily status and reject bad dates or completion state', () => {
  const data = snapshot()
  const task = { ...base('personal-task'), title: 'Проверить релиз', note: '', plannedDate: '2026-10-25', status: 'todo' }
  data.data.personalTasks.push(task)
  validateSnapshot(data)
  task.plannedDate = '2026-02-30'
  assert.throws(() => validateSnapshot(data), /personalTasks\[0\]\.plannedDate/)
  task.plannedDate = '2026-10-25'
  task.status = 'done'
  assert.throws(() => validateSnapshot(data), /personalTasks\[0\]\.completedDate/)
  task.completedDate = '2026-10-25'
  validateSnapshot(data)
})

test('valid exact dates, matching boundaries and unknown dates are accepted', () => {
  const data = snapshot()
  data.data.stages[0].plannedEnd = exact('2026-10-19')
  data.data.deliveries[0].checkpointDate = unknown()
  validateSnapshot(data)
})

test('canvas accepts zones, nodes, cross-zone edges and optional object reference', () => {
  const data = snapshot()
  data.data.canvasZones.push({ ...base('zone'), name: 'Область', color: '#abc', x: -200, y: 12, width: 300, height: 200, zIndex: 0 })
  data.data.canvasNodes.push(
    { ...base('node-1'), kind: 'action', name: 'Шаг', description: '', color: '#abc', x: 0, y: 0, width: 160, height: 80, zIndex: 1, zoneId: 'zone', ref: { type: 'process', id: 'process' } },
    { ...base('node-2'), kind: 'note', name: 'Заметка', description: '', color: '#abc', x: 500, y: 0, width: 160, height: 80, zIndex: 1, zoneId: null },
  )
  data.data.canvasEdges.push({ ...base('edge'), sourceId: 'node-1', targetId: 'node-2', label: 'далее', arrow: 'forward' })
  validateSnapshot(data)
})

test('canvas rejects dangling, self and malformed references', () => {
  const data = snapshot()
  data.data.canvasNodes.push({ ...base('node'), kind: 'action', name: 'Шаг', description: '', color: '#abc', x: 0, y: 0, width: 160, height: 80, zIndex: 1, zoneId: null })
  data.data.canvasEdges.push({ ...base('edge'), sourceId: 'node', targetId: 'missing', label: '', arrow: 'forward' })
  assert.throws(() => validateSnapshot(data), /canvasEdges\[0\]\.targetId/)
  data.data.canvasEdges[0].targetId = 'node'
  assert.throws(() => validateSnapshot(data), /самосвязь/)
  data.data.canvasEdges.length = 0
  data.data.canvasNodes[0].ref = { type: 'project', id: 'missing' }
  assert.throws(() => validateSnapshot(data), /canvasNodes\[0\]\.ref\.id/)
})

test('canvas rejects invalid geometry and nested zones', () => {
  const data = snapshot()
  data.data.canvasZones.push({ ...base('zone'), name: 'Область', color: '#abc', x: 0, y: 0, width: 100, height: 200, zIndex: 0 })
  assert.throws(() => validateSnapshot(data), /canvasZones\[0\]\.width/)
  data.data.canvasZones[0].width = 200
  data.data.canvasZones[0].zoneId = 'zone'
  assert.throws(() => validateSnapshot(data), /зоны не могут вкладываться/)
})

test('stage end before start is rejected at the end field', () => {
  const data = snapshot()
  data.data.stages[0].plannedEnd = exact('2026-10-12')
  assert.throws(() => validateSnapshot(data), /data\.stages\[0\]\.plannedEnd: завершение .* раньше начала/)
})

test('stage approximate ranges reject impossible order and permit overlap', () => {
  const data = snapshot()
  data.data.stages[0].plannedStart = range('2026-11-01', '2026-11-10')
  data.data.stages[0].plannedEnd = range('2026-10-01', '2026-10-31')
  assert.throws(() => validateSnapshot(data), /plannedEnd: завершение/)
  data.data.stages[0].plannedEnd = range('2026-11-05', '2026-11-15')
  validateSnapshot(data)
})

test('single approximate range on a shared milestone has valid boundaries', () => {
  const data = snapshot()
  data.data.sharedMilestones.push({ ...base('milestone'), name: 'Веха', date: range('2026-11-02', '2026-11-01'), purpose: '', confirmation: '', processIds: ['process'] })
  assert.throws(() => validateSnapshot(data), /data\.sharedMilestones\[0\]\.date: начало диапазона позже конца/)
})

test('delivery rejects checkpoint before start and deadline before checkpoint', () => {
  const data = snapshot()
  data.data.deliveries[0].checkpointDate = exact('2026-10-18')
  assert.throws(() => validateSnapshot(data), /checkpointDate: завершение/)
  data.data.deliveries[0].checkpointDate = exact('2026-10-23')
  data.data.deliveries[0].deadline = exact('2026-10-22')
  assert.throws(() => validateSnapshot(data), /deadline: завершение/)
})

test('delivery uses approximate bounds for the complete timeline', () => {
  const data = snapshot()
  data.data.deliveries[0].startDate = range('2026-11-01', '2026-11-10')
  data.data.deliveries[0].checkpointDate = unknown()
  data.data.deliveries[0].deadline = range('2026-10-01', '2026-10-31')
  assert.throws(() => validateSnapshot(data), /deadline: завершение/)
})
