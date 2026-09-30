import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { clusterSliceIndexWgsl, CLUSTER_SLICES } from './clusterWgsl.ts';

/** The shipped slice mapping, run as JavaScript (#1249): the slice of an axis distance and the span
 *  of a light on it, so the tests and the witness run what the WGSL does, not a second copy. */
export type SliceMap = {
  clusterSliceIndex: (d: number, front: number, back: number) => number;
  clusterSliceSpan: (d: number, r: number, front: number, back: number) => { x: number; y: number };
};
export const sliceMap = (): SliceMap =>
  shaderFunctions<SliceMap>(clusterSliceIndexWgsl, ['clusterSliceIndex', 'clusterSliceSpan'], {
    CLUSTER_SLICES,
    log: Math.log,
    floor: Math.floor,
  });
