// What the proofs that open a whole world on Dawn share: the page's frame, the loop that settles a
// pose, the bench scenes read from disk, and the image a world opened on the engine's own choice of
// backend draws. Written in an area until the kit (`../kit/`) holds it.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSETS, assetsManifest } from '../../../bench/runner/scene.ts';
import { openDefaultWorld } from '../kit/defaultWorld.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';
import type { CameraPose, SceneLight } from '../../../packages/sdk-core/src/index.ts';
import { animationFrame } from '../kit/onDawn.ts';
import { measurementSdk, proofCanvas } from '../kit/renderHarness.ts';

/** Frames a pose gets to be held before the proof gives up on it. */
const SETTLE_FRAMES = 128;

/** The measurement SDK as a URL, for the bench helpers that import it themselves. */
export const SDK_URL = pathToFileURL(
  resolve(import.meta.dirname, '../../../bench/witnesses/measurement.ts'),
).href;

/** Renders `pose` (the current one without) and flushes, frame after frame, until the image is
 *  held: that frame's metrics, or `null` when it never is. A held frame waits for the pages its
 *  cut lacks (`cutPending`): no page wait of the host's is needed between two frames. */
export async function settle(world: MeasuredWorld, pose?: CameraPose) {
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    await animationFrame();
    const metrics = world.render(pose);
    await world.flush();
    // The engine's own metrics object, rewritten by every frame: copied while it is this one's.
    if (metrics.frameHeld) return { ...metrics };
  }
  return null;
}

/** The compiled full manifest of a bench scene (`.mesure/assets/<scene>-derived`, off git:
 *  `bench/runner/README.md` § Assets) as a file address; a scene not compiled there throws. */
export const benchManifest = (scene: string) =>
  pathToFileURL(join(ASSETS, assetsManifest(scene, true).slice('/benchmark-assets/'.length))).href;

/** The pixels an image draws over its background, read where the image proofs read it. */
export { drawnPixels } from '../kit/sceneImageProof.ts';

/**
 * `manifestUrl` opened with no `backends` option — the engine reads the machine and chooses —, lit
 * by `lights` before its first frame (a cache whose light table is empty is lit by its host or by
 * nothing), settled at its first point of interest and read back: what the engine chose and
 * mounted, in its own words (`backend-choice`), and the image, bottom row first.
 */
export async function defaultBackendImage(manifestUrl: string, lights: SceneLight[] = []) {
  const { openMeasuredWorld } = await measurementSdk();
  const canvas = proofCanvas('default-backend');
  const { world, chosen } = await openDefaultWorld(openMeasuredWorld, canvas, manifestUrl, lights);
  try {
    const held = await settle(world);
    return { ...chosen(), held: held !== null, pixels: new Uint8Array(world.capture()) };
  } finally {
    world.dispose();
    canvas.remove();
  }
}
