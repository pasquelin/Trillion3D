/**
 * What moves: an airliner flies the circuit on a loop — take-off on runway 1, a climbing turn
 * away from the terminal, the downwind leg, a turn onto a long final on a 3° slope, touchdown,
 * roll-out and the taxi back — sized to the room the region leaves around the field. Another
 * airliner taxis around the taxiways, a bus shuttles along the apron, the tower's beacon and the
 * radar turn.
 */
import type { Mover, Vec3 } from '../../plan/contract.ts';
import type { Context } from './context.ts';
import { FIELD } from './site.ts';

/** Metres from local (s, t) to the region's edge along local direction (ds, dt). */
function room(ctx: Context, [s, t]: readonly number[], [ds, dt]: readonly number[]) {
  const { bounds } = ctx.site;
  let k = 0;
  for (; k < 50_000; k += 50) {
    const [x, z] = ctx.site.world(s + ds * k, t + dt * k);
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) break;
  }
  return k - 50;
}

/**
 * A 3D point at local (s, t): on the ground when `h` is 0, else `h` metres above the field's
 * elevation (an altitude, not a height over the hills), never closer than 60 m to the ground.
 */
export const air = (ctx: Context, s: number, t: number, h: number): Vec3 => {
  const [x, z] = ctx.site.world(s, t),
    ground = ctx.plan.height(x, z);
  if (h <= 0) return [x, ground, z];
  const [fx, fz] = ctx.site.world(0, FIELD.runways[0]);
  return [x, Math.max(ctx.plan.height(fx, fz) + h, ground + Math.min(h, 60)), z];
};

/** A half turn about local centre (cs, ct), from angle `a0`, sweeping π in sense `sense`. */
function halfTurn(
  ctx: Context,
  [cs, ct]: readonly number[],
  r: number,
  [a0, sense]: readonly number[],
  [h0, h1]: readonly number[],
) {
  return Array.from({ length: 13 }, (_, i) => {
    const a = a0 + (sense * Math.PI * i) / 12;
    return air(ctx, cs + r * Math.cos(a), ct + r * Math.sin(a), h0 + ((h1 - h0) * i) / 12);
  });
}

/** The local `s` sign runway 1 is used in: landing toward the side with less room. */
export const landing = (ctx: Context) => {
  const [r1] = FIELD.runways;
  return room(ctx, [0, r1], [1, 0]) >= room(ctx, [0, r1], [-1, 0]) ? -1 : 1;
};

/**
 * The circuit on runway 1. It lands and takes off along `d`, so the final approach comes from
 * the side with the most room; the turns keep a radius the region can hold.
 */
function circuit(ctx: Context): Mover {
  const [r1] = FIELD.runways,
    half = ctx.site.length / 2,
    d = landing(ctx),
    radius = Math.min(
      1_200,
      room(ctx, [0, r1], [d, 0]) - half - 500,
      (room(ctx, [0, r1], [0, -1]) - 100) / 2,
    ),
    final = Math.min(6_000, room(ctx, [0, r1], [-d, 0]) - half - radius - 100),
    // Pattern height: the 3° slope from the start of the final to the aiming point.
    pattern = Math.min(300, (final + 400) * Math.tan((3 * Math.PI) / 180)),
    s = (k: number) => -d * half + d * k,
    centreT = r1 - radius,
    blast = d * (half + 30);
  return {
    kind: 'path',
    name: 'airport/circuit',
    model: 'vehicle-airliner',
    points: [
      air(ctx, s(0), r1, 0),
      air(ctx, s(1_800), r1, 0),
      air(ctx, s(ctx.site.length), r1, 60),
      ...halfTurn(
        ctx,
        [s(ctx.site.length + 400), centreT],
        radius,
        [Math.PI / 2, -d],
        [110, pattern],
      ),
      ...halfTurn(ctx, [s(-final), centreT], radius, [-Math.PI / 2, -d], [pattern, pattern]),
      air(ctx, s(400), r1, 0),
      air(ctx, blast, r1, 0),
      air(ctx, blast, FIELD.parallelTaxiway, 0),
      air(ctx, -blast, FIELD.parallelTaxiway, 0),
      air(ctx, -blast, r1, 0),
    ],
    speed: 70,
    loop: true,
  };
}

/** Taxiing, shuttling and turning things. `beacon` and `radar` are world positions. */
export function movers(ctx: Context, beacon: Vec3, radar: Vec3): Mover[] {
  const end = ctx.site.length / 2 + 30,
    taxi = (s: number, t: number) => air(ctx, s, t, 0);
  return [
    circuit(ctx),
    {
      kind: 'path',
      name: 'airport/taxiing-airliner',
      model: 'vehicle-airliner',
      points: [
        taxi(-end, FIELD.apronTaxiway),
        taxi(0, FIELD.apronTaxiway),
        taxi(0, FIELD.parallelTaxiway),
        taxi(-end, FIELD.parallelTaxiway),
      ],
      speed: 9,
      loop: true,
    },
    {
      kind: 'path',
      name: 'airport/apron-bus',
      model: 'vehicle-city-bus',
      points: [taxi(-240, -120), taxi(700, -120), taxi(700, -124), taxi(-240, -124)],
      speed: 8,
      loop: true,
    },
    // A rotating beacon turns at 12 rpm: two beams, 24 flashes a minute.
    { kind: 'beacon', name: 'airport/beacon', position: beacon, rpm: 12, range: 20_000 },
    {
      kind: 'spin',
      name: 'airport/radar',
      model: 'airport/radar-antenna',
      position: radar,
      axis: [0, 1, 0],
      rpm: 12,
    },
  ];
}
