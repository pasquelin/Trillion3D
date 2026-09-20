export function lessonCode(operation, { manifest, importedLights = true } = {}) {
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
