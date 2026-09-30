import type { LightingSceneLight, Vec3 } from './types.ts';
import type { createLightingSceneGeometry } from './geometry.ts';
import { LIGHTING_CAMERA_POSES } from './controls.ts';
import { add, subtract, scale, cross, normalized } from './math.ts';

export function addLightingSceneObjects(
  { rectangle }: ReturnType<typeof createLightingSceneGeometry>,
  lights: readonly LightingSceneLight[],
  lightIntensity: number,
): void {
  // A stable id order preserves patch identity when a caller reorders its light controls.
  const orderedLights = [...lights].sort((a, b) =>
    a.id === b.id ? 0 : a.id === 'warm' ? -1 : b.id === 'warm' ? 1 : a.id < b.id ? -1 : 1,
  );
  for (const light of orderedLights) {
    const width = light.id === 'warm' ? 2.2 : 0.8,
      depth = light.id === 'warm' ? 1.6 : 0.8;
    const emission = light.color.map(
      (value) => value * (12 * light.intensity * lightIntensity),
    ) as Vec3;
    rectangle(
      light.id === 'warm' ? 'ceiling_emitter' : `ceiling_emitter_${light.id}`,
      subtract(light.position, [width / 2, 0, depth / 2]),
      [width, 0, 0],
      [0, 0, depth],
      [0.65, 0.65, 0.65],
      true,
      true,
      'diffuse',
      emission,
    );
  }
  const mirror = (id: string, center: Vec3, target: Vec3, width: number, height: number): void => {
    const toEye = normalized(subtract(LIGHTING_CAMERA_POSES.right_room.position, center));
    const toTarget = normalized(subtract(target, center));
    const normal = normalized(add(toEye, toTarget));
    const u = scale(normalized(cross([0, 1, 0], normal)), width);
    const v = scale(normalized(cross(normal, u)), height);
    rectangle(
      id,
      subtract(subtract(center, scale(u, 0.5)), scale(v, 0.5)),
      u,
      v,
      [0.92, 0.92, 0.92],
      true,
      false,
      'mirror',
    );
  };
  mirror('mirror_near', [0.9, 1.15, -0.4], [-3.95, 1.15, 2.3], 0.9, 1.7);
  mirror('mirror_far', [1.8, 1.5, -2.05], [-3.95, 1.5, 2.75], 1.2, 1.8);
}
