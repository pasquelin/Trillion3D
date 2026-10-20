// The resolve's weights on the CPU: the shipped text itself (`TAA_WINDOW_WGSL`), run by the
// software shader reader, never a copy of its constants.
import { TAA_WINDOW_WGSL } from './filterWeights.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'

type Weights = { taaWindow: (d2: number) => number }

/** A sample's spatial weight at squared distance `d2` (in footprints), as the shader evaluates it. */
export const { taaWindow } = shaderRun<Weights>(TAA_WINDOW_WGSL, ['taaWindow'], {})
