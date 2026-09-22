import { sceneFillLightCode } from './sceneFillLight.ts';
import type { RendererLessonPose } from './rendererLessonTypes.ts';

export function lessonCode(
  operation: string,
  {
    manifest,
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
    ? `\nworld.scene.add(light.directional({ color: [1, 0.92, 0.78], intensity: 2.5, position: [4.8, 9.6, 3.6], target: [0, 0, 0], castShadow: true }));`
    : '';
  const fill = sceneFill ? `\n${sceneFillLightCode()}` : '';
  const framing = initialPose
    ? `world.camera.position.set(${initialPose.position});
world.camera.lookAt(${initialPose.target});`
    : `world.camera.position.set(...home.target.map((value, index) =>
  value + (home.position[index] - value) * 1.25));
world.camera.lookAt(...home.target);`;
  return `import { createWorld, light, pose, math } from 'web-geometry';

// HTML: <canvas id="garden" style="width:100%;height:60vh;display:block"></canvas>
const world = createWorld('garden', { pixelRatio: window.devicePixelRatio });
await world.scene.load('${manifest ?? './assets/kinetic-garden/cache/native/full/manifest.json'}');
world.budget.geometryPool = 16 * 1024 * 1024;
world.budget.texturePool = 128 * 1024 * 1024;
${lighting}
${fill}
const home = pose.fromBounds(math.box3().setFromObject(world.scene));
${framing}
${operation}
world.invalidate();

const observer = new ResizeObserver(() => world.resize());
observer.observe(world.canvas);

// In a component, call dispose() on unmount instead.
window.addEventListener('pagehide', () => {
  observer.disconnect();
  world.dispose();
}, { once: true });`;
}
