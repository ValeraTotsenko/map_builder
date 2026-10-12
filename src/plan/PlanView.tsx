import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Snapshot } from '../model';
import { createId, validateSnapshot } from '../model';
import './plan.css';

type EntityKind = 'project' | 'delivery' | 'lane' | 'block' | 'event' | 'person' | 'estimate' | 'link';
type DateReference = { kind: 'unknown'; text?: string } | { kind: 'exact'; date: string; text?: string } | { kind: 'range'; start: string; end: string; text?: string };
type Selection = { kind: EntityKind; id: string } | null;
type Draft = { kind: EntityKind; item: Record<string, any> };
type FilterState = { search: string; project: string; delivery: string; lane: string; person: string; status: string };
type PlanViewProps = { snapshot: Snapshot; onChange: (next: Snapshot) => void; onNavigateToProcess: (targetId: string) => void; initialSelection?: string };

const DAY = 86400000;
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
function todayWeek(): string { return iso(monday(new Date())); }
function stamp() { return new Date().toISOString(); }
function createBase() { const t = stamp(); return { id: createId(), createdAt: t, updatedAt: t }; }
function humanDate(s?: string): string { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; }
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
function dateForExcel(s?: string) { return s ? new Date(`${s}T12:00:00Z`) : null; }
function intersectsPeriod(ref: DateReference, from: string, untilExclusive: string): boolean {
  if (ref.kind === 'exact') return ref.date >= from && ref.date < untilExclusive;
  if (ref.kind === 'range') return ref.end >= from && ref.start < untilExclusive;
  return false;
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

  useEffect(() => { if (initialSelection) { setDraft(null); setSelection(parseSelection(snapshot, initialSelection)); } }, [initialSelection]);
  const weeks = useMemo(() => Array.from({ length: weeksCount }, (_, i) => addWeeks(origin, i)), [origin, weeksCount]);
  const projects = [...data.projects].sort((a, b) => a.order - b.order);
  const deliveries = data.deliveries;
  const blocks = data.weekBlocks;
  const events = data.planEvents;
  const people = data.actors.filter(a => a.type === 'person');
  const isDraft = !!selection && draft?.kind === selection.kind && draft.item.id === selection.id;
  const selected = isDraft ? draft!.item : selection ? (data[COLLECTION[selection.kind]] as { id: string }[]).find(x => x.id === selection.id) as any : null;

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
    if (draft?.kind === kind && draft.item.id === id) {
      setDraft({ kind, item: { ...draft.item, ...values } });
      return;
    }
    const current = (data[COLLECTION[kind]] as any[]).find(x => x.id === id);
    if (!current) return;
    const issue = weekDateIssue(kind, { ...current, ...values });
    if (issue) { setMessage(issue); return; }
    const saved = commit(next => {
      const item = (next.data[COLLECTION[kind]] as any[]).find(x => x.id === id);
      if (!item) return;
      if (kind === 'delivery' && typeof values.projectId === 'string' && values.projectId !== item.projectId) {
        next.data.weekBlocks.forEach(b => { if (b.deliveryId === id) { b.projectId = values.projectId as string; b.updatedAt = stamp(); } });
      }
      if (kind === 'block' && typeof values.projectId === 'string' && values.projectId !== item.projectId && item.deliveryId) {
        if (next.data.deliveries.find(x => x.id === item.deliveryId)?.projectId !== values.projectId) values.deliveryId = undefined;
      }
      if (kind === 'block' && typeof values.deliveryId === 'string') {
        const delivery = next.data.deliveries.find(x => x.id === values.deliveryId);
        if (delivery) values.projectId = delivery.projectId;
      }
      Object.assign(item, values, { updatedAt: stamp() });
    });
    if (saved) setMessage('Сохранено');
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
    setDraft({ kind, item });
    setSelection({ kind, id: base.id });
    setMessage('Заполните карточку и нажмите «Сохранить».');
  }
  function saveDraft() {
    if (!draft) return;
    const issue = weekDateIssue(draft.kind, draft.item);
    if (issue) { setMessage(issue); return; }
    const { kind, item } = draft;
    if (commit(next => { (next.data[COLLECTION[kind]] as any[]).push(item); })) {
      setDraft(null);
      setMessage('Сохранено');
    }
  }
  function removeSelected() {
    if (!selection || !selected) return;
    let replacementPersonId: string | undefined;
    if (selection.kind === 'person') {
      const direct = data.participations.filter(x => x.actorId === selected.id);
      const transfers = data.handovers.filter(x => x.fromActorId === selected.id || x.toActorId === selected.id);
      const assignedBlocks = data.weekBlocks.filter(x => x.personId === selected.id);
      const ownedDeliveries = data.deliveries.filter(x => x.ownerActorId === selected.id);
      const relatedNames = Array.from(new Set(direct.map(x => {
        if (x.targetType === 'process') return data.processes.find(p => p.id === x.targetId)?.name;
        const processId = x.targetType === 'stage' ? data.stages.find(s => s.id === x.targetId)?.processId : data.checkpoints.find(c => c.id === x.targetId)?.processId;
        return data.processes.find(p => p.id === processId)?.name;
      }).filter(Boolean))).join(', ');
      const others = people.filter(x => x.id !== selected.id);
      const answer = window.prompt(
        `Удаление «${selected.name}» затронет: участия ${direct.length}, передачи ${transfers.length}, недельные блоки ${assignedBlocks.length}, поставки ${ownedDeliveries.length}.\nПроцессы: ${relatedNames || 'нет'}.\n\nЧтобы перепривязать связи, введите ID другого человека:\n${others.map(x => `${x.name}: ${x.id}`).join('\n') || 'Других людей нет'}\n\nЧтобы явно удалить связи и снять назначения, введите УДАЛИТЬ. Отмена сохранит данные.`,
      );
      if (answer === null) return;
      if (answer.trim().toUpperCase() !== 'УДАЛИТЬ') {
        const replacement = others.find(x => x.id === answer.trim());
        if (!replacement) { setMessage('Не найден человек с указанным ID. Удаление отменено.'); return; }
        replacementPersonId = replacement.id;
      }
    }
    const refs = selection.kind === 'project' ? [
      `${data.deliveries.filter(x => x.projectId === selected.id).length} поставок`, `${data.weekBlocks.filter(x => x.projectId === selected.id).length} блоков`,
    ] : selection.kind === 'delivery' ? [`${data.weekBlocks.filter(x => x.deliveryId === selected.id).length} блоков`] : selection.kind === 'lane' ? [`${data.weekBlocks.filter(x => x.laneId === selected.id).length} блоков`] : [];
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
        d.planEvents = d.planEvents.map(x => x.projectId === id ? { ...x, projectId: undefined } : x);
        d.estimates = d.estimates.filter(x => x.targetType === 'delivery' ? !removedDeliveryIds.has(x.targetId) : !removedBlockIds.has(x.targetId));
        d.crossLinks = d.crossLinks.filter(x => x.sourceType === 'delivery' ? !removedDeliveryIds.has(x.sourceId) : !removedBlockIds.has(x.sourceId));
      }
      if (selection.kind === 'delivery') {
        d.weekBlocks = d.weekBlocks.map(x => x.deliveryId === id ? { ...x, deliveryId: undefined } : x);
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
        d.deliveries = d.deliveries.map(x => x.ownerActorId === id ? { ...x, ownerActorId: replacementPersonId, updatedAt: stamp() } : x);
        d.planEvents = d.planEvents.map(x => x.actorId === id ? { ...x, actorId: replacementPersonId, updatedAt: stamp() } : x);
        d.participations = replacementPersonId ? d.participations.map(x => x.actorId === id ? { ...x, actorId: replacementPersonId, updatedAt: stamp() } : x) : d.participations.filter(x => x.actorId !== id);
        d.handovers = replacementPersonId ? d.handovers.map(x => ({ ...x, fromActorId: x.fromActorId === id ? replacementPersonId : x.fromActorId, toActorId: x.toActorId === id ? replacementPersonId : x.toActorId, updatedAt: x.fromActorId === id || x.toActorId === id ? stamp() : x.updatedAt })) : d.handovers.filter(x => x.fromActorId !== id && x.toActorId !== id);
      }
    });
    setSelection(null);
  }
  function toggle(id: string) { setCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function choose(kind: EntityKind, id: string) { setDraft(null); setSelection({ kind, id }); setMessage(''); setFieldError(''); }
  function fitsFilter(text: string) { return !filters.search || text.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase()); }
  const filteredBlocks = blocks.filter(b =>
    (!filters.project || b.projectId === filters.project) && (!filters.delivery || b.deliveryId === filters.delivery) &&
    (!filters.lane || b.laneId === filters.lane) && (!filters.person || b.personId === filters.person) &&
    (!filters.status || b.status === filters.status) && fitsFilter([b.content, b.note, nameFor(snapshot, 'project', b.projectId), nameFor(snapshot, 'delivery', b.deliveryId)].join(' '))
  );
  const visibleDeliveries = deliveries.filter(d => {
    if ((filters.project && filters.project !== d.projectId) || (filters.delivery && filters.delivery !== d.id)) return false;
    const hasMatchingBlock = filteredBlocks.some(b => b.deliveryId === d.id);
    if (filters.lane || filters.person) return hasMatchingBlock;
    const matchesDelivery = fitsFilter([d.name, d.kind, nameFor(snapshot, 'project', d.projectId)].join(' ')) && (!filters.status || filters.status === d.status);
    return matchesDelivery || hasMatchingBlock;
  });
  const visibleProjects = projects.filter(p => {
    if (filters.project && filters.project !== p.id) return false;
    const hasMatchingDelivery = visibleDeliveries.some(d => d.projectId === p.id);
    const hasStandaloneBlock = filteredBlocks.some(b => b.projectId === p.id && !b.deliveryId);
    if (filters.delivery || filters.lane || filters.person) return hasMatchingDelivery || hasStandaloneBlock;
    if (!filters.search && !filters.status) return true;
    return hasMatchingDelivery || hasStandaloneBlock || (fitsFilter([p.name, p.type].join(' ')) && (!filters.status || p.status === filters.status));
  });
  const visibleEvents = events.filter(e => !filters.delivery && !filters.lane && !filters.status &&
    (!filters.project || e.projectId === filters.project) && (!filters.person || e.actorId === filters.person) && fitsFilter(e.text));
  const undated = visibleDeliveries.filter(d => d.deadline.kind === 'unknown' && d.checkpointDate.kind === 'unknown');
  const statusOptions = Array.from(new Set([...projects.map(x => x.status), ...deliveries.map(x => x.status), ...blocks.map(x => x.status)])).filter(Boolean);

  function row(kind: EntityKind, id: string, label: string, detail: string, depth: number, bars: ReactNode, expandable = false) {
    return <div className={`plan-row ${selection?.id === id ? 'is-selected' : ''}`} key={`${kind}-${id}`}>
      <div className="plan-row-label" style={{ paddingLeft: 14 + depth * 18 }}>
        {expandable ? <button className="plan-collapse" onClick={() => toggle(id)} aria-label={collapsed.has(id) ? 'Развернуть' : 'Свернуть'}>{collapsed.has(id) ? '▸' : '▾'}</button> : <span className="plan-collapse-spacer" />}
        <button className="plan-row-name" onClick={() => choose(kind, id)} title={label}>{label}</button>
        <span className="plan-row-detail" title={detail}>{detail}</span>
      </div>
      <div className="plan-row-track" style={{ '--week-count': weeksCount } as CSSProperties} onClick={(e) => {
        if (kind !== 'project' && kind !== 'delivery') return;
        const bounds = e.currentTarget.getBoundingClientRect();
        const i = Math.min(weeksCount - 1, Math.max(0, Math.floor((e.clientX - bounds.left) / bounds.width * weeksCount)));
        add('block', { projectId: kind === 'project' ? id : data.deliveries.find(x => x.id === id)?.projectId, deliveryId: kind === 'delivery' ? id : undefined, laneId: data.lanes[0]?.id, startWeek: weeks[i], endWeek: weeks[i] });
      }}>{bars}</div>
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
      const pickedBlocks = useCurrent ? filteredBlocks.filter(b => weeks.some(w => w >= b.startWeek && w <= b.endWeek)) : blocks;
      const pickedEvents = useCurrent ? visibleEvents.filter(e => weeks.some(w => w >= e.startWeek && w <= (e.endWeek || e.startWeek))) : events;
      const untilExclusive = addWeeks(origin, weeksCount);
      const pickedDeliveries = useCurrent ? visibleDeliveries.filter(d => {
        const references = [d.startDate, d.checkpointDate, d.deadline] as DateReference[];
        const hasKnownDate = references.some(ref => ref.kind !== 'unknown');
        const hasIncludedBlock = pickedBlocks.some(b => b.deliveryId === d.id);
        const hasAnyBlock = blocks.some(b => b.deliveryId === d.id);
        return references.some(ref => intersectsPeriod(ref, origin, untilExclusive)) || hasIncludedBlock || (!hasKnownDate && !hasAnyBlock);
      }) : deliveries;
      const pickedProjects = useCurrent ? visibleProjects.filter(p => pickedDeliveries.some(d => d.projectId === p.id) || pickedBlocks.some(b => b.projectId === p.id) || (!deliveries.some(d => d.projectId === p.id) && !blocks.some(b => b.projectId === p.id))) : projects;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Конструктор процессов и планов';
      workbook.created = new Date();
      const meta = `Выгрузка: ${new Date().toLocaleString('ru-RU')}; выборка: ${useCurrent ? 'текущая' : 'весь план'}; фильтры: ${useCurrent ? JSON.stringify(filters) : 'нет'}; период: ${useCurrent ? `${origin} — ${weeks.at(-1)}` : 'весь'}`;
      const objects = workbook.addWorksheet('Объекты плана', { views: [{ state: 'frozen', ySplit: 3 }] });
      objects.addRow([meta]);
      objects.addRow([]);
      const objectHeaders = ['Проект / поток', 'Тип проекта', 'Вид поставки', 'Название поставки', 'Владелец', 'Начало', 'Контрольная дата', 'Срок с', 'Срок по', 'Словесный ориентир', 'Статус', 'Заметка'];
      objects.addRow(objectHeaders);
      objects.columns = [24, 17, 17, 26, 22, 17, 20, 17, 17, 25, 19, 34].map(width => ({ width }));
      for (const p of pickedProjects) {
        const projectDeliveries = pickedDeliveries.filter(d => d.projectId === p.id);
        if (!projectDeliveries.length) objects.addRow([p.name, p.type, '', '', '', null, null, null, null, '', p.status, p.notes || '']);
        for (const d of projectDeliveries) {
          const deadline = d.deadline as DateReference;
          objects.addRow([p.name, p.type, d.kind, d.name, d.ownerActorId ? nameFor(snapshot, 'person', d.ownerActorId) : '',
            d.startDate.kind === 'exact' ? dateForExcel(d.startDate.date) : d.startDate.kind === 'range' ? dateForExcel(d.startDate.start) : null,
            d.checkpointDate.kind === 'exact' ? dateForExcel(d.checkpointDate.date) : null,
            deadline.kind === 'exact' ? dateForExcel(deadline.date) : deadline.kind === 'range' ? dateForExcel(deadline.start) : null,
            deadline.kind === 'range' ? dateForExcel(deadline.end) : null, deadline.text || '', d.status, d.note]);
        }
      }
      const weekly = workbook.addWorksheet('Недельный план', { views: [{ state: 'frozen', ySplit: 3 }] });
      weekly.addRow([meta]); weekly.addRow([]);
      weekly.addRow(['Проект / поток', 'Поставка', 'Дорожка', 'Человек', 'Неделя начала', 'Неделя конца', 'Содержание', 'Статус', 'Заметка', 'Тип события']);
      weekly.columns = [24, 25, 23, 22, 18, 18, 38, 18, 34, 18].map(width => ({ width }));
      for (const b of pickedBlocks) weekly.addRow([nameFor(snapshot, 'project', b.projectId), b.deliveryId ? nameFor(snapshot, 'delivery', b.deliveryId) : '', nameFor(snapshot, 'lane', b.laneId), b.personId ? nameFor(snapshot, 'person', b.personId) : 'Не назначено', dateForExcel(b.startWeek), dateForExcel(b.endWeek), b.content, b.status, b.note, '']);
      for (const e of pickedEvents) weekly.addRow([e.projectId ? nameFor(snapshot, 'project', e.projectId) : '', '', '', e.actorId ? nameFor(snapshot, 'person', e.actorId) : '', dateForExcel(e.startWeek), dateForExcel(e.endWeek || e.startWeek), e.text, '', '', e.type]);
      for (const sheet of [objects, weekly]) {
        const header = sheet.getRow(3); header.font = { bold: true, color: { argb: 'FFFFFFFF' } }; header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; header.height = 27;
        sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, sheet.rowCount), column: sheet.columnCount } };
        sheet.eachRow((r, number) => { if (number > 3) { r.alignment = { vertical: 'top', wrapText: true }; r.height = 31; r.eachCell(c => { if (c.value instanceof Date) c.numFmt = 'dd.mm.yyyy'; }); } });
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `plan-${scope}-${iso(new Date())}.xlsx`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Экспортирован файл ${anchor.download}.`);
    } catch (error) { setMessage(`Не удалось создать XLSX: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setExporting(false); }
  }

  return <div className="plan-page">
    <header className="plan-toolbar">
      <div className="plan-title"><h1>План проектов</h1><span>Недельный обзор поставок и работы</span></div>
      <div className="plan-actions">
        <button className="plan-primary" onClick={() => add('project')}>+ Проект</button>
        <button onClick={() => add('delivery')}>+ Поставка</button>
        <button onClick={() => add('block')}>+ Блок</button>
        <button onClick={() => add('lane')}>+ Дорожка</button>
        <button onClick={() => add('person')}>+ Человек</button>
        <button onClick={() => add('event')}>+ Событие</button>
        <div className="plan-export"><button disabled={exporting} onClick={() => exportXlsx('current')}>{exporting ? 'Готовим файл…' : 'Экспорт в Excel: выборка'}</button><button disabled={exporting} onClick={() => exportXlsx('all')}>Весь план</button></div>
      </div>
    </header>
    <div className="plan-filters">
      <input aria-label="Поиск по плану" placeholder="Поиск по плану" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
      <select aria-label="Фильтр проекта" value={filters.project} onChange={e => setFilters({ ...filters, project: e.target.value, delivery: '' })}><option value="">Все проекты</option>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр поставки" value={filters.delivery} onChange={e => setFilters({ ...filters, delivery: e.target.value })}><option value="">Все поставки</option>{deliveries.filter(x => !filters.project || x.projectId === filters.project).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр дорожки" value={filters.lane} onChange={e => setFilters({ ...filters, lane: e.target.value })}><option value="">Все дорожки</option>{data.lanes.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр человека" value={filters.person} onChange={e => setFilters({ ...filters, person: e.target.value })}><option value="">Все люди</option>{people.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Фильтр статуса" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">Все статусы</option>{statusOptions.map(x => <option key={x} value={x}>{x}</option>)}</select>
      <button onClick={() => setFilters(DEFAULT_FILTERS)}>Сброс</button>
    </div>
    <div className="plan-period">
      <button onClick={() => setOrigin(addWeeks(origin, -4))} aria-label="Предыдущие четыре недели">←</button>
      <button onClick={() => setOrigin(addWeeks(todayWeek(), -2))}>Сегодня</button>
      <button onClick={() => setOrigin(addWeeks(origin, 4))} aria-label="Следующие четыре недели">→</button>
      <label>С недели <input type="date" value={origin} onChange={e => e.target.value && setOrigin(validWeek(e.target.value))} /></label>
      <label>Период <select value={weeksCount} onChange={e => setWeeksCount(Number(e.target.value))}><option value={8}>8 недель</option><option value={16}>16 недель</option><option value={24}>24 недели</option><option value={32}>32 недели</option></select></label>
      <button onClick={() => {
        const known = [...blocks.map(x => x.startWeek), ...deliveries.flatMap(x => x.deadline.kind === 'exact' ? [x.deadline.date] : x.deadline.kind === 'range' ? [x.deadline.start] : [])];
        if (!known.length) return;
        const min = known.sort()[0], max = known.sort().at(-1)!;
        setOrigin(addWeeks(validWeek(min), -1)); setWeeksCount([8, 16, 24, 32].find(n => weekIndex(validWeek(max), addWeeks(validWeek(min), -1)) < n) || 32);
      }}>Уместить план</button>
      <span className="plan-period-caption">{humanDate(origin)} – {humanDate(addWeeks(origin, weeksCount - 1))}</span>
    </div>
    {message && <div className="plan-message" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}
    <div className="plan-content">
      <div className="plan-main">
        <div className="plan-scroll">
          <div className="plan-grid">
            <div className="plan-grid-head"><div className="plan-head-label">Объекты плана</div><div className="plan-head-weeks" style={{ '--week-count': weeksCount } as CSSProperties}>{weeks.map(w => <div key={w} className={w === todayWeek() ? 'current-week' : ''}><strong>{w.slice(8)}.{w.slice(5, 7)}</strong><small>{w.slice(0, 4)}</small></div>)}</div></div>
            {!projects.length && <div className="plan-empty">План пока пуст. Создайте проект, затем поставку, дорожку и недельные блоки.</div>}
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
      {selection && selected && <aside className="plan-inspector"><div className="plan-inspector-head"><div><small>{isDraft ? 'Новый объект' : 'Инспектор'}</small><h2>{selected.name || selected.content || selected.text || 'Объект'}</h2></div><button aria-label="Закрыть инспектор" onClick={() => { setDraft(null); setSelection(null); setMessage(''); }}>×</button></div>
        <Inspector snapshot={snapshot} kind={selection.kind} item={selected} isDraft={isDraft} fieldError={fieldError} update={values => update(selection.kind, selection.id, values)} add={add} choose={choose} onNavigateToProcess={onNavigateToProcess} onWeekNormalized={value => setMessage(`Дата ${humanDate(value)} приведена к понедельнику ${humanDate(validWeek(value))}.`)} />
        <div className="plan-inspector-foot">{isDraft ? <><button className="plan-primary" onClick={saveDraft}>Сохранить</button><button onClick={() => { setDraft(null); setSelection(null); setMessage(''); }}>Отмена</button></> : <><span className="plan-save-indicator">Сохраняется автоматически</span><button className="danger" onClick={removeSelected}>Удалить</button></>}</div>
      </aside>}
    </div>
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
    return <section className="plan-inspector-section"><h3>Оценки объёма</h3>{estimates.map(e => <div className="plan-related" key={e.id}><span>{e.value} {e.unit} · {e.kind === 'actual' ? 'факт' : e.kind === 'forecast' ? 'прогноз' : 'оценка'}</span><button onClick={() => choose('estimate', e.id)}>Изменить оценку</button></div>)}<button onClick={() => add('estimate', { targetType, targetId: item.id })}>+ Добавить оценку</button></section>;
  };
  return <div className="plan-inspector-body">
    {kind === 'project' && <>{input('Название', 'name')}{input('Тип', 'type')}{status()}{area('Заметки', 'notes')}{!isDraft && <section className="plan-inspector-section"><h3>Поставки</h3>{d.deliveries.filter(x => x.projectId === item.id).map(x => <div className="plan-related" key={x.id}>{x.name}</div>)}<button onClick={() => add('delivery', { projectId: item.id })}>+ Поставка</button></section>}</>}
    {kind === 'delivery' && <>{select('Проект', 'projectId', d.projects)}{input('Вид поставки', 'kind')}{input('Название / версия', 'name')}{select('Владелец', 'ownerActorId', d.actors.filter(x => x.type === 'person'))}{dateRef('Начало', 'startDate')}{dateRef('Контрольная дата', 'checkpointDate')}{dateRef('Плановый срок', 'deadline')}{status()}{area('Заметка', 'note')}{!isDraft && <>{estimateSection('delivery')}{linkSection('delivery')}<button onClick={() => add('block', { projectId: item.projectId, deliveryId: item.id })}>+ Недельный блок</button></>}</>}
    {kind === 'lane' && <>{input('Название', 'name')}{input('Порядок', 'order', 'number')}</>}
    {kind === 'block' && <>{select('Проект', 'projectId', d.projects)}{select('Поставка', 'deliveryId', d.deliveries.filter(x => x.projectId === item.projectId))}{select('Дорожка', 'laneId', d.lanes)}{select('Человек', 'personId', d.actors.filter(x => x.type === 'person'), 'Не назначено')}{input('Содержание', 'content')}<div className="plan-date-pair"><label className="plan-field">Первая неделя<input type="date" value={item.startWeek} onChange={e => weekChange('startWeek', e.target.value)} /></label><label className="plan-field">Последняя неделя<input type="date" value={item.endWeek} onChange={e => weekChange('endWeek', e.target.value)} /></label></div><small>Хранятся понедельники. Последняя неделя включена.</small>{weekDateIssue(kind, item) && <small className="plan-field-error">{weekDateIssue(kind, item)}</small>}{status()}{area('Заметка', 'note')}{!isDraft && <>{estimateSection('weekBlock')}{linkSection('weekBlock')}</>}</>}
    {kind === 'event' && <>{input('Тип события', 'type')}<div className="plan-date-pair"><label className="plan-field">Первая неделя<input type="date" value={item.startWeek} onChange={e => weekChange('startWeek', e.target.value)} /></label><label className="plan-field">Последняя неделя<input type="date" value={item.endWeek || ''} onChange={e => weekChange('endWeek', e.target.value)} /></label></div>{weekDateIssue(kind, item) && <small className="plan-field-error">{weekDateIssue(kind, item)}</small>}{select('Проект', 'projectId', d.projects)}{select('Участник', 'actorId', d.actors.filter(x => x.type === 'person'))}{area('Текст', 'text')}</>}
    {kind === 'person' && <>{input('Имя', 'name')}{select('Отдел', 'departmentId', d.actors.filter(x => x.type === 'department'))}<label className="plan-field">Цвет метки<input type="color" value={item.color || '#2563eb'} onChange={e => update({ color: e.target.value })} /></label><p className="plan-help">Человек находится в общем справочнике и доступен на карте процессов.</p></>}
    {kind === 'estimate' && <><label className="plan-field">Объект<select value={`${item.targetType}:${item.targetId}`} onChange={e => { const [targetType, targetId] = e.target.value.split(':'); update({ targetType, targetId }); }}>{d.deliveries.map(x => <option key={x.id} value={`delivery:${x.id}`}>Поставка: {x.name}</option>)}{d.weekBlocks.map(x => <option key={x.id} value={`weekBlock:${x.id}`}>Блок: {x.content}</option>)}</select></label>{input('Значение', 'value', 'number')}{input('Единица', 'unit')}<label className="plan-field">Вид<select value={item.kind} onChange={e => update({ kind: e.target.value })}><option value="estimate">Оценка</option><option value="forecast">Прогноз</option><option value="actual">Факт</option></select></label></>}
    {kind === 'link' && <><label className="plan-field">Объект плана<select value={`${item.sourceType}:${item.sourceId}`} onChange={e => { const [sourceType, sourceId] = e.target.value.split(':'); update({ sourceType, sourceId }); }}>{d.deliveries.map(x => <option key={x.id} value={`delivery:${x.id}`}>Поставка: {x.name}</option>)}{d.weekBlocks.map(x => <option key={x.id} value={`weekBlock:${x.id}`}>Блок: {x.content}</option>)}</select></label><label className="plan-field">Этап или точка процесса<select value={`${item.targetType}:${item.targetId}`} onChange={e => { const [targetType, targetId] = e.target.value.split(':'); update({ targetType, targetId }); }}>{d.stages.map(x => <option key={x.id} value={`stage:${x.id}`}>Этап: {x.name}</option>)}{d.checkpoints.map(x => <option key={x.id} value={`checkpoint:${x.id}`}>Точка: {x.name}</option>)}</select></label>{area('Пояснение', 'note')}<button onClick={() => onNavigateToProcess(item.targetId)}>Открыть на карте ↗</button></>}
    <small className="plan-id">ID: {item.id}</small>
  </div>;
}
