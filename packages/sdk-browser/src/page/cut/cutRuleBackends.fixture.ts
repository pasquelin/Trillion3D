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
import { DAG_SELECTION_SHADER } from '../../gpu/dag/shader/shader.ts';
import type { CutRuleAt } from '../../gpu/dag/oracle/predicates.ts';
import type { PackedDag } from '../../gpu/dag/types.ts';
import { wgslScope } from './wgslPredicate.fixture.ts';
import { selectVisiblePages } from './cut.ts';
import type { PageRecord } from './state.ts';
import { createImageCut } from '../../backend/autonomous/imageCut.ts';
import type { ClusterRoot, PageRec } from '../selection/types.ts';

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
 *  derives and uploads (`../../gpu/dag/residencyUpload.ts`), deciding with `rule`. */
function kernelBackend(
  dag: RuleDag,
  threshold: number,
  rule?: (packed: PackedDag) => CutRuleAt,
): CutBackend {
  const { packed, uniforms } = stripUniforms(dag, threshold);
  const decide = rule?.(packed);
  return (resident) => {
    const residency = ruleResidency(packed, resident);
    const result = evaluateDagSelectionKernel(packed, uniforms, residency, false, decide);
    return { drawn: result.drawablePageIds ?? [], wanted: result.pageIds };
  };
}

/** The kernel's CPU model with the TypeScript rule. */
export const oracleBackend = (dag: RuleDag, threshold: number) => kernelBackend(dag, threshold);

/**
 * The same model where the kernel's own text decides (`DAG_SELECTION_SHADER`), run in Node: the
 * `dagMask` call site as written — `let all=…;` then `draw=drawsCluster(…);` —, its residency
 * reads `isResident(i)` and `childResident(i)` on the bit sets the host uploaded into the cold
 * buffer, and `drawsCluster` itself. Only the projection is the model's: `projected(…)` returns
 * the screen error the model computed, bound to `cluster`'s errors.
 */
export function wgslBackend(dag: RuleDag, threshold: number, source = DAG_SELECTION_SHADER) {
  const site = /\blet all=([^;]+);[^]*?\bdraw=(drawsCluster\([^;]+\));/.exec(source);
  if (!site) throw new Error('WGSL_CALL_SITE_MISSING: dagMask');
  return kernelBackend(dag, threshold, (packed) => {
    const cold = new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCones.length,
    );
    // The view block the call site and the residency reads name: a cut that holds residency.
    const views = [{ residentCut: 1, clusterCount: packed.pageCount, pixelError: threshold }];
    const scope = wgslScope(source, {
      views,
      cold,
      vi: 0,
      e: 0,
      stretch: 0,
      focal: 0,
      projected: (error: number) => error,
    });
    const all = scope.expression(site[1]),
      draw = scope.expression(site[2], ['all', 'i', 'cluster']);
    return (_ready, parentPixels, ownPixels, _childReady, t, page) => {
      views[0].pixelError = t;
      const cluster = {
        parentError: parentPixels,
        lodError: ownPixels,
        parentSphere: 0,
        sphere: 0,
      };
      return draw({ all: all(), i: page, cluster }) === true;
    };
  });
}

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

/** The WebGL2 image's cut (`../../backend/autonomous/imageCut.ts`) over `roots`, under a pool
 *  that admits every request. */
export const webgl2Cut = (roots: ClusterRoot<PageRec>[]) =>
  createImageCut({
    roots,
    viewport: [1280, 720],
    shown: [],
    desired: [],
    requested: [],
    revision: () => 0,
    pool: { admit: (asked) => asked.length, fit: (asked) => asked.length, held: {} },
  });

/** The WebGL2 image's cut of the DAG, each page resident when it holds its index array, as the
 *  WebGL2 pool loads them. */
export function webgl2Backend(dag: RuleDag, threshold: number): CutBackend {
  const cam = stripCamera(dag),
    [root] = placements(dag, 1),
    index = new Map(root.pages.map((page, i) => [page, i]));
  const cut = webgl2Cut([root]);
  const ids = (list: readonly PageRec[]) => list.map((page) => index.get(page)!);
  return (resident) => {
    root.pages.forEach((page, i) => (page.array = resident[i] ? new Uint32Array(3) : undefined));
    const { shown, wanted } = cut(cam, threshold);
    return { drawn: ids(shown), wanted: ids(wanted) };
  };
}

/** `copies` placements of the DAG, each with pages of its own, `spacing` apart along -x: when
 *  they are apart, those past the first carry their world box. */
export function placements(dag: RuleDag, copies: number, spacing = 0) {
  const n = dag.pages.length;
  return Array.from({ length: copies }, (_, r) => {
    const elements = Float64Array.from(dag.world.elements);
    elements[12] -= spacing * r;
    const pages = dag.pages.map((page, p) => ({
      ...page,
      url: `r${r}/${page.url}`,
      placementIndex: r,
      packedIndex: r * n + p,
    }));
    const x = elements[12],
      worldBox = spacing && r ? Float64Array.of(x, -2, -2, x + dag.leaves, 2, 2) : undefined;
    return { world: { elements }, pages, culling: dag.culling, structure: dag.structure, worldBox };
  }) as unknown as ClusterRoot<PageRec>[];
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
