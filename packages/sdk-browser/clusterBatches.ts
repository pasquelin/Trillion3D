import * as THREE from 'three';

/**
 * Cluster batches with a persistent index buffer.
 *
 * A source primitive (shared attribute set) owns a single resident index buffer. Each page
 * receives a fixed range there when it becomes resident: only that range is written, never
 * the whole buffer, and eviction returns it to the allocator. A frame's visible cut is then
 * only a list of sub-draws (starts/counts) submitted in one call per instance via
 * `WEBGL_multi_draw`; Three.js falls back on its own to a drawElements loop when the extension is missing.
 *
 * The cost of a frame therefore no longer depends on the total page count or on the cut
 * change, but only on the number of displayed pages.
 *
 * Assumed prototype limit: a primitive's capacity is the sum of the sizes of all its pages
 * (exact and coarse). It is therefore resident even when the cut shows only a part of it;
 * bounding that capacity (and evicting ranges under pressure) remains to be done.
 *
 * Known image limit: `isBatchedMesh` makes Three.js define USE_BATCHING, hence compile a
 * program variant where vertices go through an extra multiply. That matrix is identity and
 * the computation is exact, but the driver does not round quite the same: on emerald-square,
 * 0.04% to 0.39% of pixels change, on silhouette edges. Undoing the define (`#undef USE_BATCHING`
 * set by `onBeforeCompile`) brings the max gap from 197 to 6 levels and makes low-poly-city
 * identical bit for bit, but costs more than half of the presented frames: to revisit.
 */

import { type BatchPage } from './clusterBatchRange.ts';
import { PrimitiveIndex, BatchGroup } from './clusterBatchPrimitive.ts';
import { identityMatrixTexture, type ShaderHook } from './clusterBatchMesh.ts';
import { setupClusterBatches } from './clusterBatchSetup.ts';
import { everyGroup } from './clusterBatchLayers.ts';
import { updateClusterBatches } from './clusterBatchUpdate.ts';
export { IndexRangeAllocator, DrawRanges } from './clusterBatchRange.ts';
export type { BatchPage } from './clusterBatchRange.ts';

export type ClusterBatchStats = {
  drawCalls: number;
  subDraws: number;
  submittedTriangles: number;
  allocationBytes: number;
  pageRangeWrites: number;
  indexBytesWritten: number;
  detachments: number;
};

/** Set of batches of a scene: one index buffer per primitive, one draw object per instance. */
export class ClusterBatches {
  private scene: THREE.Scene;
  private primitives: PrimitiveIndex[] = [];
  private groups: Array<BatchGroup | undefined> = [];
  private layerGroups: Array<Map<number, BatchGroup> | undefined> = [];
  private active: BatchGroup[] = [];
  private touched: BatchGroup[] = [];
  private matrices = identityMatrixTexture();
  private indirect: THREE.DataTexture;
  private shaderHooks = new Map<THREE.Material, ShaderHook>();
  /** Clones created here — back/front of transparents, biased materials: to free, not those of the scene. */
  private ownedMaterials: THREE.Material[] = [];
  private attributeBytes = 0;
  private indexCapacityBytes = 0;
  private stats: ClusterBatchStats = {
    drawCalls: 0,
    subDraws: 0,
    submittedTriangles: 0,
    allocationBytes: 0,
    pageRangeWrites: 0,
    indexBytesWritten: 0,
    detachments: 0,
  };

  constructor(scene: THREE.Scene, pages: readonly BatchPage[]) {
    this.scene = scene;
    const setup = setupClusterBatches(pages);
    this.primitives = setup.primitives;
    this.groups = setup.groups;
    this.layerGroups = setup.layerGroups;
    this.indirect = setup.indirect;
    this.shaderHooks = setup.shaderHooks;
    this.ownedMaterials = setup.ownedMaterials;
    this.attributeBytes = setup.attributeBytes;
    this.indexCapacityBytes = setup.indexCapacityBytes;
    for (const page of pages) if (page.array) this.acceptPage([page], page.array);
    this.stats.allocationBytes = this.indexCapacityBytes + this.attributeBytes;
  }

