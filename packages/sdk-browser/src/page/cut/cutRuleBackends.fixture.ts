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
import { CUT_RULE_WGSL, type drawsCluster } from './rule.ts';
import { wgslPredicate } from './wgslPredicate.fixture.ts';
import { selectVisiblePages } from './cut.ts';
import type { PageRecord } from './state.ts';
import { createImageCut } from '../../backend/autonomous/imageCut.ts';
import type { ClusterRoot, PageRec } from '../selection/types.ts';

export type CutBackend = (resident: Uint8Array) => { drawn: number[]; wanted: number[] };

/** A camera down the strip from its near end: the leaves near it want fine clusters, the far
 *  ones coarse, so one cut spans several levels. */
function stripCamera(dag: RuleDag) {
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
export function stripUniforms(dag: RuleDag, threshold: number) {
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
 *  derives and uploads (`../../gpu/dag/readiness.ts`), deciding with `rule`. */
function kernelBackend(dag: RuleDag, threshold: number, rule?: typeof drawsCluster): CutBackend {
  const { packed, uniforms } = stripUniforms(dag, threshold);
  return (resident) => {
    const residency = ruleResidency(packed, resident);
    const result = evaluateDagSelectionKernel(packed, uniforms, residency, false, rule);
    return { drawn: result.drawablePageIds ?? [], wanted: result.pageIds };
  };
}

/** The kernel's CPU model with the TypeScript rule. */
export const oracleBackend = (dag: RuleDag, threshold: number) => kernelBackend(dag, threshold);

/** The same model deciding with the kernel's own WGSL text (`CUT_RULE_WGSL`), run in Node. */
export const wgslBackend = (dag: RuleDag, threshold: number, source = CUT_RULE_WGSL) =>
  kernelBackend(dag, threshold, wgslPredicate(source, 'drawsCluster') as typeof drawsCluster);

/** The CPU cut (`./cut.ts`) with the host answering for residency, as the WebGPU CPU path and the
 *  light cuts ask it: the rule on `./held.ts`'s readiness, its descent pruned on the open counts. */
export function cpuBackend(dag: RuleDag, threshold: number): CutBackend {
  const cam = stripCamera(dag),
    pages = dag.pages as PageRecord[],
    root = { world: dag.world, pages, culling: dag.culling, structure: dag.structure },
    index = new Map(pages.map((page, i) => [page, i]));
  const ids = (list: readonly PageRecord[]) => list.map((page) => index.get(page)!);
  return (resident) => {
    const cut = selectVisiblePages([root], cam, {
      pixelError: threshold,
      viewport: [1280, 720],
      holdResident: true,
      isResident: (page) => resident[index.get(page)!] === 1,
    });
    return { drawn: ids(cut.shown), wanted: ids(cut.wanted) };
  };
}

/** The WebGL2 image's cut (`../../backend/autonomous/imageCut.ts`): the same cut, each page
 *  resident when it holds its index array, as the WebGL2 pool loads them, under a pool that
 *  admits every request. */
export function webgl2Backend(dag: RuleDag, threshold: number): CutBackend {
  const cam = stripCamera(dag),
    pages = dag.pages.map((page) => ({ ...page })) as unknown as PageRec[],
    roots = [{ world: dag.world, pages, culling: dag.culling, structure: dag.structure }],
    index = new Map(pages.map((page, i) => [page, i])),
    requested: PageRec[] = [];
  const cut = createImageCut({
    roots: roots as ClusterRoot<PageRec>[],
    viewport: [1280, 720],
    shown: [],
    desired: [],
    requested,
    revision: () => 0,
    pool: { admit: (asked) => asked.length },
  });
  const ids = (list: readonly PageRec[]) => list.map((page) => index.get(page)!);
  return (resident) => {
    pages.forEach((page, i) => (page.array = resident[i] ? new Uint32Array(3) : undefined));
    const { shown, wanted } = cut(cam, threshold);
    return { drawn: ids(shown), wanted: ids(wanted) };
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
