/** Router, sidebar and search of the documentation portal. One entry per hash route. */
import { SECTIONS, searchText } from './docsModel.js';
import { EXAMPLES, GUIDES } from './docsContentGuides.js';
import { ENUMS_IMAGE } from './docsContentEnums.js';
import { ENUMS_RUNTIME } from './docsContentEnumsRuntime.js';
import { LIFECYCLE } from './docsContentLifecycle.js';
import { CAMERA, HOST_CAMERA } from './docsContentCamera.js';
import { MATRICES } from './docsContentMatrix.js';
import { COLORS, VECTORS } from './docsContentVector.js';
import { BOUNDS } from './docsContentBounds.js';
import { BATCHES, TREE } from './docsContentTree.js';
import { escapeHtml, renderDemoShell, renderEntry } from './viewRenderer.js';
import { initWebGpuDemo, stopWebGpuDemo } from './demoWebgpu.js';
import { demoFor } from './demoRegistry.js';
import { mountDemo } from './demoKit.js';

const DEMO = {
  id: 'webgpu-demo',
  section: 'demo',
  kind: 'Demo',
  title: 'Live WebGPU viewport',
  description: 'A frame drawn by the engine kernels themselves, bundled from packages/sdk-core.',
};

const ENTRIES = new Map(
  [
    ...GUIDES,
    ...EXAMPLES,
    DEMO,
    ...ENUMS_IMAGE,
    ...ENUMS_RUNTIME,
    ...LIFECYCLE,
    ...CAMERA,
    ...HOST_CAMERA,
    ...MATRICES,
    ...VECTORS,
    ...COLORS,
    ...BOUNDS,
    ...TREE,
    ...BATCHES,
  ].map((entry) => [entry.id, entry]),
);

const HAYSTACK = new Map([...ENTRIES.values()].map((entry) => [entry.id, searchText(entry)]));
const HOME = GUIDES[0].id;
let filter = '';

function entryOf(hash) {
  const id = hash.replace(/^#/, '').split('/').pop();
  return ENTRIES.get(id) ?? ENTRIES.get(HOME);
}

function sidebarHtml(active) {
  const query = filter.trim().toLowerCase();
  const matches = [...ENTRIES.values()].filter(
    (entry) => !query || HAYSTACK.get(entry.id).includes(query),
  );
  let html = '';
  for (const section of SECTIONS) {
    const items = matches.filter((entry) => entry.section === section.id);
    if (items.length === 0) continue;
    html += `<li class="menu-title text-xs uppercase tracking-wider mt-3 first:mt-0">${escapeHtml(section.title)}</li>`;
    for (const entry of items) {
      const label = entry.title || entry.id;
      const badge = entry.issue
        ? `<span class="badge badge-warning badge-xs shrink-0">#${entry.issue}</span>`
        : '';
      html +=
        `<li><a href="#${section.id}/${entry.id}" class="flex items-center gap-2 py-1.5${entry.id === active ? ' active' : ''}">` +
        `<span class="truncate font-mono text-xs">${escapeHtml(label)}</span>${badge}</a></li>`;
    }
  }
  return html || '<li class="px-3 py-2 text-sm opacity-60">No entry matches.</li>';
}

function renderSidebar(active = entryOf(location.hash).id) {
  const menu = document.getElementById('sidebar-menu');
  if (menu) menu.innerHTML = sidebarHtml(active);
}

function startDemo() {
  const fov = document.getElementById('demo-fov');
  const fovValue = document.getElementById('demo-fov-value');
  const mode = document.getElementById('demo-mode');
  if (fov && fovValue) fov.oninput = () => (fovValue.textContent = `${fov.value}°`);
  initWebGpuDemo(document.getElementById('demo-canvas'), document.getElementById('demo-stats'), {
    fov: () => Number(fov?.value ?? 50),
    mode: () => mode?.value ?? 'faces',
  });
}

function route() {
  const entry = entryOf(location.hash);
  const main = document.getElementById('main-content');
  if (!main) return;
  stopWebGpuDemo();
  const demo = entry.id === DEMO.id ? null : demoFor(entry.id);
  main.innerHTML = entry.id === DEMO.id ? renderDemoShell() : renderEntry(entry, demo !== null);
  if (entry.id === DEMO.id) startDemo();
  const host = main.querySelector('[data-demo]');
  if (demo && host) mountDemo(host, demo);
  renderSidebar(entry.id);
  const drawer = document.getElementById('drawer-toggle');
  if (drawer) drawer.checked = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setupSearch() {
  const inputs = ['search-input', 'search-input-mobile']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  for (const input of inputs) {
    input.addEventListener('input', () => {
      filter = input.value;
      for (const other of inputs) if (other !== input) other.value = filter;
      renderSidebar();
    });
  }
  window.addEventListener('keydown', (event) => {
    const desktop = document.getElementById('search-input');
    if (event.key === '/' && desktop && document.activeElement !== desktop) {
      event.preventDefault();
      desktop.focus();
    }
  });
}

function setupTheme() {
  const toggle = document.getElementById('theme-toggle');
  let saved = null;
  try {
    saved = localStorage.getItem('wg-docs-theme');
  } catch {
    /* Private window or blocked storage: the media query decides. */
  }
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (!toggle) return;
  toggle.checked = dark;
  toggle.addEventListener('change', () => {
    const theme = toggle.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('wg-docs-theme', theme);
    } catch {
      /* Nothing to remember: the page still renders in the chosen theme. */
    }
  });
}

setupTheme();
setupSearch();
window.addEventListener('hashchange', route);
route();
