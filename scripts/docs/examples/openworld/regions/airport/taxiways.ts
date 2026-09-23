/**
 * Taxiway furniture: yellow centreline in 30 m lengths, blue edge lights every 60 m, and at each
 * connector the holding positions and lit mandatory signs short of every runway it crosses.
 */
import { along, put, square, type Context } from './context.ts';
import { connectorS } from './roads.ts';
import { FIELD } from './site.ts';

const EDGE = FIELD.taxiwayWidth / 2;
/** Holding positions stand 75 m from a runway's centreline (code 4, non-instrument minimum). */
const HOLD = 75;

export function taxiways(ctx: Context) {
  const end = ctx.site.length / 2 + 30;
  for (const t of [FIELD.parallelTaxiway, FIELD.apronTaxiway]) {
    for (const s of along(-end + 15, end - 15, 30))
      put(ctx, 'airport/mark-taxi', [s, t], [1, 0], square(1), 'paint');
    for (const s of along(-end, end, 60))
      for (const side of [-1, 1])
        put(ctx, 'airport/light-taxi', [s, t + side * (EDGE + 1.5)], [1, 0], square(0.15), 'solid');
  }
  const [r1, r2] = FIELD.runways;
  for (const s of connectorS(ctx.site)) {
    // The yellow line stops at a runway's edge: runway paint is white.
    for (const t of along(r1 + 15, FIELD.apronTaxiway - 15, 30))
      if (Math.min(Math.abs(t - r1), Math.abs(t - r2)) > FIELD.runwayWidth / 2 + 15)
        put(ctx, 'airport/mark-taxi', [s, t], [0, 1], square(1), 'paint');
    // Holding short of runway 1 from the parallel taxiway, of runway 2 from both sides.
    for (const [t, dir] of [
      [r1 + HOLD, -1],
      [r2 - HOLD, 1],
      [r2 + HOLD, -1],
    ]) {
      put(ctx, 'airport/mark-holding', [s, t], [0, dir], square(1), 'paint');
      for (const side of [-1, 1])
        put(
          ctx,
          'airport/sign-holding',
          [s + side * (EDGE + 10), t],
          [0, -dir],
          [[0, 0, 1.6, 0.3]],
          'solid',
        );
    }
  }
}
