import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { Snapshot, WeeklyAssignment } from '../model';
import './WeeklyQuickAdd.css';

export type QuickCell = { projectId: string; deliveryId: string | null; weekStart: string; rect: { left: number; right: number; top: number; bottom: number }; pick?: boolean };
type Values = Pick<WeeklyAssignment, 'title' | 'projectId' | 'deliveryId' | 'personId' | 'weekStart' | 'count' | 'note' | 'completedCount' | 'completed'>;
type Props = {
  snapshot: Snapshot;
  cell: QuickCell;
  records: WeeklyAssignment[];
  weekLabel: string;
  onChangeTarget: (projectId: string, deliveryId: string | null) => void;
  onSave: (values: Values) => boolean;
  onToggle: (record: WeeklyAssignment) => void;
  onOpenDetails: () => void;
  onClose: () => void;
};

/** Быстрое добавление и отметка недельных задач прямо у ячейки; подробное окно открывается по кнопке. */
export default function WeeklyQuickAdd({ snapshot, cell, records, weekLabel, onChangeTarget, onSave, onToggle, onOpenDetails, onClose }: Props) {
  const people = snapshot.data.actors.filter(actor => actor.type === 'person');
  const [title, setTitle] = useState('');
  const [personId, setPersonId] = useState('');
  const [count, setCount] = useState('1');
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: cell.rect.left, top: cell.rect.bottom + 6, visibility: 'hidden' });

  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.max(8, Math.min(cell.rect.left, window.innerWidth - box.width - 8));
    let top = cell.rect.bottom + 6;
    if (top + box.height > window.innerHeight - 8) top = Math.max(8, cell.rect.top - box.height - 6);
    setPosition({ left, top });
  }, [cell.rect, records.length, cell.pick]);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest('[data-quick-owner]')) onClose(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const onScroll = (event: Event) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); window.removeEventListener('scroll', onScroll, true); };
  }, [onClose]);

  const project = snapshot.data.projects.find(item => item.id === cell.projectId);
  const delivery = snapshot.data.deliveries.find(item => item.id === cell.deliveryId);
  const targets = [...snapshot.data.projects].sort((a, b) => a.order - b.order).flatMap(item => {
    const own = snapshot.data.deliveries.filter(d => d.projectId === item.id);
    return own.length ? own.map(d => ({ value: `${item.id}|${d.id}`, label: `${item.name} / ${d.name}` })) : [{ value: `${item.id}|`, label: item.name }];
  });
  const personName = (id: string | null) => people.find(item => item.id === id)?.name || 'Не назначено';
  const isDone = (item: WeeklyAssignment) => item.count === null ? !!item.completed : (item.completedCount ?? 0) >= item.count;

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    const amount = count === '' ? null : Number(count);
    if (!clean || (amount !== null && (!Number.isSafeInteger(amount) || amount < 1))) return;
    if (onSave({ title: clean, projectId: cell.projectId, deliveryId: cell.deliveryId, personId: personId || null, weekStart: cell.weekStart, count: amount, completedCount: amount === null ? undefined : 0, completed: false, note: '' })) setTitle('');
  }

  return <div className="quick-add" ref={root} style={position} role="dialog" aria-label="Недельные задачи">
    <div className="quick-add-head"><small>Недельные задачи</small><strong>{weekLabel}</strong></div>
    {cell.pick ? <label className="quick-add-target">Поставка<select value={`${cell.projectId}|${cell.deliveryId || ''}`} onChange={event => { const [projectId, deliveryId] = event.target.value.split('|'); onChangeTarget(projectId, deliveryId || null); }}>{targets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      : <div className="quick-add-where">{project?.name}{delivery ? ` / ${delivery.name}` : ''}</div>}
    <div className="quick-add-list">
      {records.length === 0 && <p className="quick-add-empty">Пока пусто — добавьте первую задачу.</p>}
      {records.map(item => <div className={`quick-add-item ${isDone(item) ? 'is-done' : ''}`} key={item.id}>
        <button type="button" className="quick-add-check" aria-label={`${isDone(item) ? 'Сбросить' : 'Отметить выполненной'}: ${item.title}`} onClick={() => onToggle(item)}>{isDone(item) ? '✓' : ''}</button>
        <span className="quick-add-dot" style={{ background: people.find(person => person.id === item.personId)?.color || 'var(--ink-faint)' }} />
        <span className="quick-add-title" title={`${item.title} · ${personName(item.personId)}`}>{item.title}</span>
        <b>{item.count === null ? '' : `${item.completedCount ?? 0}/${item.count}`}</b>
      </div>)}
    </div>
    <form className="quick-add-form" onSubmit={submit}>
      <input autoFocus aria-label="Название задачи" placeholder="Название и Enter" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} />
      <select aria-label="Ответственный" value={personId} onChange={event => setPersonId(event.target.value)}><option value="">Не назначено</option>{people.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <input aria-label="Количество задач" type="number" min="1" step="1" value={count} onChange={event => setCount(event.target.value)} />
    </form>
    <div className="quick-add-foot"><button type="button" onClick={onOpenDetails}>Подробнее…</button><button type="button" onClick={onClose}>Готово</button></div>
  </div>;
}
