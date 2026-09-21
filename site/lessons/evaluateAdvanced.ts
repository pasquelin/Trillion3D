import {
  applyMatrix3Vector3,
  composeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  linearPartDeterminant,
  multiplyMatrix4,
  normalMatrix3,
  normalizeVector3,
  transformAffinePoint,
  transformDirectionVector3,
} from '../demos/engine.ts';
import type { ScenarioState } from './scenarios.ts';

export interface InverseResult {
  kind: 'inverse';
  input: string;
  local: number[];
  world: Float64Array;
  recovered: Float64Array;
  identity: Float64Array;
  value: string;
}

export interface ReflectionResult {
  kind: 'reflection';
  input: string;
  scale: number;
  determinant: number;
  linear: number;
  value: string;
}

export interface QuaternionResult {
  kind: 'quaternion';
  input: string;
  quaternion: number[];
  direction: Float64Array;
  value: string;
}

export interface NormalResult {
  kind: 'normal';
  input: string;
  naive: Float64Array;
  normal: Float64Array;
  value: string;
}

export type AdvancedResult = InverseResult | ReflectionResult | QuaternionResult | NormalResult;

/** Colocated with the advanced scenarios so every engine call this module makes stays in one
 * file the docs tests scan for it; not part of `AdvancedResult` (draw.ts and sceneGeometry.ts
 * still distinguish it from the four truly "advanced" kinds). */
export interface TransformResult {
  kind: 'transform';
  input: string;
  points: number[][];
  value: string;
}

export interface ChainResult {
  kind: 'chain';
  input: string;
  point: number[];
  value: string;
}

const matrix = () => new Float64Array(16);
const round = (value: number) => Number(value.toFixed(3));
const quaternion = (degrees: number): number[] => {
  const half = (degrees * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

export function transforms(id: string, state: ScenarioState): TransformResult | ChainResult {
  if (id === 'compose-transform') {
    const transform = matrix();
    composeMatrix4(transform, [state.tx, 0, 0], quaternion(state.angle), [
      state.scale,
      state.scale,
      1,
    ]);
    const corners = [
      [-1, -0.7],
      [1, -0.7],
      [1, 0.7],
      [-1, 0.7],
    ].map(([x, y]) => Array.from(transformAffinePoint(new Float64Array(3), transform, x, y, 0)));
    return {
      kind: 'transform',
      input: `T(${state.tx}, 0) · R(${state.angle}°) · S(${state.scale})`,
      points: corners,
      value: `corner → (${round(corners[2][0])}, ${round(corners[2][1])})`,
    };
  }
  const parent = matrix(),
    child = matrix(),
    combined = matrix();
  composeMatrix4(parent, [0, 0, 0], quaternion(state.parent), [1, 1, 1]);
  composeMatrix4(child, [state.child, 0, 0], quaternion(0), [1, 1, 1]);
  multiplyMatrix4(combined, parent, child);
  const point = Array.from(transformAffinePoint(new Float64Array(3), combined, 0, 0, 0));
  return {
    kind: 'chain',
    input: `parent ${state.parent}° → child (${state.child}, 0)`,
    point,
    value: `world position = (${round(point[0])}, ${round(point[1])})`,
  };
}

export function evaluateAdvanced(id: string, state: ScenarioState): AdvancedResult {
  const transform = matrix();
  if (id === 'matrix-inverse') {
    composeMatrix4(transform, [1.4, 0.4, 0], quaternion(state.angle), [state.scale, 0.8, 1]);
    const inverse = invertMatrix4(matrix(), transform),
      identity = multiplyMatrix4(matrix(), transform, inverse);
    const local: [number, number, number] = [0.8, 0.5, 0],
      world = transformAffinePoint(new Float64Array(3), transform, ...local);
    const recovered = transformAffinePoint(
      new Float64Array(3),
      inverse,
      world[0],
      world[1],
      world[2],
    );
    return {
      kind: 'inverse',
      input: `rotation ${state.angle}°, scale ${state.scale}`,
      local,
      world,
      recovered,
      identity,
      value: `recovered = (${round(recovered[0])}, ${round(recovered[1])})`,
    };
  }
  if (id === 'reflection-orientation') {
    composeMatrix4(transform, [0, 0, 0], quaternion(25), [state.scale, 1, 1]);
    const determinant = determinantMatrix4(transform),
      linear = linearPartDeterminant(transform);
    return {
      kind: 'reflection',
      input: `x scale ${state.scale}`,
      scale: state.scale,
      determinant,
      linear,
      value: `${determinant < 0 ? 'mirrored' : determinant > 0 ? 'preserved' : 'collapsed'} orientation (${round(linear)})`,
    };
  }
  if (id === 'quaternion-turn') {
    const q = quaternion(state.angle);
    composeMatrix4(transform, [0, 0, 0], q, [1, 1, 1]);
    const direction = transformDirectionVector3(new Float64Array(3), transform, 1, 0, 0);
    return {
      kind: 'quaternion',
      input: `qz(${state.angle}°)`,
      quaternion: q,
      direction,
      value: `direction = (${round(direction[0])}, ${round(direction[1])})`,
    };
  }
  composeMatrix4(transform, [0, 0, 0], quaternion(28), [state.scale, state.scaleY, 1]);
  const source: [number, number, number] = [0.7, 0.7, 0],
    naive = transformDirectionVector3(new Float64Array(3), transform, ...source);
  const normal = applyMatrix3Vector3(
    new Float64Array(3),
    normalMatrix3(new Float64Array(9), transform),
    ...source,
  );
  normalizeVector3(naive);
  normalizeVector3(normal);
  return {
    kind: 'normal',
    input: `scale (${state.scale}, ${state.scaleY})`,
    naive,
    normal,
    value: `corrected normal = (${round(normal[0])}, ${round(normal[1])})`,
  };
}
