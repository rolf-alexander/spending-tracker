// Hand-drawn SVG charts (no libraries, so everything works offline).

import { esc, compact } from './util.js';

function niceStep(max, ticks) {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

// Bar with 4px rounded top corners, anchored to the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Vertical bar chart. data: [{ label, value, tip }]. Every value is reachable by tapping
// (or hovering) a bar; the tooltip text comes from `tip`.
export function barChart(container, data, { showLabel = () => true, height = 180 } = {}) {
  const width = Math.max(260, container.clientWidth || 320);
  const pad = { top: 12, right: 4, bottom: 22, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map(d => d.value), 0);
  const step = max > 0 ? niceStep(max, 3) : 10;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const slot = plotW / data.length;
  const gap = Math.min(2, slot * 0.25);
  const barW = Math.max(1, Math.min(28, slot - gap));
  const y = v => pad.top + plotH - (v / top) * plotH;

  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="tick" x="${pad.left - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }

  let bars = '';
  let labels = '';
  let hits = '';
  data.forEach((d, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const h = (d.value / top) * plotH;
    if (h > 0) bars += `<path class="bar" data-i="${i}" d="${barPath(cx - barW / 2, y(d.value), barW, Math.max(h, 1))}"/>`;
    if (showLabel(i)) labels += `<text class="tick" x="${cx}" y="${height - 6}" text-anchor="middle">${esc(d.label)}</text>`;
    hits += `<rect class="hit" data-i="${i}" x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${plotH + pad.bottom}"/>`;
  });

  container.innerHTML = `
    <div class="chart">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Bar chart">
        ${grid}${bars}${labels}${hits}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>`;

  const svg = container.querySelector('svg');
  const tip = container.querySelector('.chart-tip');
  const show = i => {
    const d = data[i];
    svg.querySelectorAll('.bar').forEach(b => b.classList.toggle('dim', Number(b.dataset.i) !== i));
    tip.innerHTML = d.tip;
    tip.hidden = false;
    const cx = ((pad.left + slot * i + slot / 2) / width) * svg.clientWidth;
    const tipW = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(0, cx - tipW / 2), svg.clientWidth - tipW)}px`;
  };
  const hide = () => {
    tip.hidden = true;
    svg.querySelectorAll('.bar').forEach(b => b.classList.remove('dim'));
  };
  svg.addEventListener('pointerover', ev => { if (ev.target.dataset.i) show(Number(ev.target.dataset.i)); });
  svg.addEventListener('pointerdown', ev => { if (ev.target.dataset.i) show(Number(ev.target.dataset.i)); });
  svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') hide(); });
}
