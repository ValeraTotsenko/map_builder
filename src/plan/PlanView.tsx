import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Snapshot, WeeklyAssignment } from '../model';
import WeeklyTasksPanel from './WeeklyTasksPanel';
import WeeklyLoadDialog from './WeeklyLoadDialog';
import PlanHelpDialog from './PlanHelpDialog';
import PlanEntitiesDialog, { type CatalogKind } from './PlanEntitiesDialog';
import DeliveryVolumeCard from './DeliveryVolumeCard';
import { deliveryMetrics } from './deliveryMetrics';
import { createWeeklyLoadWorkbook, weeksForAllLoad } from './weeklyLoadExport';
import { createId, validateSnapshot } from '../model';
import './plan.css';
import './weekly_style.css';
import './PlanToolbar.css';
import './DeliveryRowSummary.css';

type EntityKind = 'project' | 'delivery' | 'lane' | 'block' | 'event' | 'person' | 'estimate' | 'link';
type DateReference = { kind: 'unknown'; text?: string } | { kind: 'exact'; date: string; text?: string } | { kind: 'range'; start: string; end: string; text?: string };
type Selection = { kind: EntityKind; id: string } | null;
type Draft = { kind: EntityKind; mode: 'create' | 'edit'; item: Record<string, any> };
type FilterState = { search: string; project: string; delivery: string; lane: string; person: string; status: string };
type WeekCell = { projectId: string; deliveryId: string | null; weekStart: string };
type TaskValues = Pick<WeeklyAssignment, 'title' | 'projectId' | 'deliveryId' | 'personId' | 'weekStart' | 'count' | 'note' | 'completedCount' | 'completed'>;
type PlanViewProps = { snapshot: Snapshot; onChange: (next: Snapshot) => void; onNavigateToProcess: (targetId: string) => void; initialSelection?: string };

