import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { createWorldCuts, firstMaterial, type Cut } from './worldCuts.ts';
import { createWorldMaterials, type MaterialEntry } from './worldMaterials.ts';
import { createWorldBatches } from './worldBatches.ts';
import { createWorldPoses, shownUnder } from './worldPoses.ts';
import type { LoadedModel } from './loadedModel.ts';
import type { PlacementRows } from '../../placement/placementRows.ts';
import { createWorldMembers } from './worldMembers.ts';
import { noticeFolds, type WorldNotices } from '../diagnostic/worldNotices.ts';

type Resolved = { cut: Cut; entry: MaterialEntry } | null;

/**
 * What a world's scene draws, held as tables: each mesh resolved to its geometry resource and
 * its material entry (`resolve`, asynchronous — a resource is cut off the frame), then seated on
 * a row of its batch (`seat`, synchronous, before a frame). `openedModels` is what the session in
 * place was built from; `reopenNeeded` says the scene now asks for something it does not hold — full
 * rows excepted, which `growHeld` grows in place on a session that can.
 */
export function createWorldContents(scene: Object3D, notices: WorldNotices) {
  const cuts = createWorldCuts(),
    materials = createWorldMaterials(),
    batches = createWorldBatches(),
    poses = createWorldPoses();
  const members = createWorldMembers(scene);
  const resolved = new Map<Mesh, Resolved>();
  const stale = new Set<Mesh>(),
    unseated = new Set<Mesh>();
  let openedModels = new Set<LoadedModel>();
  const forget = (mesh: Mesh) => {
    resolved.delete(mesh);
    unseated.delete(mesh);
    cuts.leave(mesh);
    batches.unseat(mesh, poses.touch);
  };
  /** Resolves the meshes that entered the scene or were written; forgets those that left.
   *  True when a light entered or left with them. */
  async function resolve() {
    const { added, removed, lights } = members.take();
    removed.forEach(forget);
    const reading = [...new Set([...added, ...stale])].filter((mesh) => members.meshes.has(mesh));
    stale.clear();
    // Every resource is read at once; the meshes are then seated in the order they came.
    const read = await Promise.all(reading.map((mesh) => cuts.of(mesh)));
    reading.forEach((mesh, i) => {
      const cut = read[i];
      if (!members.meshes.has(mesh)) return forget(mesh);
      resolved.set(mesh, cut && { cut, entry: materials.entryOf(firstMaterial(mesh.material)) });
      unseated.add(mesh);
    });
    // What the tables folded is said once, with the count of the burst that folded it.
    const folded = { geometries: cuts.counts.duplicates, materials: materials.counts.duplicates };
    noticeFolds(notices, folded);
    return lights;
  }
  type Grow = (from: PlacementRows, to: PlacementRows) => void;
  /** Writes a seated mesh's world matrix and flag into its row. */
  const writeRow = (mesh: Mesh) => {
    mesh.updateWorldMatrix(true, false);
    poses.writeSeat(mesh, batches.seats.get(mesh)!, shownUnder(mesh, scene));
  };
  /**
   * Seats the meshes waiting in batches the session holds, their rows grown in place: `grow`
   * hands each replaced buffer and its successor to the session, whose every row is then sent
   * again, and each mesh seated writes its row.
   */
  function growHeld(grow: Grow) {
    const seated: Mesh[] = [];
    for (const { batch, from } of batches.growHeld((mesh) => seated.push(mesh))) {
      grow(from, batch.rows!);
      poses.touch(batch, 0);
      poses.touch(batch, batch.rows!.capacity - 1);
    }
    seated.forEach(writeRow);
  }
  /** Seats the meshes resolved since the last call, writing the rows that were free, then — on a
   *  session that grows its buffers, `grow` — those a full buffer made wait. A blended or
   *  transmissive surface takes a row like any other: the session draws each row of it as its own
   *  blended draw, ordered by depth. */
  function seat(grow?: Grow) {
    const seating = [...unseated];
    unseated.clear();
    for (const mesh of seating) {
      const entry = resolved.get(mesh);
      if (entry === undefined) continue;
      if (!entry) {
        batches.unseat(mesh, poses.touch);
        continue;
      }
      if (batches.seat(mesh, entry.cut, entry.entry, poses.touch)) writeRow(mesh);
    }
    if (grow) growHeld(grow);
  }
  const same = <T>(a: ReadonlySet<T>, b: Iterable<T>) => {
    let n = 0;
    for (const item of b) if (!a.has(item) || ++n > a.size) return false;
    return n === a.size;
  };
  return {
    cuts,
    /** The row each seated mesh holds. */
    seats: batches.seats,
    poses,
    resolve,
    seat,
    /** A mesh's geometry or material was written: it is read again on the next resolve. */
    stale: (mesh: Mesh) => stale.add(mesh),
    get staleCount() {
      return stale.size;
    },
    /** `parent`'s children changed: read at the next resolve. */
    changed: members.changed,
    reopenNeeded: () => batches.waiting() || !same(openedModels, members.models),
    /** Sizes the batches and gathers what the next session opens on; marks it opened. */
    plan() {
      const kept = batches.reopen();
      scene.updateMatrixWorld();
      for (const batch of kept)
        batch.owners.forEach(
          (mesh, row) => mesh && poses.writeSeat(mesh, { batch, row }, shownUnder(mesh, scene)),
        );
      poses.settle();
      openedModels = new Set(members.models);
      const used = new Set<MaterialEntry>(
        [...resolved.values()].flatMap((r) => (r ? [r.entry] : [])),
      );
      materials.keep(used);
      return { batches: kept, models: [...members.models] };
    },
    shown: (node: Object3D) => shownUnder(node, scene),
  };
}
