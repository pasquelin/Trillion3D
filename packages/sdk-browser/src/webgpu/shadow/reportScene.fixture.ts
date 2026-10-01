// The scene of #1209's scheduling tests: the engine's own frame plan (`planShadowRegions`) over a
// light state, a camera and the clusters a frame draws, with the shading's report standing in for
// the readback. Whatever the frame hands its plan, the tests see: the plan of the engine, not a
// plan called by hand.
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts';
import { PAGE_MAPPED, PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { report } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { settledRt } from '../frame/hold.fixture.ts';
import { planShadowRegions } from '../pages/render/shadowRegions.ts';
import { shadowViewpointOf } from '../pages/render/shadowViewpoint.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { shadingReads, type Lit } from './shadingReads.fixture.ts';

/** The display the scenes draw at: the boss's case, 1728 × 1117 at a pixel ratio of two. */
const WIDTH = 3456;
export const HEIGHT = 2234;

/** A camera at `eye` looking along `forward`, 50° high, at the display's shape. */
export function cameraAt(eye: number[], forward: number[]) {
  const cam = G.perspectiveCamera(50, WIDTH / HEIGHT, 0.1, 200);
  cam.position.set(eye[0], eye[1], eye[2]);
  cam.lookAt(eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]);
  return readCameraWorld(createEngineCamera(), cam);
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
  (rt.run as unknown as { drawn: unknown[] }).drawn = drawn.map((b) => ({
    min: b.slice(0, 3),
    max: b.slice(3, 6),
  }));
  const { plan, store } = state;
  return {
    plan,
    store,
    /**
     * Frame `frame` seen by `cam`: the shading of the frame before reports `reported`, the engine
     * plans and draws, and the shading of this frame reads `lits`. Returns the pages it read.
     */
    frame(frame: number, cam: ReturnType<typeof cameraAt>, reported: number[], lits: Lit[]) {
      if (frame > 1) report(plan, store, frame - 1, reported);
      planShadowRegions(rt, cam, frame, frame * 16);
      plan.commit();
      return shadingReads(plan, store, shadowViewpointOf(cam, HEIGHT), lits);
    },
  };
}

/** Whether `entry` reads a drawn page. */
export const readable = (plan: { table: { words: Uint32Array } }, entry: number) =>
  (plan.table.words[entry] & (PAGE_MAPPED | PAGE_VALID)) === (PAGE_MAPPED | PAGE_VALID);
