import { sceneFillLightCode } from '../sceneFillLight.ts';

export const engineExampleCode = `import { createWorld } from 'web-geometry';

// HTML: <canvas id="garden" style="width:100%;height:60vh;display:block"></canvas>
const world = createWorld('garden');
await world.scene.load('./assets/kinetic-garden/cache/native/full/manifest.json');
world.budget.geometryPool = 16 * 1024 * 1024;
world.budget.texturePool = 128 * 1024 * 1024;
${sceneFillLightCode()}

// In a component, call dispose() on unmount instead.
window.addEventListener('pagehide', () => world.dispose(), { once: true });`;

export const engineDiagnosticsCode = `${engineExampleCode}

world.diagnostic.mode = 'clusters'; // Try 'wireframe', 'triangles' or 'beauty'.
world.invalidate();`;
