/**
 * View rendering utilities for API entries, enums, guides, and demo shell.
 */

export function renderEntryHtml(entry) {
  if (entry.html) {
    return `
      <div class="mb-6">
        <div class="badge badge-primary mb-2">${escapeHtml(entry.category || 'Guide')}</div>
        <h1 class="text-3xl font-bold tracking-tight">${escapeHtml(entry.title)}</h1>
        ${entry.subtitle ? `<p class="text-base-content/70 mt-1">${escapeHtml(entry.subtitle)}</p>` : ''}
      </div>
      <div class="divider"></div>
      ${entry.html}
    `;
  }

  const badgeClass =
    entry.type === 'Function'
      ? 'badge-secondary'
      : entry.type === 'Constant'
        ? 'badge-accent'
        : 'badge-primary';

  return `
    <div class="mb-6">
      <div class="flex items-center gap-2 mb-2">
        <span class="badge ${badgeClass}">${escapeHtml(entry.type || 'API')}</span>
        <span class="badge badge-outline">${escapeHtml(entry.category || 'General')}</span>
      </div>
      <h1 class="text-3xl font-mono font-bold tracking-tight">${escapeHtml(entry.title)}</h1>
      ${entry.description ? `<p class="text-base-content/80 mt-2 text-lg">${escapeHtml(entry.description)}</p>` : ''}
    </div>

    ${
      entry.signature
        ? `
      <div class="card bg-base-200 border border-base-300 shadow-sm mb-6">
        <div class="card-body p-4">
          <div class="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-1">Signature</div>
          <pre class="font-mono text-sm overflow-x-auto text-primary">${escapeHtml(entry.signature)}</pre>
        </div>
      </div>
    `
        : ''
    }

    ${
      entry.values && entry.values.length
        ? `
      <div class="mb-6">
        <h3 class="text-xl font-bold mb-3">Allowed Values / Layout</h3>
        <div class="overflow-x-auto border border-base-300 rounded-lg">
          <table class="table table-zebra w-full text-sm">
            <thead><tr><th>Value / Key</th><th>Description</th></tr></thead>
            <tbody>
              ${entry.values
                .map(
                  (v) => `
                <tr><td class="font-mono font-semibold text-secondary">${escapeHtml(v.name)}</td><td>${escapeHtml(v.desc)}</td></tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
        : ''
    }

    ${
      entry.params && entry.params.length
        ? `
      <div class="mb-6">
        <h3 class="text-xl font-bold mb-3">Parameters</h3>
        <div class="overflow-x-auto border border-base-300 rounded-lg">
          <table class="table table-zebra w-full text-sm">
            <thead><tr><th>Name</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>
              ${entry.params
                .map(
                  (p) => `
                <tr><td class="font-mono font-bold">${escapeHtml(p.name)}</td><td class="font-mono text-secondary">${escapeHtml(p.type)}</td><td>${escapeHtml(p.desc)}</td></tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
        : ''
    }

    ${
      entry.example
        ? `
      <div class="mb-6">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-xl font-bold">Usage Example</h3>
          <button class="btn btn-xs btn-outline" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(entry.example)}'))">Copy</button>
        </div>
        <div class="mockup-code bg-base-300 text-base-content text-sm">
          ${entry.example
            .split('\n')
            .map(
              (line, idx) => `<pre data-prefix="${idx + 1}"><code>${escapeHtml(line)}</code></pre>`,
            )
            .join('')}
        </div>
      </div>
    `
        : ''
    }

    ${
      entry.replaces || entry.proof
        ? `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
        ${
          entry.replaces
            ? `
          <div class="card bg-base-200 border border-base-300">
            <div class="card-body p-4">
              <div class="text-xs uppercase font-bold text-base-content/60">Replaces Three.js</div>
              <div class="font-mono text-sm mt-1">${escapeHtml(entry.replaces)}</div>
            </div>
          </div>
        `
            : ''
        }
        ${
          entry.proof
            ? `
          <div class="card bg-base-200 border border-base-300">
            <div class="card-body p-4">
              <div class="text-xs uppercase font-bold text-base-content/60">Verification & Performance Proof</div>
              <div class="text-sm mt-1 text-success font-medium">${escapeHtml(entry.proof)}</div>
            </div>
          </div>
        `
            : ''
        }
      </div>
    `
        : ''
    }
  `;
}

export function renderDemoShell() {
  return `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="badge badge-accent mb-1">Live WebGPU Viewport</div>
        <h1 class="text-3xl font-bold">Interactive 3D Demo</h1>
        <p class="text-base-content/70">Real-time WebGPU rendering driven by SDK math matrices and reversed-Z projection.</p>
      </div>
      <div class="flex items-center gap-2">
        <select id="demo-shading-mode" class="select select-bordered select-sm">
          <option value="clusters">Cluster Colors</option>
          <option value="normals">Geometric Normals</option>
        </select>
      </div>
    </div>

    <div class="relative w-full aspect-video bg-neutral rounded-xl overflow-hidden shadow-xl border border-base-300">
      <canvas id="demo-canvas" class="w-full h-full block cursor-grab active:cursor-grabbing"></canvas>
      <div class="absolute bottom-3 left-3 bg-base-300/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs font-mono" id="demo-stats">
        Initializing WebGPU...
      </div>
    </div>

    <div class="mt-4 card bg-base-200 border border-base-300 p-4 text-sm flex flex-col md:flex-row items-center justify-between gap-4">
      <div class="text-base-content/80">
        <strong>Controls:</strong> Click & drag to rotate 3D mesh. Matrices computed with <code>composeMatrix4</code> and <code>perspectiveProjection</code> in <code>Float64Array</code> per frame.
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs font-mono">FOV</span>
        <input type="range" id="demo-fov-range" min="30" max="90" value="50" class="range range-xs range-primary w-32" />
        <span id="demo-fov-val" class="text-xs font-mono font-bold w-6">50°</span>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
