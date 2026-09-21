import type * as THREE from 'three';
import type { BatchPage } from './clusterBatchRange.ts';
import { BatchGroup } from './clusterBatchPrimitive.ts';
import { ClusterDrawMesh } from './clusterBatchMesh.ts';
import { groupForPage } from './clusterBatchLayers.ts';
import type { ClusterBatchStats } from './clusterBatches.ts';

const bySourceOrder = (a: BatchPage, b: BatchPage) =>
  (a.sourceOrder ?? a.id) - (b.sourceOrder ?? b.id);
const byDrawOrder = (a: BatchGroup, b: BatchGroup) =>
  Number(a.transparent) - Number(b.transparent) ||
  a.sample!.renderOrder - b.sample!.renderOrder ||
  a.layer - b.layer;

type BatchUpdateState = {
  groups: Array<BatchGroup | undefined>;
  /** Twin batches of coplanar layers, by `renderOrder` then by layer. */
  layerGroups: Array<Map<number, BatchGroup> | undefined>;
  active: BatchGroup[];
  touched: BatchGroup[];
  stats: ClusterBatchStats;
  indexCapacityBytes: number;
  attributeBytes: number;
};

function setMaterial(
  mesh: ClusterDrawMesh,
  material: THREE.Material | THREE.Material[],
  source: THREE.Material | THREE.Material[],
  biased: boolean,
) {
  mesh.material = material;
  mesh._sideSplitMaterials = Array.isArray(material)
    ? (material as [THREE.Material, THREE.Material])
    : undefined;
  mesh._sideSplitBack = mesh._sideSplitMaterials?.[0];
  mesh._sideSplitFront = mesh._sideSplitMaterials?.[1];
  mesh._sideSplitSource = mesh._sideSplitMaterials
    ? Array.isArray(source)
      ? undefined
      : source
    : undefined;
  mesh._sideSplitPolygonMaterials = biased ? mesh._sideSplitMaterials : undefined;
}

/** Updates the sub-draws and the draw records without copying the indices. */
export function updateClusterBatches(state: BatchUpdateState, display: readonly BatchPage[]) {
  const touched = state.touched;
  touched.length = 0;
  for (let i = 0; i < display.length; i++) {
    const rec = display[i];
    if (!rec.array) continue;
    // A cluster of a coplanar layer above 0 joins the twin batch that carries the bias.
    const group = groupForPage(state.groups, state.layerGroups, rec);
    if (!group) continue;
    const urlIndex = group.primitive.urlIndexByPage[rec.id];
    if (urlIndex < 0) continue;
    const slot = group.primitive.slots[urlIndex];
    if (!slot) continue;
    if (!group.touched) {
      group.touched = true;
      group.ranges.reset();
      group.triangles = 0;
      group.pendingCount = 0;
      group.sample = rec;
      touched.push(group);
    }
    if (group.transparent) {
      group.pending[group.pendingCount++] = rec;
      continue;
    }
    group.ranges.push(slot.offset, slot.length);
    group.triangles += rec.triangles;
  }
  // Transparent groups keep source order: multi-draw draws the ranges in the given order.
  for (let i = 0; i < touched.length; i++) {
    const group = touched[i];
    if (!group.transparent) continue;
    const pending = group.pending;
    pending.length = group.pendingCount;
    // The cut almost always already arrives in source order: checking it costs a walk,
    // sorting it costs a sort per transparent group and per frame.
    let ordered = true;
    for (let k = 1; k < pending.length && ordered; k++)
      if (bySourceOrder(pending[k - 1], pending[k]) > 0) ordered = false;
    if (!ordered) pending.sort(bySourceOrder);
    for (let k = 0; k < pending.length; k++) {
      const rec = pending[k];
      const slot = group.primitive.slots[group.primitive.urlIndexByPage[rec.id]]!;
      group.ranges.push(slot.offset, slot.length);
      group.triangles += rec.triangles;
    }
  }
  let draws = 0,
    subDraws = 0,
    triangles = 0;
  for (let i = 0; i < touched.length; i++) {
    const group = touched[i];
    group.touched = false;
    const sample = group.sample!;
    let mesh = group.mesh;
    const material = group.biased ?? group.split ?? sample.material;
    if (!mesh) {
      mesh = new ClusterDrawMesh(
        group.primitive.geometry,
        material,
        group.ranges,
        sample.renderOrder,
      );
      group.mesh = mesh;
      setMaterial(mesh, material, sample.material, group.biased === material);
    } else if (
      mesh.material !== material ||
      (Array.isArray(material) && mesh._sideSplitSource !== sample.material)
    )
      setMaterial(mesh, material, sample.material, group.biased === material);
    mesh.matrix.elements.set(sample.matrix.elements);
    // Arrays are reused; their identity changes only when they had to grow.
    mesh._multiDrawStarts = group.ranges.starts;
    mesh._multiDrawCounts = group.ranges.counts;
    mesh._multiDrawCount = group.ranges.count;
    group.primitive.flush();
    draws++;
    subDraws += group.ranges.count;
    triangles += group.triangles;
  }
  touched.sort(byDrawOrder);
  state.touched = state.active;
  state.active = touched;
  state.stats.drawCalls = draws;
  state.stats.subDraws = subDraws;
  state.stats.submittedTriangles = triangles;
  state.stats.allocationBytes = state.indexCapacityBytes + state.attributeBytes;
}
