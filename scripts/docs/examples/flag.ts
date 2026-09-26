import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts';
import { SceneGltf } from './gltf-scene.ts';
import { fromGeometry, moved } from './mesh.ts';

/** Squares along the flag and down it: its vertices run row by row from its bottom left. */
const COLUMNS = 24,
  ROWS = 16;

/**
 * `flag`: a flag on a pole over a lawn. The flag's node declares a cloth in `extras.physics`, as
 * `obj.physics` takes it, pinned along the pole: the compiler cooks its soft-body settings with the
 * model, and the page restores them. It is modelled standing straight out, so it sags from the
 * first step.
 */
export async function writeFlag(directory: string) {
  const gltf = new SceneGltf();
  const lawn = gltf.material('lawn', [0.33, 0.47, 0.24], { roughness: 0.9 }),
    wood = gltf.material('pole', [0.42, 0.29, 0.18], { roughness: 0.8 }),
    cloth = gltf.material('flag', [0.76, 0.23, 0.23], { roughness: 0.9 });
  const ground = moved(fromGeometry(geometry.box(20, 0.2, 20)), [0, -0.1, 0]),
    pole = moved(fromGeometry(geometry.cylinder(0.05, 0.05, 4, 16)), [0, 2, 0]),
    flag = fromGeometry(geometry.plane(1.5, 1, COLUMNS, ROWS));
  // The first vertex of each row is at the pole.
  const pins = Array.from({ length: ROWS + 1 }, (_, row) => row * (COLUMNS + 1));
  const children = [
    gltf.node({ name: 'lawn', mesh: gltf.mesh('lawn', [[ground, lawn]]) }),
    gltf.node({ name: 'pole', mesh: gltf.mesh('pole', [[pole, wood]]) }),
    gltf.node({
      name: 'flag',
      mesh: gltf.mesh('flag', [[flag, cloth]]),
      translation: [0.8, 3.4, 0],
      extras: { physics: { type: 'cloth', pins, bend: 0.001 } },
    }),
  ];
  gltf.node({ name: 'flag on a pole', children }, true);
  await gltf.write(directory, 'flag');
}
