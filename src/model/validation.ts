import type { DateReference, Snapshot, WorkspaceData } from './index'

type Dict = Record<string, unknown>

function fail(path: string, problem: string): never {
  throw new Error(`${path}: ${problem}`)
}
function object(value: unknown, path: string): Dict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'ожидался объект')
  return value as Dict
}
function string(value: unknown, path: string, required = true): void {
  if (typeof value !== 'string' || (required && !value.trim())) fail(path, 'ожидалась непустая строка')
}
function optionalString(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== 'string') fail(path, 'ожидалась строка')
}
function number(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'ожидалось конечное число')
}
function oneOf(value: unknown, path: string, values: readonly string[]): void {
  if (typeof value !== 'string' || !values.includes(value)) fail(path, `допустимо: ${values.join(', ')}`)
}
function date(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(path, 'нужна дата ГГГГ-ММ-ДД')
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(path, 'несуществующая календарная дата')
}
function utc(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(path, 'нужна дата и время ISO 8601 UTC')
  date(value.slice(0, 10), path)
  const [, hours, minutes, seconds] = value.match(/T(\d{2}):(\d{2}):(\d{2})/) ?? []
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) fail(path, 'несуществующее время UTC')
}
export function validateDateReference(value: unknown, path: string): asserts value is DateReference {
  const ref = object(value, path)
  oneOf(ref.kind, `${path}.kind`, ['unknown', 'exact', 'range'])
  optionalString(ref.text, `${path}.text`)
  if (ref.kind === 'exact') date(ref.date, `${path}.date`)
  if (ref.kind === 'range') {
    date(ref.start, `${path}.start`)
    date(ref.end, `${path}.end`)
    if ((ref.start as string) > (ref.end as string)) fail(path, 'начало диапазона позже конца')
  }
}

/**
 * Reject a span only when its end is unambiguously before its start.
 * Overlapping approximate ranges remain valid because a feasible ordering exists.
 */
export function validateDateOrder(start: DateReference, end: DateReference, endPath: string): void {
  if (start.kind === 'unknown' || end.kind === 'unknown') return
  const earliestStart = start.kind === 'exact' ? start.date : start.start
  const latestEnd = end.kind === 'exact' ? end.date : end.end
  if (earliestStart > latestEnd) {
    fail(endPath, `завершение (${latestEnd}) раньше начала (${earliestStart})`)
  }
}

const dateReference: (value: unknown, path: string) => asserts value is DateReference = validateDateReference
function monday(value: unknown, path: string): void {
  date(value, path)
  if (new Date(`${value}T00:00:00.000Z`).getUTCDay() !== 1) fail(path, 'нужна дата понедельника')
}
function base(item: Dict, path: string, ids: Set<string>): void {
  string(item.id, `${path}.id`)
  if (ids.has(item.id as string)) fail(`${path}.id`, `повторяющийся id ${item.id}`)
  ids.add(item.id as string)
  utc(item.createdAt, `${path}.createdAt`)
  utc(item.updatedAt, `${path}.updatedAt`)
}
function collection(data: Dict, name: keyof WorkspaceData, ids: Set<string>, check: (item: Dict, path: string) => void): Dict[] {
  const values = data[name]
  if (!Array.isArray(values)) fail(`data.${name}`, 'ожидался массив')
  values.forEach((value, index) => {
    const path = `data.${name}[${index}]`
    const item = object(value, path)
    base(item, path, ids)
    check(item, path)
  })
  return values as Dict[]
}
function ref(id: unknown, path: string, ids: Set<string>, nullable = false): void {
  if (nullable && (id === undefined || id === null || id === '')) return
  string(id, path)
  if (!ids.has(id as string)) fail(path, `ссылка на отсутствующий объект ${id}`)
}

