/**
 * Rock and wind on the open desert: layered cliff faces on every bench riser of the mesas and
 * of the canyon walls, scree and boulders on the talus, hoodoos by the buttes, an arch and
 * cracked mud in the wadi, wind turbines along the plateau's upwind rim, blowing sand on the
 * highest dune crests and the sunset viewpoint on the tallest mesa.
 */
import type { Vec3 } from '../../plan/contract.ts';
import { WIND_TURBINE, applyPoint, between, trsMatrix } from '../../props/index.ts';
import { facing, teleport, type Build } from './build.ts';
import { duneHeight, WIND_HEADING } from './dunes.ts';
import {
  canyonFrame,
  CLIFF_RUN,
  rimRadius,
  slopes,
  STRATUM,
  WADI_HALF,
  type Tableland,
} from './landforms.ts';
import { CLIFF_FACE, CLIFF_FACES } from './rocks.ts';

/** Rise and horizontal position (0–1 across the slope) of each riser of a benched slope. */
function risers(height: number, run: number) {
  const steps = Math.max(2, Math.round(height / STRATUM));
  // A riser is the last 45 % of its step: its middle sits at 0.775 of the step.
  return Array.from({ length: steps }, (_, k) => ({
    at: ((k + 0.775) / steps) * run,
    rise: height / steps,
  }));
}

/** One face on a riser at (x, z) facing (dx, dz), tall enough to reach the tread above it. */
function face(b: Build, x: number, z: number, dx: number, dz: number, rise: number, k: number) {
  const prop = `desert/cliff-face-${k % CLIFF_FACES}`,
    scale: Vec3 = [1, (rise + 1.5) / CLIFF_FACE.height, 1];
  return b.site.place(prop, x, z, facing(dx, dz), { scale, clearance: 0 });
}

/** Faces all around a tableland, one ring per riser. */
function rimFaces(b: Build, t: Tableland) {
  const { cliff, cliffRun } = slopes(t.height);
  risers(cliff, cliffRun).forEach(({ at, rise }, tier) => {
    for (let a = 0, k = tier; a < Math.PI * 2; k++) {
      const r = rimRadius(t, a) + at,
        [dx, dz] = [Math.cos(a), Math.sin(a)];
      face(b, t.x + dx * r, t.z + dz * r, dx, dz, rise, k);
      a += CLIFF_FACE.width / Math.max(40, r - 6);
    }
  });
}

/** Faces on both canyon walls, cracked mud and boulders on the wadi floor, the arch. */
function canyon(b: Build, p: Tableland) {
  const frame = canyonFrame(p),
    depth = p.height + 6,
    walls = risers(depth, depth * CLIFF_RUN);
  for (let s = -p.radius * 0.8, k = 0; s < p.radius * 0.8; s += CLIFF_FACE.width, k++) {
    const axis = frame.offset(s);
    for (const side of [-1, 1])
      walls.forEach(({ at, rise }, tier) => {
        const { x, z } = frame.world(s, axis + side * (WADI_HALF + at)),
          toward = frame.world(s, axis);
        face(b, x, z, toward.x - x, toward.z - z, rise, k + tier);
      });
    const floor = frame.world(s, axis + between(b.seed, k, -WADI_HALF * 0.6, WADI_HALF * 0.6));
    b.site.place(k % 3 ? 'desert/mud-plates' : 'desert/boulder-1', floor.x, floor.z, k * 1.3);
    if (k % 5 === 2) b.site.place('desert/dead-tree', floor.x + 8, floor.z - 6, k);
  }
  const mouth = frame.world(p.radius * 1.5, frame.offset(p.radius * 1.5));
  b.site.place('desert/arch', mouth.x, mouth.z, frame.angle + Math.PI / 2, {
    name: 'desert/canyon/arch',
  });
  const view = frame.world(p.radius * 0.3, frame.offset(p.radius * 0.3)),
    ahead = frame.world(p.radius * 0.6, frame.offset(p.radius * 0.6));
  if (!b.markers.some((m) => m.name === 'desert/canyon'))
    teleport(b, 'desert/canyon', view.x, view.z, [ahead.x, ahead.z], 0.12);
}

