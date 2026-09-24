/**
 * Wind turbines facing the prevailing wind, and the desert's high ground: on a plateau's upwind
 * rim when the region holds one, else along its highest ground.
 */
import { WIND_TURBINE, applyPoint, trsMatrix } from '../../props/index.ts';
import { facing, type Build } from './build.ts';
import { WIND_HEADING } from './dunes.ts';

/** A tip speed of 7 × 8 m/s at the rated wind (tip-speed ratio 7), turned to rotor turns a minute. */
const RPM = ((7 * 8) / WIND_TURBINE.rotorRadius) * (60 / (2 * Math.PI));
const UPWIND = WIND_HEADING + Math.PI;
/** Towers stand 3.5 rotor diameters apart across the wind. */
export const TURBINE_SPACING = 3.5 * 2 * WIND_TURBINE.rotorRadius;

/** A tower at (x, z) with its rotor spinning into the wind; false when the ground refuses it. */
export function turbineAt(b: Build, x: number, z: number, k: number): boolean {
  const [ux, uz] = [Math.cos(UPWIND), Math.sin(UPWIND)],
    yaw = facing(ux, uz),
    tower = b.site.place('wind-turbine-tower', x, z, yaw, { name: `desert/wind/turbine-${k}` });
  if (!tower) return false;
  b.movers.push({
    kind: 'spin',
    name: `desert/wind/rotor-${k}`,
    model: 'wind-turbine-rotor',
    position: applyPoint(trsMatrix({ at: tower.position, yaw }), WIND_TURBINE.rotorAnchor),
    axis: [ux, 0, uz],
    rpm: RPM,
  });
  return true;
}

/** Ground samples of the region, highest first, on a grid of `step` metres. */
function heights(b: Build, step: number) {
  const { minX, minZ, maxX, maxZ } = b.site.bounds,
    points: [number, number, number][] = [];
  for (let x = minX + step / 2; x < maxX; x += step)
    for (let z = minZ + step / 2; z < maxZ; z += step) points.push([x, z, b.plan.height(x, z)]);
  return points.sort((p, q) => q[2] - p[2] || p[0] - q[0] || p[1] - q[1]);
}

/** The highest ground of the region. */
export function highest(b: Build): [number, number] {
  const [x, z] = heights(b, 32)[0];
  return [x, z];
}

/** Up to `count` turbines on the highest ground, a spacing apart. */
export function ridgeTurbines(b: Build, count: number) {
  const standing: [number, number][] = [];
  for (const [x, z] of heights(b, TURBINE_SPACING / 2)) {
    if (standing.length >= count) return;
    if (standing.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < TURBINE_SPACING)) continue;
    if (turbineAt(b, x, z, standing.length)) standing.push([x, z]);
  }
}
