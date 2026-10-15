import { useEffect, useRef } from 'react';
import type { Snapshot, WeekBlock, WeeklyAssignment } from '../model';
import './WeeklyLoadDialog.css';

type Props = {
  snapshot: Snapshot;
  weekStart: string;
  weekNumber: number;
  records: WeeklyAssignment[];
  blocks: WeekBlock[];
  onOpenAssignment: (record: WeeklyAssignment) => void;
  onOpenBlock: (record: WeekBlock) => void;
  onClose: () => void;
};

type Entry =
  | { kind: 'assignment'; record: WeeklyAssignment; title: string; count: number | null; note: string; projectId: string; deliveryId?: string | null }
  | { kind: 'block'; record: WeekBlock; title: string; count: null; note: string; projectId: string; deliveryId?: string | null };

const countTasks = (items: WeeklyAssignment[]) => items.reduce((sum, item) => sum + (item.count ?? 0), 0);
const countUnquantified = (items: WeeklyAssignment[]) => items.filter(item => item.count === null).length;
const formatDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
};
const endOfWeek = (weekStart: string) => {
  const day = new Date(`${weekStart}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 6);
  return day.toISOString().slice(0, 10);
};

export default function WeeklyLoadDialog({ snapshot, weekStart, weekNumber, records, blocks, onOpenAssignment, onOpenBlock, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const people = snapshot.data.actors.filter(item => item.type === 'person');
  const assignedPeople = people.filter(person => records.some(item => item.personId === person.id) || blocks.some(item => item.personId === person.id));
  const groups = [
    ...assignedPeople.map(person => ({ id: person.id, name: person.name, color: person.color || '#8995a7' })),
    ...(records.some(item => !item.personId) || blocks.some(item => !item.personId) ? [{ id: '', name: 'Не назначено', color: '#8995a7' }] : []),
  ];
  const projectName = (id: string) => snapshot.data.projects.find(item => item.id === id)?.name || 'Удалённый проект';
  const deliveryName = (id?: string | null) => snapshot.data.deliveries.find(item => item.id === id)?.name || '';

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="plan-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="plan-modal weekly-load-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-load-title">
      <header className="weekly-load-head">
        <div><small>Нагрузка по текущим фильтрам</small><h2 id="weekly-load-title">Неделя №{weekNumber}: {formatDate(weekStart)} – {formatDate(endOfWeek(weekStart))}</h2><p>Недельные задачи и рабочие блоки показаны вместе. Блоки не увеличивают числовой итог задач.</p></div>
        <button ref={closeButton} onClick={onClose} aria-label="Закрыть нагрузку недели">×</button>
      </header>
      <div className="weekly-load-overview">
        <span><strong>{groups.length}</strong> сотрудников и групп</span>
        <span><strong>{records.length}</strong> недельных записей</span>
        <span><strong>{blocks.length}</strong> рабочих блоков</span>
        <span><strong>{countTasks(records)}</strong> задач с количеством</span>
        <span><strong>{countUnquantified(records) + blocks.length}</strong> без количества</span>
      </div>
      <div className="weekly-load-content">
        {!records.length && !blocks.length && <p className="weekly-load-empty">На этой неделе нет задач и рабочих блоков по текущим фильтрам. Выберите ячейку проекта или поставки, чтобы добавить задачу.</p>}
        {groups.map(group => {
          const assignments = records.filter(item => (item.personId || '') === group.id).sort((left, right) => projectName(left.projectId).localeCompare(projectName(right.projectId), 'ru') || left.title.localeCompare(right.title, 'ru'));
          const groupBlocks = blocks.filter(item => (item.personId || '') === group.id);
          const entries: Entry[] = [
            ...assignments.map(record => ({ kind: 'assignment' as const, record, title: record.title, count: record.count, note: record.note, projectId: record.projectId, deliveryId: record.deliveryId })),
            ...groupBlocks.map(record => ({ kind: 'block' as const, record, title: record.content, count: null, note: record.note, projectId: record.projectId, deliveryId: record.deliveryId })),
          ].sort((left, right) => projectName(left.projectId).localeCompare(projectName(right.projectId), 'ru') || left.title.localeCompare(right.title, 'ru'));
          return <section className="weekly-load-person" key={group.id || 'unassigned'}>
            <div className="weekly-load-person-head"><h3><span className="weekly-person-dot" style={{ background: group.color }} />{group.name}</h3><div><span>{entries.length} записей и блоков</span><span>{countTasks(assignments)} задач с количеством</span>{countUnquantified(assignments) + groupBlocks.length > 0 && <span>{countUnquantified(assignments) + groupBlocks.length} без количества</span>}</div></div>
            <div className="weekly-load-table-scroll"><table><thead><tr><th>Проект / поставка</th><th>Задача</th><th>Количество / выполнение</th><th>Комментарий</th><th><span className="visually-hidden">Действие</span></th></tr></thead><tbody>
              {entries.map(entry => <tr key={`${entry.kind}-${entry.record.id}`}>
                <td><strong>{projectName(entry.projectId)}</strong>{entry.deliveryId && <small>{deliveryName(entry.deliveryId)}</small>}</td>
                <td><span className="weekly-load-kind">{entry.kind === 'block' ? 'Рабочий блок' : 'Недельная задача'}</span>{entry.title}{entry.kind === 'block' && <small>{formatDate(entry.record.startWeek)} – {formatDate(endOfWeek(entry.record.endWeek))}</small>}</td>
                <td>{entry.kind === 'assignment' ? entry.count === null ? <span className="weekly-load-no-count">{entry.record.completed ? '✓ Выполнено' : 'Без количества'}</span> : `${entry.record.completedCount ?? 0} / ${entry.count}` : <span className="weekly-load-no-count">Без количества</span>}</td>
                <td className="weekly-load-note">{entry.note || <span className="weekly-load-muted">—</span>}</td>
                <td><button onClick={() => entry.kind === 'assignment' ? onOpenAssignment(entry.record) : onOpenBlock(entry.record)}>Открыть</button></td>
              </tr>)}
            </tbody></table></div>
          </section>;
        })}
      </div>
      <footer className="weekly-load-foot"><span>Итого: {countTasks(records)} задач с количеством · {countUnquantified(records)} недельных записей и {blocks.length} рабочих блоков без количества</span><button onClick={onClose}>Закрыть</button></footer>
    </section>
  </div>;
}
