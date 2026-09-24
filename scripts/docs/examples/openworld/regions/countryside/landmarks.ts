/**
 * The places a visitor is sent to: the windmill on a hill near a village (its sails a spinning
 * mover), a viewpoint turned toward the world's highest peak, a clearing deep in the woods.
 */
import { WORLD, type Marker, type Mover, type Vec3, type WorldPlan } from '../../plan/contract.ts';
import { applyPoint, hash01, trsMatrix } from '../../props/index.ts';
import { scatter, type Land } from './land.ts';
import { WINDMILL } from './machines.ts';
import type { Site } from './site.ts';
import { EYE } from '../../build/markers.ts';

/** Half the side of a kept-open viewpoint or clearing, metres. */
const OPEN = 30;

/** Radius a hill is measured against, and farthest a windmill stands from its village, metres. */
const HILL = 600,
  MILL_REACH = 2_000;

/** How far (x, z) stands above the ground `HILL` metres around it. */
const prominence = (plan: WorldPlan, x: number, z: number) =>
  plan.height(x, z) -
  [0, 1, 2, 3].reduce(
    (sum, k) => sum + plan.height(x + HILL * Math.cos(k * 1.57), z + HILL * Math.sin(k * 1.57)),
    0,
  ) /
    4;

/** The windmill on the most prominent open hill near a village; its markers and mover. */
export function placeWindmill(
  site: Site,
  land: Land,
  seed: number,
): { markers: Marker[]; movers: Mover[] } {
  const plan = site.plan,
    spots = scatter(plan, 250, seed)
      .filter(
        ([x, z]) =>
          land.forest(x, z) < -0.05 &&
          land.villages.some((v) => Math.hypot(v.centre[0] - x, v.centre[2] - z) < MILL_REACH),
      )
      .map(([x, z]) => [x, z, prominence(plan, x, z)] as const)
      .sort((a, b) => b[2] - a[2] || a[0] - b[0]);
  for (const [x, z] of spots) {
    const yaw = hash01(seed, Math.round(x)) * Math.PI * 2,
      mill = site.place('countryside/windmill-tower', x, z, yaw, {
        seat: 'plinth',
        name: 'countryside/windmill',
      });
    if (!mill) continue;
    const place = trsMatrix({ at: mill.position, yaw }),
      hub = applyPoint(place, WINDMILL.hub),
      axis = applyPoint(trsMatrix({ yaw }), [0, 0, 1]),
      [ex, , ez] = applyPoint(place, [0, 0, 45]),
      eye: Vec3 = [ex, plan.height(ex, ez) + EYE, ez];
    return {
      markers: [
        {
          kind: 'teleport',
          name: 'countryside/windmill',
          position: eye,
          yaw: yaw + Math.PI,
          pitch: 0.2,
        },
      ],
      // The page turns the sails' local +Z onto `axis` and spins them about it.
      movers: [
        {
          kind: 'spin',
          name: 'countryside/windmill-sails',
          model: 'countryside/windmill-sails',
          position: hub,
          axis,
          rpm: 9,
        },
      ],
    };
  }
  return { markers: [], movers: [] };
}

/** The world's highest point on a kilometre grid: what the viewpoint looks at. */
function highestPeak(plan: WorldPlan): [number, number] {
  let best: [number, number, number] = [0, 0, -Infinity];
  for (let x = -WORLD.size / 2; x <= WORLD.size / 2; x += WORLD.tile)
    for (let z = -WORLD.size / 2; z <= WORLD.size / 2; z += WORLD.tile) {
      const h = plan.height(x, z);
      if (h > best[2]) best = [x, z, h];
    }
  return [best[0], best[1]];
}

/**
 * The viewpoint: one the plan chose (a trail leads there) if it lies in the region, else the
 * region's highest free hill; kept open, the view turned toward the world's highest peak.
 */
export function viewpoint(site: Site, seed: number, chosen: readonly Vec3[]): Marker | undefined {
  const plan = site.plan,
    [px, pz] = highestPeak(plan),
    spots = scatter(plan, 250, seed)
      .map(([x, z]) => [x, z, plan.height(x, z)] as const)
      .sort((a, b) => b[2] - a[2] || a[0] - b[0]);
  for (const [x, z] of [...chosen.map(([x, y, z]) => [x, z, y] as const), ...spots]) {
    const yaw = Math.atan2(px - x, pz - z),
      rect = { x, z, hx: OPEN, hz: OPEN, yaw };
    if (!site.free(rect, { onRoad: true })) continue;
    site.take(rect);
    return {
      kind: 'teleport',
      name: 'countryside/hilltop',
      position: [x, plan.height(x, z) + EYE, z],
      yaw,
      pitch: -0.05,
    };
  }
  return undefined;
}

/** A clearing kept open at the deepest point of the woods. */
export function clearing(site: Site, at: [number, number] | undefined): Marker | undefined {
  if (!at) return undefined;
  const rect = { x: at[0], z: at[1], hx: OPEN, hz: OPEN, yaw: 0 };
  if (!site.free(rect)) return undefined;
  site.take(rect);
  return {
    kind: 'teleport',
    name: 'countryside/forest-clearing',
    position: [at[0], site.plan.height(...at) + EYE, at[1]],
    yaw: 0,
  };
}
