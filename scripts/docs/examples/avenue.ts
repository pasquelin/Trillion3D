import { SceneGltf, yaw } from './gltf-scene.ts';
import { lathe, moved, pairs, solid } from './mesh.ts';
import { randomStream } from './random.ts';
import { box, heightfield, spline, torusKnot } from './solids.ts';

/**
 * `detail-by-pixel-error`: an avenue of fluted marble urns leading to a bronze knot on its
 * plinth, across a meadow that rises into hills. Detail everywhere, near and far, so the cut
 * through the cluster tree has something to choose.
 */

/** A turned urn whose belly carries twenty-four flutes: its radius waves around the axis. */
function flutedUrn(segments = 120, samples = 72) {
  const profile = spline(
    pairs([
      0, 0, 0.34, 0, 0.36, 0.06, 0.22, 0.14, 0.18, 0.3, 0.32, 0.55, 0.46, 0.85, 0.44, 1.15, 0.3,
      1.38, 0.24, 1.46, 0.33, 1.52, 0.34, 1.58, 0.2, 1.62, 0.12, 1.74, 0.07, 1.86, 0, 1.9,
    ]),
    samples,
  );
  const urn = lathe(profile, segments, { caps: false }),
    positions = [...urn.positions];
  for (let v = 0; v < positions.length; v += 3) {
    const [x, y, z] = positions.slice(v, v + 3),
      belly = Math.max(0, Math.min(1, 1 - Math.abs(y - 0.85) / 0.5)) ** 0.6,
      wave = 1 + 0.045 * belly * Math.cos(24 * Math.atan2(-z, x));
    positions[v] = x * wave;
    positions[v + 2] = z * wave;
  }
  return solid(positions, urn.indices);
}

/** A meadow flat along the avenue, rising into rolling hills away from it. */
function meadowHeight(x: number, z: number) {
  const away = Math.max(0, Math.min(1, (Math.abs(x) - 9) / 20)),
    hills =
      1.8 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.05) + 1.2 * Math.sin(z * 0.11 + x * 0.03);
  return -0.05 + away ** 1.5 * (2.5 + hills);
}

/** Writes `avenue.gltf` and `avenue.bin` into `directory`. */
export async function writeAvenue(directory: string) {
  const gltf = new SceneGltf(),
    marble = gltf.material('marble', [0.9, 0.87, 0.82], { roughness: 0.3 }),
    stone = gltf.material('stone', [0.72, 0.68, 0.61], { roughness: 0.75 }),
    bronze = gltf.material('bronze', [0.72, 0.47, 0.26], { roughness: 0.32, metallic: 0.55 }),
    grass = gltf.material('grass', [0.36, 0.5, 0.22], { roughness: 0.95 }),
    paving = gltf.material('paving', [0.78, 0.73, 0.64], { roughness: 0.85 });
  const urn = gltf.mesh('urn', [[flutedUrn(), marble]]),
    pedestal = gltf.mesh('urn-pedestal', [[moved(box(0.9, 0.5, 0.9), [0, 0.25, 0]), stone]]),
    knot = torusKnot([2, 3], 1.5, 0.34, [480, 40], (u, v) => 1 + 0.07 * Math.sin(v * 8 + u * 60)),
    plinth = lathe(
      pairs([
        0, 0, 1.9, 0, 1.9, 0.25, 1.7, 0.3, 1.55, 0.45, 1.45, 0.5, 1.45, 1.1, 1.6, 1.2, 1.7, 1.3,
        1.7, 1.42, 0, 1.42,
      ]),
      96,
      { caps: false },
    );
  const children = [
    gltf.node({
      name: 'knot',
      mesh: gltf.mesh('knot', [
        [moved(knot, [0, 3.1, 0]), bronze],
        [plinth, stone],
      ]),
      translation: [0, 0, -62],
    }),
    gltf.node({
      name: 'meadow',
      mesh: gltf.mesh('meadow', [[heightfield(160, 96, meadowHeight), grass]]),
    }),
    gltf.node({
      name: 'avenue',
      mesh: gltf.mesh('avenue', [[moved(box(12, 0.1, 150), [0, 0, -10]), paving]]),
    }),
  ];
  // Twenty-two urns a side, each turned at random so their flutes do not line up.
  const random = randomStream(3);
  for (const side of [-1, 1])
    for (let k = 0; k < 22; k++) {
      const z = 40 - k * 4.6;
      children.push(
        gltf.node({ mesh: pedestal, translation: [side * 4.8, 0, z] }),
        gltf.node({
          mesh: urn,
          translation: [side * 4.8, 0.5, z],
          rotation: yaw(random.uniform(0, 2 * Math.PI)),
        }),
      );
    }
  // The whole avenue is a maquette at a tenth of its size: the same view on screen, and a scene
  // small enough that its lighting proxy stays a few hundred kilobytes.
  gltf.node({ name: 'maquette', scale: [0.1, 0.1, 0.1], children }, true);
  await gltf.write(directory, 'avenue');
}
