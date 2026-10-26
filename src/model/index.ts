/**
 * The complete, portable workspace model. The JSON backup has exactly one
 * workspace and one data object; transient UI state is never stored here.
 * Dates are ISO calendar dates (YYYY-MM-DD), timestamps are ISO UTC instants.
 */

export const BACKUP_FORMAT = 'process-planner-workspace' as const
export const SCHEMA_VERSION = 4 as const

export type EntityBase = {
  id: string
  createdAt: string
  updatedAt: string
}

export type DateReference =
  | { kind: 'unknown'; text?: string }
  | { kind: 'exact'; date: string; text?: string }
  | { kind: 'range'; start: string; end: string; text?: string }

export type Workspace = EntityBase & {
  name: string
  locale: string
  weekStartsOn: 1
  display: {
    processScale: 'week' | 'month'
    planScale: 'week' | 'month'
  }
}

export type Group = EntityBase & {
  name: string
  color: string
  order: number
}

export type Process = EntityBase & {
  groupId?: string | null
  name: string
  currentState: string
  targetState: string
  reason: string
  expectedResult: string
  status: string
  priority?: string
  order: number
  note?: string
}

export type Stage = EntityBase & {
  processId: string
  name: string
  purpose: string
  plannedStart: DateReference
  plannedEnd: DateReference
  expectedOutput: string
  status: string
  order: number
}

export type Checkpoint = EntityBase & {
  processId: string
  stageId?: string | null
  name: string
  plannedDate: DateReference
  actualDate: DateReference
  confirmation: string
  status: string
}

export type SharedMilestone = EntityBase & {
  name: string
  date: DateReference
  purpose: string
  confirmation: string
  processIds: string[]
}

export type Dependency = EntityBase & {
  sourceType: 'process' | 'stage'
  sourceId: string
  targetType: 'process' | 'stage'
  targetId: string
  type: 'prerequisite' | 'influence'
  note: string
}

export type Actor = EntityBase & {
  type: 'department' | 'role' | 'person'
  name: string
  departmentId?: string | null
  color?: string
}

export type Participation = EntityBase & {
  actorId: string
  targetType: 'process' | 'stage' | 'checkpoint'
  targetId: string
  type: 'responsible' | 'participates' | 'approves' | 'provides'
  expectedContribution: string
}

export type Handover = EntityBase & {
  fromActorId: string
  toActorId: string
  targetType: 'process' | 'stage'
  targetId: string
  checkpointId?: string | null
  description: string
}

export type Project = EntityBase & {
  name: string
  type: string
  order: number
  status: string
  notes?: string
}

export type Delivery = EntityBase & {
  projectId: string
  kind: string
  name: string
  testingTaskCount?: number
  developmentTaskCount?: number
  manualCompletedTaskCount?: number
  ownerActorId?: string | null
  startDate: DateReference
  checkpointDate: DateReference
  deadline: DateReference
  status: string
  note: string
}

export type Lane = EntityBase & {
  name: string
  order: number
}

export type WeekBlock = EntityBase & {
  projectId: string
  deliveryId?: string | null
  laneId: string
  personId?: string | null
  startWeek: string
  endWeek: string
  content: string
  status: string
  note: string
}

export type WeeklyAssignment = EntityBase & {
  weekStart: string
  projectId: string
  deliveryId?: string | null
  personId: string | null
  title: string
  count: number | null
  completedCount?: number
  completed?: boolean
  note: string
}

export type PersonalTask = EntityBase & {
  title: string
  note: string
  plannedDate: string
  plannedTime?: string
  status: 'todo' | 'doing' | 'done'
  completedDate?: string
}

export type PlanEvent = EntityBase & {
  type: string
  startWeek: string
  endWeek?: string | null
  projectId?: string | null
  actorId?: string | null
  text: string
}

export type Estimate = EntityBase & {
  targetType: 'delivery' | 'weekBlock'
  targetId: string
  value: number
  unit: string
  kind: 'estimate' | 'forecast' | 'actual'
}

export type CrossLink = EntityBase & {
  sourceType: 'delivery' | 'weekBlock'
  sourceId: string
  targetType: 'stage' | 'checkpoint'
  targetId: string
  note: string
}

export type Canvas = EntityBase & {
  name: string
  viewport: { x: number; y: number; zoom: number }
}

