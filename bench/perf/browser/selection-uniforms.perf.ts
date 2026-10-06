// What the selection dispatch writes on the CPU every view of every image (`selectionDispatchMs`):
// the camera's selection uniforms, as `renderGpuCut` rewrites them in place with the camera's
// motion (`packages/sdk-browser/src/gpu/core/selection.ts`), and one view's uniform block, as the
// dispatch writes it for the camera (`gpu/dag/uniforms.ts`).
import {
  cameraSelectionUniforms,
  createSelectionUniforms,
} from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { VIEW_BLOCK_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts';
import {
  createEngineCamera,
  writeEngineCamera,
} from '../../../packages/sdk-browser/src/camera/engineCamera.ts';
import type { CameraMotion } from '../../../packages/sdk-browser/src/camera/motion.ts';
import type {
  DagViewUniforms,
  PackedDag,
} from '../../../packages/sdk-browser/src/gpu/dag/types.ts';
import { measure, rapport } from '../../core/index.ts';
import {
  readViewBlock,
  referenceCameraUniforms,
  referenceViewBlocks,
  uniformsOf,
} from '../../oracles/browser/selection-uniforms.ts';

const VIEWPORT: [number, number] = [1920, 1080],
  PIXEL_ERROR = 2;

/** A camera walking and turning along a street, far from the world origin, `frames` poses. */
function street(frames: number) {
  return Array.from({ length: frames }, (_, i) => {
    const cam = createEngineCamera(),
      yaw = i * 0.01,
      [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    cam.world.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 5e4 + i * 0.07, 1.7, -3e4 + i * 0.05, 1]);
    return writeEngineCamera(cam, { fov: 60, aspect: 16 / 9, near: 0.1, far: 5000, zoom: 1 });
  });
}
const moving: CameraMotion = {
  ahead: new Float64Array([4.2, 0, 3]),
  turn: 0.6,
  axis: new Float64Array([0, 1, 0]),
  steadyMs: 400,
  turnSteadyMs: 400,
  horizonMs: 300,
};
type Walk = {
  cameras: ReturnType<typeof street>;
  motion: CameraMotion;
  into: ReturnType<typeof createSelectionUniforms>;
};
const walk = (frames: number, motion: CameraMotion): Walk => ({
  cameras: street(frames),
  motion,
  into: createSelectionUniforms(),
});

const resCamera = await measure({
  name: 'camera selection uniforms',
  fichier: 'packages/sdk-browser/src/gpu/core/selection.ts',
  cas: [
    { name: '400 frames, walking and turning', input: walk(400, moving), size: 400 },
    { name: '400 frames, still', input: walk(400, {}), size: 400 },
  ],
  calculation: ({ cameras, motion, into }: Walk) => {
    for (const cam of cameras) cameraSelectionUniforms(cam, PIXEL_ERROR, VIEWPORT, into, motion);
    return into;
  },
  // The block the last frame left, in place over the 399 before it, against that frame's contract.
  expected: ({ cameras, motion }: Walk) =>
    referenceCameraUniforms(cameras[cameras.length - 1], PIXEL_ERROR, VIEWPORT, motion),
  lecture: (e: Walk, u: unknown) => (u === e.into ? uniformsOf(e.into) : u),
  options: { tours: 200, budgetMs: 1000 },
});

// One view's block: the camera's with its view ahead.
const camera = createSelectionUniforms();
cameraSelectionUniforms(street(1)[0], PIXEL_ERROR, VIEWPORT, camera, moving);
const dag = { pageCount: 120000, nodeCount: 40000, worldCount: 2479 };
type BlockCase = {
  target: Float32Array;
  packed: typeof dag;
  uniforms: DagViewUniforms;
};
const blockCase = (blocks: number, b: Omit<BlockCase, 'target'>): BlockCase => ({
  target: new Float32Array(VIEW_BLOCK_WORDS * blocks),
  ...b,
});
const LIST_CAP = 65536;

const resBlock = await measure({
  name: 'view uniform block',
  fichier: 'packages/sdk-browser/src/gpu/dag/uniforms.ts',
  cas: [
    {
      name: 'camera and its view ahead',
      input: blockCase(2, { packed: dag, uniforms: camera }),
      size: 1,
    },
  ],
  calculation: ({ target, packed, uniforms }: BlockCase) => {
    writeDagUniforms(target, packed as unknown as PackedDag, uniforms, true, LIST_CAP);
    return target;
  },
  expected: ({ target, packed, uniforms }: BlockCase) =>
    referenceViewBlocks(packed, uniforms, true, LIST_CAP, target.length / VIEW_BLOCK_WORDS),
  lecture: (e: BlockCase, t: unknown) =>
    t === e.target
      ? Array.from({ length: e.target.length / VIEW_BLOCK_WORDS }, (_, i) =>
          readViewBlock(e.target, i),
        )
      : t,
  options: { tours: 200, budgetMs: 1000 },
});

rapport(
  'uniformes-selection',
  [resCamera, resBlock],
  'the selection dispatch writes the uniforms its contract names',
);
