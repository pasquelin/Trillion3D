export { dot, maxStretch, coneRejects } from './projectionOracles.ts';
export { clusterErrorPixels, clusterErrorAtDepth, screenErrorBound } from './screenErrorBound.ts';
export {
  referenceScreenError,
  screenErrorVariant,
  setScreenErrorVariant,
  type ScreenErrorVariant,
} from './screenErrorVariant.ts';
export { matrixWindingCw } from './matrixOrientation.ts';
export {
  HIZ_NOTHING,
  hizReduceCeil,
  hizBuildPyramid,
  hizFootprintFar,
  hizOccluded,
} from './hizOracles.ts';
export {
  hizBuildFlat,
  hizFlatLayout,
  hizFlatLevels,
  hizFootprintFarFlat,
  type HizFlat,
} from './hizPyramidFlat.ts';

/** Exclusive prefix scan. */
export function exclusiveScan(values: readonly number[]): [number[], number] {
  const result: number[] = [];
  let total = 0;
  for (const v of values) {
    result.push(total);
    total += v;
  }
  return [result, total];
}

/** Data compaction from an array of binary predicates (0 or 1). */
export function compact<T>(values: readonly T[], flags: readonly number[]): T[] {
  if (values.length !== flags.length || flags.some((f) => f !== 0 && f !== 1)) {
    throw new Error('Invalid predicates');
  }
  const [offsets, total] = exclusiveScan(flags);
  const result: T[] = new Array(total);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) {
      result[offsets[i]] = values[i];
    }
  }
  return result;
}

/** WebGPU drawIndirect (non-indexed): 16 bytes. Not drawIndexedIndirect. */
export function packDrawIndirect(vertexCount: number, instanceCount: number): Uint32Array {
  const fit = (value: number, name: string) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error(`${name} is not a u32`);
    return value;
  };
  return Uint32Array.of(fit(vertexCount, 'vertexCount'), fit(instanceCount, 'instanceCount'), 0, 0);
}

/** 2D edge function (2D cross product). */
export function edge(
  first: readonly number[],
  second: readonly number[],
  point: readonly number[],
): number {
  return (
    (second[0] - first[0]) * (point[1] - first[1]) - (second[1] - first[1]) * (point[0] - first[0])
  );
}

/** 2D barycentric coordinates of a point in a triangle. */
export function barycentric(
  vertices: readonly (readonly number[])[],
  point: readonly number[],
): [number, number, number] {
  const [first, second, third] = vertices;
  const area = edge(first, second, third);
  if (area === 0) {
    throw new Error('Triangle degenere');
  }
  return [
    edge(second, third, point) / area,
    edge(third, first, point) / area,
    edge(first, second, point) / area,
  ];
}
