// The model's street, read off its own geometry: where the bench camera walks at eye level.
// Node chooses the columns and the street among them; the page only asks the physics
// (`street/streetPage.ts`). Nothing names a scene, and no share of the box is assumed open.
import type { Page } from 'playwright'
import { STREET_REACH, eyeHeight, modelFloor, type Bounds } from '../trajectory/poses.ts'
import { probeColumns } from './streetPage.ts'
import { readBounds } from '../harness/page.ts'
import { length2 } from '../../../packages/math/src/vector/vector.ts'
import { QUARTER_PI } from '../../../packages/math/src/constants.ts'

/** The street the camera walks: a column under open sky, its ground, and the radius around it at
 *  eye height that no wall crosses. */
export interface Street {
  x: number
  z: number
  ground: number
  clearance: number
}

/** One column of the model as the physics answered it: a street candidate, whether the sky is
 *  open over it one eye above its ground, and whether any cast hit anything at all — a column
 *  whose collision tile never loaded is unknown, not open. */
export interface ColumnProbe extends Street {
  open: boolean
  known: boolean
}

/** What the page answered: the probed columns, or why the model has no street to probe. */
export interface ColumnProbes {
  probes: ColumnProbe[]
  noStreet: string | null
}

/** What `probeColumns` needs, computed here: nothing in the page decides. */
export interface StreetProbeOptions {
  sdkUrl: string
  manifestUrl: string
  /** `[x, z, reach]`: a column, and how far its walls are looked for — its distance to the box's
   *  nearest side, so no clearance, and no street point, leaves the model. */
  columns: Array<[number, number, number]>
  headings: Array<[number, number]>
  /** Where the probe's camera stands, over the box centre, at `top`: `[x, z]`. */
  centre: [number, number]
  top: number
  floor: number
  height: number
  eye: number
  /** The share of a column's clearance the camera may walk (`STREET_REACH`). */
  reachShare: number
  settleFrames: number
  frameLimit: number
}

/** Columns per side of the footprint grid, each at the centre of its cell. */
const GRID = 17
/** Headings the clearance is read along: eight, one every 45°. */
const HEADINGS = Array.from({ length: 8 }, (_, i): [number, number] => [
  Math.cos(i * QUARTER_PI),
  Math.sin(i * QUARTER_PI),
])

/** The probe of a model's box: a grid of columns over its footprint, cast from above its top. */
export function streetProbe(bounds: Bounds, urls: { sdkUrl: string; manifestUrl: string }) {
  const { min, max } = bounds,
    eye = eyeHeight(bounds)
  const at = (lo: number, hi: number, i: number) => lo + ((hi - lo) * (i + 0.5)) / GRID
  const columns: Array<[number, number, number]> = []
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++) {
      const x = at(min.x, max.x, i),
        z = at(min.z, max.z, j)
      columns.push([x, z, Math.min(x - min.x, max.x - x, z - min.z, max.z - z)])
    }
  const height = max.y - min.y + 2 * eye
  return {
    ...urls,
    columns,
    headings: HEADINGS,
    centre: [(min.x + max.x) / 2, (min.z + max.z) / 2],
    top: max.y + eye,
    floor: modelFloor(bounds),
    height,
    eye,
    reachShare: STREET_REACH,
    settleFrames: 30,
    frameLimit: 1800,
  } satisfies StreetProbeOptions
}

/**
 * The street among the probed columns: known (the physics answered there), on the model's floor
 * (`modelFloor`, within one eye — a roof is no street), under open sky, the one with the most room around it at eye height;
 * between two as roomy, the nearer the box centre. `null` when no column qualifies: the camera
 * then walks the box's own street (`boxStreet`).
 */
export function pickStreet(probes: readonly ColumnProbe[], bounds: Bounds): Street | null {
  const cx = (bounds.min.x + bounds.max.x) / 2,
    cz = (bounds.min.z + bounds.max.z) / 2,
    floor = modelFloor(bounds) + eyeHeight(bounds)
  const off = (p: Street) => length2(p.x - cx, p.z - cz)
  const best = probes
    .filter((p) => p.known && p.open && p.ground <= floor)
    .reduce<ColumnProbe | null>(
      (a, p) =>
        !a || p.clearance > a.clearance || (p.clearance === a.clearance && off(p) < off(a)) ? p : a,
      null,
    )
  if (!best) return null
  const { open: _open, known: _known, ...street } = best
  return street
}

/** `bounds` with the street `probes` give, or why there is none, by name (`Bounds.noStreet`). */
export function streetOf(bounds: Bounds, { probes, noStreet }: ColumnProbes): Bounds {
  const street = noStreet ? null : pickStreet(probes, bounds)
  return { ...bounds, street, noStreet: street ? undefined : (noStreet ?? 'no open floor column') }
}

/** The model's box and street, read, probed and picked in the page itself, on one world: for
 *  the hosts that run there. */
export async function streetBounds(urls: { sdkUrl: string; manifestUrl: string }) {
  const bounds = await readBounds({ ...urls, street: true })
  return streetOf(bounds, await probeColumns(streetProbe(bounds, urls)))
}

/** The model's box, then its street probed in `page`, on the SDK and manifest a side reads. A
 *  model with no street to probe is said by name and walks its box's (`boxStreet`), never stops
 *  the bench. */
export async function readStreet(
  page: Page,
  urls: { sdkUrl: string; manifestUrl: string },
): Promise<Bounds> {
  // One world: `readBounds` loads the model with its physics, the probe asks it and closes it.
  const bounds = await page.evaluate(readBounds, { ...urls, street: true })
  const read = await page.evaluate(probeColumns, streetProbe(bounds, urls))
  const walked = streetOf(bounds, read)
  if (walked.noStreet) console.log(`street: none (${walked.noStreet}), the box centre is walked`)
  return walked
}
