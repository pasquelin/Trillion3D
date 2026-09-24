/**
 * **Big city.** The region the aerial hero shot looks at: a coastal city at a river mouth.
 *
 * - **Downtown**: towers of seven archetypes (setback slabs, tapering round towers with spires,
 *   Art Deco stepped towers with lanterns, twisting towers, diagrid drums, plain office blocks,
 *   residential towers with balconies) from 45 to 316 m, their curtain walls dressed in mullions and spandrels, a share of office cells
 *   lit (emissive, dimmed by day). The supertall stands on the central block; beside it a slab
 *   carries the helipad and the rooftop viewpoint. Flat roofs carry water tanks, condensers and
 *   masts.
 * - **Streets**: a grid that shares the plan's avenue lines (its pitch divides their spacing),
 *   local avenues between blocks where the plan has none, 5 m kerbed sidewalks the play layer's
 *   pedestrians walk, street lamps about every 30 m that light at night, street trees, and
 *   traffic lights with zebra crossings at busy junctions.
 * - **Mid-rise ring**: apartment blocks around courtyards, with balconies, lit rooms and neon
 *   blade signs (emissive, with a `neon-glow` emitter and a night light each).
 * - **Suburbs**: fenced garden lots with six kinds of houses and garden trees; parks with a
 *   fountain (`fountain` emitter), paths, benches and big trees; a 200 m stadium with four
 *   floodlight masts.
 * - **Harbour** on the open coast at the plan's port: two 300 m quays, container stacks, gantry cranes over
 *   a moored cargo ship, slewing cranes whose jibs turn, warehouses, smoking chimneys, boats
 *   looping the basin and sailing offshore; the plan's bridges over the river.
 *
 * Teleports: `city/rooftop`, `city/downtown`, `city/harbour`, `city/stadium`. Spawns: six cars
 * on the central avenues, a boat in the harbour. Everything is derived from the plan (the city
 * settlement and port, its avenues, rivers, bridges, coast and ground), and every building
 * reaches 4 m into the ground so no slope shows a gap. Nodes beyond the plan's budget are
 * dropped least important and farthest first (garden, then furniture, then street lamps).
 */
import type { RegionModule, WorldPlan } from '../../plan/contract.ts';
import { surface, SURFACES } from '../../props/index.ts';
import { layBridges } from './bridges.ts';
import { cityCatalog } from './catalog.ts';
import { fillCells } from './districts.ts';
import { facing, turn } from './frame.ts';
import { layCells } from './grid.ts';
import { layHarbour } from './harbour.ts';
import { Placer } from './placement.ts';
import { readSite } from './site.ts';
import { layStreets } from './streets.ts';
import { CITY } from './surfaces.ts';
import { EYE } from '../../build/markers.ts';

/**
 * Share of the global relief the city keeps above the sea: a coastal plain, so 100 m blocks sit
 * on plinths. The coastline (height 0) does not move. A design value, not a measured one.
 */
const RELIEF = 0.4;

/** Everything the city builds from the plan, with what the tests check besides the output. */
export function buildCity(plan: WorldPlan) {
  const { budget } = plan.regions.city,
    site = readSite(plan),
    catalog = cityCatalog(plan.subSeed('city/props'), site),
    placer = new Placer(site);
  const harbour = layHarbour(placer, plan.subSeed('city/harbour'));
  layBridges(placer);
  const cells = layCells(site, plan.subSeed('city/grid'));
  for (const [key, cell] of cells) if (placer.occupied(cell.box)) cells.delete(key);
  const street = layStreets(placer, cells),
    deck = fillCells(placer, cells, catalog, plan.subSeed('city/blocks')),
    towardSea = facing(harbour ? harbour.out : turn([1, 0], site.yaw));
  if (deck)
    placer.markers.push({
      kind: 'teleport',
      name: 'city/rooftop',
      position: [deck[0], deck[1] + EYE, deck[2]],
      deck: true,
      yaw: towardSea,
      pitch: -0.25,
    });
  if (street)
    placer.markers.push({
      kind: 'teleport',
      name: 'city/downtown',
      position: [street[0], street[1] + EYE, street[2]],
      yaw: facing(turn([1, 0], site.yaw)),
    });
  const { output, kept } = placer.finish(budget);
  return { output: { ...output, props: catalog.props }, kept, site };
}

export const cityRegion: RegionModule = {
  name: 'city',
  refine: (_x, _z, base) => (base > 0 ? -base * (1 - RELIEF) : 0),
  ground: [
    { surface: surface('city/beach-sand', [0.62, 0.55, 0.4], 0, 0.95), maxHeight: 2.5 },
    { surface: CITY.lawn, maxSlope: 0.35 },
    { surface: SURFACES.rock },
  ],
  generate: (plan) => buildCity(plan).output,
};
