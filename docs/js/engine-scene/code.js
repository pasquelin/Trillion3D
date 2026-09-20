export const engineExampleCode = `import { createExplorer, webgpuPagesBackend } from '@web-geometry/sdk/browser';

const canvas = document.querySelector('canvas');
const lifecycle = new AbortController();
let explorer, controls, resize, frame = 0, remaining = 0;
function dispose() {
  lifecycle.abort();
  cancelAnimationFrame(frame);
  resize?.disconnect();
  controls?.dispose();
  explorer?.dispose();
}
window.addEventListener('pagehide', dispose, { once: true });
explorer = await createExplorer(canvas, {
  manifestUrl: './assets/kinetic-garden/cache/native/full/manifest.json',
  scope: 'full',
  backends: [webgpuPagesBackend],
  width: Math.max(1, canvas.clientWidth),
  height: Math.max(1, canvas.clientHeight),
  pixelRatio: window.devicePixelRatio,
  pixelError: 0,
  lodAdaptive: false,
  temporalAntialiasing: true,
  geometryPoolBytes: 16 * 1024 * 1024,
  texturePoolBytes: 128 * 1024 * 1024,
  signal: lifecycle.signal,
});
controls = explorer.controls();
function draw() {
  frame = 0;
  explorer.render();
  if (--remaining > 0) frame = requestAnimationFrame(draw);
}
function invalidate() {
  remaining = 32;
  if (!frame) frame = requestAnimationFrame(draw);
}
controls.addEventListener('change', invalidate);
resize = new ResizeObserver(() => {
  explorer.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
  invalidate();
});
resize.observe(canvas);
await explorer.awaitPages();
if (!lifecycle.signal.aborted) invalidate();`;

export const engineDiagnosticsCode = `${engineExampleCode
  .replace(
    'controls = explorer.controls();',
    "explorer.setDiagnostic('clusters');\ncontrols = explorer.controls();",
  )
  .replace(
    "explorer.setDiagnostic('clusters');",
    "explorer.setDiagnostic('clusters'); // Try 'pages', 'wireframe' or 'beauty'.",
  )}`;
