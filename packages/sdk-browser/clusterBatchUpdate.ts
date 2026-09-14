import * as THREE from 'three';
import type { BatchPage } from './clusterBatchRange.ts';
import { BatchGroup } from './clusterBatchPrimitive.ts';
import { ClusterDrawMesh } from './clusterBatchMesh.ts';
import type { ClusterBatchStats } from './clusterBatches.ts';

const bySourceOrder = (a: BatchPage, b: BatchPage) =>
  (a.sourceOrder ?? a.id) - (b.sourceOrder ?? b.id);

type BatchUpdateState = {
  scene: THREE.Scene;
  groups: Array<BatchGroup | undefined>;
  active: BatchGroup[];
  touched: BatchGroup[];
  matrices: THREE.DataTexture;
  indirect: THREE.DataTexture;
  stats: ClusterBatchStats;
  indexCapacityBytes: number;
  attributeBytes: number;
};

/** Met à jour les sous-dessins et les objets de la scène sans recopier les index. */
export function updateClusterBatches(state: BatchUpdateState, display: readonly BatchPage[]) {
  const touched = state.touched;
  touched.length = 0;
  for (let i = 0; i < display.length; i++) {
    const rec = display[i];
    if (!rec.array) continue;
    const group = state.groups[rec.renderOrder];
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
  // Les groupes transparents gardent l'ordre source : multi-draw dessine les plages dans l'ordre donné.
  for (let i = 0; i < touched.length; i++) {
    const group = touched[i];
    if (!group.transparent) continue;
    const pending = group.pending;
    pending.length = group.pendingCount;
    // La coupe arrive presque toujours déjà dans l'ordre source : la vérifier coûte un parcours, la
    // trier coûte un tri par groupe transparent et par image.
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
  const active = state.active;
  for (let i = 0; i < active.length; i++) {
    const group = active[i];
    if (group.touched || !group.attached || !group.mesh) continue;
    state.scene.remove(group.mesh);
    group.attached = false;
    state.stats.detachments++;
  }
  let draws = 0,
    subDraws = 0,
    triangles = 0;
  for (let i = 0; i < touched.length; i++) {
    const group = touched[i];
    group.touched = false;
    const sample = group.sample!;
    let mesh = group.mesh;
    const material = group.split ?? sample.material;
    if (!mesh) {
      mesh = new ClusterDrawMesh(
        group.primitive.geometry,
        material,
        group.ranges,
        state.matrices,
        state.indirect,
      );
      mesh.renderOrder = sample.renderOrder;
      mesh.userData.clusterId = String(sample.renderOrder);
      mesh.userData.lodRole = 'exact';
      group.mesh = mesh;
    } else if (mesh.material !== material) mesh.material = material;
    mesh.matrix.copy(sample.matrix);
    // Les tableaux sont réutilisés ; leur identité ne change que lorsqu'ils ont dû grandir.
    mesh._multiDrawStarts = group.ranges.starts;
    mesh._multiDrawCounts = group.ranges.counts;
    mesh._multiDrawCount = group.ranges.count;
    if (!group.attached) {
      state.scene.add(mesh);
      group.attached = true;
    }
    group.primitive.flush();
    draws++;
    subDraws += group.ranges.count;
    triangles += group.triangles;
  }
  state.touched = active;
  state.active = touched;
  state.stats.drawCalls = draws;
  state.stats.subDraws = subDraws;
  state.stats.submittedTriangles = triangles;
  state.stats.allocationBytes = state.indexCapacityBytes + state.attributeBytes;
}
