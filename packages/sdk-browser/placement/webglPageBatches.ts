import {
  hostPageInstances,
  releaseHostInstances,
  setHostInstance,
  setHostInstanceCount,
} from '../hostPageObjects.ts';
import type { HostDrawScene } from '../hostGraphNodes.ts';
import type { HostGeometry, HostMaterials, HostMesh } from '../hostResources.ts';
import type { PageRec } from '../pageSelectionTypes.ts';
import { grownCapacity } from './placementRows.ts';

type Group = { mesh: HostMesh | null; capacity: number; count: number; first: PageRec };

/**
 * The pages the WebGL2 path draws at the rows of an instance buffer: one instanced host mesh per
 * page geometry and surface, whatever number of placements show it, its matrices the rows'. A
 * frame counts what each mesh shows, remakes a mesh too small for it at twice its size at least
 * — its size follows what frames show, never a number picked here —, then writes one matrix per
 * shown record and one count per mesh. A mesh whose page no placement shows leaves the graph. A
 * frame that shows the same records, on rows nobody wrote since, writes nothing.
 */
export function createWebglPageBatches(scene: HostDrawScene) {
  const groups = new Map<HostGeometry, Map<HostMaterials, Group>>();
  const drop = (group: Group) => {
    if (!group.mesh) return;
    scene.remove(group.mesh);
    releaseHostInstances(group.mesh);
    group.mesh = null;
  };
  const groupOf = (rec: PageRec) => {
    let bySurface = groups.get(rec.geometry!);
    if (!bySurface) groups.set(rec.geometry!, (bySurface = new Map()));
    let group = bySurface.get(rec.declaration);
    if (!group)
      bySurface.set(rec.declaration, (group = { mesh: null, capacity: 0, count: 0, first: rec }));
    return group;
  };
  // What the last draw wrote: its records, with the geometry and surface each wore then. A frame
  // that shows the same, on rows nobody wrote since, leaves every matrix and count as it is.
  const drawn: PageRec[] = [],
    drawnGeometry: (HostGeometry | undefined)[] = [],
    drawnSurface: HostMaterials[] = [];
  let rowsWritten = true;
  const unchanged = (shown: readonly PageRec[]) => {
    if (rowsWritten || shown.length !== drawn.length) return false;
    for (let i = 0; i < shown.length; i++) {
      const rec = shown[i];
      if (
        rec !== drawn[i] ||
        rec.geometry !== drawnGeometry[i] ||
        rec.declaration !== drawnSurface[i]
      )
        return false;
    }
    return true;
  };
  const remember = (shown: readonly PageRec[]) => {
    rowsWritten = false;
    drawn.length = drawnGeometry.length = drawnSurface.length = shown.length;
    for (let i = 0; i < shown.length; i++) {
      drawn[i] = shown[i];
      drawnGeometry[i] = shown[i].geometry;
      drawnSurface[i] = shown[i].declaration;
    }
  };
  return {
    /** Rows were written or rebound: the next draw writes its matrices again. */
    rowsWritten() {
      rowsWritten = true;
    },
    /** Draws `shown` — records placed by rows, each with its geometry — this frame. */
    draw(shown: readonly PageRec[]) {
      if (unchanged(shown)) return;
      for (const bySurface of groups.values())
        for (const group of bySurface.values()) group.count = 0;
      for (const rec of shown) groupOf(rec).count++;
      for (const [geometry, bySurface] of groups) {
        for (const [surface, group] of bySurface) {
          if (!group.count) {
            drop(group);
            bySurface.delete(surface);
          } else if (group.count > group.capacity) {
            drop(group);
            group.capacity = grownCapacity(group.capacity, group.count);
            const { first } = group;
            group.mesh = hostPageInstances(geometry, surface, first.renderOrder, group.capacity);
            scene.add(group.mesh);
          }
          group.count = 0;
        }
        if (!bySurface.size) groups.delete(geometry);
      }
      for (const rec of shown) {
        const group = groupOf(rec);
        setHostInstance(group.mesh!, group.count++, rec.matrix);
      }
      for (const bySurface of groups.values())
        for (const group of bySurface.values()) setHostInstanceCount(group.mesh!, group.count);
      remember(shown);
    },
    /** Takes every instanced page off the display graph. */
    clear() {
      for (const bySurface of groups.values()) for (const group of bySurface.values()) drop(group);
      groups.clear();
      rowsWritten = true;
    },
  };
}
