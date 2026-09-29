import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import type { Deformed } from './frame.ts';
import { WAVE_FLOATS } from './layout.ts';

const inverse = new Float64Array(16);

/** The smallest length a unit vector of the placement's frame takes in the world: a world
 *  distance over it is at least the object distance it came from (no shear in a scene pose). */
function smallestScale(m: ArrayLike<number>) {
  const column = (c: number) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
  return Math.min(column(0), column(1), column(2));
}

/** Write the engine's wave controls, preserving previous phases. */
export function writeWaves(
  block: Float32Array,
  entry: Deformed,
  world: number,
  wave: number,
  first: boolean,
) {
  const model = entry.mesh.waves!.waveModel;
  block.set(entry.world.elements, world);
  invertMatrix4(inverse, entry.world.elements);
  block.set(inverse, world + 16);
  let crest = 0;
  for (let w = 0; w < entry.shape.waves; w++) {
    const at = wave + w * WAVE_FLOATS,
      present = w < model.count;
    block[at + 6] = block[at + 5];
    block[at] = present ? model.dirX[w] : 1;
    block[at + 1] = present ? model.dirZ[w] : 0;
    block[at + 2] = present ? model.k[w] : 0;
    block[at + 3] = present ? model.amplitude[w] : 0;
    block[at + 4] = present ? model.lateral[w] : 0;
    block[at + 5] = present ? model.phase[w] : 0;
    if (first) block[at + 6] = block[at + 5];
    if (present) crest += model.amplitude[w] + model.lateral[w];
  }
  return crest / smallestScale(entry.world.elements);
}
