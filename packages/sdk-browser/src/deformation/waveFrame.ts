import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import type { Deformed } from './frame.ts';
import type { Waves } from '../../../sdk-core/src/fluids/waves.ts';
import { WAVE_FLOATS } from './layout.ts';
import { sameElements } from '../math/matrixElements.ts';
import { leastStretchOf } from '../scene/partition/boxes.ts';

const inverse = new Float64Array(16);

/** What a placement's wave reach is read from, held per placement: the sixteen floats of the world
 *  matrix it was read for, then the least that matrix stretches a distance (`leastStretchOf`). */
export const WAVE_STRETCH_FLOATS = 17;

const value = (model: Waves, w: number, c: number) => {
  if (w >= model.count) return c === 0 ? 1 : 0;
  switch (c) {
    case 0:
      return model.dirX[w];
    case 1:
      return model.dirZ[w];
    case 2:
      return model.k[w];
    case 3:
      return model.amplitude[w];
    case 4:
      return model.lateral[w];
    default:
      return model.phase[w];
  }
};

/** World-space sampling changes even at a frozen clock; every control participates. */
export function wavesChanged(block: Float32Array, entry: Deformed, world: number, wave: number) {
  const model = entry.mesh.waves?.waveModel;
  if (!model || !entry.shape.waves) return false;
  invertMatrix4(inverse, entry.world.elements);
  for (let c = 0; c < 16; c++)
    if (
      block[world + c] !== Math.fround(entry.world.elements[c]) ||
      block[world + 16 + c] !== Math.fround(inverse[c])
    )
      return true;
  for (let w = 0; w < entry.shape.waves; w++)
    for (let c = 0; c < 6; c++)
      if (block[wave + w * WAVE_FLOATS + c] !== Math.fround(value(model, w, c))) return true;
  return false;
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
  const model = entry.mesh.waves!.waveModel;
  block.copyWithin(world + 32, world, world + 32);
  const size = entry.shape.waves * WAVE_FLOATS;
  block.copyWithin(wave + size, wave, wave + size);
  const elements = entry.world.elements;
  block.set(elements, world);
  invertMatrix4(inverse, elements);
  block.set(inverse, world + 16);
  let crest = 0;
  for (let w = 0; w < entry.shape.waves; w++) {
    const at = wave + w * WAVE_FLOATS,
      present = w < model.count;
    for (let c = 0; c < 6; c++) block[at + c] = value(model, w, c);
    if (present) crest += model.amplitude[w] + model.lateral[w];
  }
  if (first) {
    block.copyWithin(world + 32, world, world + 32);
    block.copyWithin(wave + size, wave, wave + size);
  }
  // The waves move a vertex by at most `crest` in the world, and the inverse carries a world
  // distance d to at most d / σmin in the placement's frame: σmin, the least singular value, which
  // a shear makes shorter than every column (a child turned 45° under a parent scaled (1, ¼, 1):
  // columns 0.73 long, σmin ¼).
  if (!sameElements(held, elements)) {
    held.set(elements);
    held[16] = leastStretchOf(elements, inverse);
  }
  return crest / held[16];
}
