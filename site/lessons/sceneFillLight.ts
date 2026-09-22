import type { light as lightFamily, World } from '../../packages/sdk-browser/index.ts';

// direction [0.45, -0.35, 0.8], carried as a position/target pair ten units out: the light travels
// from that position toward the origin, the same ray the old direction vector described.
const FILL_LIGHT_POSITION: [number, number, number] = [-4.5, 3.5, -8];

/** `light` is the caller's: a static import here would pull the engine into every route that
 *  reaches this module, even one that never mounts a world. */
export const addSceneFillLight = (light: typeof lightFamily, world: World) =>
  world.scene.add(
    light.directional({
      color: [0.55, 0.68, 1],
      intensity: 0.6,
      position: FILL_LIGHT_POSITION,
      target: [0, 0, 0],
    }),
  );

export const sceneFillLightCode = () =>
  `world.scene.add(light.directional({ color: [0.55, 0.68, 1], intensity: 0.6, position: [-4.5, 3.5, -8], target: [0, 0, 0] }));`;
