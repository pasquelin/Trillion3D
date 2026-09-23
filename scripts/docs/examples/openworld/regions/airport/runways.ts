/**
 * Everything painted on or planted beside the two runways: threshold keys, designators, touchdown
 * and aiming-point marks, centreline dashes and edge lines; edge, centreline, threshold and
 * approach lights; PAPIs, windsocks and glide-slope masts. A runway is used in both directions,
 * so each end gets its own set, read by a pilot landing toward the other end.
 */
import { along, put, square, type Context } from './context.ts';
import { FIELD } from './site.ts';

const EDGE = FIELD.runwayWidth / 2;

/**
 * +1 when local +t lies on the left of a pilot flying along local `s` direction `d`, else −1.
 * The pilot's left is +X of a frame whose +Z is the flight direction: (cos yaw, −sin yaw).
 */
function leftSide(ctx: Context, d: number): number {
  const yaw = ctx.site.yaw(d, 0),
    [x1, z1] = ctx.site.world(0, 1),
    [x0, z0] = ctx.site.world(0, 0);
  return Math.sign((x1 - x0) * Math.cos(yaw) - (z1 - z0) * Math.sin(yaw));
}

/** The two digits and the side letter a pilot landing along `d` on the runway at `t` reads. */
export function designator(ctx: Context, t: number, d: number): [string, string] {
  const number = Math.round(ctx.site.bearing(d, 0) / 10) || 36,
    [a, b] = FIELD.runways,
    other = t === a ? b : a;
  return [String(number).padStart(2, '0'), (t - other) * leftSide(ctx, d) > 0 ? 'L' : 'R'];
}

/** One end's marks and lights: landing along `d` from the threshold at s = −d·L/2. */
function runwayEnd(ctx: Context, t: number, d: number) {
  const threshold = (-d * ctx.site.length) / 2,
    s = (k: number) => threshold + d * k,
    ahead: [number, number] = [d, 0],
    left = leftSide(ctx, d),
    paint = (prop: string, k: number, dt = 0) =>
      put(ctx, prop, [s(k), t + dt], ahead, square(1), 'paint');
  paint('airport/mark-piano', 6);
  const [digits, letter] = designator(ctx, t, d);
  paint(`airport/glyph-${letter}`, 48);
  paint(`airport/glyph-${digits[0]}`, 63, left * 3);
  paint(`airport/glyph-${digits[1]}`, 63, -left * 3);
  for (const [k, n] of [
    [150, 3],
    [450, 2],
    [600, 2],
    [750, 1],
    [900, 1],
  ])
    paint(`airport/mark-tdz-${n}`, k + 11.25);
  paint('airport/mark-aiming', 430);
  put(ctx, 'airport/light-threshold', [threshold, t], ahead, square(1), 'paint');
  // Approach lights: crossbars every 30 m on the extended centreline, the 300 m bar wider.
  for (const k of along(90, 390, 30))
    put(ctx, 'airport/light-approach', [s(-k), t], ahead, [[0, 0, 8.2, 0.4]], 'solid', {
      scale: k === 300 ? [1.9, 1, 1] : 1,
    });
  // PAPI on the pilot's left, 15 m off the edge, four units 9 m apart.
  for (let i = 0; i < 4; i++)
    put(
      ctx,
      'airport/papi',
      [s(300), t + left * (EDGE + 15 + i * 9)],
      ahead,
      [[0, 0, 0.8, 0.6]],
      'solid',
    );
  put(ctx, 'airport/windsock', [s(250), t - left * (EDGE + 90)], ahead, square(1.8), 'solid', {
    reach: 0.3,
  });
  // The localizer serving this approach stands past the far end, beyond the approach lights.
  put(
    ctx,
    'airport/localizer',
    [d * (ctx.site.length / 2 + 420), t],
    ahead,
    [[0, 1.6, 16, 2.6]],
    'solid',
    {
      reach: 0.3,
    },
  );
  put(
    ctx,
    'airport/glideslope',
    [s(300), t - left * (EDGE + 120)],
    ahead,
    [[2, 0, 3.6, 1.3]],
    'solid',
  );
}

/** One runway: both ends, then the marks and lights along its whole length. */
export function runway(ctx: Context, t: number) {
  const half = ctx.site.length / 2,
    east: [number, number] = [1, 0];
  runwayEnd(ctx, t, 1);
  runwayEnd(ctx, t, -1);
  for (const s of along(-half + 99, half - 99, 50))
    put(ctx, 'airport/mark-dash', [s, t], east, square(1), 'paint');
  for (const s of along(-half + 50, half - 50, 100))
    for (const side of [-1, 1])
      put(ctx, 'airport/mark-edge', [s, t + side * (EDGE - 0.6)], east, square(1), 'paint');
  for (const s of along(-half, half, 60))
    for (const side of [-1, 1])
      put(ctx, 'airport/light-edge', [s, t + side * (EDGE + 1.5)], east, square(0.15), 'solid');
  for (const s of along(-half + 15, half - 15, 30))
    put(ctx, 'airport/light-inset', [s, t + 0.6], east, square(0.2), 'paint');
}