/** Throws a user-readable error for malformed, incompatible or dangling data. */
function validateSnapshotShape(value: unknown, legacy = false, legacyWeekly = false): void {
  const root = object(value, 'snapshot')
  const workspace = object(root.workspace, 'workspace')
  const data = object(root.data, 'data')
  const ids = new Set<string>()
  base(workspace, 'workspace', ids)
  string(workspace.name, 'workspace.name')
  string(workspace.locale, 'workspace.locale')
  if (workspace.weekStartsOn !== 1) fail('workspace.weekStartsOn', 'в MVP начало недели — понедельник (1)')
  const display = object(workspace.display, 'workspace.display')
  oneOf(display.processScale, 'workspace.display.processScale', ['week', 'month'])
  oneOf(display.planScale, 'workspace.display.planScale', ['week', 'month'])

  if (!legacy) {
    const canvas = object(data.canvas, 'data.canvas')
    base(canvas, 'data.canvas', ids)
    string(canvas.name, 'data.canvas.name')
    const viewport = object(canvas.viewport, 'data.canvas.viewport')
    coordinate(viewport.x, 'data.canvas.viewport.x')
    coordinate(viewport.y, 'data.canvas.viewport.y')
    number(viewport.zoom, 'data.canvas.viewport.zoom')
    if ((viewport.zoom as number) < 0.05 || (viewport.zoom as number) > 4) fail('data.canvas.viewport.zoom', 'масштаб должен быть от 0.05 до 4')
  }

  const groups = collection(data, 'groups', ids, (v, p) => { string(v.name, `${p}.name`); string(v.color, `${p}.color`); number(v.order, `${p}.order`) })
  const processes = collection(data, 'processes', ids, (v, p) => {
    optionalString(v.groupId, `${p}.groupId`); string(v.name, `${p}.name`)
    for (const key of ['currentState', 'targetState', 'reason', 'expectedResult']) string(v[key], `${p}.${key}`, false)
    string(v.status, `${p}.status`); optionalString(v.priority, `${p}.priority`); optionalString(v.note, `${p}.note`); number(v.order, `${p}.order`)
  })
  const stages = collection(data, 'stages', ids, (v, p) => {
    string(v.processId, `${p}.processId`); string(v.name, `${p}.name`); string(v.purpose, `${p}.purpose`, false)
    dateReference(v.plannedStart, `${p}.plannedStart`); dateReference(v.plannedEnd, `${p}.plannedEnd`)
    validateDateOrder(v.plannedStart as DateReference, v.plannedEnd as DateReference, `${p}.plannedEnd`)
    string(v.expectedOutput, `${p}.expectedOutput`, false); string(v.status, `${p}.status`); number(v.order, `${p}.order`)
  })
  const checkpoints = collection(data, 'checkpoints', ids, (v, p) => {
    string(v.processId, `${p}.processId`); optionalString(v.stageId, `${p}.stageId`); string(v.name, `${p}.name`)
    dateReference(v.plannedDate, `${p}.plannedDate`); dateReference(v.actualDate, `${p}.actualDate`)
    string(v.confirmation, `${p}.confirmation`, false); string(v.status, `${p}.status`)
  })
  const sharedMilestones = collection(data, 'sharedMilestones', ids, (v, p) => {
    string(v.name, `${p}.name`); dateReference(v.date, `${p}.date`)
    string(v.purpose, `${p}.purpose`, false); string(v.confirmation, `${p}.confirmation`, false)
    if (!Array.isArray(v.processIds)) fail(`${p}.processIds`, 'ожидался массив id процессов')
    v.processIds.forEach((id, i) => string(id, `${p}.processIds[${i}]`))
  })
  const dependencies = collection(data, 'dependencies', ids, (v, p) => {
    oneOf(v.sourceType, `${p}.sourceType`, ['process', 'stage']); string(v.sourceId, `${p}.sourceId`)
    oneOf(v.targetType, `${p}.targetType`, ['process', 'stage']); string(v.targetId, `${p}.targetId`)
    oneOf(v.type, `${p}.type`, ['prerequisite', 'influence']); string(v.note, `${p}.note`, false)
    if (v.sourceId === v.targetId) fail(p, 'зависимость не может ссылаться сама на себя')
  })
  const actors = collection(data, 'actors', ids, (v, p) => {
    oneOf(v.type, `${p}.type`, ['department', 'role', 'person']); string(v.name, `${p}.name`)
    optionalString(v.departmentId, `${p}.departmentId`); optionalString(v.color, `${p}.color`)
  })
  const participations = collection(data, 'participations', ids, (v, p) => {
    string(v.actorId, `${p}.actorId`); oneOf(v.targetType, `${p}.targetType`, ['process', 'stage', 'checkpoint'])
    string(v.targetId, `${p}.targetId`); oneOf(v.type, `${p}.type`, ['responsible', 'participates', 'approves', 'provides'])
    string(v.expectedContribution, `${p}.expectedContribution`, false)
  })
  const handovers = collection(data, 'handovers', ids, (v, p) => {
    string(v.fromActorId, `${p}.fromActorId`); string(v.toActorId, `${p}.toActorId`)
    oneOf(v.targetType, `${p}.targetType`, ['process', 'stage']); string(v.targetId, `${p}.targetId`)
    optionalString(v.checkpointId, `${p}.checkpointId`); string(v.description, `${p}.description`)
  })
  const projects = collection(data, 'projects', ids, (v, p) => {
    string(v.name, `${p}.name`); string(v.type, `${p}.type`, false); number(v.order, `${p}.order`)
    string(v.status, `${p}.status`); optionalString(v.notes, `${p}.notes`)
  })
  const deliveries = collection(data, 'deliveries', ids, (v, p) => {
    string(v.projectId, `${p}.projectId`); string(v.kind, `${p}.kind`, false); string(v.name, `${p}.name`)
    optionalString(v.ownerActorId, `${p}.ownerActorId`)
    dateReference(v.startDate, `${p}.startDate`); dateReference(v.checkpointDate, `${p}.checkpointDate`)
    dateReference(v.deadline, `${p}.deadline`); string(v.status, `${p}.status`); string(v.note, `${p}.note`, false)
    validateDateOrder(v.startDate as DateReference, v.checkpointDate as DateReference, `${p}.checkpointDate`)
    validateDateOrder(v.startDate as DateReference, v.deadline as DateReference, `${p}.deadline`)
    validateDateOrder(v.checkpointDate as DateReference, v.deadline as DateReference, `${p}.deadline`)
  })
  const lanes = collection(data, 'lanes', ids, (v, p) => { string(v.name, `${p}.name`); number(v.order, `${p}.order`) })
  const weekBlocks = collection(data, 'weekBlocks', ids, (v, p) => {
    string(v.projectId, `${p}.projectId`); optionalString(v.deliveryId, `${p}.deliveryId`)
    string(v.laneId, `${p}.laneId`); optionalString(v.personId, `${p}.personId`)
    monday(v.startWeek, `${p}.startWeek`); monday(v.endWeek, `${p}.endWeek`)
    if ((v.startWeek as string) > (v.endWeek as string)) fail(p, 'первая неделя позже последней')
    string(v.content, `${p}.content`); string(v.status, `${p}.status`); string(v.note, `${p}.note`, false)
  })
  const weeklyAssignments = legacyWeekly ? [] : collection(data, 'weeklyAssignments', ids, (v, p) => {
    monday(v.weekStart, `${p}.weekStart`)
    string(v.projectId, `${p}.projectId`); optionalString(v.deliveryId, `${p}.deliveryId`)
    if (v.personId !== null) string(v.personId, `${p}.personId`)
    string(v.title, `${p}.title`)
    if ((v.title as string).length > 200) fail(`${p}.title`, 'не более 200 символов')
    number(v.count, `${p}.count`)
    if (!Number.isSafeInteger(v.count) || (v.count as number) < 1 || (v.count as number) > 100000) fail(`${p}.count`, 'нужно целое число от 1 до 100000')
    string(v.note, `${p}.note`, false)
  })
  const planEvents = collection(data, 'planEvents', ids, (v, p) => {
    string(v.type, `${p}.type`); monday(v.startWeek, `${p}.startWeek`)
    if (v.endWeek !== undefined && v.endWeek !== null) {
      monday(v.endWeek, `${p}.endWeek`)
      if ((v.startWeek as string) > (v.endWeek as string)) fail(p, 'первая неделя позже последней')
    }
    optionalString(v.projectId, `${p}.projectId`); optionalString(v.actorId, `${p}.actorId`)
    string(v.text, `${p}.text`)
  })
  const estimates = collection(data, 'estimates', ids, (v, p) => {
    oneOf(v.targetType, `${p}.targetType`, ['delivery', 'weekBlock']); string(v.targetId, `${p}.targetId`)
    number(v.value, `${p}.value`); string(v.unit, `${p}.unit`)
    oneOf(v.kind, `${p}.kind`, ['estimate', 'forecast', 'actual'])
  })
  const crossLinks = collection(data, 'crossLinks', ids, (v, p) => {
    oneOf(v.sourceType, `${p}.sourceType`, ['delivery', 'weekBlock']); string(v.sourceId, `${p}.sourceId`)
    oneOf(v.targetType, `${p}.targetType`, ['stage', 'checkpoint']); string(v.targetId, `${p}.targetId`)
    string(v.note, `${p}.note`, false)
  })

  if (!legacy) {
    const zones = collection(data, 'canvasZones', ids, (v, p) => {
      string(v.name, `${p}.name`); string(v.color, `${p}.color`)
      rectangle(v, p, 120, 80)
      if (v.zoneId !== undefined && v.zoneId !== null) fail(`${p}.zoneId`, 'зоны не могут вкладываться друг в друга')
    })
    const nodes = collection(data, 'canvasNodes', ids, (v, p) => {
      oneOf(v.kind, `${p}.kind`, ['action', 'actor', 'project', 'direction', 'note'])
      string(v.name, `${p}.name`); string(v.description, `${p}.description`, false)
      string(v.color, `${p}.color`); rectangle(v, p, 80, 40)
      if (v.zoneId !== null) string(v.zoneId, `${p}.zoneId`)
      if (v.ref !== undefined && v.ref !== null) {
        const linked = object(v.ref, `${p}.ref`)
        oneOf(linked.type, `${p}.ref.type`, ['process', 'project', 'actor'])
        string(linked.id, `${p}.ref.id`)
      }
    })
    const edges = collection(data, 'canvasEdges', ids, (v, p) => {
      string(v.sourceId, `${p}.sourceId`); string(v.targetId, `${p}.targetId`)
      if (v.sourceId === v.targetId) fail(p, 'самосвязь запрещена')
      string(v.label, `${p}.label`, false)
      oneOf(v.arrow, `${p}.arrow`, ['forward', 'reverse', 'none'])
    })
    const zoneIds = new Set(zones.map(v => v.id as string))
    const nodeIds = new Set(nodes.map(v => v.id as string))
    const processIds = new Set(processes.map(v => v.id as string))
    const projectIds = new Set(projects.map(v => v.id as string))
    const actorIds = new Set(actors.map(v => v.id as string))
    nodes.forEach((v, i) => {
      ref(v.zoneId, `data.canvasNodes[${i}].zoneId`, zoneIds, true)
      if (v.ref) {
        const linked = v.ref as { type: 'process' | 'project' | 'actor'; id: string }
        const targets = { process: processIds, project: projectIds, actor: actorIds }
        ref(linked.id, `data.canvasNodes[${i}].ref.id`, targets[linked.type])
      }
    })
    edges.forEach((v, i) => {
      ref(v.sourceId, `data.canvasEdges[${i}].sourceId`, nodeIds)
      ref(v.targetId, `data.canvasEdges[${i}].targetId`, nodeIds)
    })
  }

  const sets = {
    group: new Set(groups.map(v => v.id as string)), process: new Set(processes.map(v => v.id as string)),
    stage: new Set(stages.map(v => v.id as string)), checkpoint: new Set(checkpoints.map(v => v.id as string)),
    actor: new Set(actors.map(v => v.id as string)), project: new Set(projects.map(v => v.id as string)),
    delivery: new Set(deliveries.map(v => v.id as string)), lane: new Set(lanes.map(v => v.id as string)),
    weekBlock: new Set(weekBlocks.map(v => v.id as string)),
  }
  processes.forEach((v, i) => ref(v.groupId, `data.processes[${i}].groupId`, sets.group, true))
  stages.forEach((v, i) => ref(v.processId, `data.stages[${i}].processId`, sets.process))
  checkpoints.forEach((v, i) => {
    ref(v.processId, `data.checkpoints[${i}].processId`, sets.process)
    ref(v.stageId, `data.checkpoints[${i}].stageId`, sets.stage, true)
    if (v.stageId && stages.find(s => s.id === v.stageId)?.processId !== v.processId) fail(`data.checkpoints[${i}].stageId`, 'этап относится к другому процессу')
  })
  sharedMilestones.forEach((v, i) => (v.processIds as string[]).forEach((id, j) => ref(id, `data.sharedMilestones[${i}].processIds[${j}]`, sets.process)))
  dependencies.forEach((v, i) => {
    ref(v.sourceId, `data.dependencies[${i}].sourceId`, sets[v.sourceType as 'process' | 'stage'])
    ref(v.targetId, `data.dependencies[${i}].targetId`, sets[v.targetType as 'process' | 'stage'])
  })
  actors.forEach((v, i) => {
    ref(v.departmentId, `data.actors[${i}].departmentId`, sets.actor, true)
    if (v.departmentId && actors.find(a => a.id === v.departmentId)?.type !== 'department') fail(`data.actors[${i}].departmentId`, 'принадлежность должна ссылаться на отдел')
  })
  participations.forEach((v, i) => {
    ref(v.actorId, `data.participations[${i}].actorId`, sets.actor)
    ref(v.targetId, `data.participations[${i}].targetId`, sets[v.targetType as 'process' | 'stage' | 'checkpoint'])
  })
  handovers.forEach((v, i) => {
    ref(v.fromActorId, `data.handovers[${i}].fromActorId`, sets.actor)
    ref(v.toActorId, `data.handovers[${i}].toActorId`, sets.actor)
    ref(v.targetId, `data.handovers[${i}].targetId`, sets[v.targetType as 'process' | 'stage'])
    ref(v.checkpointId, `data.handovers[${i}].checkpointId`, sets.checkpoint, true)
  })
  deliveries.forEach((v, i) => {
    ref(v.projectId, `data.deliveries[${i}].projectId`, sets.project)
    ref(v.ownerActorId, `data.deliveries[${i}].ownerActorId`, sets.actor, true)
  })
  weekBlocks.forEach((v, i) => {
    ref(v.projectId, `data.weekBlocks[${i}].projectId`, sets.project)
    ref(v.deliveryId, `data.weekBlocks[${i}].deliveryId`, sets.delivery, true)
    if (v.deliveryId && deliveries.find(d => d.id === v.deliveryId)?.projectId !== v.projectId) fail(`data.weekBlocks[${i}].deliveryId`, 'поставка относится к другому проекту')
    ref(v.laneId, `data.weekBlocks[${i}].laneId`, sets.lane)
    ref(v.personId, `data.weekBlocks[${i}].personId`, sets.actor, true)
    if (v.personId && actors.find(a => a.id === v.personId)?.type !== 'person') fail(`data.weekBlocks[${i}].personId`, 'назначение должно ссылаться на человека')
  })
  weeklyAssignments.forEach((v, i) => {
    ref(v.projectId, `data.weeklyAssignments[${i}].projectId`, sets.project)
    ref(v.deliveryId, `data.weeklyAssignments[${i}].deliveryId`, sets.delivery, true)
    if (v.deliveryId && deliveries.find(d => d.id === v.deliveryId)?.projectId !== v.projectId) fail(`data.weeklyAssignments[${i}].deliveryId`, 'поставка относится к другому проекту')
    ref(v.personId, `data.weeklyAssignments[${i}].personId`, sets.actor, true)
    if (v.personId && actors.find(a => a.id === v.personId)?.type !== 'person') fail(`data.weeklyAssignments[${i}].personId`, 'назначение должно ссылаться на человека')
  })
  planEvents.forEach((v, i) => {
    ref(v.projectId, `data.planEvents[${i}].projectId`, sets.project, true)
    ref(v.actorId, `data.planEvents[${i}].actorId`, sets.actor, true)
  })
  estimates.forEach((v, i) => ref(v.targetId, `data.estimates[${i}].targetId`, sets[v.targetType as 'delivery' | 'weekBlock']))
  crossLinks.forEach((v, i) => {
    ref(v.sourceId, `data.crossLinks[${i}].sourceId`, sets[v.sourceType as 'delivery' | 'weekBlock'])
    ref(v.targetId, `data.crossLinks[${i}].targetId`, sets[v.targetType as 'stage' | 'checkpoint'])
  })
}

