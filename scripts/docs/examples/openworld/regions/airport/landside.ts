/**
 * The landside: a large surface car park (double rows of bays on asphalt, lamps on islands, a
 * few lit at night), the control tower and the surveillance radar west of it, the fuel farm
 * east with its pipe racks toward the apron, and the security fence around the airside.
 */
import { STREET_LAMP_LIGHTS } from '../../props/index.ts';
import { along, chance, put, square, type Context } from './context.ts';
import { TANK } from './fuel.ts';
import { GARAGE, GARAGE_COLUMNS, HOTEL, STATION } from './landmarks.ts';
import { OFFICE_PLINTH, OFFICES, officeFootprint } from './offices.ts';
import { FIELD } from './site.ts';
import { TOWER } from './tower.ts';

/** Cars that fit a 2.5 × 5 m bay, with their half width and half length. */
const CARS = [
  ['vehicle-sedan', 0.94, 2.46],
  ['vehicle-hatchback', 0.89, 2.06],
  ['vehicle-sports-car', 0.97, 2.26],
] as const;
/** A double row: a 7 m aisle, then two rows of 5 m bays back to back. */
const MODULE = 17;
const SEGMENT = 50,
  ISLAND = 2;
export const CAR_PARK = { from: -312, to: 312, near: 30, rows: 15 } as const;

/** Parks cars in one row of 20 bays; `open` is the local t direction the bays open toward. */
function row(ctx: Context, s0: number, t: number, open: number, key: number, occupancy: number) {
  put(ctx, 'airport/mark-bays', [s0 + SEGMENT / 2, t], [0, open], square(1), 'paint');
  for (let b = 0; b < 20; b++) {
    if (chance(ctx, 7, key, b) > occupancy) continue;
    const [prop, hw, hd] = CARS[Math.floor(chance(ctx, 8, key, b) * CARS.length)],
      nose = chance(ctx, 9, key, b) < 0.7 ? -open : open;
    put(ctx, prop, [s0 + 1.25 + b * 2.5, t], [0, nose], [[0, 0, hw, hd]], 'solid');
  }
}

/**
 * The car park: 15 modules of two rows, split in 50 m segments by lamp islands. A segment a
 * road crosses is left out. `occupancy` is the share of bays taken.
 */
export function carPark(ctx: Context, occupancy: number) {
  for (let m = 0; m < CAR_PARK.rows; m++) {
    const t0 = CAR_PARK.near + m * MODULE;
    for (let s0 = CAR_PARK.from, k = 0; s0 + SEGMENT <= CAR_PARK.to; s0 += SEGMENT + ISLAND, k++) {
      const placed = put(
        ctx,
        'airport/slab-asphalt',
        [s0 + (SEGMENT + ISLAND) / 2, t0 + MODULE / 2 + (m === CAR_PARK.rows - 1 ? 3.5 : 0)],
        [1, 0],
        [[0, 0, 0.5, 0.5]],
        'pad',
        {
          scale: [MODULE + (m === CAR_PARK.rows - 1 ? 7 : 0), 1, SEGMENT + ISLAND],
        },
      );
      if (!placed) continue;
      row(ctx, s0, t0 + 9.5, -1, m * 64 + k * 2, occupancy);
      row(ctx, s0, t0 + 14.5, 1, m * 64 + k * 2 + 1, occupancy);
      const lit = m % 4 === 1 && k % 3 === 1;
      put(ctx, 'street-lamp', [s0 + SEGMENT + ISLAND / 2, t0 + 12], [0, 1], square(0.3), 'solid', {
        lamps: lit ? STREET_LAMP_LIGHTS : undefined,
        name: lit ? `airport/car-park-lamp-${m}-${k}` : undefined,
      });
    }
  }
}

/** Cars on every level of the garage: four rows, three bays between each pair of columns. */
function garageCars(ctx: Context, host: number) {
  for (let level = 0; level <= GARAGE.decks; level++)
    for (const [z, nose] of [
      [-19, 1],
      [-8.5, -1],
      [8.5, 1],
      [19, -1],
    ])
      GARAGE_COLUMNS.slice(0, -1).forEach((x, gap) => {
        for (let j = 0; j < 3; j++) {
          const key = level * 1000 + gap * 10 + j + (z + 20) * 100;
          if (chance(ctx, 10, key) > 0.65) continue;
          const [prop] = CARS[Math.floor(chance(ctx, 11, key) * CARS.length)];
          ctx.placer.inside(
            prop,
            host,
            [x + 2.75 + j * 2.5, level ? level * GARAGE.deck : 0.2, z],
            nose > 0 ? 0 : Math.PI,
          );
        }
      });
}

export function buildings(ctx: Context) {
  put(
    ctx,
    'airport/control-tower',
    [-420, 70],
    [0, -1],
    [[0, 0, TOWER.base[0] / 2, TOWER.base[2] / 2]],
    'solid',
    {
      reach: TOWER.plinth,
      name: 'airport/control-tower',
    },
  );
  put(ctx, 'airport/radar-tower', [-480, 200], [0, -1], square(3), 'solid', { reach: 0.8 });
  put(
    ctx,
    'airport/hotel',
    [400, 95],
    [0, 1],
    [[0, 0, HOTEL.width / 2 + 3, HOTEL.depth / 2 + 4]],
    'solid',
    {
      reach: HOTEL.plinth,
    },
  );
  if (
    put(
      ctx,
      'airport/parking-garage',
      [380, 200],
      [0, 1],
      [
        [0, 0, GARAGE.width / 2 + 0.6, GARAGE.depth / 2 + 0.6],
        [49, 0, 10.3, 10.3],
      ],
      'solid',
      { reach: GARAGE.plinth },
    )
  )
    garageCars(ctx, ctx.placer.placed.length - 1);
  put(
    ctx,
    'airport/fire-station',
    [-335, -110],
    [0, -1],
    [[0, -1.25, STATION.width / 2 + 3.2, STATION.depth / 2 + 1.75]],
    'solid',
    { reach: STATION.plinth },
  );
  // The business park west of the tower.
  for (const [prop, size, s, t] of [
    ['airport/office-long', OFFICES.long, -640, 90],
    ['airport/office-tower', OFFICES.tower, -640, 175],
    ['airport/office-long', OFFICES.long, -720, 250],
  ] as const)
    put(ctx, prop, [s, t], [0, -1], officeFootprint(size), 'solid', { reach: OFFICE_PLINTH });
  const half = TANK.bund + 0.2;
  for (const t of [110, 165])
    for (const s of [560, 615, 670])
      put(ctx, 'airport/fuel-tank', [s, t], [0, -1], square(half), 'solid', { reach: 0.6 });
  for (const t of along(65, -45, 30))
    put(ctx, 'airport/pipe-rack', [615, t], [0, 1], [[0, 0, 1.8, 15]], 'solid', { reach: 0.3 });
}

/** The airside fence: 25 m runs around the field, left open wherever something else stands. */
export function fence(ctx: Context) {
  const end = ctx.site.length / 2 + FIELD.overrun - 10,
    [far] = FIELD.across,
    near = -30,
    run = (s: number, t: number, toward: [number, number]) =>
      put(ctx, 'airport/fence', [s, t], toward, [[0, -0.2, 12.5, 0.3]], 'solid', { reach: 0.2 });
  for (const s of along(-end + 12.5, end - 12.5, 25)) {
    run(s, far + 10, [0, 1]);
    run(s, near, [0, -1]);
  }
  for (const t of along(far + 10 + 12.5, near - 12.5, 25)) {
    run(-end, t, [1, 0]);
    run(end, t, [-1, 0]);
  }
}
