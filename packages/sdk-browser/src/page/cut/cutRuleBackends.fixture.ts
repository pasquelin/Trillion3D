/**
 * The backends the cut rule's tests drive on one synthetic DAG (`cutRule.fixture.ts`): each takes
 * the per-page residency and returns what it draws and what it wants, as page indices of the DAG.
 */
import { packDagSelection, packedWorldsToRenderOrigin } from '../../gpu/dag/pack.ts';
import { evaluateDagSelectionKernel } from '../../gpu/dag/selection.ts';
import { cameraSelectionUniforms } from '../../gpu/core/selection.ts';
import { createEngineCamera, writeEngineCamera } from '../../camera/engineCamera.ts';
import { ruleResidency } from '../../gpu/dag/readiness.fixture.ts';
import type { RuleDag } from './cutRule.fixture.ts';
import { dagNodeFloor, dagViewFrames } from '../../gpu/dag/oracle/math.ts';

export type CutBackend = (resident: Uint8Array) => { drawn: number[]; wanted: number[] };

/** A camera down the strip from its near end: the leaves near it want fine clusters, the far
 *  ones coarse, so one cut spans several levels. */
export function stripCamera(dag: RuleDag) {
  const eye = [-6, 4, 0],
    target = [dag.leaves / 2, 0, 0];
  const z = eye.map((v, a) => v - target[a]),
    zl = Math.hypot(...z);
  const back = z.map((v) => v / zl);
  // x = up × z, y = z × x, with up = +y.
  const xl = Math.hypot(back[2], back[0]),
    right = [back[2] / xl, 0, -back[0] / xl];
  const up = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  const cam = createEngineCamera();
  cam.world.set([...right, 0, ...up, 0, ...back, 0, ...eye, 1]);
  return writeEngineCamera(cam, { fov: 70, aspect: 16 / 9, near: 0.1, far: 4000, zoom: 1 });
}

/** The kernel uniforms of the strip camera, the packing's worlds brought to its render frame. */
function stripUniforms(dag: RuleDag, threshold: number) {
  const root = {
    world: dag.world,
    pages: dag.pages,
    culling: dag.culling,
    structure: dag.structure,
  };
  const packed = packDagSelection([root]),
    cam = stripCamera(dag);
  packedWorldsToRenderOrigin(packed, [root], cam.eye);
  return { packed, uniforms: cameraSelectionUniforms(cam, threshold, [1280, 720]) };
}

/** The GPU kernel's CPU model (`../../gpu/dag/oracle/oracle.ts`), on the residency its host
 *  derives and uploads (`../../gpu/dag/readiness.ts`). */
export function oracleBackend(dag: RuleDag, threshold: number): CutBackend {
  const { packed, uniforms } = stripUniforms(dag, threshold);
  return (resident) => {
    const result = evaluateDagSelectionKernel(packed, uniforms, ruleResidency(packed, resident));
    return { drawn: result.drawablePageIds ?? [], wanted: result.pageIds };
  };
}

/** The pages whose leaf node top-down pruning drops on its floor at full residency: none of them is
 *  a candidate unless the rule opens its node. */
export function floorPrunedPages(dag: RuleDag, threshold: number) {
  const { packed, uniforms } = stripUniforms(dag, threshold);
  const frames = dagViewFrames(packed, uniforms);
  const ints = new Uint32Array(packed.nodes.buffer);
  return dag.pages
    .map((_, page) => page)
    .filter((page) => {
      const node = dag.culling.links.leafOfPage[page];
      return node >= 0 && dagNodeFloor(frames, packed.nodes, ints, node) > threshold;
    });
}