export type CanvasZone = EntityBase & {
  name: string
  color: string
  x: number; y: number; width: number; height: number; zIndex: number
}

export type CanvasNode = EntityBase & {
  kind: 'action' | 'actor' | 'project' | 'direction' | 'note'
  name: string
  description: string
  color: string
  x: number; y: number; width: number; height: number; zIndex: number
  zoneId: string | null
  ref?: { type: 'process' | 'project' | 'actor'; id: string } | null
}

export type CanvasEdge = EntityBase & {
  sourceId: string
  targetId: string
  label: string
  arrow: 'forward' | 'reverse' | 'none'
}

export type WorkspaceData = {
  canvas: Canvas
  canvasZones: CanvasZone[]
  canvasNodes: CanvasNode[]
  canvasEdges: CanvasEdge[]
  groups: Group[]
  processes: Process[]
  stages: Stage[]
  checkpoints: Checkpoint[]
  sharedMilestones: SharedMilestone[]
  dependencies: Dependency[]
  actors: Actor[]
  participations: Participation[]
  handovers: Handover[]
  projects: Project[]
  deliveries: Delivery[]
  lanes: Lane[]
  weekBlocks: WeekBlock[]
  weeklyAssignments: WeeklyAssignment[]
  personalTasks: PersonalTask[]
  planEvents: PlanEvent[]
  estimates: Estimate[]
  crossLinks: CrossLink[]
}

export type Snapshot = { workspace: Workspace; data: WorkspaceData }
export type Backup = Snapshot & {
  format: typeof BACKUP_FORMAT
  schemaVersion: typeof SCHEMA_VERSION
  exportedAt: string
}

export type SnapshotSummary = {
  name: string
  groups: number
  processes: number
  actors: number
  projects: number
  deliveries: number
  weekBlocks: number
  weeklyAssignments: number
  personalTasks: number
  canvasZones: number
  canvasNodes: number
  canvasEdges: number
}

export type ImportPreview = {
  backup: Backup
  incoming: SnapshotSummary
  current: SnapshotSummary
}

export const unknownDate = (): DateReference => ({ kind: 'unknown' })
export const createId = (): string => crypto.randomUUID()

export function createEmptySnapshot(name = 'Рабочее пространство'): Snapshot {
  const now = new Date().toISOString()
  return {
    workspace: {
      id: createId(),
      createdAt: now,
      updatedAt: now,
      name,
      locale: 'ru-RU',
      weekStartsOn: 1,
      display: { processScale: 'month', planScale: 'week' },
    },
    data: {
      canvas: createEmptyCanvas(now), canvasZones: [], canvasNodes: [], canvasEdges: [],
      groups: [], processes: [], stages: [], checkpoints: [],
      sharedMilestones: [], dependencies: [], actors: [], participations: [],
      handovers: [], projects: [], deliveries: [], lanes: [], weekBlocks: [], weeklyAssignments: [], personalTasks: [],
      planEvents: [], estimates: [], crossLinks: [],
    },
  }
}

export function createEmptyCanvas(now = new Date().toISOString()): Canvas {
  return { id: createId(), name: 'Схема', viewport: { x: 0, y: 0, zoom: 1 }, createdAt: now, updatedAt: now }
}

export function getSnapshotSummary(snapshot: Snapshot): SnapshotSummary {
  return {
    name: snapshot.workspace.name,
    groups: snapshot.data.groups.length,
    processes: snapshot.data.processes.length,
    actors: snapshot.data.actors.length,
    projects: snapshot.data.projects.length,
    deliveries: snapshot.data.deliveries.length,
    weekBlocks: snapshot.data.weekBlocks.length,
    weeklyAssignments: snapshot.data.weeklyAssignments.length,
    personalTasks: snapshot.data.personalTasks.length,
    canvasZones: snapshot.data.canvasZones.length,
    canvasNodes: snapshot.data.canvasNodes.length,
    canvasEdges: snapshot.data.canvasEdges.length,
  }
}

export { validateSnapshot, validateDateReference, validateDateOrder } from './validation'
export {
  loadSnapshot,
  saveSnapshot,
  validateBackup,
  createBackup,
  parseBackup,
  restoreBackup,
  getRollbackSnapshot,
  rollbackRestore,
} from './storage'
export type { PreparedBackup } from './storage'
