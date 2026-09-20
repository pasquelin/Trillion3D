import type { CameraPose, Explorer, ExplorerOptions } from 'web-geometry';

export type PublicBrowserTypes = {
  explorer: Explorer;
  options: ExplorerOptions;
  pose: CameraPose;
};
