import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import type { Deformed } from './frame.ts'
import { WAVE_FIELDS, type Waves } from '../../../sdk-core/src/fluids/waves.ts'
import { WAVE_FLOATS } from './layout.ts'
import { sameElements, sameMatrixFloat32 } from '../../../math/src/matrix/matrixElements.ts'
import { leastStretchOf } from '../partition/boxes.ts'

const inverse = new Float64Array(16)

/** What a placement's wave reach is read from, held per placement: the sixteen floats of the world
 *  matrix it was read for, then the least that matrix stretches a distance (`leastStretchOf`). */
export const WAVE_STRETCH_FLOATS = 17

/** Field `c` (`WAVE_FIELDS`) of wave `w`; a wave past the model's count is still, heading along x. */
const value = (model: Waves, w: number, c: number) =>
  w < model.count ? model[WAVE_FIELDS[c]][w] : WAVE_FIELDS[c] === 'dirX' ? 1 : 0

/** World-space sampling changes even at a frozen clock; every control participates. */
export function wavesChanged(block: Float32Array, entry: Deformed, world: number, wave: number) {
  const model = entry.mesh.waves?.waveModel
  if (!model || !entry.shape.waves) return false
  invertMatrix4(inverse, entry.world.elements)
  if (
    !sameMatrixFloat32(block, entry.world.elements, world) ||
    !sameMatrixFloat32(block, inverse, world + 16)
  )
    return true
  for (let w = 0; w < entry.shape.waves; w++)
    for (let c = 0; c < WAVE_FIELDS.length; c++)
      if (block[wave + w * WAVE_FLOATS + c] !== Math.fround(value(model, w, c))) return true
  return false
}

/** Write full current/previous world-space wave controls, including both matrix inverses. Returns
 *  how far the waves carry a vertex in the placement's frame; `held` (`WAVE_STRETCH_FLOATS`) keeps
 *  the world matrix's least stretch, read again only when one of its floats moved. */
export function writeWaves(
  block: Float32Array,
  entry: Deformed,
  world: number,
  wave: number,
  first: boolean,
  held: Float64Array,
) {
  const model = entry.mesh.waves!.waveModel
  block.copyWithin(world + 32, world, world + 32)
  const size = entry.shape.waves * WAVE_FLOATS
  block.copyWithin(wave + size, wave, wave + size)
  const elements = entry.world.elements
  block.set(elements, world)
  invertMatrix4(inverse, elements)
  block.set(inverse, world + 16)
  let crest = 0
  for (let w = 0; w < entry.shape.waves; w++) {
    const at = wave + w * WAVE_FLOATS,
      present = w < model.count
    for (let c = 0; c < WAVE_FIELDS.length; c++) block[at + c] = value(model, w, c)
    if (present) crest += model.amplitude[w] + model.lateral[w]
  }
  if (first) {
    block.copyWithin(world + 32, world, world + 32)
    block.copyWithin(wave + size, wave, wave + size)
  }
  // The waves move a vertex by at most `crest` in the world, and the inverse carries a world
  // distance d to at most d / σmin in the placement's frame: σmin, the least singular value, which
  // a shear makes shorter than every column (a child turned 45° under a parent scaled (1, ¼, 1):
  // columns 0.73 long, σmin ¼).
  if (!sameElements(held, elements)) {
    held.set(elements)
    held[16] = leastStretchOf(elements, inverse)
  }
  return crest / held[16]
}
