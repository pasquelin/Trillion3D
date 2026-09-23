/**
 * The harbour, where the city meets the sea: two quays run 300 m out from the coast at the port.
 * Both carry container stacks; one has three gantry cranes over a moored cargo ship, the other
 * three slewing cranes whose jibs the page turns. Warehouses and two smoking chimneys
 * stand on the shore; motorboats loop the basin, sailing boats circle offshore.
 */
import type { Marker, Vec3 } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { facing, headingOf, sidewaysOf, type Obb, type Xz } from './frame.ts';
import { FLOOD_LAMPS } from './floodlight.ts';
import { QUAY, SLEW_HEIGHT } from './harbour-props.ts';
import { SAMPLE } from './grid.ts';
import { RANK, type Placer } from './placement.ts';
import { findCoast, groundUnder } from './site.ts';
import { boats, shore } from './waterfront.ts';
import { EYE } from '../../build/markers.ts';

/** Where the quays start, metres inland of the first sea point. */
const ROOT = -20;
const PIERS = [-80, 80] as const;
const CONTAINER: Xz = [6.2, 1.3];

/** The harbour; returns the direction out to sea, or nothing when the city has no open coast. */
export function layHarbour(placer: Placer, seed: number): { out: Xz } | undefined {
  const coast = findCoast(placer.site);
  if (!coast) return undefined;
  const { point, out } = coast,
    side: Xz = [-out[1], out[0]],
    world = (a: number, b: number): Xz => [
      point[0] + out[0] * a + side[0] * b,
      point[1] + out[1] * a + side[1] * b,
    ],
    at = (a: number, b: number, y: number): Vec3 => {
      const [x, z] = world(a, b);
      return [x, y, z];
    },
    box = (a: number, b: number, half: Xz, yaw: number): Obb => ({
      centre: world(a, b),
      half,
      yaw,
    }),
    along = headingOf(out),
    across = sidewaysOf(side);
  // A quay stands where its wall reaches the sea bed and its deck clears the shore.
  const quays: number[] = [];
  for (const b of PIERS) {
    const pier = box(ROOT + QUAY.length / 2, b, [QUAY.width / 2, QUAY.length / 2], along),
      ground = groundUnder(placer.site, pier, SAMPLE);
    if (Math.min(...ground) < -QUAY.depth || Math.max(...ground) >= QUAY.deck) continue;
    if (
      placer.place('city/quay', at(ROOT, b, 0), along, 'flat', RANK.structure, pier, {
        support: -QUAY.depth,
      })
    )
      quays.push(b);
  }
  if (!quays.length) return undefined;
  const deck = QUAY.deck,
    support = -QUAY.depth;
  for (const b of quays) {
    for (let k = 0; k < 30; k++)
      for (const offset of [-14, 0, 14]) {
        const a = ROOT + 30 + k * 3,
          tiers = 1 + Math.floor(hash01(seed, k, offset, b) * 4),
          bottom = placer.place(
            livery(seed, k, offset, 0),
            at(a, b + offset, deck),
            across,
            'solid',
            RANK.furniture,
            box(a, b + offset, CONTAINER, across),
            { support },
          );
        for (let t = 1; bottom && t < tiers; t++)
          placer.place(
            livery(seed, k, offset, t),
            at(a, b + offset, deck + t * 2.59),
            across,
            'solid',
            RANK.garden,
          );
      }
    placer.place(
      'city/flood-mast',
      at(ROOT + 150, b - Math.sign(b) * 23, deck),
      headingOf([-side[0] * Math.sign(b), -side[1] * Math.sign(b)]),
      'solid',
      RANK.street,
      box(ROOT + 150, b - Math.sign(b) * 23, [0.6, 0.6], along),
      { lamps: FLOOD_LAMPS, support },
    );
  }
  const [containers, cranes] = PIERS;
  if (quays.includes(containers)) {
    const shipSide = headingOf([-side[0], -side[1]]);
    for (const a of [170, 215, 260])
      placer.place(
        'gantry-crane',
        at(ROOT + a, containers, deck),
        shipSide,
        'solid',
        RANK.structure,
        box(ROOT + a, containers, [16, 9], shipSide),
        { support },
      );
    moor(placer, at, box, along, containers - QUAY.width / 2 - 17);
  }
  if (quays.includes(cranes))
    for (const [n, a] of [140, 190, 240].entries()) {
      const b = cranes - 15;
      placer.place(
        'city/crane-portal',
        at(ROOT + a, b, deck),
        along,
        'solid',
        RANK.structure,
        box(ROOT + a, b, [5.5, 7], along),
        {
          support,
          movers: [
            {
              kind: 'spin',
              name: `city/crane-jib-${n}`,
              model: 'city/crane-jib',
              position: at(ROOT + a, b, deck + SLEW_HEIGHT),
              axis: [0, 1, 0],
              rpm: 0.15 + 0.1 * hash01(seed, n),
            },
          ],
        },
      );
    }
  shore(placer, world, at, along, across);
  boats(placer, world, ROOT, seed);
  placer.markers.push(
    {
      kind: 'teleport',
      name: 'city/harbour',
      position: at(ROOT + QUAY.length - 10, quays[0], deck + EYE),
      deck: true,
      yaw: facing([-out[0], -out[1]]),
      pitch: 0.05,
    },
    {
      kind: 'spawn',
      vehicle: 'boat',
      name: 'city/harbour-boat',
      position: at(ROOT + 150, 0, 0),
      yaw: facing(out),
    },
  );
  return { out };
}

/** The kit's cargo ship draws 10 m, and its funnel's mouth stands 32.4 m over the waterline. */
const SHIP = { draft: 10, funnel: 32.4, half: [15, 90] as Xz };

/**
 * The cargo ship alongside the quay at `b`, slid out along the berth until the sea under its
 * whole hull is deeper than its draft; none when the berth never gets that deep.
 */
function moor(
  placer: Placer,
  at: (a: number, b: number, y: number) => Vec3,
  box: (a: number, b: number, half: Xz, yaw: number) => Obb,
  along: number,
  b: number,
) {
  for (let a = ROOT + QUAY.length - 100; a <= ROOT + QUAY.length + 60; a += 20) {
    const hull = box(a, b, SHIP.half, along);
    if (!groundUnder(placer.site, hull, SAMPLE).every((g) => g < -SHIP.draft)) continue;
    const funnel: Marker = {
      kind: 'emitter',
      effect: 'smoke',
      name: 'city/ship-funnel',
      position: at(a - 76, b, SHIP.funnel),
      radius: 3,
    };
    if (
      placer.place('cargo-ship', at(a, b, 0), along, 'solid', RANK.structure, hull, {
        markers: [funnel],
      })
    )
      return;
  }
}

const livery = (seed: number, k: number, offset: number, tier: number) =>
  hash01(seed + 9, k, offset, tier) < 0.5 ? 'container-red' : 'container-blue';
