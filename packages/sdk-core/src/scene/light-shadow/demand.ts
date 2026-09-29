import { LIGHT_KIND, LIGHT_SETTINGS, type ShadowViewpoint } from '../light/contracts.ts';
import type { SceneLightStore } from '../light/store.ts';
import { frustumExcludesBox } from '../../math/frustum/box.ts';
import { boxLeastAlong, boxPointFarthest } from '../../math/primitives/boxReach.ts';
import { castsShadow } from './casters.ts';
import { createLampDemand, type DemandLight } from './demandLamp.ts';
import { createSunDemand } from './demandSun.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRequestReport, createShadowRequests } from './requests.ts';
import type { SunLevels } from './sunLevels.ts';
import type { ShadowTable } from './table.ts';
import { RECEIVER_FLOATS, createReceiverCells, type ShadowReceivers } from './receiverCells.ts';
import {
  LAMP_FLOOR_MIP,
  SHADOW_TABLE_ENTRIES,
  lampEntry,
  lampFacesOf,
  shadowRequestCap,
} from './virtual.ts';

type ShadowRequests = ReturnType<typeof createShadowRequests>;

/**
 * How far from the lit point its reading reaches, in texels of the level it reads: the normal
 * offset — half a texel, plus up to the PCF's reach past 45° (`shadowNormalTexels`), which the
 * sixteen taps keep under 3 texels —, then the taps' footprints and the neighbour page across a
 * seam, 1.5 texels. The browser test checks it against the WGSL constants.
 */
export const demandMarginTexels = () => LIGHT_SETTINGS.shadowNormalOffsetTexels + 3 + 1.5;
/** Halvings of a receiver whose levels span more than one, until each part is about a page. */
const MAX_SPLITS = 12;

/**
 * THE EARLY DEMAND: the pages the frame's receivers read, known before its shadow raster, in the
 * frame — no readback, no frame late. For every shadowed light and every receiver box inside the
 * camera's frustum, the levels its pixels read there (`levels`), from the least and the most
 * footprint over the box, and at each the pages the box — grown by the reading's margin — covers.
 * A box whose levels span more than one is halved along its longest side until they do not, or it
 * is about a page wide at its finest: a floor is read at its fine mips only near the camera. The
 * list is a request report of this frame, read by the scheduler as any other (`requests.consume`):
 * page identity, residency and validity keep their one set of rules.
 *
 * The readback of the shading stays: the proof an image may hold, and, a frame late, what the
 * receivers missed (`read`). Allocates nothing past construction.
 */
