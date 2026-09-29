import { DrawRanges } from '../../cluster/batchRange.ts';
import { drawPasses, drawTriangles, drawWorld, type ClusterDraw } from '../../cluster/batchMesh.ts';
import { sameElements } from '../../math/matrixElements.ts';
import type { WebglPageArena } from './pageArena.ts';
import type { WebglPageArenas } from './pageArenas.ts';
import type { WebglClusterLightLists } from './lightLists.ts';
import type { Material } from './materialBinding.ts';
import { submitRanges, type MultiDraw } from './submit.ts';

/**
 * THE RUNS OF A DRAWN LIST (#840): sponza drew 1 465 pages a pass, twice a frame with its
 * reflection capture, one submission each — three commands and a walk of each page, enough to
 * hold the main thread over 4 ms. A list is read once a frame into runs, which every pass that
 * draws it replays. Pages placed in one arena (`pageArenas.ts`) that follow one another in the
 * list and draw alike — one surface drawn in one pass, one placement, one light list — are one
 * run: submitted once, their index ranges in one `WEBGL_multi_draw` (or its loop), in the order
 * they came. The order, the state and the triangles are those of the draws one by one, so is the
 * image; only the commands are fewer. The opaque order groups a surface's pages
 * (`drawOrder.ts`), so a run is a surface's pages. Any other mesh is a run of its own, without an
 * arena: the renderer draws it as it always did.
 */
export class WebglClusterRuns {
  count = 0;
  /** Each run's first mesh: its surface, placement and light list are the run's. */
  readonly heads: ClusterDraw[] = [];
  /** Each run's arena; undefined for a mesh drawn on its own buffers. */
  readonly arenas: (WebglPageArena | undefined)[] = [];
  readonly lists: number[] = [];
  readonly triangles: number[] = [];
  private ranges: DrawRanges[] = [];
  /** Reads `meshes` into runs, their pages placed and their lights listed. */
  build(meshes: readonly ClusterDraw[], arenas: WebglPageArenas, lights: WebglClusterLightLists) {
    this.count = 0;
    let open = -1;
    for (const mesh of meshes) {
      const material = mesh.material as Material;
      if (!material.visible) continue; // drawn nothing, breaks nothing
      const slot = drawPasses(material).length === 1 ? arenas.slot(mesh) : undefined,
        list = slot ? lights.listOf(mesh) : -1;
      if (slot && open >= 0 && this.extends(open, mesh, slot.arena, list, lights)) {
        this.ranges[open].push(slot.first, slot.count);
        this.triangles[open] += drawTriangles(mesh);
        continue;
      }
      const k = this.count++;
      this.heads[k] = mesh;
      this.arenas[k] = slot?.arena;
      this.lists[k] = list;
      this.triangles[k] = slot ? drawTriangles(mesh) : 0;
      const ranges = (this.ranges[k] ??= new DrawRanges());
      ranges.reset();
      if (slot) ranges.push(slot.first, slot.count);
      open = slot ? k : -1;
    }
    this.heads.length = this.arenas.length = this.count; // no mesh held past its frame
  }
  private extends(
    k: number,
    mesh: ClusterDraw,
    arena: WebglPageArena,
    list: number,
    lights: WebglClusterLightLists,
  ) {
    const head = this.heads[k];
    return (
      this.arenas[k] === arena &&
      head.material === mesh.material &&
      lights.same(this.lists[k], list) &&
      sameElements(drawWorld(head), drawWorld(mesh))
    );
  }
  /** Submits run `k`'s ranges, its arena bound. */
  submit(gl: WebGL2RenderingContext, multiDraw: MultiDraw | null, k: number) {
    const { starts, counts, count } = this.ranges[k];
    submitRanges(gl, multiDraw, starts, counts, count);
  }
}

/** The runs of every list a frame draws, read at its first pass, replayed by the others. */
export class WebglClusterPlans {
  private plans = new Map<readonly object[], WebglClusterRuns>();
  private spare: WebglClusterRuns[] = [];
  private arenas: WebglPageArenas;
  private lights: WebglClusterLightLists;
  constructor(arenas: WebglPageArenas, lights: WebglClusterLightLists) {
    this.arenas = arenas;
    this.lights = lights;
  }
  /** A new frame: every list is read again at its first pass. */
  beginFrame() {
    for (const runs of this.plans.values()) this.spare.push(runs);
    this.plans.clear();
  }
  of(meshes: readonly ClusterDraw[]) {
    let runs = this.plans.get(meshes);
    if (!runs) {
      runs = this.spare.pop() ?? new WebglClusterRuns();
      runs.build(meshes, this.arenas, this.lights);
      this.plans.set(meshes, runs);
    }
    return runs;
  }
}
