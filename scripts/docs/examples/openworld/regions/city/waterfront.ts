/**
 * The harbour's shore and water: warehouses and smoking chimneys inland of the quays, motorboats
 * looping the basin between them and sailing boats circling offshore. Positions are given in the
 * harbour's frame: `a` metres out to sea from the coast point, `b` metres along the coast.
 */
import type { Marker, Vec3 } from '../../plan/contract.ts';
import { hash01 } from '../../props/index.ts';
import { corners, type Obb, type Xz } from './frame.ts';
import { SAMPLE } from './grid.ts';
import { QUAY, ROOT } from './harbour-props.ts';
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
  // The basin loop at full size, else shrunk toward the quay until it floats.
  const basinAt = (k: number) =>
    [
      [100, -30],
      [260, -30],
      [290, 0],
      [260, 30],
      [100, 30],
      [80, 0],
    ].map(([a, b]) => world(root + a * k, b * k));
  const basin = [1, 0.7, 0.5, 0.35].map(basinAt).find(water) ?? basinAt(1);
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
      rings = [1, 0.6, 0.4].map((k) =>
        Array.from({ length: 16 }, (_, j) => {
          const t = phase + (j * Math.PI) / 8;
          return world(k * (700 + Math.cos(t) * 250), k * Math.sin(t) * 250 * (n % 2 ? 1 : -1));
        }),
      ),
      ring = rings.find(water);
    if (ring)
      placer.movers.push({
        kind: 'path',
        name: `city/sailboat-${n}`,
        model: 'sailboat',
        points: path([...ring, ring[0]]),
        speed: 4,
        loop: true,
      });
  }
  if (!placer.movers.some((m) => m.kind === 'path')) openWaterLoops(placer, water, path);
}

/**
 * When the harbour frame finds no water (a port squeezed inland), the boats loop over the widest
 * open water of the region: circles round the sea point farthest from any shore.
 */
function openWaterLoops(placer: Placer, water: (p: Xz[]) => boolean, path: (p: Xz[]) => Vec3[]) {
  const { minX, minZ, maxX, maxZ } = placer.site.bounds,
    circle = ([cx, cz]: Xz, r: number): Xz[] =>
      Array.from({ length: 16 }, (_, k) => [
        cx + Math.cos((k * Math.PI) / 8) * r,
        cz + Math.sin((k * Math.PI) / 8) * r,
      ]);
  let best: { at: Xz; r: number } | undefined;
  for (let x = minX + 50; x < maxX; x += 100)
    for (let z = minZ + 50; z < maxZ; z += 100)
      for (const r of [300, 200, 120, 60])
        if ((!best || r > best.r) && water(circle([x, z], r))) best = { at: [x, z], r };
  if (!best) return;
  const loops = [
    ['motorboat', best.r * 0.5, 6],
    ['sailboat', best.r * 0.9, 4],
  ] as const;
  for (const [model, r, speed] of loops) {
    const ring = circle(best.at, r);
    placer.movers.push({
      kind: 'path',
      name: `city/${model}-open`,
      model,
      points: path([...ring, ring[0]]),
      speed,
      loop: true,
    });
  }
}

/** The kit's cargo ship draws 10 m, and its funnel's mouth stands 32.4 m over the waterline. */
const SHIP = { draft: 10, funnel: 32.4, half: [15, 90] as Xz };

/**
 * The cargo ship alongside the quay at `b`, slid out along the berth until the sea under its
 * whole hull is deeper than its draft; none when the berth never gets that deep.
 */
export function moor(
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
