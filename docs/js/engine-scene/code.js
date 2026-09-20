export const engineExampleCode = `import { createExplorer } from '@web-geometry/sdk/browser';

// HTML: <canvas id="garden" style="width:100%;height:60vh;display:block"></canvas>
const explorer = await createExplorer('garden', {
  manifestUrl: './assets/kinetic-garden/cache/native/full/manifest.json',
  scope: 'full',
  interactive: true,
  geometryPoolBytes: 16 * 1024 * 1024,
  texturePoolBytes: 128 * 1024 * 1024,
});

// In a component, call dispose() on unmount instead.
window.addEventListener('pagehide', () => explorer.dispose(), { once: true });`;

export const engineDiagnosticsCode = `${engineExampleCode}

explorer.setDiagnostic('clusters'); // Try 'pages', 'wireframe' or 'beauty'.
explorer.invalidate();`;
