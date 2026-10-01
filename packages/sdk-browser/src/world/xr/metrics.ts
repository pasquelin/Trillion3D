import type { RenderBackend } from '../../backend/types.ts';
export type XrEyeMetrics = ReturnType<RenderBackend['metrics']>;
/** Work is summed across eyes; shared pools and the single selected cut are counted once. */
export function xrFrameMetrics(eyes: readonly XrEyeMetrics[], nodesTested?: number): XrEyeMetrics {
  const result: XrEyeMetrics = {
    ...eyes[eyes.length - 1],
    gpuFrameMs: null,
    gpuPassMs: null,
    gpuHostGapMs: null,
    gpuLightListsMs: null,
    gpuShadowsMs: null,
    gpuShadowCullMs: null,
    gpuShadowRasterMs: null,
    gpuLightingMs: null,
    cpuSelectNodesTested: nodesTested ?? null,
  };
  for (const key of [
    'submittedTriangles',
    'transparentSubmittedTriangles',
    'totalSubmittedTriangles',
    'drawCalls',
    'transparentDrawCalls',
    'cpuSelectMs',
    'cpuSubmitMs',
  ] as const) {
    const values = eyes.map((eye) => eye[key]);
    if (key === 'drawCalls')
      result[key] = values.every((n) => typeof n === 'number')
        ? (values as number[]).reduce((a, b) => a + b, 0)
        : undefined;
    else
      result[key] = values.every((n) => typeof n === 'number')
        ? (values as number[]).reduce((a, b) => a + b, 0)
        : null;
  }
  result.frameHeld = eyes.every((eye) => eye.frameHeld === true);
  result.coverageReady = eyes.some((eye) => eye.coverageReady === false)
    ? false
    : eyes.every((eye) => eye.coverageReady === true)
      ? true
      : null;
  result.coverageBudgetLimited = eyes.some((eye) => eye.coverageBudgetLimited === true)
    ? true
    : eyes.every((eye) => eye.coverageBudgetLimited === false)
      ? false
      : null;
  return result;
}
