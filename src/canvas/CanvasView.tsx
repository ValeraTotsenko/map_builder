import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, MarkerType, MiniMap, NodeResizer, Position, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { SmartEdgeProvider, createSmartEdge } from '@tisoap/react-flow-smart-edge';
import '@xyflow/react/dist/style.css';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Copy, Focus, Link2, Maximize2, Plus, Redo2, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { createId, type Snapshot, type WorkspaceData } from '../model';
import { DraggableDialog } from '../DraggableDialog';
import './canvas.css';

type CNode = WorkspaceData['canvasNodes'][number];
type CZone = WorkspaceData['canvasZones'][number];
type CEdge = WorkspaceData['canvasEdges'][number];
type Kind = CNode['kind'];
type PaletteKind = Kind | 'zone' | 'edge';
type CreateKind = Exclude<PaletteKind, 'edge'>;
type CreateDraft = { kind: CreateKind; name: string; description: string; color: string };
type EditDraft = { id: string; kind: 'node' | 'zone' | 'edge'; name: string; description: string; color: string; label: string; arrow: CEdge['arrow'] };
type Selection = { nodes: string[]; edges: string[] };
type SaveState = 'saved' | 'saving' | 'error';
type CardData = { model: CNode; editing: boolean; onEdit: (id: string, name: string) => void; onFinish: () => void };
type ZoneData = { model: CZone; editing: boolean; onEdit: (id: string, name: string) => void; onFinish: () => void; onResize: (id: string, x: number, y: number, width: number, height: number) => void; minWidth: number; minHeight: number };

const KIND_LABEL: Record<PaletteKind, string> = { zone: 'Зона', action: 'Действие', actor: 'Участник', project: 'Проект', direction: 'Направление', note: 'Заметка', edge: 'Связь' };
const DEFAULT_NAME: Record<Kind, string> = { action: 'Новое действие', actor: 'Новый участник', project: 'Новый проект', direction: 'Новое направление', note: 'Новая заметка' };
const KIND_MARK: Record<Kind, string> = { action: '→', actor: '♙', project: '▣', direction: '◈', note: '✎' };
const KIND_COLOR: Record<Kind, string> = { action: '#4f70d9', actor: '#8b5bc6', project: '#118b86', direction: '#e08b35', note: '#e2b74f' };
const COLORS = ['#4f70d9', '#8b5bc6', '#118b86', '#e08b35', '#e2b74f', '#dd6583', '#64748b'];
const NOW = () => new Date().toISOString();
const makeId = createId;

function InlineName({ name, editing, onCommit, onFinish }: { name: string; editing: boolean; onCommit: (value: string) => void; onFinish: () => void }) {
  const [value, setValue] = useState(name);
  const cancelled = useRef(false);
  useEffect(() => { setValue(name); cancelled.current = false; }, [name, editing]);
  if (!editing) return <span className="canvas-item-name">{name}</span>;
  return <input autoFocus className="canvas-inline-name nodrag" value={value} onChange={event => setValue(event.target.value)} onBlur={() => { if (!cancelled.current && value.trim() && value.trim() !== name) onCommit(value.trim()); onFinish(); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelled.current = true; setValue(name); onFinish(); } }} aria-label="Название элемента" />;
}

function Card({ data, selected }: NodeProps<Node<CardData>>) {
  const { model } = data;
  return <div className={`canvas-card canvas-card-${model.kind}${selected ? ' selected' : ''}`} style={{ width: model.width, height: model.height, '--item-color': model.color } as React.CSSProperties}>
    {model.kind !== 'note' && <><Handle type="target" position={Position.Left} className="canvas-handle"/><Handle type="source" position={Position.Right} className="canvas-handle"/></>}
    <div className="canvas-card-heading"><span className="canvas-card-icon" aria-hidden>{KIND_MARK[model.kind]}</span><InlineName name={model.name} editing={data.editing} onCommit={name => data.onEdit(model.id, name)} onFinish={data.onFinish}/></div>
    {model.description && <div className="canvas-card-description">{model.description}</div>}
  </div>;
}

function Zone({ data, selected }: NodeProps<Node<ZoneData>>) {
  const { model } = data;
  return <div className={`canvas-zone${selected ? ' selected' : ''}`} style={{ width: model.width, height: model.height, '--item-color': model.color } as React.CSSProperties}>
    <NodeResizer isVisible={selected} minWidth={data.minWidth} minHeight={data.minHeight} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" onResizeEnd={(_event, params) => data.onResize(model.id, params.x, params.y, params.width, params.height)}/>
    <div className="canvas-zone-title"><span className="canvas-zone-dot"/><InlineName name={model.name} editing={data.editing} onCommit={name => data.onEdit(model.id, name)} onFinish={data.onFinish}/></div>
  </div>;
}

const nodeTypes = { card: Card, zone: Zone };
const edgeTypes = { routed: createSmartEdge('bezier', { floating: true, nodePadding: 24, gridRatio: 8 }) };
const routingOptions = { routeOnlyWhenBlocked: false, routeWhileDragging: true, debounceMs: 30 };

