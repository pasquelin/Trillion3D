import {
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  EngineProfiler,
  createWorld,
  multiplyMatrix4,
  type CameraPose,
  type MemoryBudgets,
  type PoolClamp,
  type TelemetryReport,
  type World,
  type WorldOptions,
} from 'trillion3d'

const pose: CameraPose = {
  position: [0, 1, 2],
  target: [0, 0, 0],
  fov: 60,
}
const options: WorldOptions = { interactive: false }
const budgets: MemoryBudgets = { geometryPoolBytes: 64 * 1024 * 1024 }
const clamp: PoolClamp = 'root-cover'
const profiler = new EngineProfiler(60)
export const readTelemetry = (): TelemetryReport => profiler.getReport()
export const poseWorld = (world: World) => world.camera.set(pose)

// @ts-expect-error Camera field types remain precise through the public facade.
const invalidPose: CameraPose = { ...pose, fov: 'wide' }

export const browserContract = {
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  createWorld,
  invalidPose,
  multiplyMatrix4,
  budgets,
  clamp,
  options,
  pose,
}
