/**
 * The harbour, where the city meets the sea: two quays run 300 m out from the coast at the port.
 * Both carry container stacks; one has three gantry cranes over a moored cargo ship, the other
 * three slewing cranes whose jibs the page turns. Warehouses and two smoking chimneys
 * stand on the shore; motorboats loop the basin, sailing boats circle offshore.
 */
import type { Vec3 } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { facing, headingOf, sidewaysOf, type Obb, type Xz } from './frame.ts';
import { FLOOD_LAMPS } from './floodlight.ts';
import { QUAY, ROOT, SLEW_HEIGHT } from './harbour-props.ts';
import { SAMPLE } from './grid.ts';
import { RANK, type Placer } from './placement.ts';
import { findCoasts, groundUnder } from './site.ts';
import { boats, moor, shore } from './waterfront.ts';
import { EYE } from '../../build/markers.ts';

const PIERS = [-80, 80] as const;
const CONTAINER: Xz = [6.2, 1.3];

/**
 * The harbour, on the first coast round the port where its quays find room, drawn inland a
 * sample at a time until the sea bed under a quay is within its wall (a steep shelf keeps the
 * quay's root ashore): both quays if any spot takes both, else one. Returns the direction out to
 * sea, or nothing when the city has no open coast.
 */
export function layHarbour(placer: Placer, seed: number): { out: Xz } | undefined {
  for (const piers of [PIERS.length, 1])
    for (const { point, out } of findCoasts(placer.site))
      for (let inland = 0; inland <= QUAY.length; inland += SAMPLE) {
        const laid = harbourAt(placer, seed, point, out, ROOT - inland, piers);
        if (laid) return laid;
      }
  return undefined;
}

/**
 * The harbour on the coast at `point`, its quays' roots `root` metres out to sea from it, when at
 * least `piers` quays stand there; its boats keep to the sea off the coast.
 */
function harbourAt(placer: Placer, seed: number, point: Xz, out: Xz, root: number, piers: number) {
  const side: Xz = [-out[1], out[0]],
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
    across = sidewaysOf(side),
    pier = (b: number) => box(root + QUAY.length / 2, b, [QUAY.width / 2, QUAY.length / 2], along);
  // A quay stands where its wall reaches the sea bed and its deck clears the shore.
  const standing = PIERS.filter((b) => {
    const ground = groundUnder(placer.site, pier(b), SAMPLE);
    return (
      Math.min(...ground) >= -QUAY.depth &&
      Math.max(...ground) < QUAY.deck &&
      placer.fits(pier(b), 'flat')
    );
  });
  if (standing.length < piers) return undefined;
  const quays = standing.filter((b) =>
    placer.place('city/quay', at(root, b, 0), along, 'flat', RANK.structure, pier(b), {
      support: -QUAY.depth,
    }),
  );
  if (!quays.length) return undefined;
  const deck = QUAY.deck,
    support = -QUAY.depth;
  for (const b of quays) {
    for (let k = 0; k < 30; k++)
      for (const offset of [-14, 0, 14]) {
        const a = root + 30 + k * 3,
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
      at(root + 150, b - Math.sign(b) * 23, deck),
      headingOf([-side[0] * Math.sign(b), -side[1] * Math.sign(b)]),
      'solid',
      RANK.street,
      box(root + 150, b - Math.sign(b) * 23, [0.6, 0.6], along),
      { lamps: FLOOD_LAMPS, support },
    );
  }
  const [containers, cranes] = PIERS;
  if (quays.includes(containers)) {
    const shipSide = headingOf([-side[0], -side[1]]);
    for (const a of [170, 215, 260])
      placer.place(
        'gantry-crane',
        at(root + a, containers, deck),
        shipSide,
        'solid',
        RANK.structure,
        box(root + a, containers, [16, 9], shipSide),
        { support },
      );
    moor(placer, at, box, along, containers - QUAY.width / 2 - 17);
  }
  if (quays.includes(cranes))
    for (const [n, a] of [140, 190, 240].entries()) {
      const b = cranes - 15;
      placer.place(
        'city/crane-portal',
        at(root + a, b, deck),
        along,
        'solid',
        RANK.structure,
        box(root + a, b, [5.5, 7], along),
        {
          support,
          movers: [
            {
              kind: 'spin',
              name: `city/crane-jib-${n}`,
              model: 'city/crane-jib',
              position: at(root + a, b, deck + SLEW_HEIGHT),
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
      position: at(root + QUAY.length - 10, quays[0], deck + EYE),
      deck: true,
      yaw: facing([-out[0], -out[1]]),
      pitch: 0.05,
    },
    {
      kind: 'spawn',
      vehicle: 'boat',
      name: 'city/harbour-boat',
      position: at(root + 150, 0, 0),
      yaw: facing(out),
    },
  );
  return { out };
}

const livery = (seed: number, k: number, offset: number, tier: number) =>
  hash01(seed + 9, k, offset, tier) < 0.5 ? 'container-red' : 'container-blue';
