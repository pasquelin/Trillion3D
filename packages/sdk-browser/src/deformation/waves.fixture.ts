import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { DEFORM_WGSL } from './deformWgsl.ts';

/** Runs the shipped wave shader against the frame's deformation records. */
export const waveShader = (positions: Float32Array) =>
  shaderRun<{
    deformWaves: (
      at: number,
      count: number,
      p: number[],
      previous: boolean,
      normal: boolean,
    ) => number[];
  }>(DEFORM_WGSL, ['deformWaves'], { positions, cos: Math.cos }).deformWaves;
