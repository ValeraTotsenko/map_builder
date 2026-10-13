import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Actor, Checkpoint, DateReference, Dependency, Group, Handover, Participation, Process, SharedMilestone, Snapshot, Stage, WorkspaceData } from '../model'
import { createId, unknownDate, validateDateOrder, validateDateReference, validateSnapshot } from '../model'
import { DraggableDialog } from '../DraggableDialog'
import { ProcessHelpDialog } from './ProcessHelpDialog'
import './ProcessView.css'

type Kind = 'group' | 'process' | 'stage' | 'checkpoint' | 'milestone' | 'actor' | 'participation' | 'handover' | 'dependency'
type Selection = { kind: Kind; id: string }
type Row = { kind: 'milestone' | 'group' | 'process' | 'stage' | 'checkpoint'; id: string; depth: number; groupId?: string | null; processId?: string; label: string; status?: string; color?: string }
type Draft = Record<string, any>
type Props = { snapshot: Snapshot; onChange(next: Snapshot): void; onNavigateToPlan(targetId: string): void; initialSelection?: string }

const collection: Record<Kind, keyof WorkspaceData> = { group: 'groups', process: 'processes', stage: 'stages', checkpoint: 'checkpoints', milestone: 'sharedMilestones', actor: 'actors', participation: 'participations', handover: 'handovers', dependency: 'dependencies' }
const kindTitle: Record<Kind, string> = { group: 'Группа процессов', process: 'Процесс', stage: 'Этап изменения', checkpoint: 'Контрольная точка', milestone: 'Общая веха', actor: 'Участник', participation: 'Участие', handover: 'Передача результата', dependency: 'Зависимость' }
const statusOptions = ['Не начато', 'В работе', 'На проверке', 'Завершено', 'Приостановлено']
const participationTypes: Record<Participation['type'], string> = { responsible: 'Ответственен', participates: 'Участвует', approves: 'Согласует', provides: 'Предоставляет' }
const actorTypes: Record<Actor['type'], string> = { department: 'Отдел/команда', role: 'Роль', person: 'Человек' }
const stamp = () => new Date().toISOString()
const base = () => ({ id: createId(), createdAt: stamp(), updatedAt: stamp() })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (s: string) => new Date(`${s}T12:00:00Z`)
const plusDays = (s: string, count: number) => { const d = day(s); d.setUTCDate(d.getUTCDate() + count); return iso(d) }
const monday = (s: string) => plusDays(s, -((day(s).getUTCDay() + 6) % 7))
const today = () => iso(new Date())
const refStart = (ref?: DateReference) => ref?.kind === 'exact' ? ref.date : ref?.kind === 'range' ? ref.start : undefined
const refEnd = (ref?: DateReference) => ref?.kind === 'exact' ? ref.date : ref?.kind === 'range' ? ref.end : undefined
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(day(value)) : 'Без даты'
const shortMonth = (value: string) => new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(day(value)).replace('.', '')
const weekCaption = (start: string) => {
  const end = plusDays(start, 6)
  const startDay = Number(start.slice(8)), endDay = Number(end.slice(8))
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${startDay}–${endDay} ${shortMonth(end)}`
    : `${startDay} ${shortMonth(start)} – ${endDay} ${shortMonth(end)}`
}
const isoWeekNumber = (start: string) => {
  const thursday = day(start)
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7)
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4, 12))
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - (firstThursday.getUTCDay() + 6) % 7)
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000))
}
const formatRef = (ref?: DateReference) => ref?.kind === 'exact' ? formatDate(ref.date) : ref?.kind === 'range' ? `${formatDate(ref.start)} — ${formatDate(ref.end)}` : ref?.text || 'Не запланировано'
const safeStatus = (s?: string) => s || 'Не начато'
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase('ru')).join('') || '•'

function makeDraft(kind: Kind, data: WorkspaceData, context?: Selection): Draft {
  const common = base()
  const processId = context?.kind === 'process' ? context.id : context?.kind === 'stage' ? data.stages.find(x => x.id === context.id)?.processId : data.processes[0]?.id
  switch (kind) {
    case 'group': return { ...common, name: '', color: '#2563EB', order: data.groups.length }
    case 'process': return { ...common, groupId: context?.kind === 'group' && context.id !== '_ungrouped' ? context.id : null, name: '', currentState: '', targetState: '', reason: '', expectedResult: '', status: 'Не начато', priority: '', order: data.processes.length, note: '' }
    case 'stage': return { ...common, processId: processId || '', name: '', purpose: '', plannedStart: unknownDate(), plannedEnd: unknownDate(), expectedOutput: '', status: 'Не начато', order: data.stages.length }
    case 'checkpoint': return { ...common, processId: processId || '', stageId: context?.kind === 'stage' ? context.id : null, name: '', plannedDate: unknownDate(), actualDate: unknownDate(), confirmation: '', status: 'Не начато' }
    case 'milestone': return { ...common, name: '', date: unknownDate(), purpose: '', confirmation: '', processIds: processId ? [processId] : [] }
    case 'actor': return { ...common, type: 'person', name: '', departmentId: null, color: '#64748B' }
    case 'participation': return { ...common, actorId: data.actors[0]?.id || '', targetType: context?.kind === 'stage' || context?.kind === 'checkpoint' ? context.kind : 'process', targetId: context?.kind === 'stage' || context?.kind === 'checkpoint' || context?.kind === 'process' ? context.id : processId || '', type: 'participates', expectedContribution: '' }
    case 'handover': return { ...common, fromActorId: data.actors[0]?.id || '', toActorId: data.actors[1]?.id || '', targetType: context?.kind === 'stage' ? 'stage' : 'process', targetId: context?.kind === 'stage' || context?.kind === 'process' ? context.id : processId || '', checkpointId: null, description: '' }
    case 'dependency': { const sourceId = context?.kind === 'stage' || context?.kind === 'process' ? context.id : data.processes[0]?.id || ''; return { ...common, sourceType: context?.kind === 'stage' ? 'stage' : 'process', sourceId, targetType: 'process', targetId: data.processes.find(x => x.id !== sourceId)?.id || '', type: 'prerequisite', note: '' } }
  }
}

function dateRefField(label: string, value: DateReference, change: (value: DateReference) => void, error?: string) {
  const ref = value || unknownDate()
  return <div className="pv-form-section" key={label} style={{ textTransform: 'none', letterSpacing: 0 }}>
    <label>{label}<select value={ref.kind} onChange={e => change(e.target.value === 'exact' ? { kind: 'exact', date: today() } : e.target.value === 'range' ? { kind: 'range', start: today(), end: today() } : { kind: 'unknown', text: ref.text || '' })}>
      <option value="unknown">Срок неизвестен</option><option value="exact">Точная дата</option><option value="range">Ориентировочный диапазон</option>
    </select></label>
    {ref.kind === 'exact' && <label>Дата<input type="date" value={ref.date} onChange={e => change({ ...ref, date: e.target.value })} /></label>}
    {ref.kind === 'range' && <div className="pv-inline"><label>С<input type="date" value={ref.start} onChange={e => change({ ...ref, start: e.target.value })} /></label><label>По<input type="date" value={ref.end} onChange={e => change({ ...ref, end: e.target.value })} /></label></div>}
    <label>Словесный ориентир<input value={ref.text || ''} onChange={e => change({ ...ref, text: e.target.value })} placeholder="Например, после утверждения" /></label>
    {error && <span className="pv-field-error" role="alert">{error}</span>}
  </div>
}

function countConsequences(kind: Kind, id: string, data: WorkspaceData): string[] {
  const lines: string[] = []
  const add = (label: string, n: number) => { if (n) lines.push(`${label}: ${n}`) }
  if (kind === 'group') add('Процессы будут перемещены в «Без группы»', data.processes.filter(x => x.groupId === id).length)
  if (kind === 'process') {
    const stageIds = data.stages.filter(x => x.processId === id).map(x => x.id)
    const pointIds = data.checkpoints.filter(x => x.processId === id).map(x => x.id)
    add('Этапы', stageIds.length); add('Контрольные точки', pointIds.length)
    add('Зависимости', data.dependencies.filter(x => [id, ...stageIds].includes(x.sourceId) || [id, ...stageIds].includes(x.targetId)).length)
    add('Участие', data.participations.filter(x => x.targetId === id || stageIds.includes(x.targetId) || pointIds.includes(x.targetId)).length)
    add('Передачи', data.handovers.filter(x => [id, ...stageIds].includes(x.targetId) || pointIds.includes(x.checkpointId || '')).length)
    add('Привязки общих вех будут сняты', data.sharedMilestones.filter(x => x.processIds.includes(id)).length)
    add('Межэкранные связи', data.crossLinks.filter(x => stageIds.includes(x.targetId) || pointIds.includes(x.targetId)).length)
  }
  if (kind === 'stage') { add('Контрольные точки будут отвязаны от этапа', data.checkpoints.filter(x => x.stageId === id).length); add('Зависимости', data.dependencies.filter(x => x.sourceId === id || x.targetId === id).length); add('Участие', data.participations.filter(x => x.targetId === id).length); add('Передачи', data.handovers.filter(x => x.targetId === id).length); add('Межэкранные связи', data.crossLinks.filter(x => x.targetId === id).length) }
  if (kind === 'checkpoint') { add('Участие', data.participations.filter(x => x.targetId === id).length); add('Ссылки передач будут сняты', data.handovers.filter(x => x.checkpointId === id).length); add('Межэкранные связи', data.crossLinks.filter(x => x.targetId === id).length) }
  if (kind === 'actor') { add('Участие', data.participations.filter(x => x.actorId === id).length); add('Передачи', data.handovers.filter(x => x.fromActorId === id || x.toActorId === id).length); add('Назначения плана', data.weekBlocks.filter(x => x.personId === id).length); add('Владение поставками', data.deliveries.filter(x => x.ownerActorId === id).length); add('События плана', data.planEvents.filter(x => x.actorId === id).length); add('Принадлежность участников к отделу будет снята', data.actors.filter(x => x.departmentId === id).length) }
  return lines
}

function removeRelated(data: WorkspaceData, selection: Selection, replacementId?: string): WorkspaceData {
  const { kind, id } = selection
  const next: WorkspaceData = { ...data, groups: [...data.groups], processes: [...data.processes], stages: [...data.stages], checkpoints: [...data.checkpoints], sharedMilestones: [...data.sharedMilestones], dependencies: [...data.dependencies], actors: [...data.actors], participations: [...data.participations], handovers: [...data.handovers], projects: [...data.projects], deliveries: [...data.deliveries], lanes: [...data.lanes], weekBlocks: [...data.weekBlocks], planEvents: [...data.planEvents], estimates: [...data.estimates], crossLinks: [...data.crossLinks] }
  if (kind === 'group') { next.groups = next.groups.filter(x => x.id !== id); next.processes = next.processes.map(x => x.groupId === id ? { ...x, groupId: null, updatedAt: stamp() } : x) }
  if (kind === 'process') {
    const stageIds = next.stages.filter(x => x.processId === id).map(x => x.id)
    const pointIds = next.checkpoints.filter(x => x.processId === id).map(x => x.id)
    const ids = [id, ...stageIds, ...pointIds]
    next.processes = next.processes.filter(x => x.id !== id); next.stages = next.stages.filter(x => x.processId !== id); next.checkpoints = next.checkpoints.filter(x => x.processId !== id)
    next.dependencies = next.dependencies.filter(x => !ids.includes(x.sourceId) && !ids.includes(x.targetId))
    next.participations = next.participations.filter(x => !ids.includes(x.targetId)); next.handovers = next.handovers.filter(x => !ids.includes(x.targetId) && !pointIds.includes(x.checkpointId || ''))
    next.crossLinks = next.crossLinks.filter(x => !ids.includes(x.targetId)); next.sharedMilestones = next.sharedMilestones.map(x => ({ ...x, processIds: x.processIds.filter(y => y !== id) }))
  }
  if (kind === 'stage') { next.stages = next.stages.filter(x => x.id !== id); next.checkpoints = next.checkpoints.map(x => x.stageId === id ? { ...x, stageId: null, updatedAt: stamp() } : x); next.dependencies = next.dependencies.filter(x => x.sourceId !== id && x.targetId !== id); next.participations = next.participations.filter(x => x.targetId !== id); next.handovers = next.handovers.filter(x => x.targetId !== id); next.crossLinks = next.crossLinks.filter(x => x.targetId !== id) }
  if (kind === 'checkpoint') { next.checkpoints = next.checkpoints.filter(x => x.id !== id); next.participations = next.participations.filter(x => x.targetId !== id); next.handovers = next.handovers.map(x => x.checkpointId === id ? { ...x, checkpointId: null, updatedAt: stamp() } : x); next.crossLinks = next.crossLinks.filter(x => x.targetId !== id) }
  if (kind === 'milestone') next.sharedMilestones = next.sharedMilestones.filter(x => x.id !== id)
  if (kind === 'actor') {
    next.actors = next.actors.filter(x => x.id !== id).map(x => x.departmentId === id ? { ...x, departmentId: replacementId || null, updatedAt: stamp() } : x)
    next.participations = replacementId ? next.participations.map(x => x.actorId === id ? { ...x, actorId: replacementId, updatedAt: stamp() } : x) : next.participations.filter(x => x.actorId !== id)
    next.handovers = replacementId ? next.handovers.map(x => ({ ...x, fromActorId: x.fromActorId === id ? replacementId : x.fromActorId, toActorId: x.toActorId === id ? replacementId : x.toActorId, updatedAt: stamp() })).filter(x => x.fromActorId !== x.toActorId) : next.handovers.filter(x => x.fromActorId !== id && x.toActorId !== id)
    next.weekBlocks = next.weekBlocks.map(x => x.personId === id ? { ...x, personId: replacementId || null, updatedAt: stamp() } : x)
    next.deliveries = next.deliveries.map(x => x.ownerActorId === id ? { ...x, ownerActorId: replacementId || null, updatedAt: stamp() } : x)
    next.planEvents = next.planEvents.map(x => x.actorId === id ? { ...x, actorId: replacementId || null, updatedAt: stamp() } : x)
  }
  if (kind === 'participation') next.participations = next.participations.filter(x => x.id !== id)
  if (kind === 'handover') next.handovers = next.handovers.filter(x => x.id !== id)
  if (kind === 'dependency') next.dependencies = next.dependencies.filter(x => x.id !== id)
  return next
}

export function ProcessView({ snapshot, onChange, onNavigateToPlan, initialSelection }: Props) {
  const data = snapshot.data
  const [selected, setSelected] = useState<Selection | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [replacementId, setReplacementId] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [actorsOpen, setActorsOpen] = useState(false)
  const [showAllLinks, setShowAllLinks] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [collapsedProcesses, setCollapsedProcesses] = useState<string[]>([])
  const [scale, setScale] = useState<'week' | 'month'>(snapshot.workspace.display.processScale)
  const [anchor, setAnchor] = useState(monday(today()))
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(true)
  const [formError, setFormError] = useState<{ field: string; message: string } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const select = (kind: Kind, id: string) => {
    const item = (data[collection[kind]] as Array<{ id: string }>).find(x => x.id === id)
    if (!item) return
    setSelected({ kind, id }); setDraft({ ...item }); setIsNew(false); setConfirmDelete(false); setFormError(null); setInspectorOpen(true)
    if (kind === 'stage') {
      const stage = item as Stage
      const start = refStart(stage.plannedStart), end = refEnd(stage.plannedEnd)
      if (start && end && day(end).getTime() - day(start).getTime() <= 28 * 86400000) {
        setScale('week'); setAnchor(monday(start))
      }
    }
  }
  useEffect(() => {
    if (!initialSelection) return
    for (const kind of ['stage', 'checkpoint'] as Kind[]) {
      if ((data[collection[kind]] as Array<{ id: string }>).some(x => x.id === initialSelection)) {
        const processId = kind === 'stage' ? data.stages.find(x => x.id === initialSelection)?.processId : data.checkpoints.find(x => x.id === initialSelection)?.processId
        const groupId = data.processes.find(x => x.id === processId)?.groupId || '_ungrouped'
        setSearch(''); setStatusFilter(''); setGroupFilter('')
        setCollapsedProcesses(x => x.filter(id => id !== processId))
        setCollapsedGroups(x => x.filter(id => id !== groupId))
        select(kind, initialSelection)
        break
      }
    }
  }, [initialSelection])
  const create = (kind: Kind, context?: Selection) => { const next = makeDraft(kind, data, context || (!isNew ? selected : null) || undefined); setSelected({ kind, id: next.id }); setDraft(next); setIsNew(true); setConfirmDelete(false); setFormError(null); setInspectorOpen(true) }
  const close = () => { setInspectorOpen(false); setSelected(null); setDraft(null); setConfirmDelete(false); setFormError(null) }
  const change = (field: string, value: any) => { setFormError(null); setDraft(prev => {
    if (!prev) return prev
    const next = { ...prev, [field]: value }
    if (field === 'targetType' && prev.targetType !== value) next.targetId = ''
    if (field === 'sourceType' && prev.sourceType !== value) next.sourceId = ''
    if (field === 'processId' && selected?.kind === 'checkpoint' && prev.processId !== value) next.stageId = null
    if (field === 'type' && selected?.kind === 'actor' && value === 'department') next.departmentId = null
    if (field === 'sourceId' && prev.sourceId !== value && next.targetId === value) next.targetId = ''
    if (field === 'sourceType' && prev.sourceType !== value && next.targetId === next.sourceId) next.targetId = ''
    return next
  }) }
  const save = () => {
    if (!selected || !draft) return
    const fail = (field: string, message: string) => { setFormError({ field, message }); return }
    if ('name' in draft && !String(draft.name || '').trim()) return fail('name', 'Укажите название.')
    if ((selected.kind === 'stage' || selected.kind === 'checkpoint') && !draft.processId) return fail('processId', 'Выберите процесс.')
    if (selected.kind === 'participation') {
      if (!draft.actorId) return fail('actorId', 'Выберите участника.')
      if (!draft.targetId) return fail('targetId', 'Выберите объект.')
    }
    if (selected.kind === 'handover') {
      if (!draft.fromActorId) return fail('fromActorId', 'Выберите участника, который передаёт результат.')
      if (!draft.toActorId || draft.fromActorId === draft.toActorId) return fail('toActorId', 'Выберите другого участника.')
      if (!draft.targetId) return fail('targetId', 'Выберите объект передачи.')
    }
    if (selected.kind === 'dependency') {
      if (!draft.sourceId) return fail('sourceId', 'Выберите источник.')
      if (!draft.targetId || draft.sourceId === draft.targetId) return fail('targetId', 'Выберите другую цель связи.')
    }
    if (selected.kind === 'actor' && !isNew) {
      const previous = data.actors.find(x => x.id === selected.id)
      if (previous?.type === 'department' && draft.type !== 'department' && data.actors.some(x => x.departmentId === selected.id)) return fail('type', 'Сначала переназначьте участников этого отдела.')
      if (previous?.type === 'person' && draft.type !== 'person' && data.weekBlocks.some(x => x.personId === selected.id)) return fail('type', 'Сначала переназначьте недельные блоки этого человека.')
    }
    for (const [field, value] of Object.entries(draft)) if (value && typeof value === 'object' && 'kind' in value) {
      try { validateDateReference(value, field) }
      catch (error) { return fail(field, error instanceof Error ? error.message.split(': ').slice(1).join(': ') : 'Проверьте срок.') }
    }
    if (selected.kind === 'stage') {
      try { validateDateOrder(draft.plannedStart, draft.plannedEnd, 'plannedEnd') }
      catch { return fail('plannedEnd', 'Завершение этапа не может быть раньше начала.') }
    }
    const key = collection[selected.kind]
    const entity = { ...draft, updatedAt: stamp() }
    const current = data[key] as Array<Draft>
    const updated = isNew ? [...current, entity] : current.map(x => x.id === selected.id ? entity : x)
    const nextData: WorkspaceData = { ...data, [key]: updated }
    if (selected.kind === 'stage' && !isNew) nextData.checkpoints = data.checkpoints.map(x => x.stageId === selected.id ? { ...x, processId: draft.processId as string, updatedAt: stamp() } : x)
    const nextSnapshot = { ...snapshot, data: nextData }
    try { validateSnapshot(nextSnapshot) }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить объект.'
      const field = Object.keys(draft).find(key => message.includes('.' + key)) || '_form'
      return fail(field, message.replace(/^data\.\w+\[\d+\](?:\.\w+)?:\s*/, ''))
    }
    onChange(nextSnapshot)
    if (isNew) close()
    else { setDraft(entity); setFormError(null) }
  }
  const remove = () => { if (!selected) return; onChange({ ...snapshot, data: removeRelated(data, selected, replacementId || undefined) }); close(); setReplacementId('') }

  const processSpan = (id: string) => {
    const stages = data.stages.filter(x => x.processId === id)
    const starts = stages.map(x => refStart(x.plannedStart)).filter((x): x is string => !!x).sort()
    const ends = stages.map(x => refEnd(x.plannedEnd)).filter((x): x is string => !!x).sort()
    if (starts.length && ends.length) return { start: starts[0], end: ends[ends.length - 1] }
    if (starts.length) return { start: starts[0], end: undefined }
    if (ends.length) return { start: undefined, end: ends[ends.length - 1] }
    return null
  }
  const visibleProcesses = data.processes.filter(p => {
    const query = search.trim().toLocaleLowerCase('ru')
    const stageMatch = data.stages.some(s => s.processId === p.id && s.name.toLocaleLowerCase('ru').includes(query))
    return (!query || p.name.toLocaleLowerCase('ru').includes(query) || stageMatch || p.currentState.toLocaleLowerCase('ru').includes(query) || p.targetState.toLocaleLowerCase('ru').includes(query)) && (!statusFilter || p.status === statusFilter) && (!groupFilter || p.groupId === groupFilter)
  }).sort((a, b) => a.order - b.order)
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = []
    data.sharedMilestones.forEach(m => result.push({ kind: 'milestone', id: m.id, label: m.name, depth: 0 }))
    const addProcess = (p: Process, groupId?: string | null) => {
      result.push({ kind: 'process', id: p.id, label: p.name, depth: 1, groupId, processId: p.id, status: p.status, color: data.groups.find(x => x.id === p.groupId)?.color })
      if (collapsedProcesses.includes(p.id)) return
      data.stages.filter(x => x.processId === p.id).sort((a, b) => a.order - b.order).forEach(s => {
        result.push({ kind: 'stage', id: s.id, label: s.name, depth: 2, processId: p.id, status: s.status })
        data.checkpoints.filter(c => c.stageId === s.id).forEach(c => result.push({ kind: 'checkpoint', id: c.id, label: c.name, depth: 3, processId: p.id, status: c.status }))
      })
      data.checkpoints.filter(c => c.processId === p.id && !c.stageId).forEach(c => result.push({ kind: 'checkpoint', id: c.id, label: c.name, depth: 2, processId: p.id, status: c.status }))
    }
    data.groups.slice().sort((a, b) => a.order - b.order).forEach(g => {
      const list = visibleProcesses.filter(p => p.groupId === g.id)
      if (!list.length && (search || statusFilter || groupFilter)) return
      result.push({ kind: 'group', id: g.id, label: g.name, depth: 0, color: g.color })
      if (!collapsedGroups.includes(g.id)) list.forEach(p => addProcess(p, g.id))
    })
    const ungrouped = visibleProcesses.filter(p => !p.groupId)
    if (ungrouped.length) { result.push({ kind: 'group', id: '_ungrouped', label: 'Без группы', depth: 0 }); if (!collapsedGroups.includes('_ungrouped')) ungrouped.forEach(p => addProcess(p, null)) }
    return result
  }, [data, visibleProcesses, collapsedGroups, collapsedProcesses, search, statusFilter, groupFilter])

  const focusedStage = selected?.kind === 'stage' && inspectorOpen ? data.stages.find(stage => stage.id === selected.id) : undefined
  const focusedStart = focusedStage && refStart(focusedStage.plannedStart)
  const focusedEnd = focusedStage && refEnd(focusedStage.plannedEnd)
  const shortStageSelected = !!focusedStart && !!focusedEnd && day(focusedEnd).getTime() - day(focusedStart).getTime() <= 28 * 86400000
  const columns = useMemo(() => {
    const values: { start: string; end: string; label: string; detail?: string }[] = []
    const start = scale === 'week' ? monday(anchor) : `${anchor.slice(0, 7)}-01`
    for (let i = 0; i < (scale === 'week' ? shortStageSelected ? 12 : 26 : 12); i++) {
      if (scale === 'week') { const from = plusDays(start, i * 7); values.push({ start: from, end: plusDays(from, 7), label: weekCaption(from), detail: `№${isoWeekNumber(from)} · ${from.slice(0, 4)}` }) }
      else { const d = day(start); d.setUTCMonth(d.getUTCMonth() + i); const from = iso(d); d.setUTCMonth(d.getUTCMonth() + 1); values.push({ start: from, end: iso(d), label: new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' }).format(day(from)) }) }
    }
    return values
  }, [anchor, scale, shortStageSelected])
  const domainStart = day(columns[0].start).getTime()
  const domainEnd = day(columns[columns.length - 1].end).getTime()
  const pct = (date: string) => Math.max(0, Math.min(100, (day(date).getTime() - domainStart) / (domainEnd - domainStart) * 100))
  const span = (row: Row): { start?: string; end?: string } | null => {
    if (row.kind === 'process') return processSpan(row.id)
    if (row.kind === 'stage') { const s = data.stages.find(x => x.id === row.id); return s ? { start: refStart(s.plannedStart), end: refEnd(s.plannedEnd) } : null }
    if (row.kind === 'checkpoint') { const c = data.checkpoints.find(x => x.id === row.id); return c ? { start: refStart(c.plannedDate), end: refEnd(c.plannedDate) } : null }
    if (row.kind === 'milestone') { const m = data.sharedMilestones.find(x => x.id === row.id); return m ? { start: refStart(m.date), end: refEnd(m.date) } : null }
    return null
  }
  const actorScopeIds = new Set([actorFilter, ...data.actors.filter(a => a.departmentId === actorFilter && data.actors.some(parent => parent.id === actorFilter && parent.type === 'department')).map(a => a.id)])
  const actorTargets = new Set(data.participations.filter(x => actorScopeIds.has(x.actorId)).map(x => x.targetId))
  const highlighted = (row: Row): boolean => {
    if (!actorFilter) return true
    if (actorTargets.has(row.id)) return true
    if (row.kind === 'process') return data.stages.some(s => s.processId === row.id && actorTargets.has(s.id)) || data.checkpoints.some(c => c.processId === row.id && actorTargets.has(c.id))
    if (row.kind === 'group') return data.processes.some(p => (row.id === '_ungrouped' ? !p.groupId : p.groupId === row.id) && highlighted({ kind: 'process', id: p.id, label: p.name, depth: 1 }))
    return false
  }
  const selectedLinks = data.dependencies.filter(link => showAllLinks || link.sourceId === selected?.id || link.targetId === selected?.id)
  const conflicts = data.dependencies.filter(link => {
    if (link.type !== 'prerequisite') return false
    const source = rows.find(r => r.id === link.sourceId), target = rows.find(r => r.id === link.targetId)
    const end = source && span(source)?.end, start = target && span(target)?.start
    return !!(end && start && start < end)
  })
  const linkPaths = selectedLinks.flatMap(link => {
    const from = rows.findIndex(r => r.id === link.sourceId), to = rows.findIndex(r => r.id === link.targetId)
    if (from < 0 || to < 0) return []
    const start = span(rows[from])?.end, end = span(rows[to])?.start
    const x1 = start ? pct(start) * 9.4 : 16, x2 = end ? pct(end) * 9.4 : 36
    const y1 = from * 54 + 27, y2 = to * 54 + 27
    return [{ id: link.id, d: `M ${x1} ${y1} C ${Math.max(x1, x2) + 35} ${y1}, ${Math.min(x1, x2) - 35} ${y2}, ${x2} ${y2}`, type: link.type, conflict: conflicts.some(x => x.id === link.id) }]
  })
  const activeProcessId = selected?.kind === 'process' ? selected.id : selected?.kind === 'stage' ? data.stages.find(x => x.id === selected.id)?.processId : selected?.kind === 'checkpoint' ? data.checkpoints.find(x => x.id === selected.id)?.processId : undefined
  const relatedProcessIds = activeProcessId ? [activeProcessId, ...data.stages.filter(s => s.processId === activeProcessId).map(s => s.id), ...data.checkpoints.filter(c => c.processId === activeProcessId).map(c => c.id)] : []
  const relatedParticipation = data.participations.filter(x => x.targetId === selected?.id || (selected?.kind === 'process' && relatedProcessIds.includes(x.targetId)))
  const relatedHandovers = data.handovers.filter(x => x.targetId === selected?.id || (selected?.kind === 'process' && relatedProcessIds.includes(x.targetId)))
  const hiddenLinkCount = (groupId: string) => data.dependencies.filter(link => {
    const own = (id: string) => data.processes.some(p => p.id === id && p.groupId === groupId) || data.stages.some(s => s.id === id && data.processes.some(p => p.id === s.processId && p.groupId === groupId))
    return own(link.sourceId) || own(link.targetId)
  }).length
  const fit = () => {
    const dates = data.stages.flatMap(s => [refStart(s.plannedStart), refEnd(s.plannedEnd)]).filter((x): x is string => !!x).sort()
    setAnchor(dates[0] || monday(today()))
  }
  const updateScale = (value: 'week' | 'month') => { setScale(value); onChange({ ...snapshot, workspace: { ...snapshot.workspace, display: { ...snapshot.workspace.display, processScale: value }, updatedAt: stamp() } }) }

  const fieldError = (key: string) => formError?.field === key ? <span className="pv-field-error" role="alert">{formError.message}</span> : null
  const field = (label: string, key: string, opts?: { required?: boolean; multiline?: boolean; placeholder?: string }) => <label key={key}>{label}{opts?.multiline ? <textarea value={draft?.[key] ?? ''} onChange={e => change(key, e.target.value)} placeholder={opts.placeholder} /> : <input value={draft?.[key] ?? ''} onChange={e => change(key, e.target.value)} required={opts?.required} placeholder={opts?.placeholder} />}{fieldError(key)}</label>
  const selectField = (label: string, key: string, options: { value: string; label: string }[]) => <label key={key}>{label}<select value={draft?.[key] ?? ''} onChange={e => change(key, e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{fieldError(key)}</label>
  const processOptions = [{ value: '', label: 'Выберите процесс' }, ...data.processes.map(p => ({ value: p.id, label: p.name }))]
  const actorOptions = [{ value: '', label: 'Выберите участника' }, ...data.actors.map(a => ({ value: a.id, label: a.name }))]
  const targetOptions = (type: string) => type === 'stage' ? data.stages.map(x => ({ value: x.id, label: `${data.processes.find(p => p.id === x.processId)?.name || 'Процесс'} / ${x.name}` })) : type === 'checkpoint' ? data.checkpoints.map(x => ({ value: x.id, label: x.name })) : data.processes.map(x => ({ value: x.id, label: x.name }))
  const linkedTarget = (id: string) => data.processes.find(x => x.id === id)?.name || data.stages.find(x => x.id === id)?.name || data.checkpoints.find(x => x.id === id)?.name || id

  const form = () => {
    if (!selected || !draft) return null
    switch (selected.kind) {
      case 'group': return <>{field('Название', 'name', { required: true })}<label>Цвет группы<input type="color" value={draft.color || '#2563eb'} onChange={e => change('color', e.target.value)} /></label></>
      case 'process': return <>{field('Название процесса', 'name', { required: true })}{selectField('Группа', 'groupId', [{ value: '', label: 'Без группы' }, ...data.groups.map(g => ({ value: g.id, label: g.name }))])}{field('Текущая ситуация', 'currentState', { multiline: true })}{field('Целевое состояние', 'targetState', { multiline: true })}{field('Причина изменения', 'reason', { multiline: true })}{field('Ожидаемый результат', 'expectedResult', { multiline: true })}{selectField('Статус', 'status', statusOptions.map(x => ({ value: x, label: x })))}{field('Приоритет', 'priority')}{field('Заметка', 'note', { multiline: true })}</>
      case 'stage': return <>{field('Название этапа', 'name', { required: true })}{selectField('Процесс', 'processId', processOptions)}{field('Смысл этапа', 'purpose', { multiline: true })}{dateRefField('Плановое начало', draft.plannedStart, x => change('plannedStart', x), formError?.field === 'plannedStart' ? formError.message : undefined)}{dateRefField('Плановое завершение', draft.plannedEnd, x => change('plannedEnd', x), formError?.field === 'plannedEnd' ? formError.message : undefined)}{field('Ожидаемый выход', 'expectedOutput', { multiline: true })}{selectField('Статус', 'status', statusOptions.map(x => ({ value: x, label: x })))}</>
      case 'checkpoint': return <>{field('Название точки', 'name', { required: true })}{selectField('Процесс', 'processId', processOptions)}{selectField('Этап', 'stageId', [{ value: '', label: 'Без этапа' }, ...data.stages.filter(s => s.processId === draft.processId).map(s => ({ value: s.id, label: s.name }))])}{dateRefField('Плановая дата', draft.plannedDate, x => change('plannedDate', x), formError?.field === 'plannedDate' ? formError.message : undefined)}{dateRefField('Дата факта', draft.actualDate, x => change('actualDate', x), formError?.field === 'actualDate' ? formError.message : undefined)}{field('Подтверждение результата', 'confirmation', { multiline: true })}{selectField('Статус', 'status', statusOptions.map(x => ({ value: x, label: x })))}</>
      case 'milestone': return <>{field('Название вехи', 'name', { required: true })}{dateRefField('Срок', draft.date, x => change('date', x), formError?.field === 'date' ? formError.message : undefined)}{field('Смысл', 'purpose', { multiline: true })}{field('Подтверждение', 'confirmation', { multiline: true })}<label>Связанные процессы<select multiple value={draft.processIds || []} onChange={e => change('processIds', Array.from(e.target.selectedOptions, x => x.value))}>{data.processes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="pv-small-note">Для нескольких процессов удерживайте Ctrl при выборе.</div></>
      case 'actor': return <>{selectField('Тип участника', 'type', Object.entries(actorTypes).map(([value, label]) => ({ value, label })))}{field('Название или имя', 'name', { required: true })}{draft.type !== 'department' && selectField('Основной отдел', 'departmentId', [{ value: '', label: 'Не указан' }, ...data.actors.filter(a => a.type === 'department' && a.id !== draft.id).map(a => ({ value: a.id, label: a.name }))])}<label>Цвет метки<input type="color" value={draft.color || '#64748b'} onChange={e => change('color', e.target.value)} /></label></>
      case 'participation': return <>{selectField('Участник', 'actorId', actorOptions)}{selectField('Уровень', 'targetType', [{ value: 'process', label: 'Процесс' }, { value: 'stage', label: 'Этап' }, { value: 'checkpoint', label: 'Контрольная точка' }])}{selectField('Объект', 'targetId', [{ value: '', label: 'Выберите объект' }, ...targetOptions(draft.targetType)])}{selectField('Тип участия', 'type', Object.entries(participationTypes).map(([value, label]) => ({ value, label })))}{field('Ожидаемый вклад', 'expectedContribution', { multiline: true })}</>
      case 'handover': return <>{selectField('Передаёт', 'fromActorId', actorOptions)}{selectField('Получает', 'toActorId', actorOptions)}{selectField('Уровень', 'targetType', [{ value: 'process', label: 'Процесс' }, { value: 'stage', label: 'Этап' }])}{selectField('Связанный объект', 'targetId', [{ value: '', label: 'Выберите объект' }, ...targetOptions(draft.targetType)])}{selectField('Контрольная точка', 'checkpointId', [{ value: '', label: 'Не указана' }, ...data.checkpoints.map(c => ({ value: c.id, label: c.name }))])}{field('Что передаётся или согласуется', 'description', { multiline: true })}</>
      case 'dependency': return <>{selectField('Тип связи', 'type', [{ value: 'prerequisite', label: 'Предпосылка →' }, { value: 'influence', label: 'Влияет ⇢' }])}{selectField('Источник', 'sourceType', [{ value: 'process', label: 'Процесс' }, { value: 'stage', label: 'Этап' }])}{selectField('Объект-источник', 'sourceId', [{ value: '', label: 'Выберите объект' }, ...targetOptions(draft.sourceType)])}{selectField('Цель', 'targetType', [{ value: 'process', label: 'Процесс' }, { value: 'stage', label: 'Этап' }])}{selectField('Объект-цель', 'targetId', [{ value: '', label: 'Выберите объект' }, ...targetOptions(draft.targetType).filter(option => option.value !== draft.sourceId)])}{field('Пояснение', 'note', { multiline: true })}</>
    }
  }

  const editorMarkup = inspectorOpen && selected && draft ? (
<aside className="pv-inspector"><div className="pv-inspector-header"><h2>{isNew ? 'Новый объект' : kindTitle[selected.kind]}<small style={{ display: 'block', color: '#64748b', fontSize: 11, fontWeight: 400 }}>{kindTitle[selected.kind]}</small></h2><button className="pv-mini" aria-label="Закрыть карточку" onClick={close}>✕</button></div>
        {selected.kind === 'stage' && !isNew && <div className="pv-selected-detail"><strong>{draft.name}</strong><span>{formatRef(draft.plannedStart)} — {formatRef(draft.plannedEnd)}</span></div>}
        {confirmDelete ? <div className="pv-confirm"><strong>Удалить «{draft.name || kindTitle[selected.kind]}»?</strong>{countConsequences(selected.kind, selected.id, data).map(line => <div key={line}>{line}</div>)}{selected.kind === 'actor' && data.actors.some(a => a.id !== selected.id && a.type === draft.type) && <label style={{ display: 'block', marginTop: 10 }}>Перепривязать связи к участнику<select value={replacementId} onChange={e => setReplacementId(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}><option value="">Удалить связи и назначения</option>{data.actors.filter(a => a.id !== selected.id && a.type === draft.type).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}<div className="pv-form-actions"><button className="pv-btn pv-btn-danger" onClick={remove}>Удалить</button><button className="pv-btn" onClick={() => setConfirmDelete(false)}>Отмена</button></div></div> : <><div className="pv-form">{form()}{fieldError('_form')}<div className="pv-form-actions"><button className="pv-btn pv-btn-primary" onClick={save}>Сохранить</button>{!isNew && <button className="pv-btn pv-btn-danger" onClick={() => setConfirmDelete(true)}>Удалить</button>}<button className="pv-btn" onClick={close}>Закрыть</button></div></div>
          {!isNew && <><div className="pv-form-section">Связи и участие</div><div className="pv-related">
            {(selected.kind === 'process' || selected.kind === 'stage' || selected.kind === 'checkpoint') && <><button onClick={() => create('participation', selected)}>+ Участие</button>{selected.kind !== 'checkpoint' && <><button onClick={() => create('dependency', selected)}>+ Зависимость</button><button onClick={() => create('handover', selected)}>+ Передача</button></>}</>}
            {relatedParticipation.map(p => <div key={p.id}><button onClick={() => select('participation', p.id)}>{data.actors.find(a => a.id === p.actorId)?.name || 'Участник'} · {participationTypes[p.type]}{p.expectedContribution ? ` — ${p.expectedContribution}` : ''}</button></div>)}
            {relatedHandovers.map(h => <div key={h.id}><button onClick={() => select('handover', h.id)}>{data.actors.find(a => a.id === h.fromActorId)?.name || '?'} → {data.actors.find(a => a.id === h.toActorId)?.name || '?'}: {h.description}</button></div>)}
            {selected.kind === 'actor' && data.participations.filter(p => p.actorId === selected.id).map(p => <div key={p.id}><button onClick={() => select(p.targetType, p.targetId)}>{participationTypes[p.type]} · {linkedTarget(p.targetId)}{p.expectedContribution ? ` — ${p.expectedContribution}` : ''}</button></div>)}
            {data.dependencies.filter(d => d.sourceId === selected.id || d.targetId === selected.id).map(d => <div key={d.id}><button onClick={() => select('dependency', d.id)}>{linkedTarget(d.sourceId)} {d.type === 'prerequisite' ? '→' : '⇢'} {linkedTarget(d.targetId)}{conflicts.some(x => x.id === d.id) ? ' ⚠ сроки пересекаются' : ''}</button></div>)}
            {data.crossLinks.filter(l => l.targetId === selected.id).map(l => <div key={l.id}><button onClick={() => onNavigateToPlan(l.sourceId)}>↗ План: {data.deliveries.find(d => d.id === l.sourceId)?.name || data.weekBlocks.find(b => b.id === l.sourceId)?.content || l.sourceId}</button>{l.note && ` — ${l.note}`}</div>)}
            {selected.kind === 'process' && data.stages.filter(s => s.processId === selected.id).map(s => <div key={s.id}><button onClick={() => select('stage', s.id)}>Этап: {s.name} · {formatRef(s.plannedStart)} — {formatRef(s.plannedEnd)}</button></div>)}
            {selected.kind === 'process' && data.checkpoints.filter(c => c.processId === selected.id).map(c => <div key={c.id}><button onClick={() => select('checkpoint', c.id)}>Точка: {c.name} · {formatRef(c.plannedDate)}{c.confirmation ? ` · ${c.confirmation}` : ''}</button></div>)}
          </div></>}
        </>}
      </aside>
  ) : null

  return <div className="process-view">
    <div className="process-toolbar">
      <h1>Карта процессов</h1>
      <button className="pv-btn pv-btn-primary" onClick={() => create('process')}>+ Процесс</button><button className="pv-btn" onClick={() => create('group')}>+ Группа</button><button className="pv-btn" onClick={() => create('milestone')}>+ Веха</button>
      <button className="pv-btn" onClick={() => setActorsOpen(x => !x)} aria-pressed={actorsOpen}>Участники {actorsOpen ? '▾' : '▸'}</button>
      <button className="pv-btn" onClick={() => setTreeOpen(x => !x)} aria-pressed={treeOpen}>{treeOpen ? 'Скрыть дерево' : 'Показать дерево'}</button>
      <button className="pv-btn" onClick={() => create('dependency')}>+ Связь</button><button className="pv-btn" onClick={() => create('handover')}>+ Передача</button>
      <button className="pv-btn pv-help-trigger" onClick={() => setHelpOpen(true)}>ⓘ Справка</button>
      <span className="pv-toolbar-spacer" />
      <input type="search" aria-label="Поиск по карте" placeholder="Поиск процессов" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Фильтр по группе" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}><option value="">Все группы</option>{data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      <select aria-label="Фильтр по статусу" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Все статусы</option>{[...new Set([...statusOptions, ...data.processes.map(p => p.status)])].map(s => <option key={s} value={s}>{s}</option>)}</select>
      <select aria-label="Масштаб календаря" value={scale} onChange={e => updateScale(e.target.value as 'week' | 'month')}><option value="week">Недели</option><option value="month">Месяцы</option></select>
      <button className="pv-btn" aria-label="Предыдущий период" onClick={() => setAnchor(plusDays(anchor, scale === 'week' ? -7 : -30))}>←</button>
      <input type="date" aria-label="Начало периода" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} />
      <button className="pv-btn" aria-label="Следующий период" onClick={() => setAnchor(plusDays(anchor, scale === 'week' ? 7 : 30))}>→</button>
      <button className="pv-btn" onClick={() => setAnchor(monday(today()))}>Сегодня</button><button className="pv-btn" onClick={fit}>Уместить план</button>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><input type="checkbox" checked={showAllLinks} onChange={e => setShowAllLinks(e.target.checked)} /> Все связи</label>
    </div>
    <div className="pv-main">
      {actorsOpen && <aside className="pv-actors"><div className="pv-panel-title">Участники</div><button className="pv-btn" style={{ width: '100%', marginBottom: 9 }} onClick={() => create('actor')}>+ Добавить участника</button><button className={`pv-actor-item ${!actorFilter ? 'active' : ''}`} onClick={() => setActorFilter('')}>Все участники</button>{data.actors.map(a => <button className={`pv-actor-item ${actorFilter === a.id ? 'active' : ''}`} key={a.id} onClick={() => { setActorFilter(a.id); select('actor', a.id) }}><span className={`pv-actor-symbol ${a.type}`}>{a.type === 'person' ? initials(a.name) : a.type === 'department' ? '▣' : 'R'}</span><span>{a.name}<small style={{ display: 'block', color: '#64748b' }}>{actorTypes[a.type]}</small></span></button>)}{!data.actors.length && <div className="pv-small-note">Добавьте отдел, роль или человека.</div>}</aside>}
      <div className="pv-canvas">
        {treeOpen && <div className="pv-tree"><div className="pv-head">Группы / процессы / этапы</div>{rows.map(row => {
          const actualKind = row.kind === 'milestone' ? 'milestone' : row.kind
          const collapsed = row.kind === 'group' ? collapsedGroups.includes(row.id) : row.kind === 'process' ? collapsedProcesses.includes(row.id) : false
          const isSelected = selected?.kind === actualKind && selected.id === row.id
          return <div key={`${row.kind}-${row.id}`} className={`pv-row pv-tree-row pv-row-${row.kind} ${isSelected ? 'selected' : ''} ${!highlighted(row) ? 'dimmed' : ''}`} style={{ paddingLeft: 12 + row.depth * 18 }}>
            {row.kind === 'group' && <span className="pv-group-accent" style={{ background: row.color || '#9aa8bc' }} />}
            {(row.kind === 'group' || row.kind === 'process') && <button className="pv-chevron" aria-label={`${collapsed ? 'Развернуть' : 'Свернуть'} ${row.label}`} onClick={() => row.kind === 'group' ? setCollapsedGroups(x => collapsed ? x.filter(id => id !== row.id) : [...x, row.id]) : setCollapsedProcesses(x => collapsed ? x.filter(id => id !== row.id) : [...x, row.id])}>{collapsed ? '▸' : '▾'}</button>}
            <button className="pv-row-label" title={row.label} onClick={() => row.id !== '_ungrouped' ? select(actualKind, row.id) : create('group')}><span>{row.label}</span>{row.kind === 'group' && collapsed && row.id !== '_ungrouped' && <small>Скрытых связей: {hiddenLinkCount(row.id)}</small>}{row.kind === 'process' && <small>{safeStatus(row.status)} · {data.participations.filter(p => p.targetType === 'process' && p.targetId === row.id).map(p => data.actors.find(a => a.id === p.actorId)?.name).filter(Boolean).slice(0, 2).join(', ') || 'Участники не указаны'}</small>}{row.kind === 'checkpoint' && <small>{row.status || 'Точка'}</small>}</button>
            <div className="pv-row-actions">{row.kind === 'group' && <button className="pv-mini" title="Добавить процесс" onClick={() => create('process', { kind: 'group', id: row.id })}>+</button>}{row.kind === 'process' && <button className="pv-mini" title="Добавить этап" onClick={() => create('stage', { kind: 'process', id: row.id })}>+</button>}{row.kind === 'stage' && <button className="pv-mini" title="Добавить контрольную точку" onClick={() => create('checkpoint', { kind: 'stage', id: row.id })}>+</button>}</div>
          </div>
        })}{!rows.length && <div className="pv-empty">Карта пока пуста. Создайте группу или процесс.</div>}</div>}
        <div className="pv-time" style={{ '--pv-col-width': `${100 / columns.length}%`, '--pv-min-width': `${columns.length * (scale === 'week' ? 118 : 100)}px`, '--pv-column-count': columns.length } as CSSProperties}>
          <div className="pv-head pv-time-head">{columns.map(c => <span key={c.start} title={`${formatDate(c.start)} — ${formatDate(plusDays(c.end, -1))}`}>{c.label}{c.detail && <small>{c.detail}</small>}</span>)}</div>
          {rows.map(row => { const dates = span(row); const isSelected = selected?.kind === row.kind && selected.id === row.id; const visible = dates?.start && dates?.end && day(dates.end).getTime() >= domainStart && day(dates.start).getTime() < domainEnd; const left = dates?.start ? pct(dates.start) : 0; const right = dates?.end ? pct(plusDays(dates.end, 1)) : left; const rowHandovers = data.handovers.filter(h => h.targetId === row.id && (showAllLinks || h.targetId === selected?.id || (selected?.kind === 'process' && relatedProcessIds.includes(h.targetId)))); return <div key={`${row.kind}-${row.id}`} className={`pv-row pv-time-row ${row.kind} ${isSelected ? 'selected' : ''} ${!highlighted(row) ? 'dimmed' : ''} ${rowHandovers.length ? 'has-handovers' : ''}`} onClick={() => row.id !== '_ungrouped' && select(row.kind === 'milestone' ? 'milestone' : row.kind, row.id)}>
            {!!rowHandovers.length && <div className="pv-handover-list" aria-label="Передачи результата">{rowHandovers.map(h => { const from = data.actors.find(a => a.id === h.fromActorId)?.name || '?'; const to = data.actors.find(a => a.id === h.toActorId)?.name || '?'; const arrowId = `pv-handover-arrow-${h.id}`; return <div className="pv-handover-flow" key={h.id} title={`${from} → ${to}: ${h.description}`}><span>{from}</span><svg width="27" height="12" viewBox="0 0 27 12" aria-hidden="true"><defs><marker id={arrowId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#47648b" /></marker></defs><line x1="1" y1="6" x2="24" y2="6" stroke="#47648b" strokeWidth="1.7" markerEnd={`url(#${arrowId})`} /></svg><span>{to}</span><strong>{h.description}</strong></div> })}</div>}
            {(row.kind === 'process' || row.kind === 'stage') && visible && <div className={`pv-bar ${row.kind}`} title={`${row.label}: ${formatDate(dates.start)} — ${formatDate(dates.end)}`} style={{ left: `${left}%`, width: `${Math.max(1.1, right - left)}%`, borderLeftColor: row.color || undefined }}>{row.label}</div>}
            {(row.kind === 'checkpoint' || row.kind === 'milestone') && visible && <span className={`pv-marker ${row.kind}`} title={`${row.label}: ${formatDate(dates.start)}`} style={{ left: `${left}%` }} />}
            {row.kind !== 'group' && !visible && <span className="pv-unscheduled">{dates?.start || dates?.end ? 'Срок указан частично' : 'Не запланировано'}</span>}
          </div> })}
          {!!linkPaths.length && <svg className="pv-link-overlay" viewBox={`0 0 940 ${rows.length * 54}`} preserveAspectRatio="none" style={{ height: rows.length * 54 }} aria-label="Связи между процессами и этапами"><defs><marker id="pv-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="#556987" /></marker></defs>{linkPaths.map(l => <path key={l.id} d={l.d} className={`${l.type === 'influence' ? 'influence' : ''} ${l.conflict ? 'conflict' : ''}`} />)}</svg>}
          {!!conflicts.length && <span className="pv-links-note">⚠ Конфликт сроков предпосылок: {conflicts.length}</span>}
        </div>
      </div>
      {editorMarkup && <DraggableDialog title={`${isNew ? 'Добавить' : 'Редактировать'}: ${kindTitle[selected!.kind]}`} onClose={close} className="pv-editor-window">{editorMarkup}</DraggableDialog>}
    </div>
    {helpOpen && <ProcessHelpDialog onClose={() => setHelpOpen(false)} />}
  </div>
}

export default ProcessView
