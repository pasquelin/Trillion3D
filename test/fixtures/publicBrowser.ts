import {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  EngineProfiler,
  createExplorer,
  hierarchyUpdateBatch,
  type CameraPose,
  type Explorer,
  type ExplorerOptions,
  type MemoryBudgets,
  type PoolClamp,
  type TelemetryReport,
} from 'web-geometry';

const pose: CameraPose = {
  position: [0, 1, 2],
  target: [0, 0, 0],
  fov: 60,
  near: 0.1,
  far: 1_000,
};
const options: ExplorerOptions = { manifestUrl: '/scene/cache.json', pointsOfInterest: [] };
const budgets: MemoryBudgets = { geometryPoolBytes: 64 * 1024 * 1024 };
const clamp: PoolClamp = 'root-cover';
const profiler = new EngineProfiler(60);
export const readTelemetry = (): TelemetryReport => profiler.getReport();
export const renderExplorer = (explorer: Explorer) => explorer.render(pose);

// @ts-expect-error Camera field types remain precise through the public facade.
const invalidPose: CameraPose = { ...pose, fov: 'wide' };

export const browserContract = {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  createExplorer,
  hierarchyUpdateBatch,
  invalidPose,
  budgets,
  clamp,
  options,
  pose,
};
