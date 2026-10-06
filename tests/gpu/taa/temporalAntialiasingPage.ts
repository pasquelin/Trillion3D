// The engine side of the temporal antialiasing proof: the real WebGPU engine on two opaque tiles —
// a full-frame blue background and a rotated red tile, whose edges are oblique — rendered with and
// without temporal accumulation: still, under a camera pan, then after a move of the tile. Nothing
// internal is read: `setTransform` on one side, read-back pixels and `frameHeld` on the other.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import type { BackendDiagnostic } from '../../../packages/sdk-browser/src/backend/types.ts';
import {
  VIEWPORT,
  batisseur as sceneBuilder,
  square,
  cameraFace as facingCamera,
  release as release,
  engine,
  versApi as toApiMatrix,
} from '../kit/sharedSceneProof.ts';
import { image, jusquaTenue as untilHeld } from '../kit/sceneImageProof.ts';
import { runAccumulation as withAndWithoutAccumulation } from '../kit/deviceProof.ts';

/** The tile's rotation, a third of a radian: its edges are oblique. */
const TURN = 0.33;

/** The background and the red tile. */
function scene() {
  const builder = sceneBuilder();
  const background = G.mesh(square(4), G.basicSurface({ color: 0x1b3a5c }));
  background.name = 'background';
  background.position.z = -2;
  builder.source.add(background);
  builder.add(background, 'exact-clusters', 4);
  const tile = G.mesh(square(0.6), G.basicSurface({ color: 0xff2020 }));
  tile.name = 'tile';
  tile.rotation.z = TURN;
  builder.source.add(tile);
  builder.add(tile, 'exact-clusters', 0.6);
  return builder.fini();
}

/** A held image and what preceded it: the last rendered image and the count rendered. */
const held = async (...args: Parameters<typeof untilHeld>) => {
  const { rendue, tenue, rendues } = await untilHeld(...args);
  return { rendered: rendue, held: tenue, count: rendues };
};

/** One run: still, panned, then the tile moved. `temporal` picks the option. */
async function fullRun(device: GPUDevice, events: unknown[], temporal: boolean) {
  const prepared = scene(),
    own: BackendDiagnostic[] = [];
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    prepared,
    device,
    (event) => {
      own.push(event);
      events.push(event);
    },
    { temporalAntialiasing: temporal },
  );
  const camera = facingCamera();
  try {
    await backend.prepare();
    const still = await held(backend, camera);
    // The pan: the camera slides about two thirds of a pixel per frame, for sixteen frames.
    // Nothing is held; the last rendered image is the one read.
    let pannedPixels: Uint8Array = new Uint8Array();
    for (let i = 1; i <= 16; i++)
      pannedPixels = (await image(backend, facingCamera(0.02 * i))).pixels;
    const panned = Array.from(pannedPixels);
    if (!backend.setTransform) throw new Error('the backend has no setTransform');
    backend.setTransform(
      'tile',
      toApiMatrix(new G.Matrix4().makeRotationZ(TURN).setPosition(0.5, 0, 0)),
    );
    const moved = await held(backend, camera);
    const capabilities = own.find((e) => e.phase === 'render-capabilities')?.context ?? null;
    return { still, panned, moved, capabilities };
  } finally {
    release(backend, canvas, prepared);
  }
}

/** Without accumulation, with it, and with it again as the A/A witness; and the viewport. */
export async function run() {
  return { viewport: VIEWPORT, ...(await withAndWithoutAccumulation(fullRun)) };
}
