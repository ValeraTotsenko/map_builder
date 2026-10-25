import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { createId, type PersonalTask, type Snapshot } from '../model'
import { localDateKey, monthDays, tasksForDay } from './taskCalendar'
import './personal.css'

type Status = PersonalTask['status']
const columns: { status: Status; title: string }[] = [
  { status: 'todo', title: 'К выполнению' },
  { status: 'doing', title: 'В работе' },
  { status: 'done', title: 'Сделано' },
]
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

function dateLabel(date: string): string {
  return dayFormat.format(new Date(`${date}T12:00:00`))
}

export function PersonalView({ snapshot, onChange }: { snapshot: Snapshot; onChange: (next: Snapshot) => Promise<boolean> }) {
  const [today, setToday] = useState(() => localDateKey(new Date()))
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selected, setSelected] = useState<string | null>(() => localDateKey(new Date()))
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [plannedDate, setPlannedDate] = useState(today)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const tasks = snapshot.data.personalTasks

  useEffect(() => {
    const update = () => {
      const next = localDateKey(new Date())
      if (next !== today) {
        setToday(next)
        setSelected(selectedDate => selectedDate === today ? next : selectedDate)
        setMonth(currentMonth => {
          if (currentMonth.getFullYear() !== Number(today.slice(0, 4)) || currentMonth.getMonth() + 1 !== Number(today.slice(5, 7))) return currentMonth
          return new Date(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 1)
        })
      }
    }
    const timer = window.setInterval(update, 30_000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [today])

  const days = useMemo(() => monthDays(month.getFullYear(), month.getMonth()), [month])
  const dayTasks = selected ? tasksForDay(tasks, selected, today) : []
  const carried = tasks.filter(task => task.status !== 'done' && task.plannedDate < today).length
  const current = tasksForDay(tasks, today, today)
  const active = current.filter(task => task.status !== 'done').length
  const completed = current.filter(task => task.status === 'done').length

  function saveTasks(nextTasks: PersonalTask[]) {
    void onChange({ ...snapshot, data: { ...snapshot.data, personalTasks: nextTasks } })
  }

  function selectDate(date: string) {
    setSelected(previous => previous === date ? null : date)
    setEditingId(null)
    setTitle(''); setNote(''); setPlannedDate(date < today ? today : date)
  }

  function navigateMonth(offset: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1))
    setSelected(null)
  }

  function startEdit(task: PersonalTask) {
    setEditingId(task.id); setTitle(task.title); setNote(task.note); setPlannedDate(task.plannedDate)
  }

  function clearEditor() {
    setEditingId(null); setTitle(''); setNote(''); setPlannedDate(selected && selected > today ? selected : today)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = title.trim()
    if (!clean || !plannedDate) return
    const now = new Date().toISOString()
    if (editingId) {
      saveTasks(tasks.map(task => task.id === editingId ? { ...task, title: clean, note: note.trim(), plannedDate, updatedAt: now } : task))
    } else {
      saveTasks([...tasks, { id: createId(), createdAt: now, updatedAt: now, title: clean, note: note.trim(), plannedDate, status: 'todo' }])
    }
    clearEditor()
  }

  function moveTask(id: string, status: Status) {
    const now = new Date().toISOString()
    saveTasks(tasks.map(task => task.id === id ? {
      ...task, status, updatedAt: now,
      ...(status === 'done' ? { completedDate: today } : { completedDate: undefined }),
    } : task))
  }

  function drop(event: DragEvent<HTMLElement>, status: Status) {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/plain') || dragId
    if (id && tasks.some(task => task.id === id)) moveTask(id, status)
    setDragId(null)
  }

  return <section className="personal-page">
    <div className="personal-header">
      <div><div className="personal-eyebrow"><CalendarDays size={15}/> Личное пространство</div><h1>Мои задачи</h1><p>План на каждый день. Незавершённые дела автоматически видны сегодня.</p></div>
      <div className="personal-today-summary"><strong>Сегодня</strong><span>{active} в планах · {completed} сделано</span>{carried > 0 && <small>{carried} перенесено с прошлых дней</small>}</div>
    </div>
    <div className="personal-calendar-panel">
      <div className="personal-calendar-toolbar"><h2>{monthFormat.format(month)}</h2><div><button type="button" onClick={() => navigateMonth(-1)} aria-label="Предыдущий месяц"><ChevronLeft size={18}/></button><button type="button" onClick={() => { const now = new Date(); setToday(localDateKey(now)); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(localDateKey(now)); }} >Сегодня</button><button type="button" onClick={() => navigateMonth(1)} aria-label="Следующий месяц"><ChevronRight size={18}/></button></div></div>
      <div className="personal-calendar" aria-label="Календарь личных задач">
        {weekdays.map(day => <div className="personal-weekday" key={day}>{day}</div>)}
        {days.map(day => {
          const entries = tasksForDay(tasks, day.date, today)
          const pending = entries.filter(task => task.status !== 'done').length
          const done = entries.length - pending
          return <button type="button" key={day.date} className={`personal-day ${day.inMonth ? '' : 'outside'} ${day.date === today ? 'today' : ''} ${selected === day.date ? 'selected' : ''}`} onClick={() => selectDate(day.date)} aria-pressed={selected === day.date} aria-label={`${dateLabel(day.date)}: ${pending} в работе или к выполнению, ${done} сделано`}>
            <span className="personal-day-number">{Number(day.date.slice(-2))}</span><span className="personal-day-counts">{pending > 0 && <span className="personal-count pending">{pending} дел</span>}{done > 0 && <span className="personal-count done">{done} готово</span>}</span>
          </button>
        })}
      </div>
    </div>
    {selected ? <div className="personal-board-panel">
      <div className="personal-board-heading"><div><small>Доска дня</small><h2>{dateLabel(selected)}</h2><p>{dayTasks.length} задач{selected === today && carried > 0 ? ` · ${carried} перенесено` : ''}</p></div><button type="button" className="personal-close" onClick={() => setSelected(null)} aria-label="Свернуть доску"><X size={18}/></button></div>
      <form className="personal-editor" onSubmit={submit}><div className="personal-editor-fields"><label>Задача<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Что нужно сделать?" maxLength={200} required/></label><label>Дата<input type="date" value={plannedDate} onChange={event => setPlannedDate(event.target.value)} required/></label><label className="personal-note">Заметка<input value={note} onChange={event => setNote(event.target.value)} placeholder="Необязательно" maxLength={4000}/></label></div><div className="personal-editor-actions"><button className="personal-primary" type="submit"><Plus size={15}/>{editingId ? 'Сохранить' : 'Добавить задачу'}</button>{editingId && <button type="button" onClick={clearEditor}>Отмена</button>}</div></form>
      <div className="personal-board">{columns.map(column => {
        const items = dayTasks.filter(task => task.status === column.status).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        return <section className={`personal-column ${column.status}`} key={column.status} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, column.status)} aria-label={column.title}><h3>{column.title}<span>{items.length}</span></h3><div className="personal-cards">{items.length === 0 && <p className="personal-empty">Пока пусто</p>}{items.map(task => <article className="personal-card" key={task.id} draggable onDragStart={event => { setDragId(task.id); event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragId(null)}><button type="button" className="personal-card-title" onClick={() => startEdit(task)} title="Редактировать задачу">{task.title}</button>{task.note && <p>{task.note}</p>}{task.plannedDate < today && task.status !== 'done' && <small className="personal-overdue">С {dateLabel(task.plannedDate)}</small>}<div className="personal-card-footer"><label>Статус<select value={task.status} onChange={event => moveTask(task.id, event.target.value as Status)} aria-label={`Статус: ${task.title}`}>{columns.map(item => <option value={item.status} key={item.status}>{item.title}</option>)}</select></label><button type="button" className="personal-delete" onClick={() => { if (window.confirm(`Удалить задачу «${task.title}»?`)) saveTasks(tasks.filter(item => item.id !== task.id)) }} aria-label={`Удалить: ${task.title}`}><Trash2 size={15}/></button></div></article>)}</div></section>
      })}</div>
    </div> : <div className="personal-collapsed">Выберите день в календаре, чтобы открыть доску задач.</div>}
  </section>
}
