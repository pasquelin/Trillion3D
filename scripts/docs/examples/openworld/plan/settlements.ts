/**
 * The settlements of the world (#332): the city at the main river's mouth, its port, the airport
 * on its platform, a town per region, villages on the flattest land around seeded spots, a ski
 * resort high in the mountains and a small port on the largest island.
 */
import { WORLD, type RegionName, type Settlement, type Vec3 } from './contract.ts';
import type { Platform } from './carve.ts';
import { REGION_BOUNDS } from './layout.ts';
import type { Island } from './relief.ts';
import type { Ground } from './roads.ts';
import { best, RADIUS, seededSpot, settle, slopeAt } from './sites.ts';

/** Villages per region: a design of how busy each land is, not a measurement. */
const VILLAGES: Partial<Record<RegionName, number>> = {
  countryside: 7,
  mountains: 3,
  coast: 3,
  desert: 2,
};
/** Where each region's town is sought: a spot, searched within 1.2 km for flat dry land. */
const TOWNS: Partial<Record<RegionName, [number, number]>> = {
  countryside: [2_900, -500],
  desert: [-2_900, -500],
  coast: [2_500, 2_000],
  mountains: [-1_000, -2_900],
};

export function planSettlements(
  ground: Ground,
  seed: number,
  mouth: readonly [number, number],
  platform: Platform,
  islands: readonly Island[],
): Settlement[] {
  const out: Settlement[] = [],
    add = (id: string, kind: Settlement['kind'], region: RegionName, centre: Vec3) =>
      out.push({ id, kind, region, centre, radius: RADIUS[kind] });
  const spaced = (x: number, z: number, h: number) =>
    h > 3 &&
    !ground.wet(x, z) &&
    out.every((s) => Math.hypot(s.centre[0] - x, s.centre[2] - z) > s.radius + 300);
  const at = (x: number, z: number): Vec3 => [x, ground.height(x, z), z];
  // The city fills the land between the airport and the shore, centred across it.
  add('city', 'city', 'city', at(mouth[0], (REGION_BOUNDS.city.minZ + mouth[1]) / 2));
  const portX = mouth[0] + 1_500,
    port = best(
      ground.grid,
      { minX: portX - 500, maxX: portX + 500, minZ: mouth[1] - 2_000, maxZ: mouth[1] + 500 },
      (x, z, h) => (h > 2 ? z : -Infinity),
    );
  if (port) add('port', 'port', 'city', port);
  add(
    'airport',
    'airport',
    'airport',
    at((platform.minX + platform.maxX) / 2, (platform.minZ + platform.maxZ) / 2),
  );
  for (const [region, spot] of Object.entries(TOWNS) as [RegionName, [number, number]][]) {
    const centre = settle(
      ground.grid,
      spot,
      1_200,
      REGION_BOUNDS[region],
      RADIUS.town,
      (x, z, h) => spaced(x, z, h) && h < WORLD.peak * 0.75,
    );
    if (centre) add(`${region}-town`, 'town', region, centre);
  }
  const resort = best(ground.grid, REGION_BOUNDS.mountains, (x, z, h) =>
    spaced(x, z, h)
      ? -Math.abs(h - WORLD.peak * 0.75) / 100 - slopeAt(ground.grid, x, z) * 20
      : -Infinity,
  );
  if (resort) add('ski-resort', 'resort', 'mountains', resort);
  for (const [region, count] of Object.entries(VILLAGES) as [RegionName, number][])
    for (let index = 0; index < count; index++) {
      const spot = seededSpot(ground.grid, seed, region, index),
        centre = settle(
          ground.grid,
          spot,
          1_500,
          REGION_BOUNDS[region],
          RADIUS.village,
          (x, z, h) => spaced(x, z, h) && h < 1_600,
        );
      if (centre) add(`${region}-village-${index}`, 'village', region, centre);
    }
  // The island port stands on the largest island inside the coast region.
  const coast = REGION_BOUNDS.coast,
    island = islands
      .filter((i) => i.x - i.radius > coast.minX && i.z > coast.minZ && i.z < coast.maxZ)
      .sort((a, b) => b.radius * b.top - a.radius * a.top)[0],
    islandPort =
      island &&
      settle(ground.grid, [island.x, island.z], 2_000, coast, RADIUS.port, (_x, _z, h) => h < 12);
  if (islandPort) add('island-port', 'port', 'coast', islandPort);
  return out;
}