function buildFlowNodes(data: WorkspaceData, editingId: string | null, selectedIds: string[], onEdit: (id: string, name: string) => void, onFinish: () => void, onResize: ZoneData['onResize']): Node[] {
  const zones: Node[] = data.canvasZones.map(zone => {
    const children = data.canvasNodes.filter(node => node.zoneId === zone.id);
    const minWidth = Math.max(120, ...children.map(node => node.x + node.width - zone.x + 24));
    const minHeight = Math.max(80, ...children.map(node => node.y + node.height - zone.y + 24));
    return { id: zone.id, type: 'zone', position: { x: zone.x, y: zone.y }, style: { width: zone.width, height: zone.height, zIndex: zone.zIndex }, data: { model: zone, editing: editingId === zone.id, onEdit, onFinish, onResize, minWidth, minHeight }, draggable: true, selected: selectedIds.includes(zone.id) };
  });
  const cards: Node[] = data.canvasNodes.map(node => {
    const zone = data.canvasZones.find(item => item.id === node.zoneId);
    return { id: node.id, type: 'card', parentId: zone?.id, position: { x: node.x - (zone?.x ?? 0), y: node.y - (zone?.y ?? 0) }, style: { width: node.width, height: node.height, zIndex: node.zIndex }, data: { model: node, editing: editingId === node.id, onEdit, onFinish }, draggable: true, selected: selectedIds.includes(node.id) };
  });
  return [...zones, ...cards];
}

function buildFlowEdges(data: WorkspaceData, selectedNodeIds: string[], selectedEdgeIds: string[]): Edge[] {
  const active = new Set(selectedNodeIds);
  return data.canvasEdges.map(edge => ({
    id: edge.id, source: edge.sourceId, target: edge.targetId, label: edge.label || undefined, zIndex: 0,
    className: selectedEdgeIds.includes(edge.id) ? 'canvas-edge-active' : active.size ? active.has(edge.sourceId) || active.has(edge.targetId) ? 'canvas-edge-related' : 'canvas-edge-dimmed' : '',
    type: 'routed', animated: false,
    markerEnd: edge.arrow === 'forward' ? { type: MarkerType.ArrowClosed, color: '#61728b', width: 18, height: 18 } : undefined,
    markerStart: edge.arrow === 'reverse' ? { type: MarkerType.ArrowClosed, color: '#61728b', width: 18, height: 18 } : undefined,
    style: { stroke: '#61728b', strokeWidth: 1.7 },
    labelStyle: { fontSize: 12, fill: '#334155', fontWeight: 600 },
    labelBgStyle: { fill: 'white', fillOpacity: .94 }, labelBgPadding: [5, 3] as [number, number], labelBgBorderRadius: 5,
  }));
}

