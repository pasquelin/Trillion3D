import * as THREE from 'three';

import type { BatchPage } from './clusterBatchRange.ts';
import { PrimitiveIndex, BatchGroup } from './clusterBatchPrimitive.ts';
import { identityMatrixTexture, type ShaderHook } from './clusterBatchMesh.ts';
import { setupClusterBatches } from './clusterBatchSetup.ts';
import { everyGroup } from './clusterBatchLayers.ts';
import { updateClusterBatches } from './clusterBatchUpdate.ts';
import { WebglClusterOwner } from './webglClusterOwner.ts';
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
  autonomousClusterDrawsTotal: number;
  cpuSubmitMs: number | null;
};

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
  private renderer: WebglClusterOwner | undefined;
  private stats: ClusterBatchStats = {
    drawCalls: 0,
    subDraws: 0,
    submittedTriangles: 0,
    allocationBytes: 0,
    pageRangeWrites: 0,
    indexBytesWritten: 0,
    detachments: 0,
    autonomousClusterDrawsTotal: 0,
    cpuSubmitMs: null,
  };

  constructor(scene: THREE.Scene, pages: readonly BatchPage[], context?: WebGL2RenderingContext) {
    this.scene = scene;
    this.renderer = context ? new WebglClusterOwner(context) : undefined;
    const setup = setupClusterBatches(pages, !context);
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
  get autonomousDraw() {
    return !!this.renderer;
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
      attachMeshes: !this.renderer,
    };
    updateClusterBatches(state, display);
    this.active = state.active;
    this.touched = state.touched;
  }

  draw(
    camera: import('./cameraWorld.ts').HostDrawCamera,
    toneMapped: boolean,
    srgbDestination: boolean,
  ) {
    if (!this.renderer) return;
    this.scene.updateMatrixWorld();
    const meshes: import('./clusterBatchMesh.ts').ClusterDrawMesh[] = [];
    for (const group of this.active) if (group.mesh) meshes.push(group.mesh);
    const start = performance.now();
    const submitted = this.renderer.draw(meshes, this.scene, camera, toneMapped, srgbDestination);
    this.stats.cpuSubmitMs = performance.now() - start;
    this.stats.autonomousClusterDrawsTotal += submitted;
  }

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
    this.renderer?.dispose();
    this.renderer = undefined;
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
