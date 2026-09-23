import {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  EngineProfiler,
  createWorld,
  hierarchyUpdateBatch,
  type CameraPose,
  type MemoryBudgets,
  type PoolClamp,
  type TelemetryReport,
  type World,
  type WorldOptions,
} from 'web-geometry';

const pose: CameraPose = {
  position: [0, 1, 2],
  target: [0, 0, 0],
  fov: 60,
};
const options: WorldOptions = { renderer: 'webgl2', interactive: false };
const budgets: MemoryBudgets = { geometryPoolBytes: 64 * 1024 * 1024 };
const clamp: PoolClamp = 'root-cover';
const profiler = new EngineProfiler(60);
export const readTelemetry = (): TelemetryReport => profiler.getReport();
export const poseWorld = (world: World) => world.camera.set(pose);

// @ts-expect-error Camera field types remain precise through the public facade.
const invalidPose: CameraPose = { ...pose, fov: 'wide' };

export const browserContract = {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  createWorld,
  hierarchyUpdateBatch,
  invalidPose,
  budgets,
  clamp,
  options,
  pose,
};
