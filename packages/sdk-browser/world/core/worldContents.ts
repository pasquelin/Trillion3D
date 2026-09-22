import type { Object3D } from '../../../sdk-core/world/object/object3d.ts';
import type { Mesh } from '../../../sdk-core/world/object/mesh.ts';
import type { Material } from '../../../sdk-core/world/material/material.ts';
import { createWorldCuts, firstMaterial, type Cut } from './worldCuts.ts';
import { createWorldMaterials, type MaterialEntry } from './worldMaterials.ts';
import { createWorldBatches } from './worldBatches.ts';
import { createWorldPoses, shownUnder } from './worldPoses.ts';
import type { LoadedModel } from './loadedModel.ts';
import { createWorldMembers } from './worldMembers.ts';
import { noticeFolds, type WorldNotices } from '../diagnostic/worldNotices.ts';

/** A surface drawn per source mesh, in its order, rather than by rows: blended or transmissive. */
const drawnWhole = (material: Material) =>
  material.transparent === true || ((material.transmission as number | undefined) ?? 0) > 0;

type Resolved = { cut: Cut; entry: MaterialEntry } | null;

/**
 * What a world's scene draws, held as tables: each mesh resolved to its geometry resource and
 * its material entry (`resolve`, asynchronous — a resource is cut off the frame), then seated on
 * a row of its batch (`seat`, synchronous, before a frame). `opened` is what the session in place
 * was built from; `reopenNeeded` says the scene now asks for something it does not hold.
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
  const whole = new Set<Mesh>();
  const opened = { whole: new Set<Mesh>(), models: new Set<LoadedModel>() };
  const forget = (mesh: Mesh) => {
    resolved.delete(mesh);
    whole.delete(mesh);
    unseated.delete(mesh);
    cuts.leave(mesh);
    batches.unseat(mesh, poses.touch);
  };
  /** Resolves the meshes that entered the scene or were written; forgets those that left.
   *  True when a light entered or left with them. */
  async function resolve() {
    const { added, removed, lights } = members.take();
    removed.forEach(forget);
    const reading = new Set([...added, ...stale]);
    stale.clear();
    for (const mesh of reading) {
      if (!members.meshes.has(mesh)) continue;
      const cut = await cuts.of(mesh);
      if (!members.meshes.has(mesh)) forget(mesh);
      else {
        resolved.set(mesh, cut && { cut, entry: materials.entryOf(firstMaterial(mesh.material)) });
        unseated.add(mesh);
      }
    }
    // What the tables folded is said once, with the count of the burst that folded it.
    const folded = { geometries: cuts.counts.duplicates, materials: materials.counts.duplicates };
    noticeFolds(notices, folded);
    return lights;
  }
  /** Seats the meshes resolved since the last call, writing the rows that were free. */
  function seat() {
    const seating = [...unseated];
    unseated.clear();
    for (const mesh of seating) {
      const entry = resolved.get(mesh);
      if (entry === undefined) continue;
      if (!entry || drawnWhole(entry.entry.material)) {
        batches.unseat(mesh, poses.touch);
        if (entry) whole.add(mesh);
        else whole.delete(mesh);
        continue;
      }
      whole.delete(mesh);
      if (!batches.seat(mesh, entry.cut, entry.entry, poses.touch)) continue;
      mesh.updateWorldMatrix(true, false);
      poses.writeSeat(mesh, batches.seats.get(mesh)!, shownUnder(mesh, scene));
    }
  }
  const same = <T>(a: ReadonlySet<T>, b: Iterable<T>) => {
    let n = 0;
    for (const item of b) if (!a.has(item) || ++n > a.size) return false;
    return n === a.size;
  };
  return {
    cuts,
    materials,
    batches,
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
    reopenNeeded: () =>
      batches.waiting() || !same(opened.whole, whole) || !same(opened.models, members.models),
    /** Sizes the batches and gathers what the next session opens on; marks it opened. */
    plan() {
      const kept = batches.reopen();
      scene.updateMatrixWorld();
      for (const batch of kept)
        batch.owners.forEach(
          (mesh, row) => mesh && poses.writeSeat(mesh, { batch, row }, shownUnder(mesh, scene)),
        );
      poses.settle();
      opened.whole = new Set(whole);
      opened.models = new Set(members.models);
      const drawn = [...whole].map((node) => ({ node, ...resolved.get(node)! }));
      const used = new Set<MaterialEntry>(
        [...resolved.values()].flatMap((r) => (r ? [r.entry] : [])),
      );
      materials.keep(used);
      return { batches: kept, whole: drawn, models: [...members.models] };
    },
    /** The cuts a plan reads: held while its session is open. */
    cutsOf(plan: { batches: { cut: Cut }[]; whole: { cut: Cut }[] }) {
      return new Set([...plan.batches, ...plan.whole].map((item) => item.cut));
    },
    shown: (node: Object3D) => shownUnder(node, scene),
  };
}
