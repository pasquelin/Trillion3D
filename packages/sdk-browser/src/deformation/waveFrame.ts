import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import type { Deformed } from './frame.ts';
import type { Waves } from '../../../sdk-core/src/fluids/waves.ts';
import { WAVE_FLOATS } from './layout.ts';

const inverse = new Float64Array(16);

/** The smallest length a unit vector of the placement's frame takes in the world: a world
 *  distance over it is at least the object distance it came from (no shear in a scene pose). */
function smallestScale(m: ArrayLike<number>) {
  const column = (c: number) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
  return Math.min(column(0), column(1), column(2));
}

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

/** Write full current/previous world-space wave controls, including both matrix inverses. */
export function writeWaves(
  block: Float32Array,
  entry: Deformed,
  world: number,
  wave: number,
  first: boolean,
) {
  const model = entry.mesh.waves!.waveModel;
  block.copyWithin(world + 32, world, world + 32);
  const size = entry.shape.waves * WAVE_FLOATS;
  block.copyWithin(wave + size, wave, wave + size);
  block.set(entry.world.elements, world);
  invertMatrix4(inverse, entry.world.elements);
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
  return crest / smallestScale(entry.world.elements);
}
