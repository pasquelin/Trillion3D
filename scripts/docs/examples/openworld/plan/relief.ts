/**
 * The global, low-frequency relief of the world (#332), packed into the map's layout: the coast
 * runs along the south edge with islands offshore, a compact range rises along the north edge, a
 * low desert plateau lies to the west, rolling land fills the rest. Regions refine it; rivers and
 * roads cut it later.
 */
import { WORLD } from './contract.ts';
import { fbm, hash2, nameSeed, ridged, smoothstep } from './noise.ts';

/** Depth scale of the continental shelf, metres: the sea a swimmer or a boat sees near shore. */
const SHELF = 80;
/** Mean shoreline, metres south of the centre: the sea keeps a 1.5 km strip along the south edge. */
const COAST_Z = WORLD.size / 2 - 1_500;

export type Island = { x: number; z: number; top: number; radius: number };

export type Relief = {
  /** Height before any region refinement, river or road: metres, highest peak `WORLD.peak`. */
  height(x: number, z: number): number;
  /** Distance to the continent's coastline, positive inland, metres (islands excluded). */
  coast(x: number, z: number): number;
  /** The south coastline's z at a given x. */
  southCoastZ(x: number): number;
  islands: readonly Island[];
};

export function createRelief(seed: number): Relief {
  const s = (name: string) => nameSeed(seed, `relief/${name}`),
    [southSeed, rangeSeed, axisSeed, rollSeed, islandSeed] = [
      'south',
      'range',
      'axis',
      'roll',
      'islands',
    ].map(s),
    southCoastZ = (x: number) =>
      COAST_Z + 180 * fbm(southSeed, x / 2_500, 0.5, 3) + 50 * fbm(southSeed + 7, x / 500, 0, 2),
    coast = (x: number, z: number) => southCoastZ(x) - z;
  // Three islands in the sea strip, one per third of the shore, the last off the coast region.
  const islands: Island[] = Array.from({ length: 3 }, (_, index) => {
    const draw = (salt: number) => hash2(islandSeed, index, salt),
      x = -WORLD.size / 2 + (index + 0.3 + 0.5 * draw(0)) * (WORLD.size / 3);
    return {
      x,
      z: southCoastZ(x) + 500 + 400 * draw(1),
      top: 30 + 60 * draw(2),
      radius: 180 + 200 * draw(3),
    };
  });
  const raw = (x: number, z: number) => {
    const c = coast(x, z),
      // One continuous profile through sea level: the shelf rises to 0 m at the coastline and
      // the land keeps rising from there, gently, so a beach can form; a region that wants
      // cliffs raises them in its own refinement.
      shore = c >= 0 ? 40 * (1 - Math.exp(-c / 2_000)) : -SHELF * (1 - Math.exp(c / 500)),
      inland = smoothstep(0, 800, c);
    let height = shore;
    // Each layer is evaluated only where its envelope is non-zero: the sea skips them all.
    if (inland > 0) {
      const envelope = smoothstep(-2_100, -2_700, z),
        plateau = smoothstep(-1_600, -2_200, x) * smoothstep(1_000, 0, z);
      let land = 25 * fbm(rollSeed, x / 1_500, z / 1_500, 4) * (1 + 2 * plateau) + 120 * plateau;
      if (envelope > 0) {
        const axis = -3_400 + 300 * fbm(axisSeed, x / 3_000, 0.3, 2),
          range = Math.exp(-(((z - axis) / 900) ** 2)) * envelope;
        land += 2_000 * range * (0.35 + 0.65 * ridged(rangeSeed, x / 2_000, z / 2_000, 6));
      }
      height += inland * land;
    }
    for (const island of islands) {
      const d2 = ((x - island.x) ** 2 + (z - island.z) ** 2) / island.radius ** 2;
      if (d2 > 9) continue;
      const bump =
        (island.top + SHELF) * Math.exp(-d2) * (1 + 0.15 * fbm(rollSeed + 3, x / 500, z / 500, 3));
      if (bump - SHELF > height) height = bump - SHELF;
    }
    return height;
  };
  // Scale the land so the highest point of the map, found on a 100 m grid, is exactly the peak.
  let highest = 0;
  for (let z = -WORLD.size / 2; z <= WORLD.size / 2; z += 100)
    for (let x = -WORLD.size / 2; x <= WORLD.size / 2; x += 100)
      highest = Math.max(highest, raw(x, z));
  const scale = WORLD.peak / highest;
  const height = (x: number, z: number) => {
    const value = raw(x, z);
    return value > 0 ? value * scale : value;
  };
  return { height, coast, southCoastZ, islands };
}
