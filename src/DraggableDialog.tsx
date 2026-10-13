import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import './DraggableDialog.css';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function DraggableDialog({ title, onClose, children, className = '' }: Props) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    const dx = event.clientX - drag.current.pointerX;
    const dy = event.clientY - drag.current.pointerY;
    const baseLeft = rect.left - offset.x;
    const baseRight = rect.right - offset.x;
    const baseTop = rect.top - offset.y;
    const x = Math.max(24 - baseLeft, Math.min(drag.current.x + dx, window.innerWidth - 24 - baseRight));
    const y = Math.max(-baseTop, Math.min(drag.current.y + dy, window.innerHeight - 42 - baseTop));
    setOffset({ x, y });
  }

  return <div className="draggable-dialog-layer">
    <div ref={panel} className={`draggable-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}>
      <div className="draggable-dialog-bar" onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; drag.current = { pointerX: event.clientX, pointerY: event.clientY, ...offset }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}>
        <span className="draggable-dialog-grip" aria-hidden="true">⋮⋮</span><strong>{title}</strong><button type="button" onClick={onClose} aria-label="Закрыть окно">×</button>
      </div>
      <div className="draggable-dialog-content">{children}</div>
    </div>
  </div>;
}
