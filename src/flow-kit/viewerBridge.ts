/** Added only to the iframe preview; the imported HTML remains byte-for-byte unchanged. */
export const viewerBridge = String.raw`<script>
(() => {
  const MIN = 0.3, MAX = 3;
  const board = document.querySelector('.board');
  const flow = board?.querySelector('.flow');
  const scroller = board?.querySelector('.scroller');
  if (!flow || !scroller) return;

  const current = () => Number.parseFloat(flow.style.zoom) || 1;
  const report = () => window.parent.postMessage({ type: 'flowkit:zoom', value: current() }, '*');
  const setZoom = (requested, x = scroller.clientWidth / 2, y = scroller.clientHeight / 2) => {
    const previous = current();
    const next = Math.max(MIN, Math.min(MAX, requested));
    const contentX = (scroller.scrollLeft + x) / previous;
    const contentY = (scroller.scrollTop + y) / previous;
    flow.style.zoom = String(next);
    flow.style.setProperty('--z', String(next));
    scroller.scrollLeft = contentX * next - x;
    scroller.scrollTop = contentY * next - y;
    board.querySelectorAll('.zoom button').forEach(button => button.setAttribute('aria-pressed', 'false'));
    window.dispatchEvent(new Event('resize'));
    report();
  };

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'flowkit:viewer') return;
    if (event.data.action === 'report') report();
    if (event.data.action === 'step') setZoom(current() * (event.data.direction > 0 ? 1.2 : 1 / 1.2));
    if (event.data.action === 'reset') setZoom(1);
    if (event.data.action === 'fit') {
      const fit = Math.min(1, scroller.clientWidth / flow.offsetWidth, scroller.clientHeight / flow.offsetHeight);
      setZoom(fit, 0, 0);
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
    }
  });

  scroller.addEventListener('wheel', event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const bounds = scroller.getBoundingClientRect();
    setZoom(current() * Math.exp(-event.deltaY * 0.002), event.clientX - bounds.left, event.clientY - bounds.top);
  }, { capture: true, passive: false });

  let drag = null;
  scroller.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target !== scroller && event.target !== flow)) return;
    drag = { x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.setPointerCapture(event.pointerId);
    scroller.style.cursor = 'grabbing';
  });
  scroller.addEventListener('pointermove', event => {
    if (!drag) return;
    scroller.scrollLeft = drag.left + drag.x - event.clientX;
    scroller.scrollTop = drag.top + drag.y - event.clientY;
  });
  const stopDrag = () => { drag = null; scroller.style.cursor = ''; };
  scroller.addEventListener('pointerup', stopDrag);
  scroller.addEventListener('pointercancel', stopDrag);

  board.querySelectorAll('.zoom button').forEach(button => button.addEventListener('click', () => setTimeout(report, 0)));
  report();
})();
</script>`;
