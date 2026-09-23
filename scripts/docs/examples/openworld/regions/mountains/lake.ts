/**
 * The alpine lake is the plan's: it carves the basin and lays the water. This region finds where
 * the water would spill — the lowest ground on a ring just outside the shore — and runs a
 * waterfall from there down the steepest descent: a white ribbon hugging the ground, foam at
 * its foot. The ribbon is one mesh whose origin is the middle of its course.
 */
import type { MeshPart, PropMesh, Vec3, WorldPlan } from '../../plan/contract.ts';
import type { Lake as PlanLake } from '../../plan/carve.ts';
import { isTerrainPlan } from '../../plan/plan.ts';
import { blob, prop, quads, transform } from '../../props/index.ts';
import type { Placer } from './space.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';
import { downhill } from './terrain.ts';

/** The ring the outlet is looked for on, metres past the shore, and its samples. */
const OUTLET = 40;
const RING = 48;
/** The waterfall's step down the slope, and where it ends: the ground has levelled out. */
const STEP = 5;
const LEVEL = 0.1;

export type Lake = { id: string; centre: Vec3; radius: number; spill: Vec3; fall: Vec3[] };

/** The plan's lakes; the contract's `WorldPlan` does not name them, the plan carries them. */
export const planLakes = (plan: WorldPlan): readonly PlanLake[] =>
  isTerrainPlan(plan) ? plan.lakes : [];

/** The waterfall's path from the spill point down the steepest descent, 0.4 m over the ground. */
function waterfall(placer: Placer, spill: Vec3): Vec3[] {
  const path: Vec3[] = [spill];
  let [x, z] = [spill[0], spill[2]];
  for (let step = 0; step < 80; step++) {
    const { dir, fall } = downhill(placer.plan.height, x, z);
    if (step > 8 && fall < LEVEL) break;
    [x, z] = [x + dir[0] * STEP, z + dir[1] * STEP];
    if (!placer.owns(x, z, 10)) break;
    path.push([x, placer.plan.height(x, z) + 0.4, z]);
  }
  return path;
}

/** Every plan lake inside the region, with its outlet and waterfall. */
function regionLakes(placer: Placer): Lake[] {
  return planLakes(placer.plan)
    .filter((lake) => placer.owns(lake.x, lake.z, lake.radius))
    .map((lake) => {
      const r = lake.radius + OUTLET,
        ring = Array.from({ length: RING }, (_, k): Vec3 => {
          const a = (k / RING) * Math.PI * 2,
            [x, z] = [lake.x + Math.cos(a) * r, lake.z + Math.sin(a) * r];
          return [x, placer.plan.height(x, z), z];
        }),
        spill = ring.reduce((low, p) => (p[1] < low[1] ? p : low));
      return {
        id: lake.id,
        centre: [lake.x, lake.level, lake.z],
        radius: lake.radius,
        spill,
        fall: waterfall(placer, spill),
      };
    });
}

/** The waterfall's mesh around `origin`: a 5 m ribbon and a mound of foam at its foot. */
function waterfallMesh(lake: Lake, origin: Vec3): PropMesh {
  const local = ([x, y, z]: Vec3): Vec3 => [x - origin[0], y - origin[1], z - origin[2]],
    ribbon: Vec3[][] = [];
  for (let i = 0; i + 1 < lake.fall.length; i++) {
    const [a, b] = [lake.fall[i], lake.fall[i + 1]],
      len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1,
      [nx, nz] = [(-(b[2] - a[2]) / len) * 2.5, ((b[0] - a[0]) / len) * 2.5];
    ribbon.push([
      local([a[0] - nx, a[1], a[2] - nz]),
      local([a[0] + nx, a[1], a[2] + nz]),
      local([b[0] + nx, b[1], b[2] + nz]),
      local([b[0] - nx, b[1], b[2] - nz]),
    ]);
  }
  const foot = lake.fall[lake.fall.length - 1],
    parts: MeshPart[] = [
      transform(blob(S.whiteWater, [6, 1, 6], 3, { detail: 4 }), {
        at: local([foot[0], foot[1] - 0.8, foot[2]]),
      }),
    ];
  if (ribbon.length) parts.push(quads(S.whiteWater, ribbon));
  return prop(`mountains/waterfall-${lake.id}`, parts);
}

/** Places each lake's waterfall; returns the lakes whose waterfall found its ground. */
export function placeWaterfalls(placer: Placer): { lakes: Lake[]; meshes: PropMesh[] } {
  const lakes: Lake[] = [],
    meshes: PropMesh[] = [];
  for (const lake of regionLakes(placer)) {
    const [a, b] = [lake.fall[0], lake.fall[lake.fall.length - 1]],
      [x, z] = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2],
      origin: Vec3 = [x, placer.plan.height(x, z), z],
      mesh = placer.register(waterfallMesh(lake, origin));
    if (!placer.place(mesh.id, origin[0], origin[2], { y: origin[1], name: mesh.id })) continue;
    lakes.push(lake);
    meshes.push(mesh);
  }
  return { lakes, meshes };
}
