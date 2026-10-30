// What the tests of the reflection trace's layouts share: a device that hands the descriptors back, the kernels and their layouts.
import { reachedBindings } from '../../bounce/reachedBindings.fixture.ts'

/** A device with the given features that gives back the descriptor of each layout it is asked to make. */
const deviceWith = (features: string[]) =>
  ({
    features: new Set(features),
    createBindGroupLayout: (descriptor: object) => descriptor,
  }) as unknown as GPUDevice

/** A device without `float32-filterable`: the field's coarse mip is read by hand. */
export const device = deviceWith([])

/** A device with `float32-filterable`: the field's coarse mip is read through the hardware's filter. */
export const filterableDevice = deviceWith(['float32-filterable'])

/** The kernels' entries and the layout each is made over. */
export const KERNELS = {
  classifyTiles: 'classify',
  generateRays: 'generate',
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
