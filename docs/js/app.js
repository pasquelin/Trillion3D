/**
 * Documentation portal router and application controller.
 */
import { MENU_SECTIONS } from './menuData.js';
import { GUIDES_CONTENT } from './docsContentGuides.js';
import { ENUMS_CONTENT } from './docsContentEnums.js';
import { VECTOR_CONTENT } from './docsContentMathVector.js';
import { MATRIX_CONTENT } from './docsContentMathMatrix.js';
import { CAMERA_COLOR_CONTENT } from './docsContentMathCameraColor.js';
import { BATCH_LIFECYCLE_CONTENT } from './docsContentBatch.js';
import { renderDemoShell, renderEntryHtml } from './viewRenderer.js';
import { initWebGpuDemo, setDemoFov } from './demoWebgpu.js';

const ALL_ENTRIES = {
  ...GUIDES_CONTENT,
  ...ENUMS_CONTENT,
  ...VECTOR_CONTENT,
  ...MATRIX_CONTENT,
  ...CAMERA_COLOR_CONTENT,
  ...BATCH_LIFECYCLE_CONTENT,
};

let currentFilter = '';

function initApp() {
  renderSidebar();
  setupSearch();
  setupTheme();
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function renderSidebar() {
  const menuEl = document.getElementById('sidebar-menu');
  if (!menuEl) return;
  const q = currentFilter.toLowerCase().trim();

  let html = '';
  for (const sec of MENU_SECTIONS) {
    const items = sec.items.filter(
      (it) =>
        !q ||
        it.title.toLowerCase().includes(q) ||
        (ALL_ENTRIES[it.id]?.description || '').toLowerCase().includes(q),
    );
    if (items.length === 0) continue;

    html += `
      <li class="menu-title text-xs uppercase tracking-wider text-base-content/60 mt-3 first:mt-0 font-bold">${sec.title}</li>
      ${items
        .map(
          (it) => `
        <li>
          <a href="#${sec.id}/${it.id}" id="nav-${it.id}" class="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg hover:bg-base-200">
            <span class="truncate font-mono">${it.title}</span>
            ${it.tag ? `<span class="badge badge-xs ${it.tag === 'Enum' ? 'badge-primary' : it.tag === 'Guide' ? 'badge-info' : 'badge-ghost'}">${it.tag}</span>` : ''}
          </a>
        </li>
      `,
        )
        .join('')}
    `;
  }
  menuEl.innerHTML = html;
  highlightActiveNav();
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || 'guides/quick-start';
  const parts = hash.split('/');
  const entryId = parts.length > 1 ? parts[1] : parts[0];
  const contentEl = document.getElementById('main-content');
  if (!contentEl) return;

  highlightActiveNav();

  if (entryId === 'webgpu-demo') {
    contentEl.innerHTML = renderDemoShell();
    const canvas = document.getElementById('demo-canvas');
    const statsEl = document.getElementById('demo-stats');
    const modeSelect = document.getElementById('demo-shading-mode');
    const fovRange = document.getElementById('demo-fov-range');
    const fovVal = document.getElementById('demo-fov-val');

    if (fovRange) {
      fovRange.oninput = (e) => {
        const val = Number(e.target.value);
        if (fovVal) fovVal.textContent = `${val}°`;
        setDemoFov(val);
      };
    }
    initWebGpuDemo(canvas, statsEl, () => modeSelect?.value || 'clusters');
    return;
  }

  const entry = ALL_ENTRIES[entryId] || {
    title: entryId,
    category: 'Documentation',
    html: '<p class="text-base-content/70">Documentation for this entry is being compiled.</p>',
  };

  contentEl.innerHTML = renderEntryHtml(entry);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function highlightActiveNav() {
  const hash = window.location.hash.slice(1) || 'guides/quick-start';
  const parts = hash.split('/');
  const entryId = parts.length > 1 ? parts[1] : parts[0];

  document
    .querySelectorAll('#sidebar-menu a')
    .forEach((el) => el.classList.remove('active', 'bg-primary', 'text-primary-content'));
  const activeEl = document.getElementById(`nav-${entryId}`);
  if (activeEl) {
    activeEl.classList.add('active', 'bg-primary', 'text-primary-content');
  }
}

function setupSearch() {
  const inputs = [
    document.getElementById('search-input'),
    document.getElementById('search-input-mobile'),
  ].filter(Boolean);
  for (const input of inputs) {
    input.addEventListener('input', (e) => {
      currentFilter = e.target.value;
      for (const other of inputs) if (other !== input) other.value = currentFilter;
      renderSidebar();
    });
  }
  window.addEventListener('keydown', (e) => {
    const desktopInput = document.getElementById('search-input');
    if (e.key === '/' && desktopInput && document.activeElement !== desktopInput) {
      e.preventDefault();
      desktopInput.focus();
    }
  });
}

function setupTheme() {
  const toggle = document.getElementById('theme-toggle');
  const saved =
    localStorage.getItem('wg-docs-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', saved);
  if (toggle) {
    toggle.checked = saved === 'dark';
    toggle.addEventListener('change', (e) => {
      const theme = e.target.checked ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('wg-docs-theme', theme);
    });
  }
}

document.addEventListener('DOMContentLoaded', initApp);