function coordinate(value: unknown, path: string): void {
  number(value, path)
  if (Math.abs(value as number) > 10_000_000) fail(path, 'координата вне допустимого диапазона')
}

function rectangle(item: Dict, path: string, minWidth: number, minHeight: number): void {
  coordinate(item.x, `${path}.x`); coordinate(item.y, `${path}.y`)
  number(item.width, `${path}.width`); number(item.height, `${path}.height`)
  if ((item.width as number) < minWidth || (item.width as number) > 1_000_000) fail(`${path}.width`, `ширина должна быть от ${minWidth} до 1000000`)
  if ((item.height as number) < minHeight || (item.height as number) > 1_000_000) fail(`${path}.height`, `высота должна быть от ${minHeight} до 1000000`)
  number(item.zIndex, `${path}.zIndex`)
  if (!Number.isInteger(item.zIndex) || Math.abs(item.zIndex as number) > 1_000_000) fail(`${path}.zIndex`, 'ожидался целый порядок слоя')
}

export function validateSnapshot(value: unknown): asserts value is Snapshot {
  validateSnapshotShape(value)
}

/** Validates the original workspace before adding an empty canvas. */
export function validateLegacySnapshot(value: unknown): void {
  validateSnapshotShape(value, true, true)
}

/** Validates a version 2 workspace before adding weekly assignments. */
export function validateV2Snapshot(value: unknown): void {
  validateSnapshotShape(value, false, true)
}
