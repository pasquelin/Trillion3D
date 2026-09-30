import { MAP_CHOICES, PICK_BLENDS, PICK_TAPS } from './pickCounts.ts';

/**
 * Names a pixel's position picks among on an ordinary image (`requestPick`): one of the maps
 * (`WRAP_MAP`) or the sun level a masked pixel asks, one of the two blend levels, one of the three
 * anisotropic taps. A tile read by a sliver of pixels — the edge of a surface — can be named by none
 * of them, so the pick turns by one per whole phase round: a live view names the sliver's tile too,
 * each pixel stepping through the picks as it speaks. A convergence image names every pick of every
 * pixel at once (`everyPick`, `requestWgsl.ts`).
 */
export const PICK_CYCLE = (MAP_CHOICES + 1) * PICK_BLENDS * PICK_TAPS;
