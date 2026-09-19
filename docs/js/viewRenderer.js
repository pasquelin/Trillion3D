/** Renders one entry, and the shell of the live demo. Everything an entry carries is escaped. */
import { ISSUES, issueUrl, REPOSITORY } from './docsModel.js';

const KIND_BADGE = {
  Function: 'badge-secondary',
  Constant: 'badge-accent',
  Type: 'badge-primary',
  Guide: 'badge-info',
  Example: 'badge-info',
};

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `code` spans and **bold** in a description, on escaped text: no other markup is honoured. */
export function inlineMarkup(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function header(entry) {
  const badge = KIND_BADGE[entry.kind] ?? 'badge-ghost';
  const module = entry.module
    ? `<a class="link link-hover font-mono text-xs opacity-70" href="${REPOSITORY}/blob/develop/${escapeHtml(entry.module)}">${escapeHtml(entry.module)}</a>`
    : '';
  return `<div class="mb-4 flex flex-wrap items-center gap-2">
      <span class="badge ${badge}">${escapeHtml(entry.kind)}</span>${module}
    </div>
    <h1 class="text-3xl font-bold tracking-tight font-mono break-words">${escapeHtml(entry.title || entry.id)}</h1>
    ${entry.description ? `<p class="mt-3 text-base-content/80 leading-relaxed">${inlineMarkup(entry.description)}</p>` : ''}`;
}

function inDevelopment(entry) {
  if (!entry.issue) return '';
  const what = ISSUES[entry.issue] ?? 'open issue';
  return `<div role="alert" class="alert alert-warning my-4">
      <span><strong>In development.</strong> This is not on <code>develop</code> yet — it is carried by
      <a class="link" href="${issueUrl(entry.issue)}">issue #${entry.issue}</a>: ${escapeHtml(what)}.
      The signature below is the one that issue commits to.</span>
    </div>`;
}

function block(title, body) {
  return `<h2 class="text-lg font-bold mt-8 mb-2">${title}</h2>${body}`;
}

function signature(entry) {
  if (!entry.signature) return '';
  return block(
    'Signature',
    `<pre class="bg-base-200 border border-base-300 rounded-box p-4 overflow-x-auto"><code class="font-mono text-sm text-primary">${escapeHtml(entry.signature)}</code></pre>`,
  );
}

function values(entry) {
  if (!entry.values?.length) return '';
  const rows = entry.values
    .map(
      (value) =>
        `<tr><td class="font-mono font-semibold whitespace-nowrap align-top">${escapeHtml(value.name)}</td><td>${inlineMarkup(value.desc)}</td></tr>`,
    )
    .join('');
  return block(
    entry.valuesTitle ?? (entry.kind === 'Type' ? 'Values' : 'Arguments'),
    `<div class="overflow-x-auto border border-base-300 rounded-box"><table class="table table-zebra table-sm"><tbody>${rows}</tbody></table></div>`,
  );
}

function example(entry) {
  if (!entry.example) return '';
  return block(
    'Example',
    `<pre class="bg-base-200 border border-base-300 rounded-box p-4 overflow-x-auto"><code class="font-mono text-sm">${escapeHtml(entry.example)}</code></pre>`,
  );
}

function notes(entry) {
  const cards = [
    entry.replaces && ['Replaces', escapeHtml(entry.replaces)],
    entry.proof && ['Proof', escapeHtml(entry.proof)],
  ].filter(Boolean);
  if (cards.length === 0) return '';
  return `<div class="grid gap-4 md:grid-cols-2 mt-8">${cards
    .map(
      ([title, body]) =>
        `<div class="card bg-base-200 border border-base-300"><div class="card-body p-4 gap-1">
          <div class="text-xs uppercase font-bold opacity-60">${title}</div>
          <div class="text-sm font-mono break-words">${body}</div>
        </div></div>`,
    )
    .join('')}</div>`;
}

export function renderEntry(entry) {
  return [
    header(entry),
    inDevelopment(entry),
    entry.html ? `<div class="wg-prose mt-4">${entry.html}</div>` : '',
    signature(entry),
    values(entry),
    example(entry),
    notes(entry),
  ].join('');
}

export function renderDemoShell() {
  return `<div class="mb-4">
      <span class="badge badge-accent">Live demo</span>
      <h1 class="text-3xl font-bold tracking-tight mt-2">A frame, drawn by the engine kernels</h1>
      <p class="mt-3 text-base-content/80">The matrices of this viewport come from
      <code>packages/sdk-core</code> itself — <code>composeMatrix4</code>, <code>multiplyMatrix4</code> and
      <code>perspectiveProjection</code>, bundled by <code>scripts/docs-demo-bundle.mjs</code>, in
      <code>Float64Array</code>, one call per frame, no allocation. The depth is reversed and the far
      plane infinite, as everywhere in the engine. What is drawn is a single mesh, not a streamed
      scene: this page shows the maths running, not the geometry pipeline.</p>
    </div>
    <div class="flex flex-wrap items-center gap-4 mb-3">
      <label class="flex items-center gap-2 text-sm">Shading
        <select id="demo-mode" class="select select-bordered select-sm">
          <option value="faces">Face colours</option>
          <option value="normals">Geometric normals</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-sm">Field of view
        <input type="range" id="demo-fov" min="30" max="90" value="50" class="range range-xs range-primary w-32" />
        <span id="demo-fov-value" class="font-mono text-xs w-8">50°</span>
      </label>
    </div>
    <div class="relative w-full aspect-video rounded-box overflow-hidden border border-base-300 bg-neutral">
      <canvas id="demo-canvas" class="w-full h-full block cursor-grab active:cursor-grabbing"></canvas>
      <div id="demo-stats" class="absolute bottom-3 left-3 bg-base-300/80 px-3 py-1.5 rounded-box text-xs font-mono">
        Starting WebGPU…
      </div>
    </div>
    <p class="text-sm opacity-70 mt-3">Drag to turn the mesh. The counter reports frames per second
    and the time the three kernels take per frame — a CPU figure, never added to a GPU one.</p>`;
}
