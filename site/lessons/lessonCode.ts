import { sceneFillLightCode } from './sceneFillLight.ts';
import type { RendererLessonPose } from './rendererLessonTypes.ts';

export function lessonCode(
  operation: string,
  {
    manifest,
    importedLights = true,
    sceneLight = false,
    sceneFill = false,
    initialPose,
  }: {
    manifest?: string;
    importedLights?: boolean;
    sceneLight?: boolean;
    sceneFill?: boolean;
    initialPose?: RendererLessonPose;
  } = {},
) {
  const lighting = sceneLight
    ? `\nexplorer.addLight({ id: 'scene', kind: 'directional', direction: [-0.4, -0.8, -0.3], color: [1, 0.92, 0.78], intensity: 2.5, castsShadow: true });`
    : '';
  const fill = sceneFill ? `\n${sceneFillLightCode()}` : '';
  const framing = initialPose
    ? `explorer.setPose({ ...home, position: [${initialPose.position}], target: [${initialPose.target}] });`
    : `explorer.setPose({
  ...home,
  position: home.target.map((value, index) =>
    value + (home.position[index] - value) * 1.25),
});`;
  return `import { createExplorer, webgpuPagesBackend } from 'web-geometry';

// HTML: <canvas id="garden" style="width:100%;height:60vh;display:block"></canvas>
const canvas = document.getElementById('garden');
const viewport = canvas.getBoundingClientRect();
const explorer = await createExplorer(canvas, {
  manifestUrl: '${manifest ?? './assets/kinetic-garden/cache/native/full/manifest.json'}',
  scope: 'full',
  backends: [webgpuPagesBackend],
  importedLights: ${importedLights},
  interactive: false,
  width: Math.max(1, Math.round(viewport.width)),
  height: Math.max(1, Math.round(viewport.height)),
  pixelRatio: window.devicePixelRatio,
  pixelError: 0,
  geometryPoolBytes: 16 * 1024 * 1024,
  geometryPoolCeilingBytes: 64 * 1024 * 1024,
  texturePoolBytes: 128 * 1024 * 1024,
  clearColor: 0x0e1621,
  diagnosticDetail: 'summary',
});

await explorer.awaitPages();
${lighting}
${fill}
const home = explorer.homePose();
${framing}
${operation}
async function renderUntilHeld(limit = 64) {
  for (let frame = 0; frame < limit; frame++) {
    await explorer.awaitPages();
    const metrics = explorer.render();
    await explorer.flush();
    if (metrics.frameHeld) return;
    await new Promise(requestAnimationFrame);
  }
  throw new Error('The streamed view did not settle within 64 frames.');
}
await renderUntilHeld();

let resizePending = false;
const resize = new ResizeObserver(async ([entry]) => {
  explorer.resize(
    Math.max(1, Math.round(entry.contentRect.width)),
    Math.max(1, Math.round(entry.contentRect.height)),
  );
  if (resizePending) return;
  resizePending = true;
  try {
    await renderUntilHeld();
  } finally {
    resizePending = false;
  }
});
resize.observe(canvas);

// In a component, call dispose() on unmount instead.
window.addEventListener('pagehide', () => {
  resize.disconnect();
  explorer.dispose();
}, { once: true });`;
}
