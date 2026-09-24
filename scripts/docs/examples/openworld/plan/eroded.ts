/**
 * The natural ground the plan builds on (#332): the global relief and the region refinements,
 * eroded. The erosion runs once on the working grid (`erosion.ts`) and its displacement is added
 * back to the uneroded height, sampled bilinearly, so the detail finer than the grid stays and the
 * gullies, fans and talus the water and the slides made are laid over it. The sea keeps its own
 * height, and no land is lowered closer to sea level than the shore depth: the coastline does not
 * move.
 *
 * One world is eroded once per process: a plan built again from the same seed and the same
 * refinements reuses the fields the first one computed, which are the same bytes.
 */
import { WORLD } from './contract.ts';
import { erosionFields, SHORE, type ErosionFields, type Waters } from './erosion.ts';

type Height = (x: number, z: number) => number;
type Entry = { seed: number; refiners: readonly unknown[]; fields: ErosionFields };

/** The last worlds eroded: two, the plan a test builds and the other seed it compares it with. */
const KEPT = 2;
const kept: Entry[] = [];

/**
 * The eroded natural height and the erosion's fields for the world of `seed` whose uneroded
 * height is `uneroded`, made of the relief and `refiners` (the identities that key the reuse,
 * the waters following from them), with its rivers and lakes kept out of the erosion.
 */
export function erodedGround(
  seed: number,
  refiners: readonly unknown[],
  uneroded: Height,
  waters: Waters,
): { natural: Height; erosion: ErosionFields } {
  let entry = kept.find(
    (e) =>
      e.seed === seed &&
      e.refiners.length === refiners.length &&
      e.refiners.every((refine, index) => refine === refiners[index]),
  );
  if (!entry) {
    entry = { seed, refiners: [...refiners], fields: erosionFields(uneroded, waters) };
    kept.unshift(entry);
    kept.length = Math.min(kept.length, KEPT);
  }
  const erosion = entry.fields;
  const natural = (x: number, z: number) => {
    const height = uneroded(x, z);
    if (height <= WORLD.seaLevel) return height;
    return Math.max(height + erosion.displacement(x, z), Math.min(height, SHORE));
  };
  return { natural, erosion };
}
