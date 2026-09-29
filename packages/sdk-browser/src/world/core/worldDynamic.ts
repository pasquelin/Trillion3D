import {
  drawnTriangles,
  type DrawnTriangles,
} from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { PageCutPayload } from '../../../../sdk-core/src/page/decodeContracts.ts';
import { packDrawn } from '../page/runtimeCut.ts';
import { cutDynamicPrimitive, servePrimitive, type HeldBox } from '../page/runtimePrimitive.ts';
import type { WorldNotices } from '../diagnostic/worldNotices.ts';
import { changedRanges, copyRanges, LISTS, type VertexUploads } from './worldDynamicRanges.ts';
import { fits, heldBox, readInPlace, readingOf, type Reading } from './worldDynamicRead.ts';
import type { Cut } from './worldCuts.ts';

/** THE PER-FRAME UPLOAD BUDGET OF DYNAMIC GEOMETRY, in bytes sent the GPU (#573): past it an
 *  upload waits for the next frame, never dropped; a larger one still goes as a frame's first. Not
 *  derived from a scene: 4 MiB, a 60 × 60 m sea at 15 cm, 480 MB/s at 120 Hz. */
export const DYNAMIC_UPLOAD_BUDGET_BYTES = 4 * 1024 * 1024;

/** What a dynamic resource holds beside its pages: the box that culls it, the cut that serves them
 *  again in a larger one, and the geometry version read into its lists (`Reading`). */
export type DynamicHeld = Reading & { box: HeldBox; cut: PageCutPayload; version: number };
type Options = Parameters<typeof drawnTriangles>[2];

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
    ways = new WeakMap<Geometry, Map<string, Promise<Cut | null>>>(),
    /** How each resource leaves its geometry's reading, once released. */
    leaves = new WeakMap<Cut, () => void>(),
    /** The resources whose read vertices wait for an upload, in the order they changed. */
    dirty = new Set<Cut>();
  const dynamicOf = (cut: Cut) => cut.dynamic!;
  /** `cut`'s lists read at its geometry's `version`: they wait for the next `upload`. */
  const pend = (cut: Cut, version: number) => {
    dynamicOf(cut).version = version;
    dirty.add(cut);
    return cut;
  };
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
    const [key, users, version] = [`dynamic:${serial++}`, new Set<Mesh>(), geometry.version];
    const state: DynamicHeld = { ...readingOf(geometry, drawn), box, cut, version };
    return { key, drawn, runtime, users, held: false, dynamic: state } satisfies Cut;
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
      // Its corners and lists kept, a rewrite is read into the resource's own lists, then uploaded.
      const kept = before && byWay.get(way) === asked ? before : null;
      if (kept && readInPlace(geometry, mesh.primitive, options, dynamicOf(kept)))
        return pend(kept, geometry.version);
      const drawn = drawnTriangles(geometry, mesh.primitive, options);
      if (!drawn) return null;
      if (kept && fits(kept.drawn, drawn, dynamicOf(kept).box)) {
        const lists = dynamicOf(kept).next;
        for (const [list] of LISTS) lists[list]?.set(drawn[list] ?? lists[list]);
        return pend(kept, geometry.version);
      }
      // A new resource replaces it: what it read and did not upload is read there again.
      if (before) dirty.delete(before);
      const leave = () => byWay.get(way) === next && byWay.delete(way);
      const next: Promise<Cut> = make(drawn, geometry, blended, before ?? undefined).then(
        (cut) => (leaves.set(cut, leave), made(cut), cut),
        (error) => {
          leave();
          throw error;
        },
      );
      byWay.set(way, next);
      return next;
    },
    /** A resource released, its pages no longer served: a later read makes another. */
    forget(cut: Cut) {
      dirty.delete(cut);
      leaves.get(cut)?.();
    },
    /** Writes the read vertices of the resources that changed, in order, until the next would
     *  pass `budget` bytes as `uploads` weighs them; one the session does not draw yet waits.
     *  Returns the bytes sent. Nothing is allocated. */
    upload(budget: number, uploads: VertexUploads) {
      let spent = 0;
      for (const cut of dirty) {
        const held = dynamicOf(cut),
          changed = changedRanges(cut.drawn, held.next),
          bytes = uploads.weigh(cut, changed.ranges, changed.bytes);
        if (spent && spent + bytes > budget) break;
        copyRanges(cut.drawn, held.next, changed.ranges);
        if (!uploads.write(cut, changed.ranges, changed.box)) continue;
        spent += bytes;
        dirty.delete(cut);
      }
      return spent;
    },
  };
}
