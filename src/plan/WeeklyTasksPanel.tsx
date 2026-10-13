import { useEffect, useState } from 'react';
import type { Snapshot, WeeklyAssignment } from '../model';

type Context = { projectId: string; deliveryId: string | null; weekStart: string };
type Values = Pick<WeeklyAssignment, 'title' | 'projectId' | 'deliveryId' | 'personId' | 'weekStart' | 'count' | 'note'>;
type Props = {
  snapshot: Snapshot;
  title: string;
  records: WeeklyAssignment[];
  context: Context | null;
  onSave: (values: Values, id?: string) => boolean;
  onSaveBulk: (values: Values[]) => boolean;
  onDelete: (id: string) => void;
  onClose: () => void;
};

const monday = (value: string) => {
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
};
const nextWeek = (value: string) => {
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 7);
  return day.toISOString().slice(0, 10);
};
function bounds(ref: { kind: string; date?: string; start?: string; end?: string }): [string, string] | null {
  if (ref.kind === 'exact' && ref.date) return [ref.date, ref.date];
  if (ref.kind === 'range' && ref.start && ref.end) return [ref.start, ref.end];
  return null;
}

export default function WeeklyTasksPanel({ snapshot, title, records, context, onSave, onSaveBulk, onDelete, onClose }: Props) {
  const people = snapshot.data.actors.filter(actor => actor.type === 'person');
  const [draft, setDraft] = useState<Values | null>(null);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [bulk, setBulk] = useState('');
  const [bulkPerson, setBulkPerson] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!draft && !bulk.trim()) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, bulk]);
  const project = (id: string) => snapshot.data.projects.find(item => item.id === id)?.name || 'Удалённый проект';
  const delivery = (id?: string | null) => snapshot.data.deliveries.find(item => item.id === id)?.name || '';
  const person = (id: string | null) => people.find(item => item.id === id)?.name || 'Не назначено';
  const deliveryDates = draft?.deliveryId ? snapshot.data.deliveries.find(item => item.id === draft.deliveryId) : null;
  const start = deliveryDates && bounds(deliveryDates.startDate);
  const finish = deliveryDates && bounds(deliveryDates.deadline);
  const weekEnd = draft ? nextWeek(draft.weekStart) : '';
  const outside = !!draft && !!deliveryDates && ((start && weekEnd <= start[0]) || (finish && draft.weekStart > finish[1]));

  function begin(record?: WeeklyAssignment) {
    if (!record && !context) return;
    setEditingId(record?.id);
    setDraft(record ? {
      title: record.title, projectId: record.projectId, deliveryId: record.deliveryId || null,
      personId: record.personId, weekStart: record.weekStart, count: record.count, note: record.note,
    } : { title: '', projectId: context!.projectId, deliveryId: context!.deliveryId, personId: null, weekStart: context!.weekStart, count: 1, note: '' });
    setError('');
  }
  function save() {
    if (!draft?.title.trim()) { setError('Введите название задачи.'); return; }
    if (draft.count !== null && (!Number.isSafeInteger(draft.count) || draft.count < 1 || draft.count > 100000)) { setError('Количество должно быть целым числом от 1 до 100000 или пустым.'); return; }
    if (onSave({ ...draft, title: draft.title.trim(), weekStart: monday(draft.weekStart) }, editingId)) {
      setDraft(null); setEditingId(undefined); setError('');
    }
  }
  function addBulk() {
    if (!context) return;
    const titles = bulk.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!titles.length) { setError('Вставьте названия задач, каждое с новой строки.'); return; }
    if (titles.some(name => name.length > 200)) { setError('Название задачи не может быть длиннее 200 символов.'); return; }
    if (!onSaveBulk(titles.map(task => ({ title: task, projectId: context.projectId, deliveryId: context.deliveryId, personId: bulkPerson || null, weekStart: context.weekStart, count: 1, note: '' })))) return;
    setBulk(''); setError('');
  }

  return <aside className="weekly-panel" aria-label={title}>
    <div className="weekly-panel-head"><div><small>Недельные задачи</small><h2>{title}</h2></div><button onClick={onClose} aria-label="Закрыть задачи">×</button></div>
    <div className="weekly-panel-body">
      {records.length === 0 && <p className="weekly-muted">На этой неделе задач пока нет.</p>}
      {records.map(record => <div className="weekly-record" key={record.id}>
        <div className="weekly-record-title"><span className="weekly-person-dot" style={{ background: people.find(item => item.id === record.personId)?.color || '#8995a7' }} />{record.title}{record.count !== null && record.count > 1 && <b>×{record.count}</b>}{record.count === null && <b>Без количества</b>}</div>
        <div className="weekly-record-meta">{person(record.personId)} · {project(record.projectId)}{record.deliveryId && ` / ${delivery(record.deliveryId)}`} · {record.weekStart}</div>
        {record.note && <p>{record.note}</p>}
        <div className="weekly-record-actions"><button onClick={() => begin(record)}>Изменить</button><button onClick={() => { onSave({ title: record.title, projectId: record.projectId, deliveryId: record.deliveryId || null, personId: record.personId, weekStart: nextWeek(record.weekStart), count: record.count, note: record.note }); }}>Копировать на следующую неделю</button><button className="danger" onClick={() => onDelete(record.id)}>Удалить</button></div>
      </div>)}
      {context && <button className="weekly-add" onClick={() => begin()}>+ Добавить задачу</button>}
      {draft && <div className="weekly-form">
        <h3>{editingId ? 'Изменить задачу' : 'Новая задача'}</h3>
        <label>Название<input autoFocus maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Проект<select value={draft.projectId} onChange={e => setDraft({ ...draft, projectId: e.target.value, deliveryId: null })}>{snapshot.data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Поставка<select value={draft.deliveryId || ''} onChange={e => setDraft({ ...draft, deliveryId: e.target.value || null })}><option value="">Без поставки</option>{snapshot.data.deliveries.filter(item => item.projectId === draft.projectId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Неделя с понедельника<input type="date" value={draft.weekStart} onChange={e => e.target.value && setDraft({ ...draft, weekStart: monday(e.target.value) })} /></label>
        <label>Ответственный<select value={draft.personId || ''} onChange={e => setDraft({ ...draft, personId: e.target.value || null })}><option value="">Не назначено</option>{people.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Количество задач (необязательно)<input type="number" min="1" max="100000" step="1" value={draft.count ?? ''} onChange={e => setDraft({ ...draft, count: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <small className="weekly-muted">Если количество пока неизвестно, оставьте поле пустым. Название и заметка останутся в расписании.</small>
        <label>Заметка<textarea rows={2} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
        {outside && <p className="weekly-warning">Неделя вне указанного срока поставки. Сохранение разрешено.</p>}
        {error && <p className="weekly-error">{error}</p>}
        <div className="weekly-form-actions"><button className="plan-primary" onClick={save}>Сохранить</button><button onClick={() => setDraft(null)}>Отмена</button></div>
      </div>}
      {context && <div className="weekly-bulk"><h3>Быстрый ввод</h3><label>Ответственный<select value={bulkPerson} onChange={e => setBulkPerson(e.target.value)}><option value="">Не назначено</option>{people.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Одна строка — одна задача<textarea rows={4} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={'Тесты авторизации\nПроверка отчётов'} /></label><button onClick={addBulk}>Добавить список</button></div>}
    </div>
  </aside>;
}
