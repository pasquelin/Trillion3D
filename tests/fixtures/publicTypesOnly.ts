import type { CameraPose, World, WorldOptions } from 'trillion3d';

export type PublicBrowserTypes = {
  world: World;
  options: WorldOptions;
  pose: CameraPose;
};
