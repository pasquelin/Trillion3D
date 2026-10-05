// The engine side of the sampled lighting proof: the real WebGPU engine on one lit square under
// eight contract lights — more than the samples a moving pixel shades — rendered still until held,
// then under a sub-pixel camera shake that keeps every image moving. Nothing internal is read:
// lights go through the host store, images through `capture`.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import {
  createSceneLightStore,
  type SceneLightStore,
} from '../../../packages/sdk-core/src/index.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import {
  VIEWPORT,
  batisseur as sceneBuilder,
  carre as square,
  cameraFace as facingCamera,
  libere as release,
  engine,
} from '../kit/sharedSceneProof.ts';
import { image, jusquaTenue as untilHeld } from '../kit/sceneImageProof.ts';
import { executerAccumulation as withAndWithoutAccumulation } from '../kit/deviceProof.ts';

/** Moving images rendered under the shake: enough for the history to settle again. */
const SHAKES = 24;
/** Contract lights on a ring in front of the square: two colours, so a drawn subset of them
 *  differs from the whole in chroma, never only in brightness. */
const LIGHTS = 8;

/** One grey, rough, lit square facing the camera. */
function scene() {
  const builder = sceneBuilder();
  const plane = G.mesh(
    square(1.2),
    G.standardSurface({ color: 0x9a9a9a, roughness: 0.7, metalness: 0 }),
  );
  plane.name = 'plane';
  builder.source.add(plane);
  builder.ajoute(plane, 'exact-clusters', 1.2);
  return builder.fini();
}

/** The ring of lights, declared to the host store as any host would. */
function ring(store: SceneLightStore) {
  for (let i = 0; i < LIGHTS; i++) {
    const angle = (i / LIGHTS) * Math.PI * 2;
    store.add({
      id: `light-${i}`,
      kind: 'point',
      position: [Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 1.2],
      color: i % 2 ? [0.2, 0.3, 1] : [1, 0.35, 0.2],
      intensity: 1.2,
      range: 4,
      castsShadow: false,
    });
  }
}

/** One run: still until held, then shaken. `temporal` picks the option. */
async function fullRun(device: GPUDevice, events: unknown[], temporal: boolean) {
  const prepared = scene(),
    store = createSceneLightStore();
  ring(store);
  const { backend, canvas } = engine(webgpuPagesBackend, prepared, device, (e) => events.push(e), {
    temporalAntialiasing: temporal,
    sceneLights: store,
  });
  try {
    await backend.prepare();
    const { tenue: held, rendues: rendered } = await untilHeld(backend, facingCamera());
    // The shake: a hair to the left, then to the right, a hundredth of a pixel at this distance.
    // Every image moves, none is held, and the pose never leaves the still one.
    let first: number[] = [],
      last: number[] = [],
      heldWhileShaken = 0;
    for (let i = 1; i <= SHAKES; i++) {
      const frame = await image(backend, facingCamera(i % 2 ? 0.0003 : -0.0003));
      if (i === 1) first = Array.from(frame.pixels);
      if (i === SHAKES) last = Array.from(frame.pixels);
      if (frame.metriques.frameHeld) heldWhileShaken++;
    }
    return { held, rendered, first, last, heldWhileShaken };
  } finally {
    release(backend, canvas, prepared);
  }
}

/** Without accumulation, with it, and with it again as the A/A witness; the viewport and the light
 *  count. */
export async function run() {
  return { viewport: VIEWPORT, lights: LIGHTS, ...(await withAndWithoutAccumulation(fullRun)) };
}