const DAY = 86400000;
const WEEK_COLUMN_WIDTH = 124;
const DEFAULT_FILTERS: FilterState = { search: '', project: '', delivery: '', lane: '', person: '', status: '' };
const COLLECTION: Record<EntityKind, keyof Snapshot['data']> = {
  project: 'projects', delivery: 'deliveries', lane: 'lanes', block: 'weekBlocks', event: 'planEvents',
  person: 'actors', estimate: 'estimates', link: 'crossLinks',
};

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function date(s: string): Date { return new Date(`${s}T12:00:00Z`); }
function monday(d: Date): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; }
function addWeeks(s: string, n: number): string { return iso(new Date(date(s).getTime() + n * 7 * DAY)); }
function weekIndex(s: string, origin: string): number { return Math.round((date(s).getTime() - date(origin).getTime()) / (7 * DAY)); }
function isoWeekNumber(s: string): number {
  const thursday = date(s);
  thursday.setUTCDate(thursday.getUTCDate() + 3 - (thursday.getUTCDay() + 6) % 7);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4, 12));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - (firstThursday.getUTCDay() + 6) % 7);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY));
}
function todayWeek(): string { return iso(monday(new Date())); }
function stamp() { return new Date().toISOString(); }
function createBase() { const t = stamp(); return { id: createId(), createdAt: t, updatedAt: t }; }
function humanDate(s?: string): string { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; }
function workweekEnd(start: string): string { return iso(new Date(date(start).getTime() + 4 * DAY)); }
function workweekLabel(start: string): string {
  const end = workweekEnd(start);
  const month = (value: string) => new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(date(value)).replace('.', '');
  const firstDay = Number(start.slice(8)), lastDay = Number(end.slice(8));
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${firstDay}–${lastDay} ${month(end)}`
    : `${firstDay} ${month(start)} – ${lastDay} ${month(end)}`;
}
function deadlineText(ref?: DateReference): string {
  if (!ref || ref.kind === 'unknown') return ref?.text || 'Без срока';
  if (ref.kind === 'exact') return humanDate(ref.date);
  return `${humanDate(ref.start)} – ${humanDate(ref.end)}`;
}
function validWeek(s: string): string { return s ? iso(monday(date(s))) : todayWeek(); }
function blockCount(count: number): string { return `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'блок' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'блока' : 'блоков'}`; }
function weekDateIssue(kind: EntityKind, item: Record<string, any>): string {
  if (kind !== 'block' && kind !== 'event') return '';
  if (!item.startWeek) return 'Укажите первую неделю.';
  if (kind === 'block' && !item.endWeek) return 'Укажите последнюю неделю.';
  if (item.endWeek && item.endWeek < item.startWeek) return 'Последняя неделя должна быть не раньше первой.';
  return '';
}
function parseSelection(snapshot: Snapshot, id?: string): Selection {
  if (!id) return null;
  for (const kind of Object.keys(COLLECTION) as EntityKind[]) {
    const list = snapshot.data[COLLECTION[kind]] as { id: string }[];
    if (list.some(item => item.id === id)) return { kind, id };
  }
  return null;
}
function nameFor(snapshot: Snapshot, kind: 'project' | 'delivery' | 'lane' | 'person', id?: string | null): string {
  if (!id) return 'Не назначено';
  const item = (snapshot.data[COLLECTION[kind]] as { id: string; name: string }[]).find(x => x.id === id);
  return item?.name || 'Удалённый объект';
}

export default function PlanView({ snapshot, onChange, onNavigateToProcess, initialSelection }: PlanViewProps) {
  const data = snapshot.data;
  const [selection, setSelection] = useState<Selection>(() => parseSelection(snapshot, initialSelection));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [origin, setOrigin] = useState(() => addWeeks(todayWeek(), -2));
  const [weeksCount, setWeeksCount] = useState(16);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showUndated, setShowUndated] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [weekCell, setWeekCell] = useState<WeekCell | null>(null);
  const [catalog, setCatalog] = useState<CatalogKind | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<'add' | 'more' | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [projectDrop, setProjectDrop] = useState<{ id: string; side: 'before' | 'after' } | null>(null);
  const planScroll = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionMenuTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (initialSelection) { setDraft(null); setSelection(parseSelection(snapshot, initialSelection)); } }, [initialSelection]);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);
  useEffect(() => {
    if (helpOpen || loadOpen || actionMenu || (!catalog && !selection && !weekCell)) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (catalog) setCatalog(null);
      else if (weekCell) setWeekCell(null);
      else closeInspector();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [catalog, selection, weekCell, loadOpen, helpOpen, draft, actionMenu]);
  useEffect(() => {
    if (!actionMenu) return;
    const onPointerDown = (event: PointerEvent) => { if (!actionMenuRef.current?.contains(event.target as Node)) setActionMenu(null); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setActionMenu(null); actionMenuTrigger.current?.focus(); } };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [actionMenu]);
  const weeks = useMemo(() => Array.from({ length: weeksCount }, (_, i) => addWeeks(origin, i)), [origin, weeksCount]);
  useEffect(() => {
    if (!selectedWeek || !planScroll.current) return;
    const index = weekIndex(selectedWeek, origin);
    if (index < 0 || index >= weeksCount) return;
    const viewport = planScroll.current;
    const left = 310 + index * WEEK_COLUMN_WIDTH;
    if (left < viewport.scrollLeft + 310 || left + WEEK_COLUMN_WIDTH > viewport.scrollLeft + viewport.clientWidth) {
      viewport.scrollLeft = Math.max(0, left - Math.max(320, viewport.clientWidth / 2));
    }
  }, [selectedWeek, origin, weeksCount, weekCell]);
  const projects = [...data.projects].sort((a, b) => a.order - b.order);
  const deliveries = data.deliveries;
  const blocks = data.weekBlocks;
  const events = data.planEvents;
  const assignments = data.weeklyAssignments;
  const people = data.actors.filter(a => a.type === 'person');
  const activeFilterCount = [filters.project, filters.delivery, filters.lane, filters.person, filters.status].filter(Boolean).length;
  const hasFilters = !!filters.search || activeFilterCount > 0;
  const hasDraft = !!selection && draft?.kind === selection.kind && draft.item.id === selection.id;
  const isDraft = hasDraft && draft?.mode === 'create';
  const selected = hasDraft ? draft!.item : selection ? (data[COLLECTION[selection.kind]] as { id: string }[]).find(x => x.id === selection.id) as any : null;

  function commit(mutator: (next: Snapshot) => void) {
    const next = structuredClone(snapshot);
    mutator(next);
    try { validateSnapshot(next); }
    catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      setFieldError(description);
      setMessage(`Не удалось сохранить: ${description}`);
      return false;
    }
    onChange(next);
    setFieldError('');
    return true;
  }
  function update(kind: EntityKind, id: string, values: Record<string, unknown>) {
    setFieldError('');
    if (draft?.kind === kind && draft.item.id === id) {
      setDraft({ ...draft, item: { ...draft.item, ...values } });
      return;
    }
    const current = (data[COLLECTION[kind]] as any[]).find(x => x.id === id);
    if (current) setDraft({ kind, mode: 'edit', item: { ...structuredClone(current), ...values } });
  }
  function closeInspector() {
    if (draft?.mode === 'edit' && !window.confirm('Изменения не сохранены. Закрыть карточку?')) return;
    setDraft(null); setSelection(null); setMessage(''); setFieldError('');
  }
  function add(kind: EntityKind, prefill: Record<string, unknown> = {}) {
    const base = createBase();
    const week = todayWeek();
    const defaults: Record<EntityKind, Record<string, unknown>> = {
      project: { name: 'Новый проект', type: 'Проект', order: data.projects.length, status: 'Запланировано', notes: '' },
      delivery: { projectId: data.projects[0]?.id || '', kind: 'Поставка', name: 'Новая поставка', startDate: { kind: 'unknown' }, checkpointDate: { kind: 'unknown' }, deadline: { kind: 'unknown' }, status: 'Запланировано', note: '' },
      lane: { name: 'Новая дорожка', order: data.lanes.length },
      block: { projectId: data.projects[0]?.id || '', laneId: data.lanes[0]?.id || '', startWeek: week, endWeek: week, content: 'Новый блок', status: 'Запланировано', note: '' },
      event: { type: 'Заметка', startWeek: week, text: 'Новое событие' },
      person: { type: 'person', name: 'Новый участник', color: '#2563eb' },
      estimate: { targetType: data.weekBlocks.length ? 'weekBlock' : 'delivery', targetId: data.weekBlocks[0]?.id || data.deliveries[0]?.id || '', value: 0, unit: 'шт.', kind: 'estimate' },
      link: { sourceType: data.weekBlocks.length ? 'weekBlock' : 'delivery', sourceId: data.weekBlocks[0]?.id || data.deliveries[0]?.id || '', targetType: data.stages.length ? 'stage' : 'checkpoint', targetId: data.stages[0]?.id || data.checkpoints[0]?.id || '', note: '' },
    };
    if (kind === 'delivery' && !data.projects.length) { setMessage('Сначала создайте проект.'); return; }
    if (kind === 'block' && (!data.projects.length || !data.lanes.length)) { setMessage('Для блока нужны проект и дорожка.'); return; }
    if (kind === 'estimate' && !data.weekBlocks.length && !data.deliveries.length) { setMessage('Сначала создайте поставку или блок.'); return; }
    if (kind === 'link' && (!data.weekBlocks.length && !data.deliveries.length || !data.stages.length && !data.checkpoints.length)) { setMessage('Для связи нужны объект плана и этап или точка процесса.'); return; }
    const item: Record<string, any> = { ...base, ...defaults[kind], ...prefill };
    setCatalog(null);
    setWeekCell(null); setLoadOpen(false);
    setDraft({ kind, mode: 'create', item });
    setSelection({ kind, id: base.id });
    setMessage('Заполните карточку и нажмите «Сохранить».');
  }
  function saveDraft() {
    if (!draft) { setSelection(null); return; }
    const issue = weekDateIssue(draft.kind, draft.item);
    if (issue) { setMessage(issue); return; }
    const { kind, item, mode } = draft;
    const saved = commit(next => {
      if (mode === 'create') { (next.data[COLLECTION[kind]] as any[]).push(item); return; }
      const current = (next.data[COLLECTION[kind]] as any[]).find(x => x.id === item.id);
      if (!current) return;
      const values = { ...item };
      if (kind === 'delivery' && values.projectId !== current.projectId) {
        next.data.weekBlocks.forEach(b => { if (b.deliveryId === item.id) { b.projectId = values.projectId; b.updatedAt = stamp(); } });
        next.data.weeklyAssignments.forEach(a => { if (a.deliveryId === item.id) { a.projectId = values.projectId; a.updatedAt = stamp(); } });
      }
      if (kind === 'block' && values.deliveryId) {
        const delivery = next.data.deliveries.find(x => x.id === values.deliveryId);
        if (delivery) values.projectId = delivery.projectId;
      } else if (kind === 'block' && values.projectId !== current.projectId && current.deliveryId) values.deliveryId = undefined;
      Object.assign(current, values, { updatedAt: stamp() });
    });
    if (saved) { setDraft(null); setSelection(null); setMessage('Сохранено'); }
  }
  function removeSelected() {
    if (!selection || !selected) return;
    let replacementPersonId: string | undefined;
    if (selection.kind === 'person') {
      const direct = data.participations.filter(x => x.actorId === selected.id);
      const transfers = data.handovers.filter(x => x.fromActorId === selected.id || x.toActorId === selected.id);
      const assignedBlocks = data.weekBlocks.filter(x => x.personId === selected.id);
      const ownedDeliveries = data.deliveries.filter(x => x.ownerActorId === selected.id);
      const weeklyTasks = assignments.filter(x => x.personId === selected.id);
      const relatedNames = Array.from(new Set(direct.map(x => {
        if (x.targetType === 'process') return data.processes.find(p => p.id === x.targetId)?.name;
        const processId = x.targetType === 'stage' ? data.stages.find(s => s.id === x.targetId)?.processId : data.checkpoints.find(c => c.id === x.targetId)?.processId;
        return data.processes.find(p => p.id === processId)?.name;
      }).filter(Boolean))).join(', ');
      const others = people.filter(x => x.id !== selected.id);
      const answer = window.prompt(
        `Удаление «${selected.name}» затронет: участия ${direct.length}, передачи ${transfers.length}, недельные блоки ${assignedBlocks.length}, недельные задачи ${weeklyTasks.length}, поставки ${ownedDeliveries.length}.\nПроцессы: ${relatedNames || 'нет'}.\n\nЧтобы перепривязать связи, введите ID другого человека:\n${others.map(x => `${x.name}: ${x.id}`).join('\n') || 'Других людей нет'}\n\nЧтобы явно удалить связи и снять назначения, введите УДАЛИТЬ. Отмена сохранит данные.`,
      );
      if (answer === null) return;
      if (answer.trim().toUpperCase() !== 'УДАЛИТЬ') {
        const replacement = others.find(x => x.id === answer.trim());
        if (!replacement) { setMessage('Не найден человек с указанным ID. Удаление отменено.'); return; }
        replacementPersonId = replacement.id;
      }
    }
    const refs = selection.kind === 'project' ? [
      `${data.deliveries.filter(x => x.projectId === selected.id).length} поставок`, `${data.weekBlocks.filter(x => x.projectId === selected.id).length} блоков`, `${assignments.filter(x => x.projectId === selected.id).length} недельных задач`,
    ] : selection.kind === 'delivery' ? [`${data.weekBlocks.filter(x => x.deliveryId === selected.id).length} блоков`, `${assignments.filter(x => x.deliveryId === selected.id).length} недельных задач`] : selection.kind === 'lane' ? [`${data.weekBlocks.filter(x => x.laneId === selected.id).length} блоков`] : [];
    const suffix = refs.length ? ` Связанные данные: ${refs.join(', ')}. Они тоже будут удалены или отвязаны.` : '';
    if (selection.kind !== 'person' && !window.confirm(`Удалить «${selected.name || selected.content || selected.text || selection.kind}»?${suffix}`)) return;
    commit(next => {
      const d = next.data;
      const id = selected.id;
      (d[COLLECTION[selection.kind]] as any[]) = (d[COLLECTION[selection.kind]] as any[]).filter(x => x.id !== id) as any;
      if (selection.kind === 'project') {
        const removedDeliveryIds = new Set(d.deliveries.filter(x => x.projectId === id).map(x => x.id));
        const removedBlockIds = new Set(d.weekBlocks.filter(x => x.projectId === id).map(x => x.id));
        d.deliveries = d.deliveries.filter(x => x.projectId !== id);
        d.weekBlocks = d.weekBlocks.filter(x => x.projectId !== id);
        d.weeklyAssignments = d.weeklyAssignments.filter(x => x.projectId !== id);
        d.planEvents = d.planEvents.map(x => x.projectId === id ? { ...x, projectId: undefined } : x);
        d.estimates = d.estimates.filter(x => x.targetType === 'delivery' ? !removedDeliveryIds.has(x.targetId) : !removedBlockIds.has(x.targetId));
        d.crossLinks = d.crossLinks.filter(x => x.sourceType === 'delivery' ? !removedDeliveryIds.has(x.sourceId) : !removedBlockIds.has(x.sourceId));
      }
      if (selection.kind === 'delivery') {
        d.weekBlocks = d.weekBlocks.map(x => x.deliveryId === id ? { ...x, deliveryId: undefined } : x);
        d.weeklyAssignments = d.weeklyAssignments.map(x => x.deliveryId === id ? { ...x, deliveryId: null, updatedAt: stamp() } : x);
        d.estimates = d.estimates.filter(x => !(x.targetType === 'delivery' && x.targetId === id));
        d.crossLinks = d.crossLinks.filter(x => !(x.sourceType === 'delivery' && x.sourceId === id));
      }
      if (selection.kind === 'block') {
        d.estimates = d.estimates.filter(x => !(x.targetType === 'weekBlock' && x.targetId === id));
        d.crossLinks = d.crossLinks.filter(x => !(x.sourceType === 'weekBlock' && x.sourceId === id));
      }
      if (selection.kind === 'lane') {
        const removedBlockIds = new Set(d.weekBlocks.filter(x => x.laneId === id).map(x => x.id));
        d.weekBlocks = d.weekBlocks.filter(x => x.laneId !== id);
        d.estimates = d.estimates.filter(x => !(x.targetType === 'weekBlock' && removedBlockIds.has(x.targetId)));
        d.crossLinks = d.crossLinks.filter(x => !(x.sourceType === 'weekBlock' && removedBlockIds.has(x.sourceId)));
      }
      if (selection.kind === 'person') {
        d.weekBlocks = d.weekBlocks.map(x => x.personId === id ? { ...x, personId: replacementPersonId, updatedAt: stamp() } : x);
        d.weeklyAssignments = d.weeklyAssignments.map(x => x.personId === id ? { ...x, personId: replacementPersonId || null, updatedAt: stamp() } : x);
        d.deliveries = d.deliveries.map(x => x.ownerActorId === id ? { ...x, ownerActorId: replacementPersonId, updatedAt: stamp() } : x);
        d.planEvents = d.planEvents.map(x => x.actorId === id ? { ...x, actorId: replacementPersonId, updatedAt: stamp() } : x);
        d.participations = replacementPersonId ? d.participations.map(x => x.actorId === id ? { ...x, actorId: replacementPersonId, updatedAt: stamp() } : x) : d.participations.filter(x => x.actorId !== id);
        d.handovers = replacementPersonId ? d.handovers.map(x => ({ ...x, fromActorId: x.fromActorId === id ? replacementPersonId : x.fromActorId, toActorId: x.toActorId === id ? replacementPersonId : x.toActorId, updatedAt: x.fromActorId === id || x.toActorId === id ? stamp() : x.updatedAt })) : d.handovers.filter(x => x.fromActorId !== id && x.toActorId !== id);
      }
    });
    setSelection(null);
  }
  function toggle(id: string) { setCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function moveProject(sourceId: string, targetId: string, side: 'before' | 'after') {
    if (sourceId === targetId) return;
    commit(next => {
      const ordered = [...next.data.projects].sort((a, b) => a.order - b.order);
      const sourceIndex = ordered.findIndex(project => project.id === sourceId);
      if (sourceIndex < 0) return;
      const [source] = ordered.splice(sourceIndex, 1);
      const targetIndex = ordered.findIndex(project => project.id === targetId);
      if (targetIndex < 0) return;
      ordered.splice(targetIndex + (side === 'after' ? 1 : 0), 0, source);
      ordered.forEach((project, index) => {
        if (project.order !== index) { project.order = index; project.updatedAt = stamp(); }
      });
    });
  }
  function choose(kind: EntityKind, id: string) { setCatalog(null); setDraft(null); setWeekCell(null); setLoadOpen(false); setSelection({ kind, id }); setMessage(''); setFieldError(''); }
  function fitsFilter(text: string) { return !filters.search || text.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase()); }
  const filteredBlocks = blocks.filter(b =>
    (!filters.project || b.projectId === filters.project) && (!filters.delivery || b.deliveryId === filters.delivery) &&
    (!filters.lane || b.laneId === filters.lane) && (!filters.person || b.personId === filters.person) &&
    (!filters.status || b.status === filters.status) && fitsFilter([b.content, b.note, nameFor(snapshot, 'project', b.projectId), nameFor(snapshot, 'delivery', b.deliveryId)].join(' '))
  );
  const filteredAssignments = assignments.filter(a =>
    (!filters.project || a.projectId === filters.project) && (!filters.delivery || a.deliveryId === filters.delivery) &&
    (!filters.person || a.personId === filters.person) && !filters.lane && !filters.status &&
    fitsFilter([a.title, a.note, nameFor(snapshot, 'project', a.projectId), a.deliveryId ? nameFor(snapshot, 'delivery', a.deliveryId) : '', a.personId ? nameFor(snapshot, 'person', a.personId) : 'Не назначено'].join(' '))
  );
  const visibleDeliveries = deliveries.filter(d => {
    if ((filters.project && filters.project !== d.projectId) || (filters.delivery && filters.delivery !== d.id)) return false;
    const hasMatchingBlock = filteredBlocks.some(b => b.deliveryId === d.id);
    const hasMatchingAssignment = filteredAssignments.some(a => a.deliveryId === d.id);
    if (filters.lane || filters.person) return hasMatchingBlock || hasMatchingAssignment;
    const matchesDelivery = fitsFilter([d.name, d.kind, nameFor(snapshot, 'project', d.projectId)].join(' ')) && (!filters.status || filters.status === d.status);
    return matchesDelivery || hasMatchingBlock || hasMatchingAssignment;
  });
  const visibleProjects = projects.filter(p => {
    if (filters.project && filters.project !== p.id) return false;
    const hasMatchingDelivery = visibleDeliveries.some(d => d.projectId === p.id);
    const hasStandaloneBlock = filteredBlocks.some(b => b.projectId === p.id && !b.deliveryId);
    const hasMatchingAssignment = filteredAssignments.some(a => a.projectId === p.id);
    if (filters.delivery || filters.lane || filters.person) return hasMatchingDelivery || hasStandaloneBlock || hasMatchingAssignment;
    if (!filters.search && !filters.status) return true;
    return hasMatchingDelivery || hasStandaloneBlock || hasMatchingAssignment || (fitsFilter([p.name, p.type].join(' ')) && (!filters.status || p.status === filters.status));
  });
  const visibleEvents = events.filter(e => !filters.delivery && !filters.lane && !filters.status &&
    (!filters.project || e.projectId === filters.project) && (!filters.person || e.actorId === filters.person) && fitsFilter(e.text));
  const undated = visibleDeliveries.filter(d => d.deadline.kind === 'unknown' && d.checkpointDate.kind === 'unknown');
  const statusOptions = Array.from(new Set([...projects.map(x => x.status), ...deliveries.map(x => x.status), ...blocks.map(x => x.status)])).filter(Boolean);
  const weekAssignments = selectedWeek ? filteredAssignments.filter(a => a.weekStart === selectedWeek && visibleProjects.some(p => p.id === a.projectId)) : [];
  const weekBlocks = selectedWeek ? filteredBlocks.filter(b => b.startWeek <= selectedWeek && b.endWeek >= selectedWeek && visibleProjects.some(p => p.id === b.projectId)) : [];
  const panelRecords = weekCell ? assignments.filter(a => a.projectId === weekCell.projectId && (a.deliveryId || null) === weekCell.deliveryId && a.weekStart === weekCell.weekStart) : [];
  function saveAssignment(values: TaskValues, id?: string) {
    const saved = commit(next => {
      if (id) {
        const target = next.data.weeklyAssignments.find(a => a.id === id);
        if (target) Object.assign(target, values, { updatedAt: stamp() });
      } else next.data.weeklyAssignments.push({ ...createBase(), ...values });
    });
    if (saved) setMessage('Недельная задача сохранена.');
    return saved;
  }
  function saveBulk(values: TaskValues[]) {
    const saved = commit(next => { for (const item of values) next.data.weeklyAssignments.push({ ...createBase(), ...item }); });
    if (saved) setMessage(`Добавлено задач: ${values.length}.`);
    return saved;
  }
  function assignmentsForCell(projectId: string, deliveryId: string | null, weekStart: string) {
    return filteredAssignments.filter(a => a.projectId === projectId && (a.deliveryId || null) === deliveryId && a.weekStart === weekStart);
  }
  function assignmentCells(projectId: string, deliveryId: string | null) {
    return weeks.map(w => {
      const items = assignmentsForCell(projectId, deliveryId, w);
      return <button key={`${projectId}-${deliveryId}-${w}`} className={`weekly-cell ${items.length ? 'has-tasks' : ''} ${selectedWeek === w ? 'is-week-selected' : ''}`} title={items.length ? `${items.map(a => `${nameFor(snapshot, 'person', a.personId)}: ${a.title} — ${a.count === null ? a.completed ? 'выполнено' : 'не выполнено' : `${a.completedCount ?? 0} из ${a.count} выполнено`}${a.note ? ` — ${a.note}` : ''}`).join('\n')}` : `Добавить задачу на неделю ${humanDate(w)}`} style={{ gridColumn: weekIndex(w, origin) + 1 }} onClick={e => { e.stopPropagation(); setLoadOpen(false); setWeekCell({ projectId, deliveryId, weekStart: w }); setSelectedWeek(w); }}>
        {items.length ? <span className="weekly-cell-content">
          {items.map(item => <span className={`weekly-task ${item.count !== null && (item.completedCount ?? 0) > item.count ? 'is-over-complete' : ''}`} key={item.id} style={{ borderColor: people.find(person => person.id === item.personId)?.color || '#8995a7', '--task-progress': `${item.count === null ? item.completed ? 100 : 0 : Math.max(0, Math.min(100, (item.completedCount ?? 0) / item.count * 100))}%` } as CSSProperties}>
            <span className="weekly-task-head"><span>{nameFor(snapshot, 'person', item.personId)}</span><b>{item.count === null ? item.completed ? '✓' : '' : `${item.completedCount ?? 0}/${item.count}`}</b></span>
            <span className="weekly-task-title">{item.title}</span>
          </span>)}
        </span> : <span className="weekly-cell-plus">+</span>}
      </button>;
    });
  }

  function row(kind: EntityKind, id: string, label: string, detail: string, depth: number, bars: ReactNode, expandable = false) {
    const delivery = kind === 'delivery' ? data.deliveries.find(x => x.id === id) : undefined;
    const projectId = kind === 'project' ? id : delivery?.projectId || '';
    const deliveryId = kind === 'delivery' ? id : null;
    const volume = delivery ? deliveryMetrics(delivery, assignments) : null;
    const showVolume = volume && (volume.hasVolume || volume.scheduled > 0 || volume.unquantified > 0 || volume.completedManual !== undefined);
    const volumeBase = volume ? (volume.total > 0 ? volume.total : Math.max(volume.scheduled, volume.completed)) : 0;
    const volumePercent = (value: number) => volumeBase > 0 ? `${Math.min(100, value / volumeBase * 100)}%` : '0%';
    const maxTasks = projectId ? Math.max(0, ...weeks.map(w => assignmentsForCell(projectId, deliveryId, w).length)) : 0;
    const rowHeight = Math.max(66, 8 + maxTasks * 54 + Math.max(0, maxTasks - 1) * 4);
    return <div className={`plan-row ${kind === 'project' || kind === 'delivery' ? 'has-week-cells' : ''} ${selection?.id === id ? 'is-selected' : ''} ${kind === 'project' && projectDrop?.id === id ? `is-drop-${projectDrop.side}` : ''}`} style={projectId ? { height: rowHeight } : undefined} key={`${kind}-${id}`}
      onDragOver={kind === 'project' ? event => { if (!draggingProjectId || draggingProjectId === id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; const bounds = event.currentTarget.getBoundingClientRect(); const side = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'; if (projectDrop?.id !== id || projectDrop.side !== side) setProjectDrop({ id, side }); } : undefined}
      onDrop={kind === 'project' ? event => { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); const side = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'; if (draggingProjectId && draggingProjectId !== id) moveProject(draggingProjectId, id, side); setDraggingProjectId(null); setProjectDrop(null); } : undefined}>
      <div className="plan-row-label" style={{ paddingLeft: 14 + depth * 18 }}>
        {kind === 'project' && <button type="button" className="plan-project-drag" draggable aria-label={`Перетащить проект «${label}». Alt и стрелки вверх или вниз также меняют порядок.`} title="Перетащить проект; Alt+↑/↓ — изменить порядок" onDragStart={event => { event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; setDraggingProjectId(id); setProjectDrop(null); }} onDragEnd={() => { setDraggingProjectId(null); setProjectDrop(null); }} onKeyDown={event => { if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const index = projects.findIndex(project => project.id === id); const target = projects[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target) moveProject(id, target.id, event.key === 'ArrowUp' ? 'before' : 'after'); }}>⋮⋮</button>}
        {expandable ? <button className="plan-collapse" onClick={() => toggle(id)} aria-label={collapsed.has(id) ? 'Развернуть' : 'Свернуть'}>{collapsed.has(id) ? '▸' : '▾'}</button> : <span className="plan-collapse-spacer" />}
        {showVolume && volume ? <div className="plan-delivery-row-content">
          <div className="plan-delivery-row-heading"><button className="plan-row-name" onClick={() => choose(kind, id)} title={label}>{label}</button><span className="plan-row-detail" title={detail}>{detail}</span></div>
          <div className="plan-delivery-row-stats" title={`В тестировании: ${volume.testing}; в разработке: ${volume.development}; всего: ${volume.hasVolume ? volume.total : 'не задано'}; распределено: ${volume.scheduled}; выполнено: ${volume.completed}${volume.completedManual !== undefined ? ` (ручной итог; по неделям: ${volume.completedFromWeeks})` : ''}${volume.unquantified ? `; без количества: ${volume.unquantified}, выполнено: ${volume.unquantifiedCompleted}` : ''}`}>
            <span>Тест <b>{volume.testing}</b></span><span>Разр <b>{volume.development}</b></span><span>Всего <b>{volume.hasVolume ? volume.total : '—'}</b></span><span>План <b>{volume.scheduled}</b></span><span>Готово <b>{volume.completed}{volume.completedManual !== undefined ? '*' : ''}</b></span>
          </div>
          <div className="plan-delivery-row-progress" role="img" aria-label={`Распределено ${volume.scheduled} из ${volume.hasVolume ? volume.total : 'неуказанного объёма'}, выполнено ${volume.completed}`}><span className="is-scheduled" style={{ width: volumePercent(volume.scheduled) }} /><span className="is-completed" style={{ width: volumePercent(volume.completed) }} /></div>
        </div> : <><button className="plan-row-name" onClick={() => choose(kind, id)} title={label}>{label}</button><span className="plan-row-detail" title={detail}>{detail}</span></>}
      </div>
      <div className="plan-row-track" style={{ '--week-count': weeksCount } as CSSProperties}>{bars}{projectId ? assignmentCells(projectId, deliveryId) : null}</div>
    </div>;
  }
  function bar(start: string, end: string, label: string, kind: EntityKind, id: string, className = '', title = '') {
    const first = Math.max(0, weekIndex(validWeek(start), origin));
    const last = Math.min(weeksCount - 1, weekIndex(validWeek(end), origin));
    if (first >= weeksCount || last < 0 || last < first) return null;
    return <button key={id} className={`plan-bar ${className}`} style={{ left: `${first / weeksCount * 100}%`, width: `${(last - first + 1) / weeksCount * 100}%` }} title={`${label} · ${humanDate(start)} – ${humanDate(end)}${title ? ` · ${title}` : ''}`} onClick={e => { e.stopPropagation(); choose(kind, id); }}>{label}</button>;
  }
  function marker(when: string, label: string, kind: EntityKind, id: string, soft = false) {
    const i = weekIndex(validWeek(when), origin);
    if (i < 0 || i >= weeksCount) return null;
    return <button key={`${id}-${when}`} className={`plan-marker ${soft ? 'soft' : ''}`} style={{ left: `${(i + .5) / weeksCount * 100}%` }} title={`${label}: ${humanDate(when)}`} onClick={e => { e.stopPropagation(); choose(kind, id); }}>◆</button>;
  }

  async function exportXlsx(scope: 'current' | 'all') {
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const useCurrent = scope === 'current';
      const exportAssignments = useCurrent ? filteredAssignments.filter(task => weeks.includes(task.weekStart)) : assignments;
      const exportBlocks = useCurrent ? filteredBlocks.filter(block => weeks.some(week => week >= block.startWeek && week <= block.endWeek)) : blocks;
      const exportWeeks = useCurrent ? weeks : weeksForAllLoad(assignments, blocks, weeks);
      const workbook = createWeeklyLoadWorkbook(new ExcelJS.Workbook(), {
        projects: useCurrent ? visibleProjects : projects,
        deliveries: useCurrent ? visibleDeliveries : deliveries,
        assignments: exportAssignments,
        blocks: exportBlocks,
        people,
        weeks: exportWeeks,
        scopeLabel: useCurrent ? 'Текущая выборка' : 'Весь план',
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `plan-zagruzka-${scope}-${iso(new Date())}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Экспортирован файл ${anchor.download}.`);
    } catch (error) { setMessage(`Не удалось создать XLSX: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setExporting(false); }
  }

  return <div className="plan-page">
    <header className="plan-toolbar">
      <div className="plan-title"><h1>План проектов</h1><span>Недельный обзор поставок и работы</span></div>
      <div className="plan-actions">
        <div className="plan-search-tools">
          <input aria-label="Поиск по плану" placeholder="Поиск по плану" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
          <button className={`plan-filter-toggle ${activeFilterCount ? 'has-active' : ''}`} onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen} aria-controls="plan-advanced-filters">Фильтры{activeFilterCount > 0 && <span className="plan-filter-count">{activeFilterCount}</span>}</button>
          {hasFilters && <button className="plan-clear-filters" onClick={() => setFilters(DEFAULT_FILTERS)}>Сбросить</button>}
        </div>
        <div className="plan-menu-actions" ref={actionMenuRef}>
          <button className="plan-primary" onClick={event => { actionMenuTrigger.current = event.currentTarget; setActionMenu(menu => menu === 'add' ? null : 'add'); }} aria-expanded={actionMenu === 'add'} aria-controls="plan-add-menu">+ Добавить</button>
          <button onClick={event => { actionMenuTrigger.current = event.currentTarget; setActionMenu(menu => menu === 'more' ? null : 'more'); }} aria-expanded={actionMenu === 'more'} aria-controls="plan-more-menu">Ещё <span aria-hidden="true">▾</span></button>
          {actionMenu === 'add' && <div className="plan-action-popover" id="plan-add-menu" aria-label="Добавить объект плана">
            <strong>Добавить в план</strong>
            <button onClick={() => { setActionMenu(null); add('project'); }}>Проект</button>
            <button onClick={() => { setActionMenu(null); add('delivery'); }}>Поставку</button>
            <button onClick={() => { setActionMenu(null); add('block'); }}>Рабочий блок</button>
            <button onClick={() => { setActionMenu(null); add('lane'); }}>Дорожку</button>
            <button onClick={() => { setActionMenu(null); add('person'); }}>Человека</button>
            <button onClick={() => { setActionMenu(null); add('event'); }}>Событие</button>
          </div>}
          {actionMenu === 'more' && <div className="plan-action-popover" id="plan-more-menu" aria-label="Дополнительные действия">
            <strong>Рабочее пространство</strong>
            <button onClick={() => { setActionMenu(null); setSelection(null); setDraft(null); setWeekCell(null); setLoadOpen(false); setCatalog('person'); }}>Объекты плана</button>
            <button onClick={() => { setActionMenu(null); setHelpOpen(true); }}>Справка</button>
            <strong className="plan-popover-section">Экспорт в Excel</strong>
            <button disabled={exporting} onClick={() => { setActionMenu(null); exportXlsx('current'); }}>Текущая выборка</button>
            <button disabled={exporting} onClick={() => { setActionMenu(null); exportXlsx('all'); }}>Весь план</button>
          </div>}
        </div>
      </div>
    </header>
    {filtersOpen && <div className="plan-filters plan-advanced-filters" id="plan-advanced-filters">
      <select aria-label="Фильтр проекта" value={filters.project} onChange={e => setFilters({ ...filters, project: e.target.value, delivery: '' })}><option value="">Все проекты</option>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр поставки" value={filters.delivery} onChange={e => setFilters({ ...filters, delivery: e.target.value })}><option value="">Все поставки</option>{deliveries.filter(x => !filters.project || x.projectId === filters.project).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр дорожки" value={filters.lane} onChange={e => setFilters({ ...filters, lane: e.target.value })}><option value="">Все дорожки</option>{data.lanes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр человека" value={filters.person} onChange={e => setFilters({ ...filters, person: e.target.value })}><option value="">Все люди</option>{people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр статуса" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">Все статусы</option>{statusOptions.map(x => <option key={x} value={x}>{x}</option>)}</select>
    </div>}
    <div className="plan-period">
      <button onClick={() => setOrigin(addWeeks(origin, -4))} aria-label="Предыдущие четыре недели">←</button>
      <button onClick={() => setOrigin(addWeeks(todayWeek(), -2))}>Сегодня</button>
      <button onClick={() => setOrigin(addWeeks(origin, 4))} aria-label="Следующие четыре недели">→</button>
      <label>С недели <input type="date" value={origin} onChange={e => e.target.value && setOrigin(validWeek(e.target.value))} /></label>
      <label>Период <select value={weeksCount} onChange={e => setWeeksCount(Number(e.target.value))}><option value={8}>8 недель</option><option value={16}>16 недель</option><option value={24}>24 недели</option><option value={32}>32 недели</option></select></label>
      <button onClick={() => {
        const known = [...blocks.map(x => x.startWeek), ...assignments.map(x => x.weekStart), ...deliveries.flatMap(x => x.deadline.kind === 'exact' ? [x.deadline.date] : x.deadline.kind === 'range' ? [x.deadline.start] : [])];
        if (!known.length) return;
        const min = known.sort()[0], max = known.sort().at(-1)!;
        setOrigin(addWeeks(validWeek(min), -1)); setWeeksCount([8, 16, 24, 32].find(n => weekIndex(validWeek(max), addWeeks(validWeek(min), -1)) < n) || 32);
      }}>Уместить план</button>
      <span className="plan-period-caption">{humanDate(origin)} – {humanDate(addWeeks(origin, weeksCount - 1))}</span>
    </div>
    {message && <div className="plan-message" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}
    <div className="plan-content">
      <div className="plan-main">
        <div className="plan-scroll" ref={planScroll}>
          <div className="plan-grid">
            <div className="plan-grid-head"><div className="plan-head-label">Объекты плана</div><div className="plan-head-weeks" style={{ '--week-count': weeksCount } as CSSProperties}>{weeks.map(w => <button key={w} className={`${w === todayWeek() ? 'current-week' : ''} ${selectedWeek === w ? 'is-selected-week' : ''}`} onClick={() => { setSelectedWeek(w); setWeekCell(null); setLoadOpen(true); }} aria-label={`Нагрузка недели №${isoWeekNumber(w)}, рабочие дни ${humanDate(w)} — ${humanDate(workweekEnd(w))}`} title={`Рабочие дни: ${humanDate(w)} — ${humanDate(workweekEnd(w))}`}><strong>{workweekLabel(w)}</strong><small>№{isoWeekNumber(w)} · {w.slice(0, 4)}</small></button>)}</div></div>
            {!projects.length && <div className="plan-empty">План пока пуст. Создайте проект, затем добавьте поставку и недельные задачи.</div>}
            {visibleProjects.map(p => <div key={p.id}>
              {row('project', p.id, p.name, `${p.type} · ${p.status}`, 0, null, true)}
              {!collapsed.has(p.id) && <>
                {visibleDeliveries.filter(d => d.projectId === p.id).map(d => <div key={d.id}>
                  {row('delivery', d.id, d.name, `${d.kind} · ${deadlineText(d.deadline as DateReference)}`, 1, <>{d.deadline.kind === 'exact' && marker(d.deadline.date, d.name, 'delivery', d.id)}{d.deadline.kind === 'range' && bar(d.deadline.start, d.deadline.end, '≈ срок', 'delivery', d.id, 'is-soft')}{d.checkpointDate.kind === 'exact' && marker(d.checkpointDate.date, 'Контрольная дата', 'delivery', d.id, true)}</>, true)}
                  {!collapsed.has(d.id) && [...data.lanes].sort((a, b) => a.order - b.order).map(l => {
                    const laneBlocks = filteredBlocks.filter(b => b.deliveryId === d.id && b.laneId === l.id);
                    if (!laneBlocks.length) return null;
                    return <div key={`${d.id}-${l.id}`}>
                      {row('lane', l.id, l.name, blockCount(laneBlocks.length), 2, null, true)}
                      {!collapsed.has(l.id) && laneBlocks.map(b => row('block', b.id, b.personId ? nameFor(snapshot, 'person', b.personId) : 'Не назначено', b.content, 3, bar(b.startWeek, b.endWeek, b.content, 'block', b.id, b.personId ? 'is-assigned' : 'is-unassigned')))}
                    </div>;
                  })}
                </div>)}
                {[...data.lanes].sort((a, b) => a.order - b.order).map(l => {
                  const laneBlocks = filteredBlocks.filter(b => b.projectId === p.id && !b.deliveryId && b.laneId === l.id);
                  if (!laneBlocks.length) return null;
                  return <div key={`${p.id}-${l.id}-loose`}>
                    {row('lane', l.id, l.name, `${blockCount(laneBlocks.length)} без поставки`, 1, null, true)}
                    {!collapsed.has(l.id) && laneBlocks.map(b => row('block', b.id, b.personId ? nameFor(snapshot, 'person', b.personId) : 'Не назначено', b.content, 2, bar(b.startWeek, b.endWeek, b.content, 'block', b.id, b.personId ? 'is-assigned' : 'is-unassigned')))}
                  </div>;
                })}
              </>}
            </div>)}
            {visibleEvents.length > 0 && <div className="plan-section-label">События</div>}
            {visibleEvents.map(e => row('event', e.id, e.type, e.text, 0, bar(e.startWeek, e.endWeek || e.startWeek, e.text, 'event', e.id, 'is-event')))}
          </div>
        </div>
        {showUndated && undated.length > 0 && <div className="plan-undated"><div><strong>Без срока</strong><button onClick={() => setShowUndated(false)}>Скрыть</button></div>{undated.map(d => <button key={d.id} onClick={() => choose('delivery', d.id)}>{nameFor(snapshot, 'project', d.projectId)} · {d.name}</button>)}</div>}
        {!showUndated && undated.length > 0 && <button className="plan-show-undated" onClick={() => setShowUndated(true)}>Показать без срока ({undated.length})</button>}
        <div className="plan-legend"><span><i className="legend-work" /> Рабочий блок</span><span><i className="legend-unassigned" /> Не назначено</span><span><i className="legend-estimate" /> Приблизительный срок</span><span><i className="legend-event" /> Событие</span></div>
      </div>
    </div>
    {loadOpen && selectedWeek && <WeeklyLoadDialog snapshot={snapshot} weekStart={selectedWeek} weekNumber={isoWeekNumber(selectedWeek)} records={weekAssignments} blocks={weekBlocks} onClose={() => setLoadOpen(false)} onOpenAssignment={record => { setLoadOpen(false); setWeekCell({ projectId: record.projectId, deliveryId: record.deliveryId || null, weekStart: record.weekStart }); }} onOpenBlock={record => choose('block', record.id)} />}
    {weekCell && <div className="plan-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setWeekCell(null); }}><div className="plan-modal plan-weekly-modal" role="dialog" aria-modal="true" aria-label="Недельные задачи"><WeeklyTasksPanel key={`${weekCell.projectId}-${weekCell.deliveryId}-${weekCell.weekStart}`} snapshot={snapshot} context={weekCell} title={`${nameFor(snapshot, 'project', weekCell.projectId)}${weekCell.deliveryId ? ` / ${nameFor(snapshot, 'delivery', weekCell.deliveryId)}` : ''} · ${humanDate(weekCell.weekStart)}`} records={panelRecords} onSave={saveAssignment} onSaveBulk={saveBulk} onDelete={id => { if (window.confirm('Удалить недельную задачу?')) commit(next => { next.data.weeklyAssignments = next.data.weeklyAssignments.filter(a => a.id !== id); }); }} onClose={() => setWeekCell(null)} /></div></div>}
    {!weekCell && !loadOpen && !catalog && selection && selected && <div className="plan-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeInspector(); }}><div className="plan-modal plan-editor-modal" role="dialog" aria-modal="true" aria-label={`${isDraft ? 'Создать' : 'Редактировать'} ${selected.name || selected.content || selected.text || 'объект'}`}><aside className="plan-inspector"><div className="plan-inspector-head"><div><small>{isDraft ? 'Новый объект' : 'Редактирование'}</small><h2>{selected.name || selected.content || selected.text || 'Объект'}</h2></div><button aria-label="Закрыть редактор" onClick={closeInspector}>×</button></div>
      <Inspector snapshot={snapshot} kind={selection.kind} item={selected} isDraft={isDraft} fieldError={fieldError} update={values => update(selection.kind, selection.id, values)} add={add} choose={choose} onNavigateToProcess={onNavigateToProcess} onWeekNormalized={value => setMessage(`Дата ${humanDate(value)} приведена к понедельнику ${humanDate(validWeek(value))}.`)} />
      <div className="plan-inspector-foot"><button className="plan-primary" onClick={saveDraft}>Сохранить</button><button onClick={closeInspector}>Отмена</button>{!isDraft && <button className="danger" onClick={removeSelected}>Удалить</button>}</div>
    </aside></div></div>}
    {catalog && <PlanEntitiesDialog snapshot={snapshot} active={catalog} onSelect={setCatalog} onOpen={choose} onOpenAssignment={item => { setCatalog(null); setSelectedWeek(item.weekStart); setWeekCell({ projectId: item.projectId, deliveryId: item.deliveryId || null, weekStart: item.weekStart }); setLoadOpen(false); }} onAdd={add} onClose={() => setCatalog(null)} />}
    {helpOpen && <PlanHelpDialog onClose={() => setHelpOpen(false)} />}
  </div>;
}

type InspectorProps = { snapshot: Snapshot; kind: EntityKind; item: any; isDraft: boolean; fieldError: string; update: (values: Record<string, unknown>) => void; add: (kind: EntityKind, prefill?: Record<string, unknown>) => void; choose: (kind: EntityKind, id: string) => void; onNavigateToProcess: (targetId: string) => void; onWeekNormalized: (value: string) => void };
function Inspector({ snapshot, kind, item, isDraft, fieldError, update, add, choose, onNavigateToProcess, onWeekNormalized }: InspectorProps) {
  const d = snapshot.data;
  const input = (label: string, key: string, type = 'text') => <label className="plan-field">{label}<input type={type} value={item[key] ?? ''} onChange={e => update({ [key]: type === 'number' ? Number(e.target.value) : e.target.value })} /></label>;
  const area = (label: string, key: string) => <label className="plan-field">{label}<textarea rows={3} value={item[key] ?? ''} onChange={e => update({ [key]: e.target.value })} /></label>;
  const select = (label: string, key: string, options: { id: string; name: string }[], empty = 'Не выбрано') => <label className="plan-field">{label}<select value={item[key] ?? ''} onChange={e => update({ [key]: e.target.value || undefined })}><option value="">{empty}</option>{options.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
  const status = () => <label className="plan-field">Статус<select value={item.status || ''} onChange={e => update({ status: e.target.value })}>{['Запланировано', 'В работе', 'Завершено', 'На паузе', 'Риск'].map(x => <option key={x} value={x}>{x}</option>)}</select></label>;
  const weekChange = (key: 'startWeek' | 'endWeek', value: string) => {
    if (!value) { update({ [key]: key === 'endWeek' && kind === 'event' ? undefined : '' }); return; }
    const normalized = validWeek(value);
    update({ [key]: normalized });
    if (normalized !== value && (!weekDateIssue(kind, { ...item, [key]: normalized }) || isDraft)) onWeekNormalized(value);
  };
  const dateRef = (label: string, key: string) => {
    const ref = (item[key] || { kind: 'unknown' }) as DateReference;
    return <fieldset className="plan-date-ref"><legend>{label}</legend><select value={ref.kind} onChange={e => update({ [key]: e.target.value === 'exact' ? { kind: 'exact', date: todayWeek(), text: ref.text } : e.target.value === 'range' ? { kind: 'range', start: todayWeek(), end: addWeeks(todayWeek(), 2), text: ref.text } : { kind: 'unknown', text: ref.text } })}><option value="unknown">Неизвестно</option><option value="exact">Точная дата</option><option value="range">Диапазон</option></select>
      {ref.kind === 'exact' && <input aria-label={`${label}: дата`} type="date" value={ref.date} onChange={e => update({ [key]: { ...ref, date: e.target.value } })} />}
      {ref.kind === 'range' && <div className="plan-date-pair"><input aria-label={`${label}: начало`} type="date" value={ref.start} onChange={e => update({ [key]: { ...ref, start: e.target.value } })} /><input aria-label={`${label}: конец`} type="date" value={ref.end} min={ref.start} onChange={e => update({ [key]: { ...ref, end: e.target.value } })} /></div>}
      <input aria-label={`${label}: словесный ориентир`} placeholder="Словесный ориентир (необязательно)" value={ref.text || ''} onChange={e => update({ [key]: { ...ref, text: e.target.value } })} />{fieldError.includes(`.${key}`) && <small className="plan-field-error" role="alert">{fieldError.split(': ').slice(1).join(': ') || fieldError}</small>}</fieldset>;
  };
  const linkSection = (sourceType: 'delivery' | 'weekBlock') => {
    const links = d.crossLinks.filter(l => l.sourceType === sourceType && l.sourceId === item.id);
    return <section className="plan-inspector-section"><h3>Связи с картой процессов</h3>{links.map(l => <div className="plan-related" key={l.id}><button onClick={() => onNavigateToProcess(l.targetId)}>{l.targetType === 'stage' ? d.stages.find(x => x.id === l.targetId)?.name : d.checkpoints.find(x => x.id === l.targetId)?.name || 'Открыть объект процесса'} ↗</button><small>{l.note}</small><button onClick={() => choose('link', l.id)}>Изменить связь</button></div>)}<button onClick={() => add('link', { sourceType, sourceId: item.id })}>+ Добавить связь</button></section>;
  };
  const estimateSection = (targetType: 'delivery' | 'weekBlock') => {
    const estimates = d.estimates.filter(e => e.targetType === targetType && e.targetId === item.id);
    return <section className="plan-inspector-section"><h3>{targetType === 'delivery' ? 'Дополнительные оценки' : 'Оценки объёма'}</h3>{estimates.map(e => <div className="plan-related" key={e.id}><span>{e.value} {e.unit} · {e.kind === 'actual' ? 'факт' : e.kind === 'forecast' ? 'прогноз' : 'оценка'}</span><button onClick={() => choose('estimate', e.id)}>Изменить оценку</button></div>)}<button onClick={() => add('estimate', { targetType, targetId: item.id })}>+ Добавить оценку</button></section>;
  };
  return <div className="plan-inspector-body">
    {kind === 'project' && <>{input('Название', 'name')}{input('Тип', 'type')}{status()}{area('Заметки', 'notes')}{!isDraft && <section className="plan-inspector-section"><h3>Поставки</h3>{d.deliveries.filter(x => x.projectId === item.id).map(x => <div className="plan-related" key={x.id}>{x.name}</div>)}<button onClick={() => add('delivery', { projectId: item.id })}>+ Поставка</button></section>}</>}
    {kind === 'delivery' && <>{select('Проект', 'projectId', d.projects)}{input('Вид поставки', 'kind')}{input('Название / версия', 'name')}{select('Владелец', 'ownerActorId', d.actors.filter(x => x.type === 'person'))}{dateRef('Начало', 'startDate')}{dateRef('Контрольная дата', 'checkpointDate')}{dateRef('Плановый срок', 'deadline')}{status()}<DeliveryVolumeCard delivery={item} assignments={d.weeklyAssignments} onChange={update} fieldError={fieldError} />{area('Заметка', 'note')}{!isDraft && <>{estimateSection('delivery')}{linkSection('delivery')}<button onClick={() => add('block', { projectId: item.projectId, deliveryId: item.id })}>+ Недельный блок</button></>}</>}
    {kind === 'lane' && <>{input('Название', 'name')}{input('Порядок', 'order', 'number')}</>}
    {kind === 'block' && <>{select('Проект', 'projectId', d.projects)}{select('Поставка', 'deliveryId', d.deliveries.filter(x => x.projectId === item.projectId))}{select('Дорожка', 'laneId', d.lanes)}{select('Человек', 'personId', d.actors.filter(x => x.type === 'person'), 'Не назначено')}{input('Содержание', 'content')}<div className="plan-date-pair"><label className="plan-field">Первая неделя<input type="date" value={item.startWeek} onChange={e => weekChange('startWeek', e.target.value)} /></label><label className="plan-field">Последняя неделя<input type="date" value={item.endWeek} onChange={e => weekChange('endWeek', e.target.value)} /></label></div><small>Хранятся понедельники. Последняя неделя включена.</small>{weekDateIssue(kind, item) && <small className="plan-field-error">{weekDateIssue(kind, item)}</small>}{status()}{area('Заметка', 'note')}{!isDraft && <>{estimateSection('weekBlock')}{linkSection('weekBlock')}</>}</>}
    {kind === 'event' && <>{input('Тип события', 'type')}<div className="plan-date-pair"><label className="plan-field">Первая неделя<input type="date" value={item.startWeek} onChange={e => weekChange('startWeek', e.target.value)} /></label><label className="plan-field">Последняя неделя<input type="date" value={item.endWeek || ''} onChange={e => weekChange('endWeek', e.target.value)} /></label></div>{weekDateIssue(kind, item) && <small className="plan-field-error">{weekDateIssue(kind, item)}</small>}{select('Проект', 'projectId', d.projects)}{select('Участник', 'actorId', d.actors.filter(x => x.type === 'person'))}{area('Текст', 'text')}</>}
    {kind === 'person' && <>{input('Имя', 'name')}{select('Отдел', 'departmentId', d.actors.filter(x => x.type === 'department'))}<label className="plan-field">Цвет метки<input type="color" value={item.color || '#2563eb'} onChange={e => update({ color: e.target.value })} /></label><p className="plan-help">Человек находится в общем справочнике и доступен на карте процессов.</p></>}
    {kind === 'estimate' && <><label className="plan-field">Объект<select value={`${item.targetType}:${item.targetId}`} onChange={e => { const [targetType, targetId] = e.target.value.split(':'); update({ targetType, targetId }); }}>{d.deliveries.map(x => <option key={x.id} value={`delivery:${x.id}`}>Поставка: {x.name}</option>)}{d.weekBlocks.map(x => <option key={x.id} value={`weekBlock:${x.id}`}>Блок: {x.content}</option>)}</select></label>{input('Значение', 'value', 'number')}{input('Единица', 'unit')}<label className="plan-field">Вид<select value={item.kind} onChange={e => update({ kind: e.target.value })}><option value="estimate">Оценка</option><option value="forecast">Прогноз</option><option value="actual">Факт</option></select></label></>}
    {kind === 'link' && <><label className="plan-field">Объект плана<select value={`${item.sourceType}:${item.sourceId}`} onChange={e => { const [sourceType, sourceId] = e.target.value.split(':'); update({ sourceType, sourceId }); }}>{d.deliveries.map(x => <option key={x.id} value={`delivery:${x.id}`}>Поставка: {x.name}</option>)}{d.weekBlocks.map(x => <option key={x.id} value={`weekBlock:${x.id}`}>Блок: {x.content}</option>)}</select></label><label className="plan-field">Этап или точка процесса<select value={`${item.targetType}:${item.targetId}`} onChange={e => { const [targetType, targetId] = e.target.value.split(':'); update({ targetType, targetId }); }}>{d.stages.map(x => <option key={x.id} value={`stage:${x.id}`}>Этап: {x.name}</option>)}{d.checkpoints.map(x => <option key={x.id} value={`checkpoint:${x.id}`}>Точка: {x.name}</option>)}</select></label>{area('Пояснение', 'note')}<button onClick={() => onNavigateToProcess(item.targetId)}>Открыть на карте ↗</button></>}
    <small className="plan-id">ID: {item.id}</small>
  </div>;
}
