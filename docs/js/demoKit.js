/**
 * The small kit every per-entry demo is built from: controls that a reader moves, and views
 * that show what the engine function returned. A demo declares `{ controls, run }`; `run`
 * receives the control values, calls the engine, and returns the views to show. Nothing here
 * knows any particular function.
 */

import { escapeHtml } from './escapeHtml.js';

/** A number the reader drags. `step` defaults to a hundredth of the range. */
export function slider(name, label, min, max, value, step) {
  return { kind: 'slider', name, label, min, max, value, step: step ?? (max - min) / 100 };
}

/** A choice among fixed values. */
export function choice(name, label, options, value) {
  return { kind: 'choice', name, label, options, value: value ?? options[0].value };
}

/** A 4×4 column-major matrix, shown row by row as the maths writes it. */
export function matrixView(title, m, note) {
  return { kind: 'matrix', title, values: Array.from(m), note };
}

/** Named scalars or short vectors. */
export function valueView(title, rows) {
  return { kind: 'values', title, rows };
}

/** A verdict: what the function decided, and why it matters. */
export function verdictView(title, ok, text) {
  return { kind: 'verdict', title, ok, text };
}

/** Colour swatches, each with the numbers behind it. */
export function swatchView(title, swatches) {
  return { kind: 'swatch', title, swatches };
}

/** A drawing the demo paints itself: `paint(context, width, height)`. */
export function canvasView(title, paint, height = 260) {
  return { kind: 'canvas', title, paint, height };
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const absolute = Math.abs(value);
  if (absolute >= 1e6 || absolute < 1e-4) return value.toExponential(2);
  return value.toFixed(absolute >= 100 ? 1 : 4).replace(/\.?0+$/, '');
}

function controlHtml(control) {
  if (control.kind === 'choice') {
    const options = control.options
      .map(
        (option) =>
          `<option value="${escapeHtml(option.value)}"${option.value === control.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
      )
      .join('');
    return `<label class="flex items-center gap-2 text-sm">
        <span class="opacity-70">${escapeHtml(control.label)}</span>
        <select class="select select-bordered select-sm" data-control="${control.name}">${options}</select>
      </label>`;
  }
  return `<label class="flex items-center gap-2 text-sm">
      <span class="opacity-70">${escapeHtml(control.label)}</span>
      <input type="range" class="range range-xs range-primary w-32" data-control="${control.name}"
        min="${control.min}" max="${control.max}" step="${control.step}" value="${control.value}" />
      <output class="font-mono text-xs w-14 text-right" data-output="${control.name}"></output>
    </label>`;
}

function matrixHtml(view) {
  const cells = [];
  for (let row = 0; row < 4; row++) {
    const line = [];
    for (let column = 0; column < 4; column++)
      line.push(
        `<td class="font-mono text-xs px-2 py-1 text-right">${escapeHtml(formatNumber(view.values[column * 4 + row]))}</td>`,
      );
    cells.push(`<tr>${line.join('')}</tr>`);
  }
  return `<table class="table table-xs w-auto border border-base-300 rounded-box"><tbody>${cells.join('')}</tbody></table>
    ${view.note ? `<p class="text-xs opacity-60 mt-1">${escapeHtml(view.note)}</p>` : ''}`;
}

function viewHtml(view, index) {
  const body =
    view.kind === 'matrix'
      ? matrixHtml(view)
      : view.kind === 'values'
        ? `<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">${view.rows
            .map(
              (row) =>
                `<dt class="font-mono text-xs opacity-70">${escapeHtml(row[0])}</dt><dd class="font-mono text-xs">${escapeHtml(row[1])}</dd>`,
            )
            .join('')}</dl>`
        : view.kind === 'verdict'
          ? `<div class="badge ${view.ok ? 'badge-success' : 'badge-error'} badge-sm">${view.ok ? 'kept' : 'rejected'}</div>
             <span class="text-sm ml-2">${escapeHtml(view.text)}</span>`
          : view.kind === 'swatch'
            ? `<div class="flex flex-wrap gap-3">${view.swatches
                .map(
                  (swatch) =>
                    `<div class="text-xs"><div class="w-24 h-12 rounded-box border border-base-300" style="background:${escapeHtml(swatch.css)}"></div>
                     <div class="font-mono mt-1 opacity-70">${escapeHtml(swatch.label)}</div></div>`,
                )
                .join('')}</div>`
            : `<canvas data-canvas="${index}" class="w-full rounded-box border border-base-300 bg-base-200" style="height:${view.height}px"></canvas>`;
  return `<div class="mt-3">
      ${view.title ? `<div class="text-xs uppercase font-bold opacity-60 mb-1">${escapeHtml(view.title)}</div>` : ''}
      ${body}
    </div>`;
}

/**
 * Mounts a demo inside `host`: the controls, then the views its `run` returns, recomputed on
 * every move. Returns nothing to dispose — the demo holds no timer and no GPU resource.
 */
export function mountDemo(host, demo) {
  const controls = demo.controls ?? [];
  host.innerHTML = `
    ${controls.length ? `<div class="flex flex-wrap items-center gap-4 mb-2">${controls.map(controlHtml).join('')}</div>` : ''}
    <div data-views></div>`;
  const views = host.querySelector('[data-views]');
  const inputs = [...host.querySelectorAll('[data-control]')];

  const read = () => {
    const state = {};
    for (const input of inputs)
      state[input.dataset.control] = input.type === 'range' ? Number(input.value) : input.value;
    return state;
  };

  const update = () => {
    const state = read();
    for (const input of inputs) {
      const output = host.querySelector(`[data-output="${input.dataset.control}"]`);
      if (output) output.textContent = formatNumber(Number(input.value));
    }
    const produced = demo.run(state) ?? [];
    views.innerHTML = produced.map(viewHtml).join('');
    produced.forEach((view, index) => {
      if (view.kind !== 'canvas') return;
      const canvas = views.querySelector(`[data-canvas="${index}"]`);
      canvas.width = canvas.clientWidth;
      canvas.height = view.height;
      view.paint(canvas.getContext('2d'), canvas.width, canvas.height);
    });
  };

  for (const input of inputs) input.addEventListener('input', update);
  update();
}
