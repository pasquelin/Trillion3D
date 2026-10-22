import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import { displacementFadeOut, displacementRange } from '../../visibility/tessellation/numbers.ts'
import type { MaterialLayers } from '../../geometry/rows/page/pageRowMaterial.ts'
import { layerSlot } from '../../geometry/rows/page/pageRowMaterial.ts'

/**
 * A DISPLACED SURFACE'S RECORD, beside the material table and by the same rank
 * (`materialTable.ts`): what the tessellation reads of a surface to push each point it makes along
 * its normal (`../../visibility/tessellation/`). `scale` holds the magnitude, the centre and the
 * two ends of the fade range in pixels — both zero for a displacement that never fades —, `bounds`
 * the least and the greatest distance a point moves (`displacementRange`) and the size under which
 * the fade is gone (`displacementFadeOut`), `map` the height map's data-atlas slot and the texture
 * set it reads, zero for a surface that is not displaced. The table is its own small buffer, made only once a displaced surface is written: a
 * scene without one holds none, so the material record every other pass reads is untouched.
 */
export const DISPLACEMENT_RECORD = fieldLayout('DisplacementRecord', [
  ['scale', 'vec4f'],
  ['bounds', 'vec4f'],
  ['map', 'vec4u'],
] as const)
/** Words of one record. */
export const DISPLACEMENT_WORDS = DISPLACEMENT_RECORD.words

const F = DISPLACEMENT_RECORD.at
/** One record, filled before it is compared with the table's: a write allocates nothing. */
const scratch = new Float32Array(DISPLACEMENT_WORDS)
const scratchInts = new Uint32Array(scratch.buffer)

/** The displaced records of a material table, by rank, as the host last wrote them. */
export function createDisplacementRecords() {
  return {
    /** The records' words, a rank's at `rank * DISPLACEMENT_WORDS`: zero where none is displaced. */
    ints: new Uint32Array(0),
    /** The surfaces displaced now, and a count that moves with every change: what an upload
     *  compares to know whether to send again. */
    count: 0,
    version: 0,
  }
}
export type DisplacementRecords = ReturnType<typeof createDisplacementRecords>

/** Whether the record of rank `rank` holds a displaced surface. */
const held = (d: DisplacementRecords, rank: number) =>
  (d.ints[rank * DISPLACEMENT_WORDS + F.map] ?? 0) !== 0

/**
 * Writes the displacement of `mat` at `rank` — or clears the rank, a surface that is not displaced
 * or whose height map the atlas does not hold, which is drawn flat. The table grows to hold the rank
 * only for a surface that is displaced. Returns whether a word changed.
 */
export function writeDisplacementRecord(
  d: DisplacementRecords,
  rank: number,
  mat: Pick<VisMaterial, 'displacement' | 'displacementMap'>,
  { dataLayer }: Pick<MaterialLayers, 'dataLayer'>,
) {
  const at = rank * DISPLACEMENT_WORDS
  const slot = mat.displacement ? layerSlot(dataLayer, mat.displacementMap) : 0
  const was = held(d, rank)
  if (!slot && !was) return false
  if (d.ints.length < at + DISPLACEMENT_WORDS) d.ints = resized(d.ints, at + DISPLACEMENT_WORDS)
  scratch.fill(0)
  if (slot && mat.displacement) {
    const { magnitude, center, fade } = mat.displacement
    scratch[F.scale] = magnitude
    scratch[F.scale + 1] = center
    scratch[F.scale + 2] = fade?.start ?? 0
    scratch[F.scale + 3] = fade?.end ?? 0
    const { min, max } = displacementRange(mat.displacement)
    scratch[F.bounds] = min
    scratch[F.bounds + 1] = max
    scratch[F.bounds + 2] = displacementFadeOut(mat.displacement)
    scratchInts[F.map] = slot
    // The texture set the map reads (glTF's `texCoord`), held to the last one a page carries.
    scratchInts[F.map + 1] = Math.min(mat.displacementMap?.channel ?? 0, MAX_UV_SETS - 1)
  }
  let changed = false
  for (let i = 0; i < DISPLACEMENT_WORDS; i++)
    if (d.ints[at + i] !== scratchInts[i]) {
      d.ints[at + i] = scratchInts[i]
      changed = true
    }
  if (changed) {
    if (was !== !!slot) d.count += slot ? 1 : -1
    d.version++
  }
  return changed
}
