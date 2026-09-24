/**
 * Villages on the plan's settlements: the church square near the centre, houses with gardens in
 * rings facing it, street lamps along the plan's roads through the village.
 */
import type { Instance, Settlement } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { SQUARE_CENTRE } from './church.ts';
import { HOUSES } from './houses.ts';
import { frame } from './land.ts';
import type { Site } from './site.ts';

/** Ring spacing and the frontage a house takes along its ring, metres. */
const RING = 30,
  FRONTAGE = 24;
/** Share of plots built at the village's heart; it falls to none at its edge. */
const BUILT = 0.8;
/** Distance between two street lamps along a road, metres. */
const LAMP_STEP = 32;

export type Village = { settlement: Settlement; square?: Instance };

export function placeVillages(
  site: Site,
  villages: readonly Settlement[],
  seed: number,
): Village[] {
  return villages.map((settlement, v): Village => {
    const [cx, , cz] = settlement.centre;
    let square: Instance | undefined;
    // The square: the first free spot on a spiral out from the centre, facing it.
    for (let k = 0; k < 40 && !square; k++) {
      const r = k * 12,
        a = k * 2.4,
        x = cx + Math.cos(a) * r,
        z = cz + Math.sin(a) * r;
      square = site.place(
        'countryside/church-square',
        x,
        z,
        k ? Math.atan2(cx - x, cz - z) : hash01(seed, v) * 6.28,
        {
          seat: 'plinth',
          name: `countryside/${settlement.id}/church`,
        },
      );
    }
    for (let r = 50; r < settlement.radius; r += RING) {
      const count = Math.floor((2 * Math.PI * r) / FRONTAGE);
      for (let n = 0; n < count; n++) {
        if (hash01(seed + 5, v * 1000 + r, n) > BUILT * (1 - r / settlement.radius) ** 2) continue;
        const a = ((n + hash01(seed + 1, v, r)) / count) * Math.PI * 2,
          x = cx + Math.cos(a) * r,
          z = cz + Math.sin(a) * r,
          yaw = Math.atan2(cx - x, cz - z),
          spec = HOUSES[Math.floor(hash01(seed + 2, v * 1000 + r, n) * HOUSES.length)],
          house = site.place(spec.id, x, z, yaw, {
            seat: 'plinth',
            name: `countryside/${settlement.id}/house-${r}-${n}`,
          });
        if (!house) continue;
        // The garden behind: a fruit tree or a shrub.
        const garden = frame(x, z, yaw).at(hash01(seed + 3, v, n) * 6 - 3, -spec.depth / 2 - 6);
        site.place(
          hash01(seed + 4, v, n) < 0.5 ? 'countryside/fruit-tree' : 'bush-round',
          ...garden,
          yaw,
        );
      }
    }
    streetLamps(site, settlement);
    return { settlement, ...(square ? { square } : {}) };
  });
}

/** Street lamps along every plan road inside the village, alternating sides, arms over the road. */
function streetLamps(site: Site, settlement: Settlement) {
  const [cx, , cz] = settlement.centre;
  let n = 0;
  for (const road of site.plan.roads) {
    let next = 0,
      run = 0;
    for (let i = 1; i < road.points.length; i++) {
      const [ax, , az] = road.points[i - 1],
        [bx, , bz] = road.points[i],
        length = Math.hypot(bx - ax, bz - az) || 1;
      for (; next < run + length; next += LAMP_STEP) {
        const t = (next - run) / length,
          x = ax + (bx - ax) * t,
          z = az + (bz - az) * t;
        if (Math.hypot(x - cx, z - cz) > settlement.radius) continue;
        const side = n++ % 2 ? 1 : -1,
          nx = (-(bz - az) / length) * side,
          nz = ((bx - ax) / length) * side,
          offset = road.width / 2 + 1.8;
        site.place('street-lamp', x + nx * offset, z + nz * offset, Math.atan2(nz, -nx), {
          name: `countryside/${settlement.id}/lamp-${n}`,
        });
      }
      run += length;
    }
  }
}

/** The square's centre in the world, for a teleport or a spawn. */
export function squareCentre(square: Instance): [number, number, number] {
  const [x, z] = frame(square.position[0], square.position[2], square.yaw).at(
    SQUARE_CENTRE[0],
    SQUARE_CENTRE[2],
  );
  return [x, square.position[1] + SQUARE_CENTRE[1], z];
}
