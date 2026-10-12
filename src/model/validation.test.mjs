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
      groups: [], processes: [{ ...base('process'), name: 'Процесс', currentState: '', targetState: '', reason: '', expectedResult: '', status: 'planned', order: 0 }],
      stages: [{ ...base('stage'), processId: 'process', name: 'Этап', purpose: '', plannedStart: exact('2026-10-19'), plannedEnd: exact('2026-10-30'), expectedOutput: '', status: 'planned', order: 0 }],
      checkpoints: [], sharedMilestones: [], dependencies: [], actors: [], participations: [], handovers: [],
      projects: [{ ...base('project'), name: 'Проект', type: '', order: 0, status: 'planned' }],
      deliveries: [{ ...base('delivery'), projectId: 'project', kind: '', name: 'Поставка', startDate: exact('2026-10-19'), checkpointDate: exact('2026-10-23'), deadline: exact('2026-10-30'), status: 'planned', note: '' }],
      lanes: [], weekBlocks: [], planEvents: [], estimates: [], crossLinks: [],
    },
  }
}

test('valid exact dates, matching boundaries and unknown dates are accepted', () => {
  const data = snapshot()
  data.data.stages[0].plannedEnd = exact('2026-10-19')
  data.data.deliveries[0].checkpointDate = unknown()
  validateSnapshot(data)
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
