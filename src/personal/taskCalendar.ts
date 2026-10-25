import type { PersonalTask } from '../model'

/** Calendar dates use the browser's local day, independent of UTC timestamps. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function visibleTaskDate(task: PersonalTask, today: string): string {
  if (task.status === 'done') return task.completedDate ?? task.plannedDate
  return task.plannedDate < today ? today : task.plannedDate
}

export function tasksForDay(tasks: PersonalTask[], date: string, today: string): PersonalTask[] {
  return tasks.filter(task => visibleTaskDate(task, today) === date)
}

export function monthDays(year: number, month: number): Array<{ date: string; inMonth: boolean }> {
  const first = new Date(year, month, 1)
  const start = (first.getDay() + 6) % 7
  const length = new Date(year, month + 1, 0).getDate()
  const slots = Math.ceil((start + length) / 7) * 7
  return Array.from({ length: slots }, (_, index) => {
    const day = new Date(year, month, 1 - start + index)
    return { date: localDateKey(day), inMonth: day.getMonth() === month }
  })
}
