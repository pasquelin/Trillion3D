/**
 * ## Coast and islands
 *
 * The east side of the map, where the land meets the sea, and the islands offshore.
 *
 * - **Chalk cliffs.** Along stretches of the shore the land rises 30–70 m straight out of the
 *   sea. Every high shore is dressed with a layered chalk face — beds of white and grey chalk
 *   with dark bands of flint, each cut back by the sea by its own amount, turf on top, fallen
 *   blocks at the foot — stretched to the cliff it stands in. Sea stacks stand off the longer
 *   cliffs, boulders lie in the surf, spray rises at the foot.
 * - **The lighthouse** crowns the most prominent headland: a banded red and white tower, a
 *   corbelled gallery, a glazed lantern whose beam sweeps the sea at night, the keeper's
 *   cottage, and a track to a road within 3 km. Its gallery is the viewpoint at sunset.
 * - **The beach resort** lies on the longest sandy shore: a promenade with lamps and benches,
 *   changing huts, cafés with striped awnings and terraces, rows of parasols and loungers down
 *   to the water, lifeguard towers, and a long timber pier with lamps out to a pier head.
 * - **The island port**: a stone quay with bollards and lamps, fishing boats and rowing boats
 *   moored along it, and fishermen's houses in rows facing the water.
 * - **Dunes and woods**: marram grass on the dunes behind the beaches, pines and bushes above.
 *   Towns and villages of the coast get houses facing their streets; the roads get guardrails
 *   wherever they run along a drop or the sea; the plan's bridges become arched stone viaducts.
 * - **At sea**: sailboats and motorboats loop in the bays, a fishing boat runs between the
 *   island port and the pier.
 *
 * Teleports: the lighthouse gallery, the beach promenade, the island quay. Boats spawn at the
 * island port and off the pier head. Everything is found from the plan's own relief, so any
 * coastline the plan draws is dressed; one seed gives the same bytes.
 */
import type { RegionModule, RegionOutput, WorldPlan } from '../../plan/contract.ts';
import { sharedProps } from '../../props/index.ts';
import { EYE } from '../../build/markers.ts';
import { coastProps } from './props/index.ts';
import { LIGHTHOUSE } from './props/lighthouse.ts';
import { GROUND_LAYERS, refine } from './relief.ts';
import { beachResort } from './sites/beach.ts';
import { bridges } from './sites/bridges.ts';
import { ferry, sailing } from './sites/boats.ts';
import { dressCliffs, surfRocks } from './sites/cliffs.ts';
import type { ShoreFrame } from './sites/frame.ts';
import { Layout } from './sites/layout.ts';
import { raiseLighthouse } from './sites/lighthouse.ts';
import { coastMap } from './sites/map.ts';
import { guardrails, vegetation } from './sites/nature.ts';
import { islandPort, village } from './sites/port.ts';

/** Nodes kept back from the budget for what the page adds at run time, a share. */
const RESERVE = 0.05;

function generateCoast(plan: WorldPlan): RegionOutput {
  const { bounds, budget } = plan.regions.coast,
    props = coastProps(plan.subSeed('coast/props')),
    // Shared props are placed by id; their meshes are read here for footprints only.
    shared = sharedProps(plan.subSeed('props')),
    layout = new Layout(
      coastMap(plan, bounds),
      plan.subSeed('coast/layout'),
      [...props, ...shared],
      plan.roads,
    );
  bridges(layout, plan.bridges);
  const headland = raiseLighthouse(layout),
    resort = beachResort(layout, headland?.foot),
    port = islandPort(layout);
  for (const settlement of plan.settlements)
    if (settlement.region === 'coast' && settlement.kind !== 'port') village(layout, settlement);
  guardrails(layout, plan.roads);
  const cliffs = dressCliffs(layout);
  surfRocks(layout, cliffs, Math.round(cliffs.length * 1.5));
  if (headland) {
    const target = resort?.frame.origin ?? [
        headland.foot[0] - headland.normal[0],
        0,
        headland.foot[2] - headland.normal[1],
      ],
      [x, y, z] = headland.foot,
      look = Math.atan2(target[0] - x, target[2] - z);
    // The gallery faces the resort along the coast, the sun going down over the land behind it:
    // on its deck, the top of the tower's collider, clear of the lantern's.
    layout.markers.push({
      kind: 'teleport',
      name: 'coast/lighthouse-gallery',
      position: [x + Math.sin(look) * 3.6, y + LIGHTHOUSE.gallery + EYE, z + Math.cos(look) * 3.6],
      deck: true,
      yaw: look,
      pitch: -0.15,
    });
  }
  const frames = [resort?.frame, port].filter((f): f is ShoreFrame => !!f);
  sailing(layout, frames);
  if (resort && port) ferry(layout, port, resort.frame);
  vegetation(
    layout,
    Math.max(0, Math.floor(budget.nodes * (1 - RESERVE)) - layout.instances.length),
  );
  return {
    props,
    instances: layout.instances,
    lights: layout.lights,
    markers: layout.markers,
    movers: layout.movers,
    roads: layout.roads,
  };
}

export const coastRegion: RegionModule = {
  name: 'coast',
  refine,
  ground: GROUND_LAYERS,
  generate: generateCoast,
};
