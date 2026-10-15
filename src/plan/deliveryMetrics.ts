import type { Delivery, WeeklyAssignment } from '../model';

export function deliveryMetrics(delivery: Delivery, assignments: WeeklyAssignment[]) {
  const linked = assignments.filter(task => task.deliveryId === delivery.id);
  const testing = delivery.testingTaskCount ?? 0;
  const development = delivery.developmentTaskCount ?? 0;
  return {
    hasVolume: delivery.testingTaskCount !== undefined || delivery.developmentTaskCount !== undefined,
    testing,
    development,
    total: testing + development,
    scheduled: linked.reduce((sum, task) => sum + (task.count ?? 0), 0),
    completed: linked.reduce((sum, task) => sum + (task.count === null ? 0 : task.completedCount ?? 0), 0),
    unquantified: linked.filter(task => task.count === null).length,
    unquantifiedCompleted: linked.filter(task => task.count === null && task.completed).length,
  };
}
