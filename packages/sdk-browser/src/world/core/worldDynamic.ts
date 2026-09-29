import {
  drawnTriangles,
  type DrawnTriangles,
} from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { boxEmpty, boxExpandByPoint } from '../../../../sdk-core/src/math/primitives/box.ts';
import type { PageCutPayload } from '../../../../sdk-core/src/page/decodeContracts.ts';
import { packDrawn } from '../page/runtimeCut.ts';
import { cutDynamicPrimitive, servePrimitive, type HeldBox } from '../page/runtimePrimitive.ts';
import type { WorldNotices } from '../diagnostic/worldNotices.ts';
import { changedRanges, copyRanges } from './worldDynamicRanges.ts';
import type { VertexRange } from '../../placement/backendSceneUpdates.ts';
import type { Cut } from './worldCuts.ts';

/**
 * THE PER-FRAME UPLOAD BUDGET OF DYNAMIC GEOMETRY, in bytes (#573): a frame uploads the changed
 * vertices of its dynamic resources in the order they changed, until the next one would pass it —
 * deferred then to the next frame, never dropped, its previous vertices drawn meanwhile. A
 * resource larger than the budget still goes whole as a frame's first. It is not derived from a
 * scene: it bounds what one frame writes to the GPU, 4 MiB — 170 000 vertices of position and
 * normal, a 60 × 60 m sea at 15 cm —, 480 MB/s at 120 Hz.
 */
export const DYNAMIC_UPLOAD_BUDGET_BYTES = 4 * 1024 * 1024;

/** What a dynamic resource holds beside its pages: the box that culls it, the cut that serves them
 *  again in a larger one, and the triangles read since its last upload, if any. */
export type DynamicHeld = {
  box: HeldBox;
  cut: PageCutPayload;
  blended: boolean;
  version: number;
  pending: DrawnTriangles | null;
};
type Options = Parameters<typeof drawnTriangles>[2];

/** The drawn box of `drawn`, joined to `declared` and `before`; widened by half its size when
 *  nothing was declared, so that a sheet that waves stays within the box it was cut in. */
function heldBox(drawn: DrawnTriangles, declared: Geometry['maxBounds'], before?: HeldBox) {
  const box = new Float64Array(6);
  boxEmpty(box, 0);
  const p = drawn.positions;
  for (let i = 0; i + 2 < p.length; i += 3) boxExpandByPoint(box, 0, p[i], p[i + 1], p[i + 2]);
  if (declared) {
    boxExpandByPoint(box, 0, declared.min.x, declared.min.y, declared.min.z);
    boxExpandByPoint(box, 0, declared.max.x, declared.max.y, declared.max.z);
  }
  if (before) {
    boxExpandByPoint(box, 0, before[0], before[1], before[2]);
    boxExpandByPoint(box, 0, before[3], before[4], before[5]);
  }
  const pad = declared ? 0 : Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1e-3) / 2;
  for (let a = 0; a < 3; a++) {
    box[a] -= pad;
    box[a + 3] += pad;
  }
  return box;
}

/** Whether `next` draws the triangles `held` draws — the same corners, the same lists —, and
 *  within `box`: its vertices can then be written in place. */
function fits(held: DrawnTriangles, next: DrawnTriangles, box: HeldBox) {
  const lists = ['positions', 'normals', 'uvs', 'colors'] as const;
  const same =
    held.indices.length === next.indices.length &&
    held.indices.every((v, i) => v === next.indices[i]) &&
    lists.every((list) => held[list]?.length === next[list]?.length);
  const p = next.positions;
  for (let i = 0; same && i < p.length; i++)
    if (p[i] < box[i % 3] || p[i] > box[(i % 3) + 3]) return false;
  return same;
}

/**
 * THE DYNAMIC GEOMETRY OF A WORLD (#573). A geometry that declares `usage: 'dynamic'`, or whose
 * version changes on two consecutive frames — said once under `geometry-dynamic`, naming the
 * mesh —, is cut into pages once, index pages alone (`servePrimitive`), and never again while its
 * triangles keep their corners: a new version is read, and its changed vertices wait for
 * `upload`, which writes them in place under the frame's budget. Vertices that leave the held box
 * serve the same pages again in a larger one — nothing is cut —; corners that change are cut anew.
 */
