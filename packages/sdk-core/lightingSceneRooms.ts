import type { Vec3 } from './lightingSceneTypes.ts';
import type { createLightingSceneGeometry } from './lightingSceneGeometry.ts';
import { add } from './lightingSceneMath.ts';

const WALL: Vec3 = [0.65, 0.65, 0.65];

export function addLightingSceneRooms(
  { box }: ReturnType<typeof createLightingSceneGeometry>,
  doorAngle: number,
): void {
  // Split the slabs at the partition: no transport-cell centre sits inside a solid wall.
  for (const [side, x0, x1] of [
    ['left', -4, -0.08],
    ['right', 0.08, 4],
  ] as const) {
    box(`floor_${side}`, [x0, -0.16, -3], [x1, 0, 3], [0.55, 0.55, 0.55], ['py']);
    box(`ceiling_${side}`, [x0, 3, -3], [x1, 3.16, 3], WALL, ['ny']);
    box(`back_wall_${side}`, [x0, 0, -3.16], [x1, 3, -3], WALL, ['pz']);
    box(`front_wall_${side}`, [x0, 0, 3], [x1, 3, 3.16], WALL, ['nz']);
  }
  box('floor_threshold', [-0.08, -0.16, -0.8], [0.08, 0, 0.8], [0.55, 0.55, 0.55], ['py']);
  box('west_wall', [-4.16, 0, -3], [-4, 3, 3], [0.7, 0.07, 0.04], ['px']);
  box('east_wall', [4, 0, -3], [4.16, 3, 3], WALL, ['nx']);
  box('partition_back', [-0.08, 0, -3], [0.08, 3, -0.8], WALL, ['nx', 'px', 'pz']);
  box('partition_front', [-0.08, 0, 0.8], [0.08, 3, 3], WALL, ['nx', 'px', 'nz']);
  box('partition_header', [-0.08, 2.2, -0.8], [0.08, 3, 0.8], WALL, ['nx', 'px', 'ny']);

  const cosine = Math.cos(doorAngle),
    sine = Math.sin(doorAngle);
  const rotate = ([x, y, z]: Vec3): Vec3 => [x * cosine - z * sine, y, x * sine + z * cosine];
  const transform = (v: Vec3): Vec3 => add(rotate(v), [0, 0, -0.8]);
  box(
    'door',
    [-0.04, 0, 0],
    [0.04, 2.2, 1.6],
    [0.35, 0.22, 0.09],
    ['nx', 'px'],
    true,
    transform,
    rotate,
  );
}
