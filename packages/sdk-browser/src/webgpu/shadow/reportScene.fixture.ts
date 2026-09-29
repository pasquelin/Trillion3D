// The scene of #1209's scheduling tests: the engine's own frame plan (`planShadowRegions`) over a
// light state, a camera and the clusters a frame draws, with the shading's report standing in for
// the readback. Whatever the frame hands its plan, the tests see: the plan of the engine, not a
// plan called by hand.
import type { SceneLight, ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts';
import { PAGE_MAPPED, PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { report } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { createEngineCamera, writeEngineCamera } from '../../camera/engineCamera.ts';
import { settledRt } from '../frame/hold.fixture.ts';
import { planShadowRegions, shadowViewpointOf } from '../pages/render/encodeShadows.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { shadingReads, type Lit } from './shadingReads.fixture.ts';

/** The display the scenes draw at: the boss's case, 1728 × 1117 at a pixel ratio of two. */
const WIDTH = 3456,
  HEIGHT = 2234;

/** A camera at `eye` looking along `forward`, level, 50° high, at the display's shape. */
export function cameraAt(eye: number[], forward: number[]) {
  const cam = createEngineCamera(),
    f = forward.map((c) => c / Math.hypot(...forward)),
    right = [-f[2], 0, f[0]].map((c) => c / Math.hypot(f[0], f[2])),
    up = [0, 1, 2].map(
      (k) => right[(k + 1) % 3] * f[(k + 2) % 3] - right[(k + 2) % 3] * f[(k + 1) % 3],
    );
  cam.world.set([...right, 0, ...up, 0, ...f.map((c) => -c), 0, ...eye, 1]);
  return writeEngineCamera(cam, { fov: 50, aspect: WIDTH / HEIGHT, near: 0.1, far: 200, zoom: 1 });
}

/**
 * A runtime lit by `lights` over a pool of `poolSide`² pages, drawing clusters of world boxes
 * `drawn` (`[minX, minY, minZ, maxX, maxY, maxZ]` each), in a scene a hundred metres wide.
 */
export function reportScene(poolSide: number, lights: SceneLight[], drawn: number[][]) {
  const rt = settledRt(),
    state = createWebgpuLightState(poolSide),
    noop = () => {};
  for (const light of lights) state.store.add(light);
  state.shadows = { view: {}, writeLamp: noop, writeSun: noop, clearRecord: noop } as never;
  const worldBox = Float64Array.of(-50, 0, -50, 50, 10, 50);
  Object.assign(rt, {
    lights: state,
    diag: { engineDiagnostic: noop, diagnosticFailure: noop },
    layout: {
      rows: { ...rt.layout.rows, residentFlags: [], residentOffsetWords: [], casterSlots: 0 },
      packedPages: [],
      selectionRoots: [{ world: { elements: IDENTITY_MATRIX4 }, worldBox }],
    },
  });
  Object.assign(rt.gpu, { targetSize: [WIDTH, HEIGHT], displaySize: [WIDTH, HEIGHT] });
  const setDrawn = (boxes: number[][]) => {
    (rt.run as unknown as { drawn: unknown[] }).drawn = boxes.map((b) => ({
      min: b.slice(0, 3),
      max: b.slice(3, 6),
      placementIndex: 0,
    }));
  };
  setDrawn(drawn);
  const { plan, store } = state;
  return {
    plan,
    store,
    setDrawn,
    /**
     * Frame `frame` seen by `cam`: the shading of the frame before reports `reported`, the engine
     * plans and draws, and the shading of this frame reads `lits`. Returns the pages it read.
     */
    frame(frame: number, cam: ReturnType<typeof cameraAt>, reported: number[], lits: Lit[]) {
      if (frame > 1) report(plan, store, frame - 1, reported);
      planShadowRegions(rt, cam, frame, frame * 16);
      plan.commit();
      const at = shadowViewpointOf(cam, HEIGHT),
        [px, py, pz] = at.position,
        [fx, fy, fz] = at.forward,
        view: ShadowViewpoint = { ...at, position: [px, py, pz], forward: [fx, fy, fz] };
      return shadingReads(plan, store, view, view.pixelNear, lits);
    },
  };
}

/** Whether `entry` reads a drawn page. */
export const readable = (plan: { table: { words: Uint32Array } }, entry: number) =>
  (plan.table.words[entry] & (PAGE_MAPPED | PAGE_VALID)) === (PAGE_MAPPED | PAGE_VALID);