export function createShadowDemand(table: ShadowTable, pool: ShadowPool, sun: SunLevels) {
  const cap = shadowRequestCap(pool.pages),
    seen = new Uint32Array(SHADOW_TABLE_ENTRIES / 32),
    stack = new Float64Array((MAX_SPLITS + 1) * RECEIVER_FLOATS),
    levels = new Int32Array(2),
    gathered = createReceiverCells(),
    lampDemand = createLampDemand(),
    sunDemand = createSunDemand(sun),
    margin = demandMarginTexels(),
    report: ShadowRequestReport = {
      frame: -1,
      layoutEpoch: -1,
      stamp: -1,
      count: 0,
      entries: new Uint32Array(cap),
    };
  const mark = (entry: number) => {
    const word = entry >>> 5,
      bit = 1 << (entry & 31);
    if (seen[word] & bit) return;
    seen[word] |= bit;
    if (report.count < cap) report.entries[report.count] = entry;
    report.count++;
  };
  let view: ShadowViewpoint, receivers: ShadowReceivers;
  /** Least and most footprint of a pixel over the box — its view depth, then its distance —,
   *  widened by 1/64: the projection's jitter and rounding. */
  const footprint = (o: number, most: boolean) => {
    const pixel = most ? receivers.pixelNearMost : receivers.pixelNear;
    if (receivers.orthographic) return pixel;
    const eye = view.position;
    if (most)
      return (
        (pixel * boxPointFarthest(stack, o, eye[0], eye[1], eye[2]) * (1 + 1 / 64)) / view.near
      );
    return (
      (pixel * Math.max(boxLeastAlong(stack, o, view.forward, eye), view.near) * (1 - 1 / 64)) /
      view.near
    );
  };
  const visit = (light: DemandLight, depth: number) => {
    const o = depth * RECEIVER_FLOATS;
    // A cell holds boxes the frustum keeps, in the light's reach (`write`): only its halves test.
    if (depth) {
      const b = stack;
      if (
        frustumExcludesBox(receivers.planes, b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5])
      )
        return;
      if (!light.reaches(stack, o)) return;
    }
    light.levels(stack, o, footprint(o, false), footprint(o, true), levels);
    const fine = levels[0],
      coarse = levels[1];
    if (fine > coarse) return;
    let axis = 0;
    for (let k = 1; k < 3; k++)
      if (stack[o + 3 + k] - stack[o + k] > stack[o + 3 + axis] - stack[o + axis]) axis = k;
    const side = stack[o + 3 + axis] - stack[o + axis];
    if (fine < coarse && depth < MAX_SPLITS && side > light.pageSide(stack, o, fine)) {
      const c = o + RECEIVER_FLOATS,
        middle = stack[o + axis] + side / 2;
      for (let half = 0; half < 2; half++) {
        stack.copyWithin(c, o, o + RECEIVER_FLOATS);
        stack[c + (half ? axis : 3 + axis)] = middle;
        visit(light, depth + 1);
      }
      return;
    }
    for (let level = fine; level <= coarse; level++) light.mark(stack, o, level, margin);
  };
  const demand = {
    /** This frame's demand, as a report stamped `stamp`: every page its receivers read. */
    write(
      store: SceneLightStore,
      at: ShadowViewpoint,
      from: ShadowReceivers,
      frame: number,
      stamp: number,
    ) {
      view = at;
      receivers = from;
      // The words last listed, or the whole set past a list that overflowed.
      if (report.count > cap) seen.fill(0);
      else for (let i = 0; i < report.count; i++) seen[report.entries[i] >>> 5] = 0;
      report.frame = frame;
      report.layoutEpoch = table.layoutEpoch;
      report.stamp = stamp;
      report.count = 0;
      const cells = gathered.gather(from, at);
      for (let slot = 0; slot < store.count; slot++) {
        const slice = store.sliceOf(slot),
          light = slice >= 0 && castsShadow(store, slot) ? store.light(store.ids[slot]) : undefined;
        if (!light) continue;
        const base = table.baseOf(slice);
        const reader =
          light.kind === 'directional'
            ? sunDemand.aim(slice, base, mark)
            : lampDemand.aim(light, base, mark);
        // Every face's floor, as `requests.floors` asks a lamp's: what a reader falls back to last.
        if (light.kind !== 'directional')
          for (let face = 0; face < lampFacesOf(LIGHT_KIND[light.kind]); face++)
            mark(base + lampEntry(face, LAMP_FLOOR_MIP, 0, 0));
        for (let r = 0; r < cells.count; r++) {
          if (!reader.reaches(cells.boxes, r * RECEIVER_FLOATS)) continue;
          for (let k = 0; k < RECEIVER_FLOATS; k++) stack[k] = cells.boxes[r * RECEIVER_FLOATS + k];
          visit(reader, 0);
        }
      }
      return report;
    },
    /**
     * Reads the frame's requests. Without receivers, the shading's report `read`, as of its own
     * frame. With them, `read` first — what it names asked for as of this frame: the readback,
     * a frame late, adds what no receiver named —, then the demand, which needs no report. Returns
     * true when `read` proves the state stamped `before` asks for nothing more: its stamp is that
     * state's, and neither it nor the demand allocated a page (`requests.complete`).
     */
    read(
      requests: ShadowRequests,
      read: ShadowRequestReport | null,
      from: ShadowReceivers | undefined,
      store: SceneLightStore,
      at: ShadowViewpoint,
      before: number,
      nowMs: number,
      frame: number,
    ) {
      if (read) requests.consume(read, nowMs, frame, from ? frame : read.frame);
      const proved = !!read && read.stamp === before && requests.complete;
      if (from) requests.consume(demand.write(store, at, from, frame, before), nowMs, frame);
      return proved && requests.complete;
    },
  };
  return demand;
}
