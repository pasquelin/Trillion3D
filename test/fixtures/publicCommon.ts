import {
  HIERARCHY_ROOT,
  hierarchyUpdateBatch,
  type CameraPose,
  type JobSnapshot,
  type TransportOptions,
  type TransportResult,
} from 'web-geometry';

export const home: CameraPose = {
  position: [2, 1, 2],
  target: [0, 0, 0],
  fov: 55,
  near: 0.1,
  far: 100,
};
export const statusOf = <T>(snapshot: JobSnapshot<T>) => snapshot.status;
export const transportOptions: TransportOptions = {
  onProgress: (progress) => progress.completed / progress.total,
};
export const transportIterations = (result: TransportResult) => result.iterations;

// @ts-expect-error Camera vectors have exactly three coordinates.
const invalidPose: CameraPose = { ...home, position: [0, 1] };

export const commonContract = { HIERARCHY_ROOT, hierarchyUpdateBatch, invalidPose };
