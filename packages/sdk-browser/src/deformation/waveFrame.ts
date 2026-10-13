import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import type { Deformed } from './frame.ts'
import { WAVE_FIELDS, type Waves } from '../../../sdk-core/src/fluids/waves.ts'
import { WAVE_FLOATS } from './layout.ts'
import { sameElements, sameMatrixFloat32 } from '../../../math/src/matrix/matrixElements.ts'
import { leastStretchOf } from '../partition/boxes.ts'

/** What a wave placement's controls and reach are read from, held per placement: the world matrix
 *  they were read for, its inverse, and the least it stretches a distance (`leastStretchOf`). */
export interface WaveHeld {
  matrix: Float64Array
  inverse: Float64Array
  stretch: number
}

export const createWaveHeld = (): WaveHeld => ({
  matrix: new Float64Array(16),
  inverse: new Float64Array(16),
  stretch: 0,
})

/** `held`'s inverse of the world matrix `elements`: inverted, and its stretch read, again only when
 *  one of the matrix's floats moved. */
function heldInverse(held: WaveHeld, elements: ArrayLike<number>) {
  if (!sameElements(held.matrix, elements)) {
    held.matrix.set(elements)
    invertMatrix4(held.inverse, elements)
    held.stretch = leastStretchOf(elements, held.inverse)
  }
  return held.inverse
}

/** Field `c` (`WAVE_FIELDS`) of wave `w`; a wave past the model's count is still, heading along x. */
const value = (model: Waves, w: number, c: number) =>
  w < model.count ? model[WAVE_FIELDS[c]][w] : WAVE_FIELDS[c] === 'dirX' ? 1 : 0

/** World-space sampling changes even at a frozen clock; every control participates. */
export function wavesChanged(
  block: Float32Array,
  entry: Deformed,
  world: number,
  wave: number,
  held: WaveHeld,
) {
  const model = entry.mesh.waves?.waveModel
  if (!model || !entry.shape.waves) return false
  if (
    !sameMatrixFloat32(block, entry.world.elements, world) ||
    !sameMatrixFloat32(block, heldInverse(held, entry.world.elements), world + 16)
  )
    return true
  for (let w = 0; w < entry.shape.waves; w++)
    for (let c = 0; c < WAVE_FIELDS.length; c++)
      if (block[wave + w * WAVE_FLOATS + c] !== Math.fround(value(model, w, c))) return true
  return false
}

/** Write full current/previous world-space wave controls, including both matrix inverses. Returns
 *  how far the waves carry a vertex in the placement's frame, from the world matrix's least stretch
 *  `held` keeps. */
export function writeWaves(
  block: Float32Array,
  entry: Deformed,
  world: number,
  wave: number,
  first: boolean,
  held: WaveHeld,
) {
  const model = entry.mesh.waves!.waveModel
  block.copyWithin(world + 32, world, world + 32)
  const size = entry.shape.waves * WAVE_FLOATS
  block.copyWithin(wave + size, wave, wave + size)
  const elements = entry.world.elements
  block.set(elements, world)
  block.set(heldInverse(held, elements), world + 16)
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
  return crest / held.stretch
}
