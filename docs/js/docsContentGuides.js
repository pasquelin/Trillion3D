/**
 * Guide and example document entries for the portal.
 */
export const GUIDES_CONTENT = {
  'quick-start': {
    title: 'Quick Start',
    subtitle: 'Getting up and running with the Web Geometry engine',
    category: 'Guides',
    html: `
<div class="prose max-w-none">
  <p>The Web Geometry SDK virtualizes large 3D scenes in the browser using WebGPU cluster streaming, visibility buffers, and temporal anti-aliasing.</p>
  <h3>1. Installation</h3>
  <div class="mockup-code my-4">
    <pre data-prefix="$"><code>pnpm add @web-geometry/sdk</code></pre>
  </div>
  <h3>2. Basic Integration</h3>
  <p>Import the runtime entry points from <code>@web-geometry/sdk/browser</code> and <code>@web-geometry/sdk/core</code>:</p>
  <div class="mockup-code my-4">
    <pre data-prefix="1"><code>import { createExplorer, prepare } from '@web-geometry/sdk/browser';</code></pre>
    <pre data-prefix="2"><code>import { createEngineCamera, writeEngineCamera } from '@web-geometry/sdk/core';</code></pre>
    <pre data-prefix="3"><code></code></pre>
    <pre data-prefix="4"><code>// 1. Prepare scene assets from compiled cluster cache</code></pre>
    <pre data-prefix="5"><code>const scene = await prepare({ assetUrl: '/assets/city.manifest.bin' });</code></pre>
    <pre data-prefix="6"><code></code></pre>
    <pre data-prefix="7"><code>// 2. Attach explorer runtime to canvas element</code></pre>
    <pre data-prefix="8"><code>const canvas = document.getElementById('viewport');</code></pre>
    <pre data-prefix="9"><code>const explorer = await createExplorer({ canvas, scene });</code></pre>
    <pre data-prefix="10"><code></code></pre>
    <pre data-prefix="11"><code>// 3. Render loop driven by requestAnimationFrame</code></pre>
    <pre data-prefix="12"><code>function frame() {</code></pre>
    <pre data-prefix="13"><code>  explorer.render();</code></pre>
    <pre data-prefix="14"><code>  requestAnimationFrame(frame);</code></pre>
    <pre data-prefix="15"><code>}</code></pre>
    <pre data-prefix="16"><code>frame();</code></pre>
  </div>
</div>`,
  },
  architecture: {
    title: 'Architecture & Rules',
    subtitle: 'Core design principles and engine boundaries',
    category: 'Guides',
    html: `
<div class="prose max-w-none">
  <p>The engine is built around strict invariants defined in <code>AGENTS.md</code>:</p>
  <ul>
    <li><strong>Output first, allocation never:</strong> Math functions take an <code>out</code> buffer and return it. Zero heap allocation per frame.</li>
    <li><strong>Float64Array for calculation:</strong> Computations execute in double precision to avoid compound rounding errors, then convert to GPU single precision only upon upload.</li>
    <li><strong>Cluster streaming:</strong> Geometry is packaged in 128-triangle clusters and grouped into 128 KB pages for on-demand GPU resident streaming.</li>
    <li><strong>Reversed infinite depth:</strong> Perspective projections map the near plane to 1.0 and infinity to 0.0 for optimal floating-point depth buffer precision.</li>
  </ul>
</div>`,
  },
  'three-migration': {
    title: 'Three.js Migration Guide',
    subtitle: 'Mapping Three.js functions to engine equivalents (Issue #59)',
    category: 'Guides',
    html: `
<div class="prose max-w-none">
  <p>The engine decouples runtime math and host primitives from Three.js across 77 inventoried functions:</p>
  <div class="overflow-x-auto my-4">
    <table class="table table-zebra w-full text-sm">
      <thead><tr><th>Three.js Function</th><th>Engine Equivalent</th><th>Difference / Notes</th></tr></thead>
      <tbody>
        <tr><td><code>Matrix4.multiplyMatrices(a, b)</code></td><td><code>multiplyMatrix4(out, a, b)</code></td><td>Double precision, out first, 1.2× faster</td></tr>
        <tr><td><code>Matrix4.invert()</code></td><td><code>invertMatrix4(out, m)</code></td><td>Singular writes zeros, 1.3× faster</td></tr>
        <tr><td><code>Matrix4.identity()</code></td><td><code>IDENTITY_MATRIX4</code></td><td>Immutable Float64Array constant</td></tr>
        <tr><td><code>Vector3.dot(v)</code></td><td><code>dotVector3(a, b, aAt, bAt)</code></td><td>Indexed reads, 3.9× faster</td></tr>
        <tr><td><code>Vector3.crossVectors(a, b)</code></td><td><code>crossVector3(out, a, b)</code></td><td>Operands read before write, 5.0× faster</td></tr>
        <tr><td><code>Color.convertSRGBToLinear()</code></td><td><code>srgbToLinear(c)</code></td><td>Exact sRGB formula (gap ≤ 1e-11)</td></tr>
        <tr><td><code>PerspectiveCamera.updateProjection()</code></td><td><code>perspectiveProjection(out, ...)</code></td><td>Reversed infinite depth</td></tr>
      </tbody>
    </table>
  </div>
</div>`,
  },
  'example-scene': {
    title: 'Example: Scene Setup',
    subtitle: 'Preparing clusters and initializing the explorer backend',
    category: 'Examples',
    html: `
<div class="prose max-w-none">
  <p>Demonstrates scene preparation from pre-compiled cluster caches:</p>
  <div class="mockup-code my-4">
    <pre data-prefix="1"><code>import { prepare, createExplorer } from '@web-geometry/sdk/browser';</code></pre>
    <pre data-prefix="2"><code></code></pre>
    <pre data-prefix="3"><code>const canvas = document.querySelector('canvas');</code></pre>
    <pre data-prefix="4"><code>const scene = await prepare({</code></pre>
    <pre data-prefix="5"><code>  manifestUrl: '/assets/emerald-square.bin',</code></pre>
    <pre data-prefix="6"><code>  maxGpuMemoryBytes: 288 * 1024 * 1024,</code></pre>
    <pre data-prefix="7"><code>});</code></pre>
    <pre data-prefix="8"><code>const backend = await createExplorer({ canvas, scene });</code></pre>
  </div>
</div>`,
  },
  'example-camera': {
    title: 'Example: Camera Setup',
    subtitle: 'Creating and updating engine camera frames without allocations',
    category: 'Examples',
    html: `
<div class="prose max-w-none">
  <p>Engine cameras are pre-allocated once and updated per frame in place:</p>
  <div class="mockup-code my-4">
    <pre data-prefix="1"><code>import { createEngineCamera, writeEngineCamera } from '@web-geometry/sdk/core';</code></pre>
    <pre data-prefix="2"><code></code></pre>
    <pre data-prefix="3"><code>const camera = createEngineCamera();</code></pre>
    <pre data-prefix="4"><code>// In your game/app update loop:</code></pre>
    <pre data-prefix="5"><code>writeEngineCamera(camera, {</code></pre>
    <pre data-prefix="6"><code>  fov: 60,</code></pre>
    <pre data-prefix="7"><code>  aspect: window.innerWidth / window.innerHeight,</code></pre>
    <pre data-prefix="8"><code>  near: 0.1,</code></pre>
    <pre data-prefix="9"><code>  far: 2000,</code></pre>
    <pre data-prefix="10"><code>  zoom: 1.0,</code></pre>
    <pre data-prefix="11"><code>});</code></pre>
  </div>
</div>`,
  },
  'example-batch': {
    title: 'Example: Batch Math Processing',
    subtitle: 'Transforming and culling thousands of objects in flat arrays',
    category: 'Examples',
    html: `
<div class="prose max-w-none">
  <p>Batches execute across contiguous Float64Array views with zero per-element allocation:</p>
  <div class="mockup-code my-4">
    <pre data-prefix="1"><code>import { multiplyMatrix4Batch } from '@web-geometry/sdk/core';</code></pre>
    <pre data-prefix="2"><code></code></pre>
    <pre data-prefix="3"><code>const count = 10000;</code></pre>
    <pre data-prefix="4"><code>const parents = new Float64Array(count * 16);</code></pre>
    <pre data-prefix="5"><code>const locals = new Float64Array(count * 16);</code></pre>
    <pre data-prefix="6"><code>const worlds = new Float64Array(count * 16);</code></pre>
    <pre data-prefix="7"><code></code></pre>
    <pre data-prefix="8"><code>// Computes all 10,000 matrices in one vectorized batch:</code></pre>
    <pre data-prefix="9"><code>multiplyMatrix4Batch(worlds, parents, locals, count);</code></pre>
  </div>
</div>`,
  },
  'example-diagnostics': {
    title: 'Example: Visual Diagnostic Modes',
    subtitle: 'Switching real-time GPU visualization modes',
    category: 'Examples',
    html: `
<div class="prose max-w-none">
  <p>Inspect cluster density, overdraw, screen error, and triangle budgets:</p>
  <div class="mockup-code my-4">
    <pre data-prefix="1"><code>// Set diagnostic mode on active render backend:</code></pre>
    <pre data-prefix="2"><code>backend.setDiagnostic('clusters'); // View individual cluster partitions</code></pre>
    <pre data-prefix="3"><code>backend.setDiagnostic('overdraw'); // Highlight overdraw cost per pixel</code></pre>
    <pre data-prefix="4"><code>backend.setDiagnostic('normals');  // Shaded geometric normal buffer</code></pre>
    <pre data-prefix="5"><code>backend.setDiagnostic('none');     // Standard beauty lighting pass</code></pre>
  </div>
</div>`,
  },
};
