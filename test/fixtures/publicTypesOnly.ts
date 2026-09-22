import type { CameraPose, World, WorldOptions } from 'web-geometry';

export type PublicBrowserTypes = {
  world: World;
  options: WorldOptions;
  pose: CameraPose;
};
