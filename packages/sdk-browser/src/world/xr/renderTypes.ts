import type { HostCamera } from '../../camera/world.ts';
import type { BorrowedPresent } from '../../gpu/core/borrowedPresent.ts';
/** A stable eye history drawing into the browser's current borrowed texture. */
export interface XrGpuEye {
  draw(camera: HostCamera, target: BorrowedPresent): import('./metrics.ts').XrEyeMetrics;
  dispose(): Promise<void>;
}
export interface XrGpuBackend {
  setXrActive?(active: boolean): void;
  createXrEye?(width: number, height: number): Promise<XrGpuEye>;
}