export function CanvasView({ snapshot, onChange }: { snapshot: Snapshot; onChange: (next: Snapshot) => Promise<boolean> }) {
  const [data, setData] = useState(snapshot.data);
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [] });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [tool, setTool] = useState<PaletteKind | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [createError, setCreateError] = useState('');
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState('');
  const [past, setPast] = useState<WorkspaceData[]>([]);
  const [future, setFuture] = useState<WorkspaceData[]>([]);
  const [titleDraft, setTitleDraft] = useState(snapshot.data.canvas.name);
  const flow = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const emitted = useRef<Snapshot | null>(null);
  const current = useRef(data);
  const clipboard = useRef<string[]>([]);
  const seq = useRef(0);
  const selectionRef = useRef(selection);
  const connectRef = useRef(connectFrom);
  current.current = data;
  selectionRef.current = selection;
  connectRef.current = connectFrom;

  useEffect(() => { if (snapshot !== emitted.current) { setData(snapshot.data); current.current = snapshot.data; setPast([]); setFuture([]); setTitleDraft(snapshot.data.canvas.name); setSaveState('saved'); } }, [snapshot]);
  const publish = useCallback((nextData: WorkspaceData, record = true) => {
    const previous = current.current;
    if (record) { setPast(items => [...items.slice(-49), previous]); setFuture([]); }
    current.current = nextData;
    setData(nextData);
    setSaveState('saving');
    const next = { ...snapshot, data: nextData };
    emitted.current = next;
    const number = ++seq.current;
    void onChange(next).then(ok => { if (number === seq.current) setSaveState(ok ? 'saved' : 'error'); }).catch(error => { if (number === seq.current) setSaveState('error'); setNotice(String(error)); });
  }, [onChange, snapshot]);

  const editName = useCallback((id: string, name: string) => {
    const d = current.current; const stamp = NOW();
    const zones = d.canvasZones.map(item => item.id === id ? { ...item, name, updatedAt: stamp } : item);
    const nodes = d.canvasNodes.map(item => item.id === id ? { ...item, name, updatedAt: stamp } : item);
    publish({ ...d, canvasZones: zones, canvasNodes: nodes });
  }, [publish]);
  const finishEdit = useCallback(() => setEditingId(null), []);
  const resizeZone = useCallback((id: string, x: number, y: number, width: number, height: number) => {
    const d = current.current; const zone = d.canvasZones.find(item => item.id === id); if (!zone) return;
    const children = d.canvasNodes.filter(node => node.zoneId === id);
    const right = x + width, bottom = y + height;
    const allowedX = Math.min(x, ...children.map(node => node.x - 16));
    const allowedY = Math.min(y, ...children.map(node => node.y - 44));
    const allowedWidth = Math.max(120, right - allowedX, ...children.map(node => node.x + node.width + 16 - allowedX));
    const allowedHeight = Math.max(80, bottom - allowedY, ...children.map(node => node.y + node.height + 16 - allowedY));
    publish({ ...d, canvasZones: d.canvasZones.map(item => item.id === id ? { ...item, x: allowedX, y: allowedY, width: allowedWidth, height: allowedHeight, updatedAt: NOW() } : item) });
  }, [publish]);

  useEffect(() => setFlowNodes(buildFlowNodes(data, editingId, selectionRef.current.nodes, editName, finishEdit, resizeZone)), [data, editingId, editName, finishEdit, resizeZone]);
  const edges = useMemo(() => buildFlowEdges(data, selection.nodes, selection.edges), [data, selection.nodes, selection.edges]);
  const routingNodes = useMemo(() => {
    const zones = new Map(flowNodes.filter(node => node.type === 'zone').map(node => [node.id, node]));
    const cards = new Map(data.canvasNodes.map(node => [node.id, node]));
    // Zones group cards visually; only cards should block a connection's path.
    return flowNodes.filter(node => node.type === 'card').map(node => {
      const parent = node.parentId ? zones.get(node.parentId) : undefined;
      const model = cards.get(node.id);
      const width = node.measured?.width ?? model?.width ?? 220;
      const height = node.measured?.height ?? model?.height ?? 90;
      return { ...node, parentId: undefined, position: { x: node.position.x + (parent?.position.x ?? 0), y: node.position.y + (parent?.position.y ?? 0) }, width, height, measured: { width, height }, dragging: node.dragging || parent?.dragging };
    });
  }, [flowNodes, data.canvasNodes]);

  const addAt = useCallback((kind: PaletteKind, x: number, y: number, details?: Omit<CreateDraft, 'kind'>) => {
    if (kind === 'edge') { setTool('edge'); setConnectFrom(null); setNotice('Выберите первую карточку, затем вторую.'); return; }
    const d = current.current; const id = makeId(); const stamp = NOW();
    if (kind === 'zone') {
      const zone: CZone = { id, name: details?.name || 'Новая зона', color: details?.color || COLORS[d.canvasZones.length % COLORS.length], x, y, width: 450, height: 280, zIndex: 0, createdAt: stamp, updatedAt: stamp };
      publish({ ...d, canvasZones: [...d.canvasZones, zone] });
    } else {
      const width = kind === 'note' ? 200 : 220, height = kind === 'note' ? 112 : 90;
      const zone = [...d.canvasZones].reverse().find(item => x >= item.x + 12 && y >= item.y + 42 && x + width <= item.x + item.width - 12 && y + height <= item.y + item.height - 12);
      const node: CNode = { id, kind, name: details?.name || DEFAULT_NAME[kind], description: details?.description || '', color: details?.color || KIND_COLOR[kind], x, y, width, height, zIndex: 1, zoneId: zone?.id ?? null, ref: null, createdAt: stamp, updatedAt: stamp };
      publish({ ...d, canvasNodes: [...d.canvasNodes, node] });
    }
    setSelection({ nodes: [id], edges: [] }); setEditingId(details ? null : id); setEditDraft(null); setTool(null);
  }, [publish]);
  const addAtCenter = (kind: PaletteKind, details?: Omit<CreateDraft, 'kind'>) => {
    if (kind === 'edge') { addAt(kind, 0, 0); return; }
    const pane = document.querySelector('.canvas-flow')?.getBoundingClientRect();
    const position = flow.current?.screenToFlowPosition({ x: (pane?.left ?? 0) + (pane?.width ?? 800) / 2, y: (pane?.top ?? 0) + (pane?.height ?? 600) / 2 }) ?? { x: 100, y: 100 };
    const width = kind === 'zone' ? 450 : kind === 'note' ? 200 : 220;
    const height = kind === 'zone' ? 280 : kind === 'note' ? 112 : 90;
    const center = { x: position.x - width / 2, y: position.y - height / 2 };
    const viewport = flow.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    const visible = { left: -viewport.x / viewport.zoom, top: -viewport.y / viewport.zoom, right: ((pane?.width ?? 800) - viewport.x) / viewport.zoom, bottom: ((pane?.height ?? 600) - viewport.y) / viewport.zoom };
    const minimap = document.querySelector('.canvas-minimap')?.getBoundingClientRect();
    const collides = (x: number, y: number, item: { x: number; y: number; width: number; height: number }) => x < item.x + item.width + 18 && x + width + 18 > item.x && y < item.y + item.height + 18 && y + height + 18 > item.y;
    const candidates: { x: number; y: number; score: number }[] = [];
    const step = kind === 'zone' ? 95 : 75;
    for (let ring = 0; ring <= 14; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = Math.round(center.x + dx * step), y = Math.round(center.y + dy * step);
      if (kind !== 'zone' && data.canvasZones.some(item => {
        const touches = x < item.x + item.width + 10 && x + width + 10 > item.x && y < item.y + item.height + 10 && y + height + 10 > item.y;
        const contained = x >= item.x + 12 && y >= item.y + 42 && x + width <= item.x + item.width - 12 && y + height <= item.y + item.height - 12;
        return touches && !contained;
      })) continue;
      const overlap = kind === 'zone' ? data.canvasZones.filter(item => collides(x, y, item)).length : data.canvasNodes.filter(item => collides(x, y, item)).length;
      const insideZone = kind !== 'zone' && data.canvasZones.some(item => collides(x, y, item));
      const offscreen = x < visible.left + 10 || y < visible.top + 10 || x + width > visible.right - 10 || y + height > visible.bottom - 10;
      const screenLeft = (pane?.left ?? 0) + x * viewport.zoom + viewport.x;
      const screenTop = (pane?.top ?? 0) + y * viewport.zoom + viewport.y;
      const underMinimap = minimap && screenLeft < minimap.right + 8 && screenLeft + width * viewport.zoom > minimap.left - 8 && screenTop < minimap.bottom + 8 && screenTop + height * viewport.zoom > minimap.top - 8;
      candidates.push({ x, y, score: overlap * 10000 + (insideZone ? 1000 : 0) + (offscreen ? 5000 : 0) + (underMinimap ? 5000 : 0) + ring * 4 + Math.abs(dx) + Math.abs(dy) });
    }
    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates[0] ?? center;
    addAt(kind, chosen.x, chosen.y, details);
  };
  const openCreate = (kind: PaletteKind) => {
    if (kind === 'edge') { addAtCenter('edge'); return; }
    setCreateError(''); setTool(null); setConnectFrom(null);
    setCreateDraft({ kind, name: kind === 'zone' ? 'Новая зона' : DEFAULT_NAME[kind], description: '', color: kind === 'zone' ? COLORS[data.canvasZones.length % COLORS.length] : KIND_COLOR[kind] });
  };
  const saveCreate = () => {
    if (!createDraft) return;
    const name = createDraft.name.trim();
    if (!name) { setCreateError('Укажите название элемента.'); return; }
    addAtCenter(createDraft.kind, { name, description: createDraft.description.trim(), color: createDraft.color });
    setCreateDraft(null);
  };
  const openEditor = (id: string) => {
    const d = current.current;
    const node = d.canvasNodes.find(item => item.id === id);
    const zone = d.canvasZones.find(item => item.id === id);
    const edge = d.canvasEdges.find(item => item.id === id);
    if (!node && !zone && !edge) return;
    setEditingId(null);
    setEditError('');
    setEditDraft({ id, kind: node ? 'node' : zone ? 'zone' : 'edge', name: node?.name || zone?.name || '', description: node?.description || '', color: node?.color || zone?.color || '', label: edge?.label || '', arrow: edge?.arrow || 'forward' });
  };
  const connect = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) { setNotice('Карточку нельзя связать с самой собой.'); return; }
    const d = current.current;
    if (!d.canvasNodes.some(item => item.id === sourceId) || !d.canvasNodes.some(item => item.id === targetId)) return;
    const stamp = NOW(); const id = makeId();
    const edge: CEdge = { id, sourceId, targetId, label: '', arrow: 'forward', createdAt: stamp, updatedAt: stamp };
    publish({ ...d, canvasEdges: [...d.canvasEdges, edge] }); setSelection({ nodes: [], edges: [id] }); setEditDraft(null); setTool(null); setConnectFrom(null); setNotice('');
  }, [publish]);
  const onNodeClick = (event: React.MouseEvent, node: Node) => {
    if (tool === 'edge') {
      if (node.type !== 'card') return;
      if (!connectRef.current) { setConnectFrom(node.id); setNotice('Выберите вторую карточку.'); }
      else connect(connectRef.current, node.id);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    setSelection({ nodes: [node.id], edges: [] });
    openEditor(node.id);
  };
  const onConnect = (connection: Connection) => { if (connection.source && connection.target) connect(connection.source, connection.target); };
  const onDragStop = (_event: MouseEvent | TouchEvent, moved: Node, movedNodes?: Node[]) => {
    const d = current.current; const stamp = NOW();
    const list = movedNodes?.length ? movedNodes : [moved];
    const movedById = new Map(list.map(item => [item.id, item]));
    const zones = d.canvasZones.map(zone => {
      const drag = movedById.get(zone.id);
      return drag ? { ...zone, x: drag.position.x, y: drag.position.y, updatedAt: stamp } : zone;
    });
    const movedZones = new Map(zones.filter((zone, index) => zone.x !== d.canvasZones[index].x || zone.y !== d.canvasZones[index].y).map(zone => [zone.id, zone]));
    const nodes = d.canvasNodes.map(item => {
      const drag = movedById.get(item.id);
      const originalParent = item.zoneId ? d.canvasZones.find(zone => zone.id === item.zoneId) : undefined;
      const newParent = item.zoneId ? zones.find(zone => zone.id === item.zoneId) : undefined;
      if (!drag && !movedZones.has(item.zoneId ?? '')) return item;
      const x = drag ? drag.position.x + (newParent?.x ?? 0) : item.x + (newParent?.x ?? 0) - (originalParent?.x ?? 0);
      const y = drag ? drag.position.y + (newParent?.y ?? 0) : item.y + (newParent?.y ?? 0) - (originalParent?.y ?? 0);
      const zone = [...zones].reverse().find(candidate => x >= candidate.x + 12 && y >= candidate.y + 42 && x + item.width <= candidate.x + candidate.width - 12 && y + item.height <= candidate.y + candidate.height - 12);
      return { ...item, x, y, zoneId: zone?.id ?? null, updatedAt: stamp };
    });
    if (zones.some((item, index) => item !== d.canvasZones[index]) || nodes.some((item, index) => item !== d.canvasNodes[index])) publish({ ...d, canvasZones: zones, canvasNodes: nodes });
  };
  const changeProperty = (id: string, field: string, value: string) => {
    const d = current.current, stamp = NOW();
    if (id === d.canvas.id) publish({ ...d, canvas: { ...d.canvas, [field]: value, updatedAt: stamp } });
    else if (d.canvasNodes.some(item => item.id === id)) publish({ ...d, canvasNodes: d.canvasNodes.map(item => item.id === id ? { ...item, [field]: value, updatedAt: stamp } : item) });
    else if (d.canvasZones.some(item => item.id === id)) publish({ ...d, canvasZones: d.canvasZones.map(item => item.id === id ? { ...item, [field]: value, updatedAt: stamp } : item) });
    else publish({ ...d, canvasEdges: d.canvasEdges.map(item => item.id === id ? { ...item, [field]: value, updatedAt: stamp } : item) });
  };
  const saveEdit = () => {
    if (!editDraft) return;
    const d = current.current, stamp = NOW();
    if (editDraft.kind !== 'edge' && !editDraft.name.trim()) { setEditError('Укажите название элемента.'); return; }
    if (editDraft.kind === 'node') {
      const node = d.canvasNodes.find(item => item.id === editDraft.id);
      if (!node) { setEditDraft(null); return; }
      const name = editDraft.name.trim(), description = editDraft.description.trim();
      if (name !== node.name || description !== node.description || editDraft.color !== node.color) publish({ ...d, canvasNodes: d.canvasNodes.map(item => item.id === editDraft.id ? { ...item, name, description, color: editDraft.color, updatedAt: stamp } : item) });
    } else if (editDraft.kind === 'zone') {
      const zone = d.canvasZones.find(item => item.id === editDraft.id);
      if (!zone) { setEditDraft(null); return; }
      const name = editDraft.name.trim();
      if (name !== zone.name || editDraft.color !== zone.color) publish({ ...d, canvasZones: d.canvasZones.map(item => item.id === editDraft.id ? { ...item, name, color: editDraft.color, updatedAt: stamp } : item) });
    } else {
      const edge = d.canvasEdges.find(item => item.id === editDraft.id);
      if (!edge) { setEditDraft(null); return; }
      const label = editDraft.label.trim();
      if (label !== edge.label || editDraft.arrow !== edge.arrow) publish({ ...d, canvasEdges: d.canvasEdges.map(item => item.id === editDraft.id ? { ...item, label, arrow: editDraft.arrow, updatedAt: stamp } : item) });
    }
    setEditDraft(null);
    setEditError('');
  };
  const undo = useCallback(() => { if (!past.length) return; const previous = past[past.length - 1], present = current.current; setPast(items => items.slice(0, -1)); setFuture(items => [...items, present]); publish(previous, false); }, [past, publish]);
  const redo = useCallback(() => { if (!future.length) return; const next = future[future.length - 1], present = current.current; setFuture(items => items.slice(0, -1)); setPast(items => [...items, present]); publish(next, false); }, [future, publish]);
  const requestDelete = useCallback(() => { if (selectionRef.current.nodes.length || selectionRef.current.edges.length) setConfirmDelete(true); }, []);
  const performDelete = (zoneMode: 'keep' | 'remove' = 'keep') => {
    const d = current.current; const ids = new Set(selectionRef.current.nodes); const zones = new Set(d.canvasZones.filter(item => ids.has(item.id)).map(item => item.id));
    const removedNodes = new Set(d.canvasNodes.filter(item => ids.has(item.id) || (zoneMode === 'remove' && item.zoneId && zones.has(item.zoneId))).map(item => item.id));
    const edges = d.canvasEdges.filter(item => !removedNodes.has(item.sourceId) && !removedNodes.has(item.targetId) && !selectionRef.current.edges.includes(item.id));
    publish({ ...d, canvasZones: d.canvasZones.filter(item => !zones.has(item.id)), canvasNodes: d.canvasNodes.filter(item => !removedNodes.has(item.id)).map(item => item.zoneId && zones.has(item.zoneId) ? { ...item, zoneId: null, updatedAt: NOW() } : item), canvasEdges: edges });
    setSelection({ nodes: [], edges: [] }); setConfirmDelete(false); setEditDraft(null);
  };
  const duplicate = useCallback((ids: string[]) => {
    const d = current.current; const originals = d.canvasNodes.filter(item => ids.includes(item.id)); const originalZones = d.canvasZones.filter(item => ids.includes(item.id)); if (!originals.length && !originalZones.length) return;
    const stamp = NOW(); const remap = new Map<string, string>();
    const zones = originalZones.map(item => { const id = makeId(); remap.set(item.id, id); return { ...item, id, name: `${item.name} — копия`, x: item.x + 36, y: item.y + 36, createdAt: stamp, updatedAt: stamp }; });
    const sourceNodes = d.canvasNodes.filter(item => ids.includes(item.id) || (item.zoneId && remap.has(item.zoneId)));
    const nodes = sourceNodes.map(item => { const id = makeId(); remap.set(item.id, id); return { ...item, id, name: ids.includes(item.id) ? `${item.name} — копия` : item.name, x: item.x + 36, y: item.y + 36, zoneId: item.zoneId && remap.has(item.zoneId) ? remap.get(item.zoneId)! : item.zoneId, createdAt: stamp, updatedAt: stamp }; });
    const edges = d.canvasEdges.filter(item => remap.has(item.sourceId) && remap.has(item.targetId)).map(item => ({ ...item, id: makeId(), sourceId: remap.get(item.sourceId)!, targetId: remap.get(item.targetId)!, createdAt: stamp, updatedAt: stamp }));
    publish({ ...d, canvasZones: [...d.canvasZones, ...zones], canvasNodes: [...d.canvasNodes, ...nodes], canvasEdges: [...d.canvasEdges, ...edges] }); setSelection({ nodes: [...zones, ...nodes].map(item => item.id), edges: [] });
  }, [publish]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (editDraft || createDraft) return;
      const target = event.target as HTMLElement; if (target.closest('input, textarea, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(selectionRef.current.nodes); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { clipboard.current = [...selectionRef.current.nodes]; event.preventDefault(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); duplicate(clipboard.current); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); requestDelete(); }
      else if (event.key === 'Escape') { setCreateDraft(null); setTool(null); setConnectFrom(null); setNotice(''); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [undo, redo, duplicate, requestDelete, editDraft, createDraft]);

  const selectedId = selection.nodes.length === 1 ? selection.nodes[0] : selection.edges.length === 1 ? selection.edges[0] : null;
  const selectedNode = data.canvasNodes.find(item => item.id === selectedId);
  const selectedZone = data.canvasZones.find(item => item.id === selectedId);
  const selectedEdge = data.canvasEdges.find(item => item.id === selectedId);
  const selected = selectedNode ?? selectedZone ?? selectedEdge;
  const linkedEdgeCount = data.canvasEdges.filter(item => selection.nodes.includes(item.sourceId) || selection.nodes.includes(item.targetId)).length;
  const selectedZoneCount = data.canvasZones.filter(item => selection.nodes.includes(item.id)).length;
  const containedCount = data.canvasNodes.filter(item => item.zoneId && selection.nodes.includes(item.zoneId) && !selection.nodes.includes(item.id)).length;
  const needsConfirm = linkedEdgeCount > 0 || containedCount > 0;
  const showDeleteDialog = confirmDelete && needsConfirm;
  useEffect(() => { if (confirmDelete && !needsConfirm) performDelete('keep'); }, [confirmDelete, needsConfirm]);
  const makeDemo = () => {
    const d = current.current; const stamp = NOW(); const zoneId = makeId(); const names = ['Идея', 'Действие', 'Результат'];
    const zone: CZone = { id: zoneId, name: 'Пример процесса', color: '#4f70d9', x: 120, y: 100, width: 850, height: 300, zIndex: 0, createdAt: stamp, updatedAt: stamp };
    const nodes: CNode[] = names.map((name, index) => ({ id: makeId(), kind: 'action', name, description: '', color: '#4f70d9', x: 160 + index * 270, y: 205, width: 200, height: 90, zIndex: 1, zoneId, ref: null, createdAt: stamp, updatedAt: stamp }));
    const demoEdges: CEdge[] = [0, 1].map(index => ({ id: makeId(), sourceId: nodes[index].id, targetId: nodes[index + 1].id, label: '', arrow: 'forward', createdAt: stamp, updatedAt: stamp }));
    publish({ ...d, canvasZones: [...d.canvasZones, zone], canvasNodes: [...d.canvasNodes, ...nodes], canvasEdges: [...d.canvasEdges, ...demoEdges] });
    requestAnimationFrame(() => flow.current?.fitView({ padding: .18, duration: 400 }));
  };

  return <div className="canvas-screen">
    <aside className="canvas-palette" aria-label="Палитра элементов"><div className="canvas-palette-heading">Элементы</div>{(['zone','action','actor','project','direction','note','edge'] as PaletteKind[]).map(kind => <button key={kind} className={`canvas-palette-item${tool === kind ? ' active' : ''}`} onClick={() => openCreate(kind)} draggable={kind !== 'edge'} onDragStart={event => event.dataTransfer.setData('application/x-canvas-kind', kind)} title={`Добавить: ${KIND_LABEL[kind]}`}><span className={`canvas-palette-symbol kind-${kind}`}>{kind === 'zone' ? '▧' : kind === 'edge' ? '↗' : KIND_MARK[kind]}</span><span>{KIND_LABEL[kind]}</span></button>)}<div className="canvas-palette-tip">Нажмите или перетащите элемент на полотно. Для связи соедините маркеры карточек.</div></aside>
    <section className="canvas-workspace"><div className="canvas-toolbar"><div className="canvas-title-wrap"><input aria-label="Название схемы" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onBlur={() => { const name = titleDraft.trim() || 'Схема'; setTitleDraft(name); if (name !== data.canvas.name) changeProperty(data.canvas.id, 'name', name); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/><span className={`canvas-save-status ${saveState}`}>{saveState === 'saved' ? <><Check size={12}/> Сохранено</> : saveState === 'saving' ? 'Сохранение…' : 'Ошибка сохранения'}</span></div><div className="canvas-toolbar-actions"><button onClick={undo} disabled={!past.length} title="Отменить (Ctrl+Z)"><Undo2 size={17}/></button><button onClick={redo} disabled={!future.length} title="Повторить (Ctrl+Y)"><Redo2 size={17}/></button><span className="canvas-tool-divider"/><button onClick={() => flow.current?.fitView({ padding: .16, duration: 300 })} title="Уместить схему"><Maximize2 size={16}/><span>Уместить</span></button><button onClick={() => flow.current?.zoomOut({ duration: 180 })} title="Уменьшить"><ZoomOut size={17}/></button><button onClick={() => flow.current?.zoomIn({ duration: 180 })} title="Увеличить"><ZoomIn size={17}/></button><button className="canvas-add-button" onClick={() => openCreate('action')}><Plus size={16}/> Добавить</button></div></div>
      {notice && <div className="canvas-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Закрыть"><X size={14}/></button></div>}
      <div className="canvas-flow" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const kind = event.dataTransfer.getData('application/x-canvas-kind') as PaletteKind; if (!KIND_LABEL[kind] || kind === 'edge') return; const point = flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }); if (point) addAt(kind, Math.round(point.x), Math.round(point.y)); }}>
        <SmartEdgeProvider nodes={routingNodes} options={routingOptions}><ReactFlow nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={(changes: NodeChange[]) => setFlowNodes(items => applyNodeChanges(changes, items))} onNodeDragStop={onDragStop} onNodeClick={onNodeClick} onEdgeClick={(_event, edge) => { setSelection({ nodes: [], edges: [edge.id] }); openEditor(edge.id); }} onPaneClick={() => setSelection({ nodes: [], edges: [] })} onConnect={onConnect} onSelectionChange={({ nodes, edges }) => { const nextNodes = nodes.map(item => item.id); const nextEdges = edges.map(item => item.id); if (!nextNodes.length && !nextEdges.length) return; setSelection(previous => previous.nodes.join("|") === nextNodes.join("|") && previous.edges.join("|") === nextEdges.join("|") ? previous : { nodes: nextNodes, edges: nextEdges }); }} onInit={instance => { flow.current = instance; }} onMoveEnd={(_event, viewport) => { const d = current.current; if (Math.abs(d.canvas.viewport.x - viewport.x) < 1 && Math.abs(d.canvas.viewport.y - viewport.y) < 1 && Math.abs(d.canvas.viewport.zoom - viewport.zoom) < .001) return; publish({ ...d, canvas: { ...d.canvas, viewport, updatedAt: NOW() } }, false); }} defaultViewport={data.canvas.viewport} minZoom={.05} maxZoom={4} zoomOnScroll={false} panOnScroll={false} panOnDrag selectionOnDrag={false} zoomOnDoubleClick={false} multiSelectionKeyCode={['Control','Meta','Shift']} deleteKeyCode={null} fitView={false} proOptions={{ hideAttribution: true }}><Background color="#dce3ee" gap={22} size={1}/><MiniMap pannable zoomable className="canvas-minimap" nodeColor={node => node.type === 'zone' ? '#dce7f9' : '#8da5d6'}/><Controls showZoom={false} showFitView={false} showInteractive={false}/></ReactFlow></SmartEdgeProvider>
        {!data.canvasNodes.length && !data.canvasZones.length && <div className="canvas-empty"><div className="canvas-empty-mark">◇</div><h2>Начните с одной мысли</h2><p>Добавьте зону или карточку, затем соедините шаги и участников.</p><div><button onClick={() => openCreate('zone')}>Добавить зону</button><button className="secondary" onClick={makeDemo}>Создать пример</button></div></div>}
      </div>
      {(selection.nodes.length || selection.edges.length) > 0 && <div className="canvas-selection-bar"><strong>Выбрано: {selection.nodes.length + selection.edges.length}</strong>{selected && <button onClick={() => openEditor(selected.id)}>Редактировать</button>}<button onClick={() => duplicate(selection.nodes)} disabled={!selection.nodes.length}><Copy size={14}/> Копировать</button><button onClick={requestDelete}><Trash2 size={14}/> Удалить</button></div>}
    </section>
    {editDraft && <DraggableDialog title={editDraft.kind === 'edge' ? 'Редактировать связь' : editDraft.kind === 'zone' ? 'Редактировать зону' : 'Редактировать элемент схемы'} onClose={() => setEditDraft(null)} className="canvas-edit-window">
      <div className="canvas-create-form">
        {editDraft.kind === 'edge' ? <><label>Подпись<input autoFocus maxLength={100} value={editDraft.label} onChange={event => setEditDraft({ ...editDraft, label: event.target.value })} placeholder="Например, согласует"/></label><label>Направление<select value={editDraft.arrow} onChange={event => setEditDraft({ ...editDraft, arrow: event.target.value as CEdge['arrow'] })}><option value="forward">От источника к цели →</option><option value="reverse">К источнику ←</option><option value="none">Без стрелки —</option></select></label></> : <><label>Название<input autoFocus maxLength={160} value={editDraft.name} onChange={event => { setEditDraft({ ...editDraft, name: event.target.value }); setEditError(''); }} onKeyDown={event => { if (event.key === 'Enter') saveEdit(); }}/></label>{editDraft.kind === 'node' && <label>Пояснение<textarea rows={4} maxLength={1000} value={editDraft.description} onChange={event => setEditDraft({ ...editDraft, description: event.target.value })} placeholder="Необязательно"/></label>}<div className="canvas-create-color-label">Цвет</div><div className="canvas-create-colors">{COLORS.map(color => <button type="button" key={color} style={{ background: color }} className={editDraft.color === color ? 'active' : ''} aria-label={`Цвет ${color}`} onClick={() => setEditDraft({ ...editDraft, color })}/>)}</div></>}
        {editError && <p className="canvas-create-error" role="alert">{editError}</p>}
        <div className="canvas-create-actions"><button type="button" onClick={() => setEditDraft(null)}>Отмена</button><button type="button" className="canvas-create-save" onClick={saveEdit}>Сохранить</button></div>
      </div>
    </DraggableDialog>}
    {createDraft && <DraggableDialog title="Добавить элемент схемы" onClose={() => setCreateDraft(null)} className="canvas-create-window">
      <div className="canvas-create-form">
        <label>Тип элемента<select value={createDraft.kind} onChange={event => { const kind = event.target.value as CreateKind; setCreateDraft({ kind, name: kind === 'zone' ? 'Новая зона' : DEFAULT_NAME[kind], description: '', color: kind === 'zone' ? COLORS[data.canvasZones.length % COLORS.length] : KIND_COLOR[kind] }); }}>{(['zone','action','actor','project','direction','note'] as CreateKind[]).map(kind => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}</select></label>
        <label>Название<input autoFocus maxLength={160} value={createDraft.name} onChange={event => { setCreateDraft({ ...createDraft, name: event.target.value }); setCreateError(''); }} onKeyDown={event => { if (event.key === 'Enter') saveCreate(); }}/></label>
        {createError && <p className="canvas-create-error" role="alert">{createError}</p>}
        {createDraft.kind !== 'zone' && <label>Пояснение<textarea rows={3} maxLength={1000} value={createDraft.description} onChange={event => setCreateDraft({ ...createDraft, description: event.target.value })} placeholder="Необязательно"/></label>}
        <div className="canvas-create-color-label">Цвет</div><div className="canvas-create-colors">{COLORS.map(color => <button type="button" key={color} style={{ background: color }} className={createDraft.color === color ? 'active' : ''} aria-label={`Цвет ${color}`} onClick={() => setCreateDraft({ ...createDraft, color })}/>)}</div>
        <div className="canvas-create-actions"><button type="button" onClick={() => setCreateDraft(null)}>Отмена</button><button type="button" className="canvas-create-save" onClick={saveCreate}>Добавить на схему</button></div>
      </div>
    </DraggableDialog>}
    {showDeleteDialog && <div className="canvas-modal-backdrop"><div className="canvas-modal" role="dialog" aria-modal="true" aria-labelledby="canvas-delete-title"><h2 id="canvas-delete-title">Удалить выбранное?</h2><p>{linkedEdgeCount ? `Вместе с карточками будут удалены связи: ${linkedEdgeCount}. ` : ''}{containedCount ? `В выбранных зонах находятся карточки: ${containedCount}.` : ''}</p><div className="canvas-modal-actions"><button onClick={() => setConfirmDelete(false)}>Отмена</button>{selectedZoneCount > 0 && containedCount > 0 && <button onClick={() => performDelete('keep')}>Оставить карточки</button>}<button className="danger" onClick={() => performDelete('remove')}>{containedCount > 0 ? 'Удалить с содержимым' : 'Удалить'}</button></div></div></div>}
  </div>;
}









