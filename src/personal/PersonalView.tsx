import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, Plus, Trash2, X } from 'lucide-react'
import { createId, type PersonalTask, type Snapshot } from '../model'
import { localDateKey, monthDays, tasksForDay } from './taskCalendar'
import './personal.css'

type Status = PersonalTask['status']
const columns: { status: Status; title: string }[] = [
  { status: 'todo', title: 'К выполнению' },
  { status: 'doing', title: 'В работе' },
  { status: 'done', title: 'Сделано' },
]
const statusActions: Record<Status, { status: Status; label: string }[]> = {
  todo: [{ status: 'doing', label: 'В работу' }, { status: 'done', label: 'Готово' }],
  doing: [{ status: 'todo', label: 'В план' }, { status: 'done', label: 'Готово' }],
  done: [{ status: 'todo', label: 'В план' }, { status: 'doing', label: 'В работу' }],
}
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const monthFormat = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

function dateLabel(date: string): string {
  return dayFormat.format(new Date(`${date}T12:00:00`))
}

function shiftDay(date: string, offset: number): string {
  const day = new Date(`${date}T12:00:00`)
  day.setDate(day.getDate() + offset)
  return localDateKey(day)
}

export function PersonalView({ snapshot, onChange }: { snapshot: Snapshot; onChange: (next: Snapshot) => Promise<boolean> }) {
  const [today, setToday] = useState(() => localDateKey(new Date()))
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selected, setSelected] = useState(() => localDateKey(new Date()))
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [plannedDate, setPlannedDate] = useState(today)
  const [plannedTime, setPlannedTime] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const tasks = snapshot.data.personalTasks

  useEffect(() => {
    if (!editorOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editorOpen])

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
  const dayTasks = tasksForDay(tasks, selected, today)
  const carried = tasks.filter(task => task.status !== 'done' && task.plannedDate < today).length
  const current = tasksForDay(tasks, today, today)
  const active = current.filter(task => task.status !== 'done').length
  const completed = current.filter(task => task.status === 'done').length

  function saveTasks(nextTasks: PersonalTask[]) {
    void onChange({ ...snapshot, data: { ...snapshot.data, personalTasks: nextTasks } })
  }

  function selectDate(date: string) {
    setSelected(date)
    setMonth(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1))
    clearEditor(date)
  }

  function navigateMonth(offset: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1))
  }

  function openAdd() {
    clearEditor(selected)
    setEditorOpen(true)
  }

  function startEdit(task: PersonalTask) {
    setEditingId(task.id); setTitle(task.title); setNote(task.note); setPlannedDate(task.plannedDate); setPlannedTime(task.plannedTime || '')
    setEditorOpen(true)
  }

  function clearEditor(date = selected) {
    setEditingId(null); setTitle(''); setNote(''); setPlannedDate(date > today ? date : today); setPlannedTime('')
  }

  function closeEditor() {
    setEditorOpen(false)
    clearEditor()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = title.trim()
    if (!clean || !plannedDate) return
    const now = new Date().toISOString()
    if (editingId) {
      saveTasks(tasks.map(task => task.id === editingId ? { ...task, title: clean, note: note.trim(), plannedDate, plannedTime: plannedTime || undefined, updatedAt: now } : task))
    } else {
      saveTasks([...tasks, { id: createId(), createdAt: now, updatedAt: now, title: clean, note: note.trim(), plannedDate, plannedTime: plannedTime || undefined, status: 'todo' }])
    }
    closeEditor()
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
      <button type="button" className="personal-calendar-toggle" aria-expanded={calendarOpen} onClick={() => setCalendarOpen(open => !open)}><CalendarDays size={17}/><span>Календарь</span><small>{monthFormat.format(month)}</small><ChevronDown className={calendarOpen ? 'open' : ''} size={17}/></button>
      {calendarOpen && <><div className="personal-calendar-toolbar"><h2>{monthFormat.format(month)}</h2><div><button type="button" onClick={() => navigateMonth(-1)} aria-label="Предыдущий месяц"><ChevronLeft size={18}/></button><button type="button" onClick={() => selectDate(today)}>Сегодня</button><button type="button" onClick={() => navigateMonth(1)} aria-label="Следующий месяц"><ChevronRight size={18}/></button></div></div>
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
      </div></>}
    </div>
    <div className="personal-board-panel">
      <div className="personal-board-heading"><div><small>Доска дня</small><h2>{dateLabel(selected)}</h2><p>{dayTasks.length} задач{selected === today && carried > 0 ? ` · ${carried} перенесено` : ''}</p></div><div className="personal-board-actions"><button type="button" onClick={() => selectDate(shiftDay(selected, -1))} aria-label="Предыдущий день"><ChevronLeft size={17}/></button><button type="button" onClick={() => selectDate(today)}>Сегодня</button><button type="button" onClick={() => selectDate(shiftDay(selected, 1))} aria-label="Следующий день"><ChevronRight size={17}/></button><button type="button" className="personal-primary" onClick={openAdd}><Plus size={16}/>Добавить задачу</button></div></div>
      <div className="personal-board">{columns.map(column => {
        const items = dayTasks.filter(task => task.status === column.status).sort((a, b) => (a.plannedTime || '99:99').localeCompare(b.plannedTime || '99:99') || a.createdAt.localeCompare(b.createdAt))
        return <section className={`personal-column ${column.status}`} key={column.status} onDragOver={event => event.preventDefault()} onDrop={event => drop(event, column.status)} aria-label={column.title}><h3>{column.title}<span>{items.length}</span></h3><div className="personal-cards">{items.length === 0 && <p className="personal-empty">Пока пусто</p>}{items.map(task => <article className="personal-card" key={task.id} draggable onDragStart={event => { setDragId(task.id); event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragId(null)}>{task.plannedTime && <span className="personal-card-time"><Clock3 size={13}/>{task.plannedTime}</span>}<button type="button" className="personal-card-title" onClick={() => startEdit(task)} title="Редактировать задачу">{task.title}</button>{task.note && <p>{task.note}</p>}{task.plannedDate < today && task.status !== 'done' && <small className="personal-overdue">С {dateLabel(task.plannedDate)}</small>}<div className="personal-card-footer"><div className="personal-card-actions">{statusActions[task.status].map(action => <button type="button" key={action.status} className={`personal-status-action ${action.status === 'done' ? 'finish' : ''}`} onClick={() => moveTask(task.id, action.status)} aria-label={`${action.label}: ${task.title}`}>{action.label}</button>)}</div><button type="button" className="personal-delete" onClick={() => { if (window.confirm(`Удалить задачу «${task.title}»?`)) saveTasks(tasks.filter(item => item.id !== task.id)) }} aria-label={`Удалить: ${task.title}`}><Trash2 size={15}/></button></div></article>)}</div></section>
      })}</div>
    </div>
    {editorOpen && <div className="personal-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeEditor() }}><div className="personal-modal" role="dialog" aria-modal="true" aria-labelledby="personal-modal-title"><div className="personal-modal-heading"><div><small>{editingId ? 'Редактирование задачи' : 'Новая задача'}</small><h2 id="personal-modal-title">{editingId ? 'Изменить задачу' : 'Добавить задачу'}</h2></div><button type="button" onClick={closeEditor} aria-label="Закрыть окно"><X size={18}/></button></div><form onSubmit={submit} className="personal-modal-form"><label>Название задачи<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="Что нужно сделать?" maxLength={200} required/></label><div className="personal-modal-schedule"><label>Дата<input type="date" value={plannedDate} onChange={event => setPlannedDate(event.target.value)} required/></label><label>Время (необязательно)<input type="time" value={plannedTime} onChange={event => setPlannedTime(event.target.value)}/></label></div><label>Описание и заметки<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Контекст, шаги или ссылки" maxLength={4000} rows={6}/></label><div className="personal-modal-actions"><button type="button" onClick={closeEditor}>Отмена</button><button type="submit" className="personal-primary">{editingId ? 'Сохранить' : 'Добавить задачу'}</button></div></form></div></div>}
  </section>
}
