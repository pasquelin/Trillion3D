import type * as THREE from 'three';

import type { BatchPage } from './clusterBatchRange.ts';
import { PrimitiveIndex, BatchGroup } from './clusterBatchPrimitive.ts';
import { wholeMeshTriangles, type ClusterDrawMesh } from './clusterBatchMesh.ts';
import { setupClusterBatches } from './clusterBatchSetup.ts';
import { everyGroup } from './clusterBatchLayers.ts';
import { updateClusterBatches } from './clusterBatchUpdate.ts';
import type { WebglClusterOwner } from './webglClusterOwner.ts';
import type { HostDrawCamera } from './cameraWorld.ts';
import { drawClusterBatches } from './webglClusterBatchDraw.ts';
import { EngineError } from '../sdk-core/index.ts';
export { IndexRangeAllocator, DrawRanges } from './clusterBatchRange.ts';
export type { BatchPage } from './clusterBatchRange.ts';

export type ClusterBatchStats = {
  drawCalls: number;
  subDraws: number;
  submittedTriangles: number;
  allocationBytes: number;
  pageRangeWrites: number;
  indexBytesWritten: number;
  autonomousClusterDrawsTotal: number;
  /** Scene copies the owner submitted this frame: the transmissive surfaces in view. */
  copyDraws: number;
  /** Bytes of the frozen transmission backdrop; zero while no copy transmits. */
  backdropBytes: number;
  cpuSubmitMs: number | null;
};

const NO_MESHES: THREE.Mesh[] = [];
/** A paged-cluster submission: a batch record, or a whole page mesh of a diagnostic mode. */
export type ClusterDraw = ClusterDrawMesh | THREE.Mesh;
/** What draws: the engine-owned WebGL2 program, or nothing at all. */
type Owned = 'draw' | 'dispose' | 'backdropBytes' | 'copySubmissions';
export type ClusterDrawOwner = Pick<WebglClusterOwner, Owned>;

/** Resident index ranges of the paged clusters, batched per primitive instance, and the draw
 *  records the owner submits each frame. The host scene is read for its lights and background. */
export class ClusterBatches {
  private scene: THREE.Scene;
  private primitives: PrimitiveIndex[] = [];
  private groups: Array<BatchGroup | undefined> = [];
  private layerGroups: Array<Map<number, BatchGroup> | undefined> = [];
  private active: BatchGroup[] = [];
  private touched: BatchGroup[] = [];
  /** Clones created here — back/front of transparents, biased materials: to free, not those of the scene. */
  private ownedMaterials: THREE.Material[] = [];
  private attributeBytes = 0;
  private indexCapacityBytes = 0;
  private owner: ClusterDrawOwner | undefined;
  private diagnosticMeshes: readonly THREE.Mesh[] = NO_MESHES;
  private copies: readonly THREE.Mesh[];
  private stats: ClusterBatchStats = {
    drawCalls: 0,
    subDraws: 0,
    submittedTriangles: 0,
    allocationBytes: 0,
    pageRangeWrites: 0,
    indexBytesWritten: 0,
    autonomousClusterDrawsTotal: 0,
    copyDraws: 0,
    backdropBytes: 0,
    cpuSubmitMs: null,
  };

  /** No `owner` where no WebGL2 context exists: the cut still runs, a draw is refused by name. */
  constructor(
    scene: THREE.Scene,
    pages: readonly BatchPage[],
    owner?: ClusterDrawOwner,
    copies: readonly THREE.Mesh[] = [],
  ) {
    this.scene = scene;
    this.owner = owner;
    this.copies = copies;
    const setup = setupClusterBatches(pages);
    this.primitives = setup.primitives;
    this.groups = setup.groups;
    this.layerGroups = setup.layerGroups;
    this.ownedMaterials = setup.ownedMaterials;
    this.attributeBytes = setup.attributeBytes;
    this.indexCapacityBytes = setup.indexCapacityBytes;
    for (const page of pages) if (page.array) this.acceptPage([page], page.array);
    this.stats.allocationBytes = this.indexCapacityBytes + this.attributeBytes;
  }
  get metrics(): Readonly<ClusterBatchStats> {
    return this.stats;
  }
  /** What the owner submits for the paged clusters, in submission order: the batch records of
   *  the cut, or the whole page meshes of a diagnostic mode. */
  get drawList(): readonly ClusterDraw[] {
    const draws: ClusterDraw[] = [];
    for (const group of this.active) if (group.mesh) draws.push(group.mesh);
    return draws.concat(this.diagnosticMeshes);
  }
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
  dropPage(recs: readonly BatchPage[]) {
    for (const rec of recs) {
      const group = this.groups[rec.renderOrder];
      if (!group) continue;
      const urlIndex = group.primitive.urlIndexByPage[rec.id];
      if (urlIndex < 0) continue;
      group.primitive.free(urlIndex);
    }
  }
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
  update(display: readonly BatchPage[]) {
    this.stats.cpuSubmitMs = null;
    this.diagnosticMeshes = NO_MESHES;
    const state = {
      groups: this.groups,
      active: this.active,
      touched: this.touched,
      layerGroups: this.layerGroups,
      stats: this.stats,
      indexCapacityBytes: this.indexCapacityBytes,
      attributeBytes: this.attributeBytes,
    };
    updateClusterBatches(state, display);
    this.active = state.active;
    this.touched = state.touched;
  }
  /** A diagnostic mode draws whole page meshes instead of the batches, until the next `update`. */
  showPages(meshes: THREE.Mesh[]) {
    this.diagnosticMeshes = meshes;
    this.active.length = 0;
    this.stats.drawCalls = this.stats.subDraws = meshes.length;
    this.stats.submittedTriangles = 0;
    for (const mesh of meshes) this.stats.submittedTriangles += wholeMeshTriangles(mesh);
  }
  draw(camera: HostDrawCamera, toneMapped: boolean, srgbDestination: boolean) {
    if (!this.owner)
      throw new EngineError('WEBGL2_UNAVAILABLE', 'engine WebGL2 context unavailable');
    drawClusterBatches(
      this.owner,
      this.active,
      this.diagnosticMeshes,
      this.copies,
      this.scene,
      camera,
      toneMapped,
      srgbDestination,
      this.stats,
    );
  }
  dispose() {
    this.owner?.dispose();
    this.owner = undefined;
    this.showPages([]);
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
  }
}