/** Scree, boulders and, by buttes, hoodoos on a tableland's talus. */
function talus(b: Build, t: Tableland, count: number) {
  const { cliffRun, talusRun } = slopes(t.height);
  for (let i = 0; i < count; i++) {
    const a = between(t.seed, i, 0, Math.PI * 2),
      r = rimRadius(t, a) + cliffRun + talusRun * between(t.seed + 1, i, 0.05, 1.1),
      x = t.x + Math.cos(a) * r,
      z = t.z + Math.sin(a) * r,
      pick = i % 7,
      prop =
        pick < 3
          ? `desert/scree-${pick % 2 ? 'a' : 'b'}`
          : pick < 6
            ? `desert/boulder-${i % 5}`
            : t.kind === 'butte'
              ? 'desert/hoodoo-tall'
              : 'desert/hoodoo-squat';
    b.site.place(prop, x, z, a * 7, {
      scale: pick >= 3 && pick < 6 ? between(t.seed + 2, i, 0.8, 2.2) : 1,
    });
  }
}

/** Rotor speed: tip-speed ratio 7 at a 8 m/s rated-region wind, ω = 7 · 8 / R. */
const RPM = ((7 * 8) / WIND_TURBINE.rotorRadius) * (60 / (2 * Math.PI));

/** Turbines along the plateau's upwind rim, 3.5 rotor diameters apart, rotors into the wind. */
function turbines(b: Build, p: Tableland) {
  const upwind = WIND_HEADING + Math.PI,
    spacing = 3.5 * 2 * WIND_TURBINE.rotorRadius,
    [ux, uz] = [Math.cos(upwind), Math.sin(upwind)],
    yaw = facing(ux, uz);
  for (let a = upwind - 1.1, k = 0; a < upwind + 1.1; k++) {
    const r = rimRadius(p, a) - 120,
      x = p.x + Math.cos(a) * r,
      z = p.z + Math.sin(a) * r,
      tower = b.site.place('wind-turbine-tower', x, z, yaw, { name: `desert/wind/turbine-${k}` });
    if (tower)
      b.movers.push({
        kind: 'spin',
        name: `desert/wind/rotor-${k}`,
        model: 'wind-turbine-rotor',
        position: applyPoint(trsMatrix({ at: tower.position, yaw }), WIND_TURBINE.rotorAnchor),
        axis: [ux, 0, uz],
        rpm: RPM,
      });
    a += spacing / r;
  }
}

/** Every landform's furniture; the viewpoint on the tallest tableland fully in the desert. */
export function land(b: Build, sites: readonly Tableland[]) {
  for (const t of sites) {
    rimFaces(b, t);
    talus(b, t, t.kind === 'plateau' ? 400 : t.kind === 'mesa' ? 120 : 60);
    if (t.kind === 'plateau') {
      canyon(b, t);
      turbines(b, t);
    }
  }
  const own = sites.filter(
    (t) => t.kind !== 'plateau' && (b.plan.biome(t.x, t.z).weights.desert ?? 0) > 0.99,
  );
  const top = own.sort((p, q) => q.height - p.height)[0] ?? sites[0];
  if (top) {
    // The west rim, looking west into the sunset.
    const a = Math.PI,
      r = rimRadius(top, a) - 12;
    teleport(
      b,
      'desert/mesa-sunset',
      top.x + Math.cos(a) * r,
      top.z + Math.sin(a) * r,
      [top.x - 10000, top.z],
      -0.12,
    );
  }
}

/** Sand blowing off the highest crests, on a coarse grid over the region. */
export function blowingSand(b: Build, count: number) {
  const { minX, minZ, maxX, maxZ } = b.site.bounds,
    crests: { x: number; z: number; h: number }[] = [];
  for (let x = minX + 300; x < maxX - 300; x += 450)
    for (let z = minZ + 300; z < maxZ - 300; z += 450) {
      const h = duneHeight(x, z);
      if (h > 12) crests.push({ x, z, h });
    }
  crests.sort((p, q) => q.h - p.h || p.x - q.x || p.z - q.z);
  crests.slice(0, count).forEach(({ x, z }, i) =>
    b.markers.push({
      kind: 'emitter',
      effect: 'sand',
      name: `desert/dunes/sand-${i}`,
      position: [x, b.plan.height(x, z), z],
      radius: 180,
    }),
  );
}
