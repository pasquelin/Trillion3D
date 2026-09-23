import { SceneGltf } from './gltf-scene.ts';
import { randomStream, sineNoise, type Vec3 } from './random.ts';
import { icosphere } from './solids.ts';

/**
 * `ten-thousand-objects`: a small planet and a ring of ten thousand moonlets, each one a detailed
 * rock. Four rock shapes, each in three stones, placed ten thousand times: the file carries twelve
 * meshes and ten thousand nodes, and the compiler instances the meshes.
 */
const COUNT = 10_000;

/** A lumpy rock pressed with six craters, stretched out of round. */
function rock(seed: number) {
  const random = randomStream(seed),
    stretch = [1, 0.6 + random.uniform(0, 0.3), 0.8 + random.uniform(0, 0.3)],
    lumps = sineNoise(seed, 5),
    craters = Array.from({ length: 6 }, () => ({
      centre: random.direction(),
      size: random.uniform(0.25, 0.5),
    }));
  const sphere = icosphere(4, (point) =>
    craters.reduce(
      (radius, { centre, size }) => {
        const reach = Math.max(
          0,
          1 - Math.hypot(...point.map((value, k) => value - centre[k])) / size,
        );
        return radius - 0.12 * reach ** 2;
      },
      1 + 0.22 * lumps(point),
    ),
  );
  return {
    ...sphere,
    positions: sphere.positions.map((value, index) => value * stretch[index % 3]),
  };
}

/** Rounds a placement to a tenth of a millimetre at the ring's scale: shorter JSON, same scene. */
const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** Writes `ring.gltf` and `ring.bin` into `directory`. */
export async function writeRing(directory: string) {
  const gltf = new SceneGltf(),
    stones = [
      gltf.material('basalt', [0.55, 0.52, 0.49], { roughness: 0.9 }),
      gltf.material('rust', [0.62, 0.42, 0.3], { roughness: 0.85 }),
      gltf.material('ice', [0.8, 0.85, 0.9], { roughness: 0.45 }),
    ],
    sand = gltf.material('planet', [0.78, 0.66, 0.52], { roughness: 0.9 });
  // Each shape is written once; its three meshes, one per stone, share its accessors.
  const kinds = [1, 2, 3, 4].flatMap((seed) => {
    const shape = gltf.primitive(rock(seed), stones[0]);
    return ['basalt', 'rust', 'ice'].map((stone, material) =>
      gltf.mesh(`rock-${seed - 1}-${stone}`, [{ ...shape, material: stones[material] }]),
    );
  });
  const relief = sineNoise(99, 6),
    planet = icosphere(5, ([x, y, z]) => 1 + 0.035 * relief([x * 1.5, y * 1.5, z * 1.5]));
  const children = [
    gltf.node({
      name: 'planet',
      mesh: gltf.mesh('planet', [[planet, sand]]),
      scale: [1.6, 1.6, 1.6],
    }),
  ];
  const random = randomStream(10);
  for (let placed = 0; placed < COUNT; placed++) {
    // Denser in two bands with a gap between them; rust inside, ice outside.
    const r = random.next() < 0.45 ? random.uniform(2.6, 3.6) : random.uniform(3.9, 5.2),
      angle = random.uniform(0, 2 * Math.PI),
      y = random.normal() * (0.05 + 0.02 * (r - 2.6)),
      // A Lomax (Pareto II) draw: many pebbles, a few boulders.
      size = Math.min(0.012 + (0.06 * ((1 - random.next()) ** (-1 / 3) - 1)) / 3, 0.14),
      stone = r < 3.2 && random.next() < 0.6 ? 1 : r > 4.4 && random.next() < 0.6 ? 2 : 0,
      quaternion = [random.normal(), random.normal(), random.normal(), random.normal()],
      length = Math.hypot(...quaternion),
      translation: Vec3 = [r * Math.cos(angle), y, r * Math.sin(angle)];
    children.push(
      gltf.node({
        mesh: kinds[random.integer(4) * 3 + stone],
        translation: translation.map(round),
        rotation: quaternion.map((value) => round(value / length)),
        scale: Array(3).fill(round(size)),
      }),
    );
  }
  gltf.node({ name: 'system', children }, true);
  await gltf.write(directory, 'ring');
}
