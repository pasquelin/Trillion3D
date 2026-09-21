import {
  crossVector3,
  dotVector3,
  frustumClipBox,
  frustumPlanesFromMatrix,
  lengthSqVector3,
  normalizeVector3,
  perspectiveProjection,
  transformHomogeneousPoint,
} from '../demos/engine.ts';
import { evaluateDetail, type DetailResult } from './evaluateDetail.ts';
import {
  evaluateAdvanced,
  transforms,
  type AdvancedResult,
  type TransformResult,
  type ChainResult,
} from './evaluateAdvanced.ts';
import { localizeResult } from './localizeResult.ts';
import type { Locale } from '../content/locale.ts';
import type { ScenarioState } from './scenarios.ts';

export type { TransformResult, ChainResult } from './evaluateAdvanced.ts';

export interface PerspectiveResult {
  kind: 'perspective';
  input: string;
  depth: number;
  fov: number;
  ndc: number[];
  value: string;
}
export interface FrustumResult {
  kind: 'frustum';
  input: string;
  x: number;
  depth: number;
  fov: number;
  status: number;
  value: string;
}
export interface NormalizeResult {
  kind: 'normalize';
  input: string;
  before: Float64Array;
  after: Float64Array;
  value: string;
}
export interface DotResult {
  kind: 'vectors';
  input: string;
  a: number[];
  b: number[];
  dot: number;
  value: string;
}
export interface CrossResult {
  kind: 'vectors';
  input: string;
  a: number[];
  b: number[];
  cross: number;
  value: string;
}
export type VectorsResult = DotResult | CrossResult;

export type EvaluationResult =
  | TransformResult
  | ChainResult
  | PerspectiveResult
  | FrustumResult
  | VectorsResult
  | NormalizeResult
  | AdvancedResult
  | DetailResult;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const matrix = () => new Float64Array(16);
const vec = (x = 0, y = 0, z = 0) => new Float64Array([x, y, z]);
const round = (value: number) => Number(value.toFixed(3));
const vector = (angle: number): number[] => [Math.cos(rad(angle)), Math.sin(rad(angle)), 0];

function camera(id: string, state: ScenarioState): PerspectiveResult | FrustumResult {
  const projection = matrix();
  perspectiveProjection(projection, state.fov, 1.6, 0.1, 1);
  if (id === 'perspective') {
    const clip = new Float64Array(4);
    transformHomogeneousPoint(clip, projection, 1, 1, -state.depth);
    const ndc = [clip[0] / clip[3], clip[1] / clip[3]];
    return {
      kind: 'perspective',
      input: `point (1, 1, −${state.depth}), FOV ${state.fov}°`,
      depth: state.depth,
      fov: state.fov,
      ndc,
      value: `projected = (${round(ndc[0])}, ${round(ndc[1])})`,
    };
  }
  const planes = new Float64Array(24);
  frustumPlanesFromMatrix(planes, projection);
  const x = state.x,
    z = -state.depth;
  const status = frustumClipBox(planes, x - 0.6, -0.6, z - 0.6, x + 0.6, 0.6, z + 0.6);
  return {
    kind: 'frustum',
    input: `box x=${x}, depth=${state.depth}, FOV ${state.fov}°`,
    x,
    depth: state.depth,
    fov: state.fov,
    status,
    value: ['outside', 'crossing', 'inside'][status],
  };
}

function vectors(id: string, state: ScenarioState): VectorsResult | NormalizeResult {
  if (id === 'normalize') {
    const before = vec(state.x, state.y, 0),
      after = new Float64Array(before);
    normalizeVector3(after);
    return {
      kind: 'normalize',
      input: `v = (${state.x}, ${state.y})`,
      before,
      after,
      value: `length ${round(Math.sqrt(lengthSqVector3(before)))} → ${round(Math.sqrt(lengthSqVector3(after)))}`,
    };
  }
  const a = vector(state.angleA),
    b = vector(state.angleB);
  if (id === 'dot-product') {
    const dot = dotVector3(a, b);
    return {
      kind: 'vectors',
      input: `a ${state.angleA}°, b ${state.angleB}°`,
      a,
      b,
      dot,
      value: `a · b = ${round(dot)} — ${dot > 0.05 ? 'same direction' : dot < -0.05 ? 'opposed' : 'perpendicular'}`,
    };
  }
  const cross = vec();
  crossVector3(cross, a, b);
  return {
    kind: 'vectors',
    input: `a ${state.angleA}°, b ${state.angleB}°`,
    a,
    b,
    cross: cross[2],
    value: `a × b = ${round(cross[2])} — ${cross[2] >= 0 ? 'counter-clockwise' : 'clockwise'}`,
  };
}

export function evaluate(
  id: string,
  state: ScenarioState,
  locale: Locale = 'en',
): EvaluationResult {
  let result: EvaluationResult;
  if (
    ['matrix-inverse', 'reflection-orientation', 'quaternion-turn', 'normal-transform'].includes(id)
  )
    result = evaluateAdvanced(id, state);
  else if (id === 'compose-transform' || id === 'matrix-chain') result = transforms(id, state);
  else if (id === 'perspective' || id === 'frustum') result = camera(id, state);
  else if (['dot-product', 'cross-product', 'normalize'].includes(id)) result = vectors(id, state);
  else result = evaluateDetail(id, state);
  return localizeResult(result, locale);
}
