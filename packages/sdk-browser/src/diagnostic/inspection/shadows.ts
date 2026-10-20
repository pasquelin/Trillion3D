import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { transformHomogeneousPoint } from '../../../../math/src/vector/vector.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import {
  VSM_ENTRY_COARSER_MASK,
  VSM_ENTRY_COARSER_SHIFT,
  VSM_ENTRY_DRAWABLE_BIT,
  VSM_ENTRY_MAPPED_BIT,
  VSM_LEVEL0_PAGES,
  VSM_MAP_UNSEEN,
} from '../../vsm/constants.ts'
import type { VsmLightCache } from '../../vsm/cacheManager.ts'
import type { VsmProjectionDataValues } from '../../vsm/projectionData.ts'
import { unprojectInto } from './camera.ts'
import type { InspectedShadowMap } from './types.ts'

/**
 * One shadow map as its image packed it (`../../vsm/frameSetup.ts`): where its table lies in
 * the page table, its finest mip, and — a sun's level — the map's UV back to the world: the inverse
 * of its record's `shiftedToMapUv`, the level's centre and the UV depth of that centre.
 */
export type ShadowMapSnapshot = {
  light: string
  kind: SceneLight['kind']
  level: number
  seen: boolean
  /** The table's origin, x | y << 16, and the entries a side of its finest mip. */
  origin: number
  side: number
  /** A sun's level alone. */
  sun?: { toShifted: Float64Array; centre: number[]; depth: number; direction: number[] }
}

const centreUv = new Float64Array(4)

/** `map`'s record as its light's entry holds it, copied: the next plan rewrites the entry. */
function snapshotMap(
  entry: VsmLightCache,
  kind: SceneLight['kind'],
  data: VsmProjectionDataValues,
): ShadowMapSnapshot {
  const snap: ShadowMapSnapshot = {
    light: entry.lightId,
    kind,
    level: kind === 'directional' ? data.mapLevel : 0,
    seen: (data.flags & VSM_MAP_UNSEEN) === 0,
    origin: data.tableOrigin,
    side: VSM_LEVEL0_PAGES >> data.finestMip,
  }
  if (kind !== 'directional') return snap
  transformHomogeneousPoint(centreUv, data.shiftedToMapUv, 0, 0, 0)
  snap.sun = {
    toShifted: invertMatrix4(new Float64Array(16), data.shiftedToMapUv),
    centre: data.originShift.map((shift) => -shift),
    depth: centreUv[2] / centreUv[3],
    // The record holds the direction toward the sun.
    direction: data.lightDirection.map((toward) => -toward),
  }
  return snap
}

/** Every map the image's plan packed for the main view: its suns' levels, its local lights' maps
 *  — a sun's clipmap of another view keyed apart (`VsmLightCache.view`) left out. */
export function snapshotShadowMaps(
  entries: Iterable<VsmLightCache>,
  kindOf: (light: string) => SceneLight['kind'] | undefined,
): ShadowMapSnapshot[] {
  const maps: ShadowMapSnapshot[] = []
  for (const entry of entries) {
    const kind = kindOf(entry.lightId)
    if (!kind || entry.mapId < 0 || (entry.view !== undefined && entry.view !== '')) continue
    for (const map of entry.mapCaches) maps.push(snapshotMap(entry, kind, map.projectionData))
  }
  return maps
}

/** The page-table rows `maps` lie in: the rows from 0 a copy holds them all in. */
export function shadowTableRows(maps: readonly ShadowMapSnapshot[]) {
  let rows = 0
  for (const map of maps) rows = Math.max(rows, (map.origin >>> 16) + (3 * map.side) / 2 + 1)
  return rows
}

const shifted = new Float64Array(3)
/** The four world corners of page (`x`, `y`) of a sun's level `sun`, into `out` from `at`. */
function pageCorners(
  out: Float32Array,
  at: number,
  sun: NonNullable<ShadowMapSnapshot['sun']>,
  x: number,
  y: number,
) {
  for (let corner = 0; corner < 4; corner++) {
    const u = (x + (corner === 1 || corner === 2 ? 1 : 0)) / VSM_LEVEL0_PAGES,
      v = (y + (corner >= 2 ? 1 : 0)) / VSM_LEVEL0_PAGES
    // The inverse of `shiftedToMapUv` takes the map's UV — its clip y flipped — to the world
    // shifted by the level's centre.
    unprojectInto(shifted, 0, sun.toShifted, u, v, sun.depth)
    for (let k = 0; k < 3; k++) out[at + 3 * corner + k] = shifted[k] + sun.centre[k]
  }
}

/** The pages `map` holds at its own level in `words`, the page table from row 0, `width` entries a
 *  row: mapped there — not a fallback to a coarser level —, and drawn this image or cached. */
export function decodeShadowMap(
  map: ShadowMapSnapshot,
  words: Uint32Array,
  width: number,
): InspectedShadowMap {
  const ox = map.origin & 0xffff,
    oy = map.origin >>> 16
  // A sun's level reads its finest mip alone; a local light's mips lie below it (`tableBlocks.ts`).
  const rows = map.sun ? map.side : (3 * map.side) / 2
  const found: number[] = []
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < map.side; x++) {
      const word = words[(oy + y) * width + ox + x] ?? 0
      const mapped = (word & VSM_ENTRY_MAPPED_BIT) !== 0,
        coarser = (word >>> VSM_ENTRY_COARSER_SHIFT) & VSM_ENTRY_COARSER_MASK
      if (mapped && coarser === 0) found.push(x, y, (word & VSM_ENTRY_DRAWABLE_BIT) !== 0 ? 1 : 0)
    }
  const count = found.length / 3,
    placed = map.sun ? count : 0
  const pages = new Float32Array(placed * 12),
    rendered = new Uint8Array(count)
  let renderedCount = 0
  for (let i = 0; i < count; i++) {
    rendered[i] = found[3 * i + 2]
    renderedCount += rendered[i]
    if (map.sun) pageCorners(pages, i * 12, map.sun, found[3 * i], found[3 * i + 1])
  }
  const direction = map.sun?.direction ?? [0, 0, 0]
  return {
    light: map.light,
    kind: map.kind,
    level: map.level,
    seen: map.seen,
    pages,
    rendered,
    mappedCount: count,
    renderedCount,
    direction: [direction[0], direction[1], direction[2]],
  }
}
