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
  const completionBase = volume.hasVolume && volume.total > 0 ? volume.total : volume.scheduled;
  const completionOver = Math.max(0, volume.completed - completionBase);

  return <section className="delivery-volume" aria-label="Объём и выполнение поставки">
    <div className="delivery-volume-heading"><h3>Объём и выполнение</h3><p>Укажите текущий объём задач релиза. Распределение и выполнение считаются по недельным задачам этой поставки.</p></div>
    <div className="delivery-volume-inputs">
      <label>В тестировании<input type="number" min="0" step="1" value={delivery.testingTaskCount ?? ''} onChange={event => onChange({ testingTaskCount: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="0" /></label>
      <label>В разработке<input type="number" min="0" step="1" value={delivery.developmentTaskCount ?? ''} onChange={event => onChange({ developmentTaskCount: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="0" /></label>
    </div>
    <label className="delivery-volume-manual">Выполнено вручную — итог<input type="number" min="0" step="1" value={delivery.manualCompletedTaskCount ?? ''} onChange={event => onChange({ manualCompletedTaskCount: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={`Автоматически: ${format(volume.completedFromWeeks)}`} /><small>Если заполнено, это число заменяет автоматический итог по недельным задачам. Очистите поле, чтобы снова считать автоматически.</small></label>
    {fieldError && (fieldError.includes('testingTaskCount') || fieldError.includes('developmentTaskCount') || fieldError.includes('manualCompletedTaskCount') || fieldError.includes('суммарный объём')) && <small className="delivery-volume-error" role="alert">{fieldError.split(': ').slice(1).join(': ') || fieldError}</small>}
    <div className="delivery-volume-totals">
      <div><strong>{volume.hasVolume ? format(volume.total) : '—'}</strong><span>Всего в поставке</span></div>
      <div><strong>{format(volume.scheduled)}</strong><span>Распределено по неделям</span></div>
      <div><strong>{format(volume.completed)}</strong><span>Выполнено{volume.completedManual !== undefined ? ' · вручную' : ''}</span></div>
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
      <div className="delivery-volume-progress-head"><span>Выполнено по поставке</span><strong>{completionBase > 0 ? `${format(volume.completed)} / ${format(completionBase)}` : format(volume.completed)}</strong></div>
      <div className="delivery-volume-track"><span className="is-completed" style={{ width: `${percent(volume.completed, completionBase)}%` }} /></div>
      <small>{volume.completedManual !== undefined ? `Ручной итог: ${format(volume.completedManual)}. По недельным задачам: ${format(volume.completedFromWeeks)}.` : `По недельным задачам: ${format(volume.completedFromWeeks)}.`}{completionOver > 0 ? ` Сверх ${volume.hasVolume && volume.total > 0 ? 'объёма поставки' : 'распределённого'}: +${format(completionOver)}.` : ''}</small>
    </div>
    {volume.unquantified > 0 && <p className="delivery-volume-unquantified">Без количества: {format(volume.unquantified)} записей, из них выполнено {format(volume.unquantifiedCompleted)}. Они не входят в числовые суммы.</p>}
    <p className="delivery-volume-hint">Статусы объёма меняются вручную. Каждая количественная запись в календаре добавляет своё число к распределённому объёму.</p>
  </section>;
}
