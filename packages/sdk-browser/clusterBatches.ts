import type { BatchPage } from './clusterBatchRange.ts';
import { PrimitiveIndex, BatchGroup } from './clusterBatchPrimitive.ts';
import { wholeMeshTriangles, type ClusterDrawMesh, type WholeMesh } from './clusterBatchMesh.ts';
import { setupClusterBatches } from './clusterBatchSetup.ts';
import { everyGroup } from './clusterBatchLayers.ts';
import { updateClusterBatches } from './clusterBatchUpdate.ts';
import type { WebglClusterOwner } from './webglClusterOwner.ts';
import type { HostDrawCamera } from './cameraWorld.ts';
import { drawClusterBatches, type ClusterDrawScene } from './webglClusterBatchDraw.ts';
import type { SceneCopy } from './webglClusterCopyCulling.ts';
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
  /** Submissions of the scene copies in view this frame, the backdrop pass included. */
  copyDraws: number;
  /** Bytes the frozen transmission backdrop holds, kept until a resize or the dispose; zero
   *  before the first transmissive copy in view. */
  backdropBytes: number;
  cpuSubmitMs: number | null;
};

const NO_MESHES: WholeMesh[] = [];
/** A paged-cluster submission: a batch record, or a whole page mesh of a diagnostic mode. */
export type ClusterDraw = ClusterDrawMesh | WholeMesh;
/** What draws: the engine-owned WebGL2 program's public surface, or nothing at all. */
export type ClusterDrawOwner = Pick<WebglClusterOwner, keyof WebglClusterOwner>;

/** Resident index ranges of the paged clusters, batched per primitive instance, and the draw
 *  records the owner submits each frame. The host scene is read for its lights and background. */
export class ClusterBatches {
  private scene: ClusterDrawScene;
  private primitives: PrimitiveIndex[] = [];
  private groups: Array<BatchGroup | undefined> = [];
  private layerGroups: Array<Map<number, BatchGroup> | undefined> = [];
  private active: BatchGroup[] = [];
  private touched: BatchGroup[] = [];
  private attributeBytes = 0;
  private indexCapacityBytes = 0;
  private owner: ClusterDrawOwner | undefined;
  private diagnosticMeshes: readonly WholeMesh[] = NO_MESHES;
  private copies: readonly SceneCopy[];
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
    scene: ClusterDrawScene,
    pages: readonly BatchPage[],
    owner?: ClusterDrawOwner,
    copies: readonly SceneCopy[] = [],
  ) {
    this.scene = scene;
    this.owner = owner;
    this.copies = copies;
    const setup = setupClusterBatches(pages);
    this.primitives = setup.primitives;
    this.groups = setup.groups;
    this.layerGroups = setup.layerGroups;
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
  showPages(meshes: WholeMesh[]) {
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
    for (const group of everyGroup(this.groups, this.layerGroups)) group.mesh = undefined;
    for (const primitive of this.primitives) primitive.dispose();
    this.primitives.length = 0;
    this.groups.length = 0;
    this.layerGroups.length = 0;
  }
}
