import type { Snapshot, WeeklyAssignment } from '../model';

export type CatalogKind = 'person' | 'project' | 'delivery' | 'lane' | 'block' | 'event' | 'assignment';
type EditableKind = Exclude<CatalogKind, 'assignment'>;

type Props = {
  snapshot: Snapshot;
  active: CatalogKind;
  onSelect: (kind: CatalogKind) => void;
  onOpen: (kind: EditableKind, id: string) => void;
  onOpenAssignment: (item: WeeklyAssignment) => void;
  onAdd: (kind: EditableKind) => void;
  onClose: () => void;
};

const tabs: { kind: CatalogKind; label: string }[] = [
  { kind: 'person', label: 'Люди' }, { kind: 'project', label: 'Проекты' },
  { kind: 'delivery', label: 'Поставки' }, { kind: 'assignment', label: 'Недельные задачи' },
  { kind: 'lane', label: 'Дорожки' }, { kind: 'block', label: 'Блоки' }, { kind: 'event', label: 'События' },
];

export default function PlanEntitiesDialog({ snapshot, active, onSelect, onOpen, onOpenAssignment, onAdd, onClose }: Props) {
  const d = snapshot.data;
  const people = d.actors.filter(item => item.type === 'person');
  const list = active === 'person' ? people : active === 'project' ? d.projects : active === 'delivery' ? d.deliveries : active === 'lane' ? d.lanes : active === 'block' ? d.weekBlocks : active === 'event' ? d.planEvents : d.weeklyAssignments;
  const count = (kind: CatalogKind) => kind === 'person' ? people.length : kind === 'project' ? d.projects.length : kind === 'delivery' ? d.deliveries.length : kind === 'lane' ? d.lanes.length : kind === 'block' ? d.weekBlocks.length : kind === 'event' ? d.planEvents.length : d.weeklyAssignments.length;
  const person = (id?: string | null) => people.find(item => item.id === id)?.name || 'Не назначено';
  const project = (id?: string | null) => d.projects.find(item => item.id === id)?.name || 'Без проекта';

  function label(item: (typeof list)[number]) {
    if ('title' in item) return item.title;
    if ('content' in item) return item.content;
    if ('text' in item) return item.text;
    return item.name;
  }
  function detail(item: (typeof list)[number]) {
    if ('weekStart' in item) return `${item.weekStart} · ${person(item.personId)} · ${project(item.projectId)} · ${item.count} задач`;
    if ('startWeek' in item) return `${item.startWeek}${item.endWeek ? ` – ${item.endWeek}` : ''}${'projectId' in item && item.projectId ? ` · ${project(item.projectId)}` : ''}`;
    if ('projectId' in item) return `${project(item.projectId)}${'kind' in item ? ` · ${item.kind}` : ''}`;
    if ('type' in item) return item.type === 'person' ? 'Сотрудник' : item.type;
    return '';
  }

  return <div className="plan-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="plan-catalog plan-modal" role="dialog" aria-modal="true" aria-label="Объекты плана">
      <div className="plan-catalog-head"><div><small>План проектов</small><h2>Объекты плана</h2></div><button aria-label="Закрыть обзор объектов" onClick={onClose}>×</button></div>
      <div className="plan-catalog-tabs" role="tablist" aria-label="Типы объектов">{tabs.map(tab => <button key={tab.kind} role="tab" aria-selected={active === tab.kind} className={active === tab.kind ? 'active' : ''} onClick={() => onSelect(tab.kind)}>{tab.label} <span>{count(tab.kind)}</span></button>)}</div>
      <div className="plan-catalog-content">
        <div className="plan-catalog-list-head"><strong>{tabs.find(tab => tab.kind === active)?.label}</strong>{active !== 'assignment' && <button className="plan-primary" onClick={() => onAdd(active)}>+ Добавить</button>}</div>
        {!list.length && <p className="plan-catalog-empty">Пока нет объектов этого типа.</p>}
        <div className="plan-catalog-list">{list.map(item => <div className="plan-catalog-item" key={item.id}>
          {active === 'person' && <span className="plan-catalog-color" style={{ background: 'color' in item ? item.color || '#2563eb' : '#2563eb' }} />}
          <div><strong>{label(item)}</strong><small>{detail(item)}</small>{active === 'person' && <small>{d.weeklyAssignments.filter(a => a.personId === item.id).length} недельных назначений</small>}</div>
          <button onClick={() => active === 'assignment' ? onOpenAssignment(item as WeeklyAssignment) : onOpen(active as EditableKind, item.id)}>Редактировать</button>
        </div>)}</div>
      </div>
    </section>
  </div>;
}
