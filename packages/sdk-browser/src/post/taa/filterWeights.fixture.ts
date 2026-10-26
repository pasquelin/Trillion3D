// The resolve's weights on the CPU: the shipped text itself (`taaWindowWgsl`), run by the
// software shader reader, never a copy of its constants.
import { taaWindowWgsl } from './filterWeights.ts'
import { FULL_PRECISION } from './colorSpaceWgsl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

type Weights = { taaWindow: (d2: number) => number }

/** A sample's spatial weight at squared distance `d2` (in footprints), as the shader evaluates it. */
export const { taaWindow } = shaderRun<Weights>(taaWindowWgsl(FULL_PRECISION), ['taaWindow'], {})