export function createWorldDynamic(notices: WorldNotices | undefined, counts: { cuts: number }) {
  let frame = 0,
    serial = 0;
  const changes = new WeakMap<Geometry, { version: number; frame: number }>(),
    dynamic = new WeakSet<Geometry>(),
    ways = new WeakMap<Geometry, Map<string, Promise<Cut | null>>>();
  /** The resources whose read vertices wait for an upload, in the order they changed. */
  const dirty = new Set<Cut>();
  const dynamicOf = (cut: Cut) => cut.dynamic!;
  /** Whether `mesh`'s geometry takes the dynamic path: declared, or changed on two frames in a row. */
  const wants = (mesh: Mesh) => {
    const geometry = mesh.geometry,
      declared = geometry.usage === 'dynamic';
    if (dynamic.has(geometry)) return true;
    const seen = changes.get(geometry);
    const detected = !!seen && seen.version !== geometry.version && frame - seen.frame === 1;
    // First seen, a geometry has changed on no frame yet.
    if (!seen || seen.version !== geometry.version)
      changes.set(geometry, { version: geometry.version, frame: seen ? frame : -Infinity });
    if (!declared && !detected) return false;
    dynamic.add(geometry);
    const name = mesh.name || `(unnamed ${mesh.type})`;
    notices?.say(
      'geometry-dynamic',
      `Mesh "${name}" ${declared ? 'declares' : 'rewrites every frame'} its geometry: its vertices are uploaded in place, never cut again`,
      { kind: 'lifecycle', mesh: name, declared },
    );
    return true;
  };
  /** A new resource for `drawn`: cut, or `before`'s cut served in a larger box. */
  const make = async (
    drawn: DrawnTriangles,
    geometry: Geometry,
    blended: boolean,
    before?: Cut,
  ) => {
    const held = before && dynamicOf(before);
    const box = heldBox(drawn, geometry.maxBounds, held?.box);
    // Its corners unchanged, a larger box serves the same pages again: nothing is cut.
    const again = held && fits(before.drawn, drawn, box);
    if (!again) counts.cuts++;
    const { cut, runtime } = again
      ? { cut: held.cut, runtime: servePrimitive(held.cut, drawn, box) }
      : await cutDynamicPrimitive(packDrawn(drawn, blended), drawn, box);
    const state: DynamicHeld = { box, cut, blended, version: geometry.version, pending: null };
    return {
      key: `dynamic:${serial++}`,
      drawn,
      runtime,
      users: new Set<Mesh>(),
      held: false,
      dynamic: state,
    } satisfies Cut;
  };
  return {
    wants,
    /** A frame was drawn: two changes a frame apart are consecutive. */
    tick: () => void frame++,
    /** The dynamic resource `mesh` draws read `way`; `made` hears each new one. */
    async of(
      mesh: Mesh,
      way: string,
      options: Options,
      blended: boolean,
      made: (cut: Cut) => void,
    ) {
      const geometry = mesh.geometry;
      const byWay = ways.get(geometry) ?? new Map<string, Promise<Cut | null>>();
      ways.set(geometry, byWay);
      const asked = byWay.get(way),
        before = await asked;
      if (before && dynamicOf(before).version === geometry.version) return before;
      const drawn = drawnTriangles(geometry, mesh.primitive, options);
      if (!drawn) return null;
      if (before && byWay.get(way) === asked && fits(before.drawn, drawn, dynamicOf(before).box)) {
        Object.assign(dynamicOf(before), { version: geometry.version, pending: drawn });
        dirty.add(before);
        return before;
      }
      // A failed cut leaves no trace: the next read of this geometry tries again.
      const next: Promise<Cut> = make(drawn, geometry, blended, before ?? undefined).then(
        (cut) => (made(cut), cut),
        (error) => {
          if (byWay.get(way) === next) byWay.delete(way);
          throw error;
        },
      );
      byWay.set(way, next);
      return next;
    },
    /** A resource released: a later read of its geometry makes another. */
    forget(cut: Cut) {
      dirty.delete(cut);
    },
    /**
     * Writes the read vertices of the resources that changed, in order, until the next would pass
     * `budget` bytes; `write` hands each resource's changed ranges to the session, false when it
     * does not draw that resource yet — it then waits. Returns the bytes written.
     */
    upload(budget: number, write: (cut: Cut, ranges: VertexRange[], box: Float64Array) => boolean) {
      let spent = 0;
      for (const cut of dirty) {
        const held = dynamicOf(cut),
          next = held.pending!,
          changed = changedRanges(cut.drawn, next);
        if (spent && spent + changed.bytes > budget) break;
        copyRanges(cut.drawn, next, changed.ranges);
        if (!write(cut, changed.ranges, changed.box)) continue;
        spent += changed.bytes;
        held.pending = null;
        dirty.delete(cut);
      }
      return spent;
    },
  };
}
