import type { Delivery, WeeklyAssignment } from '../model';
import { deliveryMetrics } from './deliveryMetrics';
import './DeliveryVolumeCard.css';

type Props = {
  delivery: Delivery;
  assignments: WeeklyAssignment[];
  onChange: (values: Record<string, unknown>) => void;
  fieldError?: string;
};

const format = (value: number) => value.toLocaleString('ru-RU');
const percent = (value: number, total: number) => total > 0 ? Math.min(100, value / total * 100) : 0;

export default function DeliveryVolumeCard({ delivery, assignments, onChange, fieldError }: Props) {
  const volume = deliveryMetrics(delivery, assignments);
  const unscheduled = Math.max(0, volume.total - volume.scheduled);
  const schedulingOver = Math.max(0, volume.scheduled - volume.total);
  const completionOver = Math.max(0, volume.completed - volume.scheduled);

  return <section className="delivery-volume" aria-label="Объём и выполнение поставки">
    <div className="delivery-volume-heading"><h3>Объём и выполнение</h3><p>Укажите текущий объём задач релиза. Распределение и выполнение считаются по недельным задачам этой поставки.</p></div>
    <div className="delivery-volume-inputs">
      <label>В тестировании<input type="number" min="0" step="1" value={delivery.testingTaskCount ?? ''} onChange={event => onChange({ testingTaskCount: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="0" /></label>
      <label>В разработке<input type="number" min="0" step="1" value={delivery.developmentTaskCount ?? ''} onChange={event => onChange({ developmentTaskCount: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="0" /></label>
    </div>
    {fieldError && (fieldError.includes('testingTaskCount') || fieldError.includes('developmentTaskCount') || fieldError.includes('суммарный объём')) && <small className="delivery-volume-error" role="alert">{fieldError.split(': ').slice(1).join(': ') || fieldError}</small>}
    <div className="delivery-volume-totals">
      <div><strong>{volume.hasVolume ? format(volume.total) : '—'}</strong><span>Всего в поставке</span></div>
      <div><strong>{format(volume.scheduled)}</strong><span>Распределено по неделям</span></div>
      <div><strong>{format(volume.completed)}</strong><span>Проверено / закрыто</span></div>
    </div>
    {volume.hasVolume && volume.total > 0 && <div className="delivery-volume-breakdown">
      <div className="delivery-volume-bar" role="img" aria-label={`В тестировании ${format(volume.testing)}, в разработке ${format(volume.development)}`}>
        <span className="is-testing" style={{ width: `${percent(volume.testing, volume.total)}%` }} />
        <span className="is-development" style={{ width: `${percent(volume.development, volume.total)}%` }} />
      </div>
      <div className="delivery-volume-legend"><span><i className="is-testing" />В тестировании: {format(volume.testing)}</span><span><i className="is-development" />В разработке: {format(volume.development)}</span></div>
    </div>}
    <div className="delivery-volume-progress">
      <div className="delivery-volume-progress-head"><span>Распределено в календаре</span><strong>{volume.hasVolume && volume.total > 0 ? `${Math.round(volume.scheduled / volume.total * 100)}%` : format(volume.scheduled)}</strong></div>
      <div className="delivery-volume-track"><span className="is-scheduled" style={{ width: `${percent(volume.scheduled, volume.total)}%` }} /></div>
      <small>{volume.hasVolume ? schedulingOver > 0 ? `Сверх текущего объёма: ${format(schedulingOver)}` : `Ещё не распределено: ${format(unscheduled)}` : 'Для процента заполните объём в тестировании и разработке.'}</small>
    </div>
    <div className="delivery-volume-progress">
      <div className="delivery-volume-progress-head"><span>Проверено из распределённого</span><strong>{volume.scheduled > 0 ? `${format(volume.completed)} / ${format(volume.scheduled)}` : format(volume.completed)}</strong></div>
      <div className="delivery-volume-track"><span className="is-completed" style={{ width: `${percent(volume.completed, volume.scheduled)}%` }} /></div>
      <small>{completionOver > 0 ? `Перевыполнение по недельным задачам: +${format(completionOver)}` : volume.hasVolume && volume.total > 0 ? `${Math.round(volume.completed / volume.total * 100)}% от текущего объёма поставки` : 'Выполнение отмечается в карточках недельных задач.'}</small>
    </div>
    {volume.unquantified > 0 && <p className="delivery-volume-unquantified">Без количества: {format(volume.unquantified)} записей, из них выполнено {format(volume.unquantifiedCompleted)}. Они не входят в числовые суммы.</p>}
    <p className="delivery-volume-hint">Статусы объёма меняются вручную. Каждая количественная запись в календаре добавляет своё число к распределённому объёму.</p>
  </section>;
}
