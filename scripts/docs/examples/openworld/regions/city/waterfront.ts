/**
 * The harbour's shore and water: warehouses and smoking chimneys inland of the quays, motorboats
 * looping the basin between them and sailing boats circling offshore. Positions are given in the
 * harbour's frame: `a` metres out to sea from the coast point, `b` metres along the coast.
 */
import type { Vec3 } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { corners, type Obb, type Xz } from './frame.ts';
import { SAMPLE } from './grid.ts';
import { RANK, type Extras, type Placer } from './placement.ts';
import { CHIMNEY_TOP } from './signs.ts';
import { dry, groundUnder, inBounds } from './site.ts';
import { FOUNDATION } from './tower-kit.ts';

/**
 * Three warehouses and two chimneys on the shore behind the quays, each at the first distance
 * inland where the land is dry, level and clear of roads.
 */
export function shore(
  placer: Placer,
  world: (a: number, b: number) => Xz,
  at: (a: number, b: number, y: number) => Vec3,
  along: number,
  across: number,
) {
  const stand = (
    prop: string,
    depths: number[],
    b: number,
    half: Xz,
    yaw: number,
    extras: (a: number, y: number) => Extras = () => ({}),
  ) => {
    for (const a of depths) {
      const footprint: Obb = { centre: world(a, b), half, yaw },
        ground = groundUnder(placer.site, footprint, SAMPLE),
        y = Math.max(...ground);
      if (
        !corners(footprint).every((c) => dry(placer.site, c)) ||
        y - Math.min(...ground) > FOUNDATION / 2
      )
        continue;
      if (
        placer.place(prop, at(a, b, y), yaw, 'solid', RANK.structure, footprint, {
          support: y - FOUNDATION,
          ...extras(a, y),
        })
      )
        return;
    }
  };
  const inland = (from: number) => Array.from({ length: 8 }, (_, k) => from - k * 40);
  for (const b of [-100, 0, 100]) stand('city/warehouse', inland(-40), b, [30.5, 15.5], across);
  for (const b of [-45, 45])
    stand('city/chimney', inland(-120), b, [4, 4], along, (a, y) => ({
      markers: [
        {
          kind: 'emitter',
          effect: 'smoke',
          name: placer.name('chimney-smoke'),
          position: at(a, b, y + CHIMNEY_TOP),
          radius: 4,
        },
      ],
    }));
}

/** Motorboats loop the basin between the quays (which start at `root`); sailing boats circle 700 m out. */
export function boats(
  placer: Placer,
  world: (a: number, b: number) => Xz,
  root: number,
  seed: number,
) {
  const water = (points: Xz[]) =>
      points.every((p) => placer.site.plan.height(p[0], p[1]) < -1 && inBounds(placer.site, p)),
    path = (points: Xz[]): Vec3[] => points.map(([x, z]) => [x, 0, z]);
  const basin = [
    [100, -30],
    [260, -30],
    [290, 0],
    [260, 30],
    [100, 30],
    [80, 0],
  ].map(([a, b]) => world(root + a, b));
  for (const [n, loop] of [basin, [...basin].reverse()].entries())
    if (water(loop))
      placer.movers.push({
        kind: 'path',
        name: `city/motorboat-${n}`,
        model: 'motorboat',
        points: path([...loop, loop[0]]),
        speed: 6 + n,
        loop: true,
      });
  for (let n = 0; n < 3; n++) {
    const phase = hash01(seed, 40 + n) * Math.PI * 2,
      ring = Array.from({ length: 16 }, (_, k) => {
        const t = phase + (k * Math.PI) / 8;
        return world(700 + Math.cos(t) * 250, Math.sin(t) * 250 * (n % 2 ? 1 : -1));
      });
    if (water(ring))
      placer.movers.push({
        kind: 'path',
        name: `city/sailboat-${n}`,
        model: 'sailboat',
        points: path([...ring, ring[0]]),
        speed: 4,
        loop: true,
      });
  }
}
