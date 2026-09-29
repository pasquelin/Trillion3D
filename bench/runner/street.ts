// The model's street, read off its own geometry (#1016): where the bench camera walks at eye level.
// Node chooses the columns and the street among them; the page only asks the physics
// (`streetPage.ts`). Nothing names a scene, and no share of the box is assumed open.
import type { Page } from 'playwright';
import { STREET_REACH, eyeHeight, plancherDuModele, type Bounds } from './poses.ts';
import { probeColumns } from './streetPage.ts';

/** One column of the model as the physics answered it: its ground, whether the sky is open over
 *  it one eye above that ground, and the nearest wall at that eye. */
export interface ColumnProbe {
  x: number;
  z: number;
  ground: number;
  open: boolean;
  clearance: number;
}

/** The street the camera walks: a column under open sky, its ground, and the radius around it at
 *  eye height that no wall crosses. */
export interface Street {
  x: number;
  z: number;
  ground: number;
  clearance: number;
}

/** What `probeColumns` needs, computed here: nothing in the page decides. */
export interface StreetProbeOptions {
  sdkUrl: string;
  manifestUrl: string;
  columns: Array<[number, number]>;
  headings: Array<[number, number]>;
  centre: [number, number, number];
  top: number;
  floor: number;
  height: number;
  reach: number;
  eye: number;
  /** The share of a column's clearance the camera may walk (`STREET_REACH`). */
  reachShare: number;
  settleFrames: number;
  frameLimit: number;
}

/** Columns per side of the footprint grid, each at the centre of its cell. */
const GRID = 17;
/** Headings the clearance is read along: eight, one every 45°. */
const HEADINGS = Array.from({ length: 8 }, (_, i): [number, number] => [
  Math.cos((i * Math.PI) / 4),
  Math.sin((i * Math.PI) / 4),
]);

/** The probe of a model's box: a grid of columns over its footprint, cast from above its top. */
export function streetProbe(bounds: Bounds, urls: { sdkUrl: string; manifestUrl: string }) {
  const { min, max } = bounds,
    eye = eyeHeight(bounds);
  const at = (lo: number, hi: number, i: number) => lo + ((hi - lo) * (i + 0.5)) / GRID;
  const columns: Array<[number, number]> = [];
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++) columns.push([at(min.x, max.x, i), at(min.z, max.z, j)]);
  const height = max.y - min.y + 2 * eye;
  return {
    ...urls,
    columns,
    headings: HEADINGS,
    centre: [(min.x + max.x) / 2, max.y + eye, (min.z + max.z) / 2],
    top: max.y + eye,
    floor: plancherDuModele(bounds),
    height,
    reach: Math.hypot(max.x - min.x, max.z - min.z),
    eye,
    reachShare: STREET_REACH,
    settleFrames: 30,
    frameLimit: 1800,
  } satisfies StreetProbeOptions;
}

/**
 * The street among the probed columns: on the model's floor (`plancherDuModele`, within one eye —
 * a roof is no street), under open sky, the one with the most room around it at eye height;
 * between two as roomy, the nearer the box centre. `null` when no column qualifies: the camera
 * then walks the box centre, on its floor, with no room (`poseAt`).
 */
export function pickStreet(probes: readonly ColumnProbe[], bounds: Bounds): Street | null {
  const cx = (bounds.min.x + bounds.max.x) / 2,
    cz = (bounds.min.z + bounds.max.z) / 2,
    floor = plancherDuModele(bounds) + eyeHeight(bounds);
  let best: Street | null = null,
    bestDistance = Infinity;
  for (const probe of probes) {
    if (!probe.open || probe.ground > floor) continue;
    const distance = Math.hypot(probe.x - cx, probe.z - cz);
    const roomier = !best || probe.clearance > best.clearance;
    if (roomier || (probe.clearance === best!.clearance && distance < bestDistance)) {
      best = { x: probe.x, z: probe.z, ground: probe.ground, clearance: probe.clearance };
      bestDistance = distance;
    }
  }
  return best;
}

/** The model's street, probed in `page` on the SDK and manifest a side reads: `bounds` with it. */
export async function readStreet(
  page: Page,
  bounds: Bounds,
  urls: { sdkUrl: string; manifestUrl: string },
): Promise<Bounds> {
  const probes = await page.evaluate(probeColumns, streetProbe(bounds, urls));
  return { ...bounds, street: pickStreet(probes, bounds) };
}
