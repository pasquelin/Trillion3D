/**
 * # Mountains — the range in the north-west
 *
 * The highest ground of the world, visible from the city 30 km away. The plan draws the range
 * in broad strokes; this region carves it: ridged, domain-warped crests that climb toward
 * 3 500 m, gullies scored into the flanks, and cirques — bowls with a flat floor under a steep
 * headwall, where the plan finds its alpine lake. The terrain paints snow above the snowline,
 * bare granite on every face too steep to hold it, scree and alpine meadow between the tree
 * line (2 000 m) and the snow, needle litter under the forest and grass in the valley floors.
 *
 * What stands on it:
 * - **The alpine lake** (the plan's): from the lowest point past its shore a waterfall runs
 *   down the steepest descent, its spray an emitter at the foot; a refuge looks over the water.
 * - **The mountain roads**, exactly as the plan draws their switchbacks: a tunnel portal at
 *   each end of every run bored through a ridge, the plan's bridges built span by span on
 *   piers, orange snow poles along both edges.
 * - **The ski resort and the mountain villages**: a church with an onion dome, chalets and
 *   hotels with carved balconies and roofs laid shingle by shingle, gables turned to the
 *   valley, lantern posts along the roads.
 * - **A cable car** from the resort to the highest summit: two stations, pylons each as tall as
 *   the ground under the sagging cables asks, two cabins going round as `path` movers.
 * - **An observatory** on a lesser top, its dome turning slowly (a `spin` mover), and a cross
 *   on the summit.
 * - **Forest** below the tree line — the shared pines, plus larches and frosted pines grown
 *   from the same rule — **boulder fields** above it and **crags** on the steep high faces,
 *   filling what the node budget leaves.
 *
 * Teleports: the summit viewpoint (looking at the city and the sea), the lake shore, the ski
 * resort and each village, the observatory, the pass top. Emitters: snow plumes on the five
 * highest summits, the waterfall's spray. Cars spawn in each settlement and at the pass top.
 *
 * Conventions: a yaw turns a prop's (or a viewer's) +Z toward its heading; a building's origin
 * is its floor, its stone base hiding up to 3.5 m of slope; a prop's footprint is the circle
 * holding its mesh seen from above, and no two footprints overlap. Lamps are declared on the
 * props that carry them; lanterns and windows light at night, the tunnel lamps always.
 */
import type { RegionModule } from '../../plan/contract.ts';
import { layoutMountains } from './layout.ts';
import { MOUNTAIN_GROUND } from './surfaces.ts';
import { refineMountains } from './terrain.ts';

export const mountainsRegion: RegionModule = {
  name: 'mountains',
  refine: refineMountains,
  ground: MOUNTAIN_GROUND,
  generate: (plan) => layoutMountains(plan).output,
};
