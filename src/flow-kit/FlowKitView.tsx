import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, Maximize2, Minus, Plus, Trash2 } from 'lucide-react';
import type { FlowKitDocument, Snapshot } from '../model';
import { viewerBridge } from './viewerBridge';
import './flow-kit.css';

type Props = { snapshot: Snapshot; onChange: (next: Snapshot) => Promise<boolean> };
const MAX_HTML_SIZE = 2_000_000;
const VIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'">`;

function getFlowTitle(html: string, filename: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  if (!parsed.querySelector('#flow.flow') || !parsed.querySelector('.board') || !Array.from(parsed.scripts).some(script => script.textContent?.includes('var FLOWS ='))) {
    throw new Error('Это не HTML-схема Flow Kit. Импортируйте файл flow.html, созданный скиллом.');
  }
  return (parsed.querySelector('.wrap > header h1')?.textContent || parsed.title || filename.replace(/\.html?$/i, '')).trim().slice(0, 200) || 'Схема Flow Kit';
}

function download(document: FlowKitDocument) {
  const url = URL.createObjectURL(new Blob([document.html], { type: 'text/html;charset=utf-8' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${document.title.replace(/[\\/:*?"<>|]/g, '_') || 'flow'}.html`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function FlowKitView({ snapshot, onChange }: Props) {
  const documents = snapshot.data.flowKitDocuments;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const selected = documents.find(item => item.id === selectedId) ?? documents.at(-1);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === 'flowkit:zoom' && typeof event.data.value === 'number') setZoom(event.data.value);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const viewerAction = (action: string, direction?: number) => frame.current?.contentWindow?.postMessage({ type: 'flowkit:viewer', action, direction }, '*');

  const importFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      if (!/\.html?$/i.test(file.name)) throw new Error('Выберите HTML-файл схемы Flow Kit.');
      if (file.size > MAX_HTML_SIZE) throw new Error('Файл слишком большой: допустимо до 2 МБ.');
      const html = await file.text();
      if (html.length > MAX_HTML_SIZE) throw new Error('Файл слишком большой: допустимо до 2 млн символов.');
      const title = getFlowTitle(html, file.name);
      const now = new Date().toISOString();
      const item: FlowKitDocument = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, title, html };
      if (await onChange({ ...snapshot, data: { ...snapshot.data, flowKitDocuments: [...documents, item] } })) setSelectedId(item.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  const remove = async (item: FlowKitDocument) => {
    if (!window.confirm(`Удалить схему «${item.title}» из рабочего пространства?`)) return;
    if (await onChange({ ...snapshot, data: { ...snapshot.data, flowKitDocuments: documents.filter(value => value.id !== item.id) } })) setSelectedId(null);
  };

  return <section className="flowkit-view">
    <aside className="flowkit-sidebar">
      <div className="flowkit-sidebar-header"><div><span className="flowkit-eyebrow">Готовые схемы</span><h1>Flow Kit</h1></div><span className="flowkit-count">{documents.length}</span></div>
      <p className="flowkit-hint">Схемы из скилла хранятся здесь в исходном HTML. Просмотр доступен без редактирования.</p>
      <button className="flowkit-import" onClick={() => input.current?.click()} disabled={busy}><FileUp size={17}/> Импортировать flow.html</button>
      <input ref={input} type="file" accept=".html,.htm,text/html" hidden onChange={event => importFile(event.target.files?.[0])}/>
      {error && <p className="flowkit-error" role="alert">{error}</p>}
      <div className="flowkit-list">{documents.map(item => <button key={item.id} className={`flowkit-list-item ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</small></button>)}</div>
    </aside>
    <div className="flowkit-main">{selected ? <><div className="flowkit-toolbar"><div><span className="flowkit-eyebrow">Просмотр схемы</span><h2>{selected.title}</h2></div><div className="flowkit-actions"><div className="flowkit-zoom" role="group" aria-label="Масштаб схемы"><button onClick={() => viewerAction('step', -1)} aria-label="Уменьшить масштаб" title="Уменьшить"><Minus size={16}/></button><button className="flowkit-zoom-value" onClick={() => viewerAction('reset')} title="Вернуть 100%">{Math.round(zoom * 100)}%</button><button onClick={() => viewerAction('step', 1)} aria-label="Увеличить масштаб" title="Увеличить"><Plus size={16}/></button><button onClick={() => viewerAction('fit')} aria-label="Показать всю схему" title="Вся схема"><Maximize2 size={16}/></button></div><button className="quiet-button" onClick={() => download(selected)}><Download size={16}/> HTML</button><button className="quiet-button" onClick={() => remove(selected)} aria-label="Удалить схему"><Trash2 size={16}/></button></div></div><iframe ref={frame} key={selected.id} title={selected.title} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={() => { setZoom(1); viewerAction('report'); }} srcDoc={VIEW_CSP + selected.html + viewerBridge}/></> : <div className="flowkit-empty"><FileUp size={34}/><h2>Здесь появятся готовые схемы</h2><p>Импортируйте <code>flow.html</code>, созданный скиллом Flow Kit.</p><button className="flowkit-import" onClick={() => input.current?.click()}>Импортировать схему</button></div>}</div>
  </section>;
}
