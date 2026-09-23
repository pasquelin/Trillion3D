/**
 * ## Desert (west and south-west)
 *
 * One trade wind from the north-east shapes the whole region. Where sand is scarce it builds
 * barchans — crescents with a gentle windward back, a slip face at the 34° angle of repose and
 * horns reaching downwind; where sand is plentiful, long sharp-crested seif dunes run along it.
 * Between the sand seas lies a gravel plain of cacti, agaves, dry shrubs and boulders.
 *
 * Mesas and buttes stand on the plain, and a plateau kilometres across carries a canyon with a
 * dry riverbed (wadi) on its floor. Their slopes are benched by the strata: the ground paints
 * horizontal bands of ochre, rust, cream and red by altitude, and every riser of every bench
 * carries a layered cliff face, hard beds standing proud as ledges. Scree, boulders and hoodoos
 * cover the talus; a natural arch stands at the canyon's mouth; wind turbines line the
 * plateau's upwind rim, their rotors turning into the wind.
 *
 * The oasis town gathers mud-brick houses with flat roofs, parapets, roof beams and rooftop
 * shades around a raised pool under date palms, with a domed hall, a market square, wells and
 * lanterns; a dirt track joins the highway. The two villages are the same, smaller. On the highway: a filling station (canopy lit from
 * beneath, pumps, shop, a tall lit price sign), a truck stop with its diner and parked lorries,
 * billboards, and a high-voltage line on pylons.
 *
 * Effects: sand blowing off the highest crests, dust on the track and at the truck stop, heat
 * haze over the asphalt (declared; it waits on a post-processing pass). Teleports: the mesa's
 * west rim at sunset, the canyon floor, the oasis, the filling station, where a car waits.
 *
 * Waiting on the engine: heat haze needs post-processing. `refine` sees no plan, so the relief
 * draws from the world seed and the static layout alone and cannot flatten the town's or the
 * station's ground; buildings stand on plinths that reach 1.5 m under their floor instead.
 * Every yaw, a teleport's included, turns the node's +Z toward the direction it names.
 */
import type { RegionModule, RegionOutput, WorldPlan } from '../../plan/contract.ts';
import type { Build } from './build.ts';
import { desertProps, footprints } from './catalog.ts';
import { sandSupply, WIND_HEADING } from './dunes.ts';
import { roadside } from './highway.ts';
import { blowingSand, land } from './land.ts';
import { tablelandsIn } from './landforms.ts';
import { oasis } from './oasis.ts';
import { settlementsOf } from './streets.ts';
import { DESERT_GROUND } from './palette.ts';
import { refineDesert, rockAt } from './relief.ts';
import { scatter } from './scatter.ts';
import { Site } from './site.ts';

/** Share of the node budget the landforms may take before scatter fills the rest. */
const LANDFORM_SHARE = 0.6;

/** Tumbleweeds rolling downwind across the gravel plain, 600 m each, at a quarter of the wind. */
function tumbleweeds(b: Build, count: number) {
  const { minX, minZ, maxX, maxZ } = b.site.bounds,
    [wx, wz] = [Math.cos(WIND_HEADING), Math.sin(WIND_HEADING)];
  for (let i = 0, found = 0; i < 400 && found < count; i++) {
    const x = minX + 800 + (maxX - minX - 1600) * ((i * 0.618034) % 1),
      z = minZ + 800 + (maxZ - minZ - 1600) * ((i * 0.381966) % 1);
    if (sandSupply(x, z) > -0.1 || rockAt(x, z).owned > 0) continue;
    const points = Array.from({ length: 13 }, (_, k) => {
      const px = x + wx * 50 * k,
        pz = z + wz * 50 * k;
      return [px, b.plan.height(px, pz) + 0.4, pz] as const;
    });
    b.movers.push({
      kind: 'path',
      name: `desert/tumbleweed-${found++}`,
      model: 'desert/tumbleweed',
      points,
      speed: 2,
      loop: true,
    });
  }
}

function generate(plan: WorldPlan): RegionOutput {
  const { bounds, seed, budget } = plan.regions.desert,
    props = desertProps(seed),
    site = new Site(plan, bounds, footprints(props)),
    b: Build = { plan, site, seed, props, lights: [], markers: [], movers: [], roads: [] };
  const highway = roadside(b);
  for (const home of settlementsOf(b)) oasis(b, home, highway?.run);
  site.limit = Math.floor(budget.nodes * LANDFORM_SHARE);
  land(b, tablelandsIn(bounds));
  site.limit = budget.nodes;
  blowingSand(b, 16);
  tumbleweeds(b, 4);
  scatter(b, budget.nodes);
  return {
    props,
    instances: site.instances,
    lights: b.lights,
    markers: b.markers,
    movers: b.movers,
    roads: b.roads,
  };
}

export const desertRegion: RegionModule = {
  name: 'desert',
  refine: refineDesert,
  ground: DESERT_GROUND,
  generate,
};
