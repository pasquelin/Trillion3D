/**
 * Landside planting from the shared kit: a clipped hedge between the curbside and the car park,
 * an avenue of trees along the landside edge, and loose groves around the business park. The
 * airside stays bare, as airfields keep it (no cover for birds near the runways).
 */
import { along, chance, put, square, type Context } from './context.ts';
import { CAR_PARK } from './landside.ts';

const TREES = ['tree-oak-small', 'tree-birch-small', 'tree-oak-large', 'tree-birch-large'];

export function planting(ctx: Context) {
  for (const s of along(-330, 470, 5))
    put(ctx, 'bush-round', [s, CAR_PARK.near - 3.5], [0, 1], square(0.9), 'solid');
  for (const [i, s] of along(-900, 900, 14).entries())
    put(ctx, TREES[i % 2], [s, 312], [0, 1], square(1.2), 'solid');
  // Groves: seeded tries across the business park; whatever lands on something is dropped.
  for (let k = 0; k < 220; k++) {
    const s = -950 + chance(ctx, 12, k) * 560,
      t = 40 + chance(ctx, 13, k) * 260,
      tree = TREES[Math.floor(chance(ctx, 14, k) * TREES.length)];
    put(ctx, tree, [s, t], [chance(ctx, 15, k) - 0.5, 0.5], square(1.2), 'solid');
  }
}