  get metrics(): Readonly<ClusterBatchStats> {
    return this.stats;
  }
  /** Resident capacity of the index buffers, in bytes. Reread after a possible growth. */
  get indexBytes() {
    let bytes = 0;
    for (let i = 0; i < this.primitives.length; i++) bytes += this.primitives[i].array.byteLength;
    return bytes;
  }

  /** Writes the range of a page that became resident. No other part of the buffer is touched.
   *  A request may carry a streaming packet: each record has then already received its own
   *  view at its offset in that packet, and it is that view — not the packet — that is written. */
  acceptPage(recs: readonly BatchPage[], array: Uint32Array) {
    for (const rec of recs) {
      const group = this.groups[rec.renderOrder];
      if (!group) continue;
      const urlIndex = group.primitive.urlIndexByPage[rec.id];
      if (urlIndex < 0 || group.primitive.slots[urlIndex]) continue;
      const slice = rec.array ?? array;
      const capacity = group.primitive.array.byteLength;
      group.primitive.reserve(urlIndex, slice);
      this.indexCapacityBytes += group.primitive.array.byteLength - capacity;
      this.stats.pageRangeWrites++;
      this.stats.indexBytesWritten += slice.byteLength;
    }
  }

  /** Returns the range of an evicted page to its primitive's allocator. */
  dropPage(recs: readonly BatchPage[]) {
    for (const rec of recs) {
      const group = this.groups[rec.renderOrder];
      if (!group) continue;
      const urlIndex = group.primitive.urlIndexByPage[rec.id];
      if (urlIndex < 0) continue;
      group.primitive.free(urlIndex);
    }
  }

  /** Lists the URLs of a cut without a Set: one stamp per distinct page of each primitive. */
  markUrls(pages: readonly BatchPage[], stamp: number, into: string[]) {
    for (let i = 0; i < pages.length; i++) {
      const rec = pages[i];
      const group = this.groups[rec.renderOrder];
      const urlIndex = group ? group.primitive.urlIndexByPage[rec.id] : -1;
      if (!group || urlIndex < 0) {
        into.push(rec.url);
        continue;
      }
      const stamps = group.primitive.stamps;
      if (stamps[urlIndex] === stamp) continue;
      stamps[urlIndex] = stamp;
      into.push(rec.url);
    }
    return into;
  }

  /** Builds the frame cut from the resident ranges. */
  update(display: readonly BatchPage[]) {
    const state = {
      scene: this.scene,
      groups: this.groups,
      active: this.active,
      touched: this.touched,
      layerGroups: this.layerGroups,
      matrices: this.matrices,
      indirect: this.indirect,
      stats: this.stats,
      indexCapacityBytes: this.indexCapacityBytes,
      attributeBytes: this.attributeBytes,
    };
    updateClusterBatches(state, display);
    this.active = state.active;
    this.touched = state.touched;
  }

  /** Diagnostic modes: batches disappear, pages are drawn one by one by the caller. */
  hideAll() {
    const active = this.active;
    for (let i = 0; i < active.length; i++) {
      const group = active[i];
      if (!group.attached || !group.mesh) continue;
      this.scene.remove(group.mesh);
      group.attached = false;
      this.stats.detachments++;
    }
    active.length = 0;
    this.stats.drawCalls = 0;
    this.stats.subDraws = 0;
    this.stats.submittedTriangles = 0;
  }

  dispose() {
    this.hideAll();
    for (const [material, previous] of this.shaderHooks) {
      material.onBeforeCompile = previous as THREE.Material['onBeforeCompile'];
      delete (material as { customProgramCacheKey?: unknown }).customProgramCacheKey;
      material.needsUpdate = true;
    }
    this.shaderHooks.clear();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedMaterials.length = 0;
    for (const group of everyGroup(this.groups, this.layerGroups)) {
      group.mesh = undefined;
      group.split = undefined;
      group.biased = undefined;
    }
    for (const primitive of this.primitives) primitive.dispose();
    this.primitives.length = 0;
    this.groups.length = 0;
    this.layerGroups.length = 0;
    this.matrices.dispose();
    this.indirect.dispose();
  }
}
