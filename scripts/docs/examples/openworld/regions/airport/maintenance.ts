/**
 * The west and east ends of the apron: a row of maintenance hangars with an airliner nosed out
 * of the first, the general-aviation park of light aircraft and helicopters, and the cargo sheds
 * with their stacked containers and a freighter at the stand.
 */
import { VEHICLE_SPECS } from '../../props/index.ts';
import { chance, put, type Context } from './context.ts';
import { APRON } from './apron.ts';
import { HANGAR_PLINTH, HANGARS, hangarFootprint } from './hangar.ts';
import { GATE } from './jetbridge.ts';
import type { Footprint } from './placer.ts';

const OUT: [number, number] = [0, -1];
/** A 40 ft ISO container's height, metres. */
const CONTAINER_HEIGHT = 2.59;

/** A vehicle's footprint, from its measured bounds. */
function footprintOf(id: string): Footprint {
  const spec = VEHICLE_SPECS.find((candidate) => `vehicle-${candidate.id}` === id);
  if (!spec) throw new Error(`airport: no vehicle ${id}`);
  const [[x0, , z0], [x1, , z1]] = spec.bounds;
  return [[(x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2]];
}

/** Paved ground from s0 to s1 and t0 to t1, laid as slabs no longer than 100 m. */
function pave(
  ctx: Context,
  [s0, s1]: readonly number[],
  [t0, t1]: readonly number[],
  surface = 'concrete',
) {
  const n = Math.ceil((s1 - s0) / 100),
    step = (s1 - s0) / n;
  for (let i = 0; i < n; i++)
    put(
      ctx,
      `airport/slab-${surface}`,
      [s0 + step * (i + 0.5), (t0 + t1) / 2],
      [1, 0],
      [[0, 0, 0.5, 0.5]],
      'pad',
      {
        scale: [Math.abs(t1 - t0), 1, step],
      },
    );
}

function hangars(ctx: Context) {
  const t = -150;
  pave(ctx, [-1400, -770], [APRON.edge, t - HANGARS.standard.depth / 2 - 4]);
  [-1320, -1170, -1020, -870].forEach((s, i) => {
    const wide = i === 0,
      size = wide ? HANGARS.wide : HANGARS.standard,
      front = t - size.depth / 2 - 4,
      apronT = (front + APRON.edge) / 2;
    put(
      ctx,
      wide ? 'airport/hangar-wide' : 'airport/hangar',
      [s, t],
      OUT,
      hangarFootprint(size),
      'solid',
      {
        reach: HANGAR_PLINTH,
        name: `airport/hangar-${i + 1}`,
      },
    );
    if (wide) put(ctx, 'vehicle-airliner', [s, front - 22], OUT, GATE.airliner, 'solid');
    else if (i === 2)
      put(ctx, 'vehicle-helicopter', [s, apronT], OUT, footprintOf('vehicle-helicopter'), 'solid');
    else
      put(
        ctx,
        'vehicle-light-plane',
        [s + 12, apronT],
        OUT,
        footprintOf('vehicle-light-plane'),
        'solid',
      );
    put(
      ctx,
      'airport/tug',
      [s - size.span / 2 + 10, front - 6],
      [1, 0],
      [[0, 0, 1.5, 3.2]],
      'solid',
    );
  });
}

function generalAviation(ctx: Context) {
  pave(ctx, [-740, -380], [APRON.edge, -110]);
  const plane = footprintOf('vehicle-light-plane');
  for (let row = 0; row < 5; row++)
    for (let k = 0; k < 11; k++) {
      if (chance(ctx, 4, row, k) < 0.2) continue;
      const helicopter = row === 4 && k % 3 === 0,
        prop = helicopter ? 'vehicle-helicopter' : 'vehicle-light-plane';
      put(
        ctx,
        prop,
        [-715 + k * 30, -130 - row * 24],
        [0, row % 2 ? -1 : 1],
        helicopter ? footprintOf(prop) : plane,
        'solid',
      );
    }
}

function cargo(ctx: Context) {
  pave(ctx, [830, 1430], [APRON.edge, -60]);
  [900, 1060].forEach((s, i) =>
    put(ctx, 'airport/hangar', [s, -110], OUT, hangarFootprint(HANGARS.standard), 'solid', {
      reach: HANGAR_PLINTH,
      scale: [1.4, 0.75, 1],
      name: `airport/cargo-shed-${i + 1}`,
    }),
  );
  put(ctx, 'vehicle-airliner', [1300, -200], OUT, GATE.airliner, 'solid', {
    name: 'airport/freighter',
  });
  // Container stacks: 40 ft boxes, long side along s, in rows one to three high.
  for (let row = 0; row < 4; row++)
    for (let k = 0; k < 12; k++) {
      const high = 1 + Math.floor(chance(ctx, 5, row, k) * 3),
        colour = (level: number) => (chance(ctx, 6, row * 16 + k, level) < 0.5 ? 'red' : 'blue');
      if (
        !put(
          ctx,
          `container-${colour(0)}`,
          [1160 + row * 13, -80 - k * 3],
          [0, 1],
          [[0, 0, 6.13, 1.22]],
          'solid',
        )
      )
        continue;
      const base = ctx.placer.placed.length - 1;
      for (let level = 1; level < high; level++)
        ctx.placer.stack(`container-${colour(level)}`, base + level - 1, CONTAINER_HEIGHT);
    }
  put(ctx, 'airport/baggage-train', [1250, -100], [1, 0], [[0, -2.8, 0.9, 7]], 'solid');
}

export function maintenance(ctx: Context) {
  hangars(ctx);
  generalAviation(ctx);
  cargo(ctx);
}
