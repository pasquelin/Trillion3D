// A machine's limits for the tests that read them: round rates and costs, every resource named.
import type { Machine } from './machine.ts'

export const TEST_MACHINE: Machine = {
  version: 3,
  adapter: 'test',
  date: '',
  readGBs: 400,
  writeGBs: 400,
  textureReadGBs: 500,
  textureWriteGBs: 300,
  attachmentGBs: 800,
  threadsPerMs: 1e8,
  passMs: 0.002,
  dispatchMs: 0.0015,
  barrierMs: 0.0005,
  texelLoadG: 500,
  texelFilterG: 250,
  aluTflops: 20,
  sharedGBs: 4000,
  mrt4G: 25,
  fragmentsG: 100,
  trianglesG: 4,
}
