// The patch WGSL (corners, edge factors, pattern, displaced box) run on the shader kit.
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import * as P from './tessellation/patchWgsl.ts'

type Run = {
  packCorner(b: number[]): number
  unpackCorner(e: number): number[]
  sortedFactors(f: number[]): { factors: number[]; corners: number[]; flip: boolean }
  patternOf(f: number[], flip: boolean): number
  edgeFactors(...args: unknown[]): number[]
  quarterRateDepth(...args: number[]): number
  boxGrownByDisplacement(...args: unknown[]): { lo: number[]; hi: number[] }
}

export const patchRun = (scope: object = {}) =>
  shaderRun<Run>(
    wgslBlock(
      'patchTest',
      [
        P.packCorner,
        P.unpackCorner,
        P.sortedFactors,
        P.patternOf,
        P.edgeFactors,
        P.quarterRateDepth,
        P.boxGrownByDisplacement,
      ],
      '',
    ),
    [
      'packCorner',
      'unpackCorner',
      'sortedFactors',
      'patternOf',
      'edgeFactors',
      'quarterRateDepth',
      'boxGrownByDisplacement',
    ],
    scope,
  )
