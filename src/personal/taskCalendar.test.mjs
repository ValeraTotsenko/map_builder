import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [new URL('./taskCalendar.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const { visibleTaskDate, tasksForDay, monthDays } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`)
const task = (id, plannedDate, status, completedDate) => ({ id, plannedDate, status, completedDate })

test('unfinished earlier tasks appear today without changing their planned dates', () => {
  const old = task('old', '2026-10-23', 'todo')
  const active = task('active', '2026-10-24', 'doing')
  const done = task('done', '2026-10-23', 'done', '2026-10-24')
  assert.equal(visibleTaskDate(old, '2026-10-24'), '2026-10-24')
  assert.deepEqual(tasksForDay([old, active, done], '2026-10-24', '2026-10-24').map(item => item.id), ['old', 'active', 'done'])
  assert.deepEqual(tasksForDay([old, active, done], '2026-10-25', '2026-10-25').map(item => item.id), ['old', 'active'])
  assert.equal(old.plannedDate, '2026-10-23')
})

test('month calendar begins Monday and includes adjacent days', () => {
  const days = monthDays(2026, 9)
  assert.equal(days[0].date, '2026-09-28')
  assert.equal(days[0].inMonth, false)
  assert.equal(days.find(day => day.date === '2026-10-01').inMonth, true)
  assert.equal(days.length % 7, 0)
})
