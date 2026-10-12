import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeftRight, Database, Download, FolderKanban, GitBranch, RotateCcw, Shapes, Upload, X } from 'lucide-react';
import { createBackup, getRollbackSnapshot, getSnapshotSummary, loadSnapshot, parseBackup, restoreBackup, rollbackRestore, saveSnapshot, validateSnapshot, type ImportPreview, type Snapshot } from './model';
import { ProcessView } from './process';
import { PlanView } from './plan';
import { CanvasView } from './canvas';
import './style.css';

type Page = 'process' | 'plan' | 'canvas';

function downloadBlob(name: string, value: Blob) {
  const url = URL.createObjectURL(value);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const summaryLabels: Record<string, string> = {
  groups: 'Группы', processes: 'Процессы', actors: 'Участники',
  projects: 'Проекты', deliveries: 'Поставки', weekBlocks: 'Недельные блоки',
  canvasZones: 'Зоны схемы', canvasNodes: 'Карточки схемы', canvasEdges: 'Связи схемы',
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Summary({ title, snapshot }: { title: string; snapshot: Snapshot }) {
  const summary = getSnapshotSummary(snapshot);
  const counts = Object.entries(summary).filter(([, value]) => typeof value === 'number');
  return <div className="restore-summary"><strong>{title}</strong><span>{snapshot.workspace.name}</span><div>{counts.map(([key, value]) => <small key={key}>{summaryLabels[key] ?? key}: {String(value)}</small>)}</div></div>;
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>('process');
  const [target, setTarget] = useState<string>();
  const [dataOpen, setDataOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { loadSnapshot().then(setSnapshot).then(() => getRollbackSnapshot().then(value => setRollbackAvailable(Boolean(value)))).catch(error => setMessage(`Не удалось открыть данные: ${errorText(error)}`)); }, []);

  const change = (next: Snapshot): Promise<boolean> => {
    try { validateSnapshot(next); }
    catch (error) { setMessage(`Изменение не сохранено: ${errorText(error)}`); return Promise.resolve(false); }
    setSnapshot(next);
    saving.current = saving.current.catch(() => undefined).then(() => saveSnapshot(next));
    return saving.current.then(() => true, error => {
      setMessage(`Не удалось сохранить изменения: ${errorText(error)}`);
      return false;
    });
  };

  const backup = async () => {
    setBusy(true);
    try {
      await saving.current;
      const result = await createBackup();
      downloadBlob(result.filename, new Blob([result.json], { type: 'application/json;charset=utf-8' }));
      setMessage(`Создана копия ${result.filename} · ${new Date(result.backup.exportedAt).toLocaleString('ru-RU')}`);
      setDataOpen(false);
    } catch (error) { setMessage(`Копия не создана: ${errorText(error)}`); }
    finally { setBusy(false); }
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try { await saving.current; setPreview(await parseBackup(await file.text())); setDataOpen(false); }
    catch (error) { setMessage(`Файл отклонён: ${errorText(error)}`); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const restore = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await saving.current;
      const result = await restoreBackup(preview.backup);
      setSnapshot(result);
      setRollbackAvailable(true);
      setPreview(null);
      setMessage('Рабочее пространство восстановлено. Предыдущее состояние можно вернуть через меню «Данные».');
    } catch (error) { setMessage(`Восстановление не выполнено: ${errorText(error)}`); }
    finally { setBusy(false); }
  };

  const rollback = async () => {
    setBusy(true);
    try { await saving.current; setSnapshot(await rollbackRestore()); setRollbackAvailable(false); setDataOpen(false); setMessage('Состояние до восстановления возвращено.'); }
    catch (error) { setMessage(`Не удалось вернуть состояние: ${errorText(error)}`); }
    finally { setBusy(false); }
  };

  if (!snapshot) return <div className="loading"><div className="loading-mark">◇</div><strong>Конструктор процессов и планов</strong><span>{message || 'Открываем рабочее пространство…'}</span></div>;

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-symbol"><ArrowLeftRight size={18} /></span><div><strong>{snapshot.workspace.name}</strong><small>Конструктор процессов и планов</small></div></div>
      <nav className="main-nav" aria-label="Разделы"><button className={page === 'process' ? 'active' : ''} onClick={() => { setPage('process'); setTarget(undefined); }}><GitBranch size={16}/>Карта процессов</button><button className={page === 'plan' ? 'active' : ''} onClick={() => { setPage('plan'); setTarget(undefined); }}><FolderKanban size={16}/>План проектов</button><button className={page === 'canvas' ? 'active' : ''} onClick={() => { setPage('canvas'); setTarget(undefined); }}><Shapes size={16}/>Схема</button></nav>
      <div className="header-actions"><div className="data-menu"><button className="quiet-button" aria-expanded={dataOpen} onClick={() => setDataOpen(value => !value)}><Database size={16}/> Данные</button>{dataOpen && <div className="menu-popover"><button onClick={backup} disabled={busy}><Download size={15}/> Скачать JSON-копию</button><button onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={15}/> Восстановить из JSON</button>{rollbackAvailable && <button onClick={rollback} disabled={busy}><RotateCcw size={15}/> Вернуть состояние до восстановления</button>}</div>}</div><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => readFile(event.target.files?.[0])}/></div>
    </header>
    {message && <div role="status" className="global-message"><span>{message}</span><button aria-label="Закрыть сообщение" onClick={() => setMessage('')}><X size={15}/></button></div>}
    <main className="app-main">{page === 'process' ? <ProcessView snapshot={snapshot} onChange={change} onNavigateToPlan={(id) => {setPage('plan'); setTarget(id);}} initialSelection={target}/> : page === 'plan' ? <PlanView snapshot={snapshot} onChange={change} onNavigateToProcess={(id) => {setPage('process'); setTarget(id);}} initialSelection={target}/> : <CanvasView snapshot={snapshot} onChange={change}/>}</main>
    {preview && <div className="modal-backdrop" role="presentation"><div className="restore-modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><div className="modal-heading"><div><small>Проверка файла</small><h2 id="restore-title">Восстановить пространство?</h2></div><button aria-label="Закрыть" onClick={() => setPreview(null)}><X size={18}/></button></div><p className="warning-text">Копия полностью заменит данные карты процессов, плана проектов и схемы. Объединения данных нет.</p><p className="muted">Копия создана: {new Date(preview.backup.exportedAt).toLocaleString('ru-RU')}</p><div className="restore-columns"><Summary title="Из файла" snapshot={{workspace: preview.backup.workspace, data: preview.backup.data}}/><Summary title="Сейчас" snapshot={snapshot}/></div><div className="modal-actions"><button className="quiet-button" onClick={backup}><Download size={15}/> Сначала скачать текущую копию</button><button className="quiet-button" onClick={() => setPreview(null)}>Отмена</button><button className="danger-button" disabled={busy} onClick={restore}>Заменить рабочее пространство</button></div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
