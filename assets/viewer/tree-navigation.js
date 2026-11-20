// Rebind after each chart render: the library replaces its zoom canvas.
export function setupTreeNavigation(root, chart) {
  const canvas = root.querySelector('#f3Canvas');
  const zoom = canvas?.__zoomObj;
  if (!zoom) return;
  const d3 = window.d3;
  const selection = d3.select(canvas);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const duration = () => reducedMotion.matches ? 0 : 180;
  const output = document.getElementById('tree-zoom-level');
  const minus = document.getElementById('tree-zoom-out');
  const plus = document.getElementById('tree-zoom-in');
  zoom.scaleExtent([0.15, 3]).clickDistance(8).tapDistance(12);
  // A double click/tap should select a person, not also zoom the canvas.
  selection.on('dblclick.zoom', null);
  const update = () => {
    const scale = d3.zoomTransform(canvas).k;
    output.value = Math.round(scale * 100) + '%';
    minus.disabled = scale <= 0.15;
    plus.disabled = scale >= 3;
  };
  zoom.on('zoom.controls', update);
  const scaleBy = amount => {
    selection.interrupt();
    selection.transition().duration(duration()).call(zoom.scaleBy, amount);
  };
  minus.onclick = () => scaleBy(1 / 1.25);
  plus.onclick = () => scaleBy(1.25);
  document.getElementById('tree-fit').onclick = () => {
    selection.interrupt();
    chart.updateTree({ tree_position: 'fit', transition_time: duration() });
  };
  // Keep form fields usable while editing and avoid dragging via the right button.
  zoom.filter(event => !event.target.closest('input, textarea, select, button, .f3-form-cont')
    && (!event.ctrlKey || event.type === 'wheel') && !event.button);
  update();
}
