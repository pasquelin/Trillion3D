// What the tests of the reflection trace's layouts share: a device that hands the descriptors back, the kernels and their layouts.
import { reachedBindings } from '../../bounce/reachedBindings.fixture.ts'

/** A device that gives back the descriptor of each layout it is asked to make. */
export const device = {
  createBindGroupLayout: (descriptor: object) => descriptor,
} as unknown as GPUDevice

/** The kernels' entries and the layout each is made over. */
export const KERNELS = {
  classifyTiles: 'classify',
  keepDepth: 'keepDepth',
  traceScreen: 'screen',
  clearTracing: 'clearTracing',
  traceScene: 'scene',
  resolveSurface: 'resolve',
  temporalSurface: 'temporal',
  bilateralOpaque: 'bilateral',
  bilateralFront: 'bilateralFront',
  clearOpaque: 'clear',
  clearFront: 'clearFront',
} as const

/** The bindings of group 0 that `entry` reaches in `program`, by the variable's name. */
export const reached = (program: string, entry: string) => reachedBindings(program, [entry])
