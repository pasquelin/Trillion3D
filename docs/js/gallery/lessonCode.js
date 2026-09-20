import { sceneFillLightCode } from '../sceneFillLight.js';

export function lessonCode(
  operation,
  { manifest, importedLights = true, sceneLight = false, sceneFill = false } = {},
) {
  const lighting = sceneLight
    ? `\nexplorer.addLight({ id: 'scene', kind: 'directional', direction: [-0.4, -0.8, -0.3], color: [1, 0.92, 0.78], intensity: 2.5, castsShadow: true });`
    : '';
  const fill = sceneFill ? `\n${sceneFillLightCode()}` : '';
  return `import { createExplorer } from '@web-geometry/sdk/browser';

// HTML: <canvas id="garden" style="width:100%;height:60vh;display:block"></canvas>
const explorer = await createExplorer('garden', {
  manifestUrl: '${manifest ?? './assets/kinetic-garden/cache/native/full/manifest.json'}',
  scope: 'full',
  importedLights: ${importedLights},
  interactive: true,
  geometryPoolBytes: 16 * 1024 * 1024,
  geometryPoolCeilingBytes: 64 * 1024 * 1024,
  texturePoolBytes: 128 * 1024 * 1024,
});

await explorer.awaitPages();
${lighting}
${fill}
const home = explorer.homePose();
explorer.setPose({
  ...home,
  position: home.target.map((value, index) =>
    value + (home.position[index] - value) * 1.25),
});
${operation}
explorer.render();

// In a component, call dispose() on unmount instead.
window.addEventListener('pagehide', () => explorer.dispose(), { once: true });`;
}
