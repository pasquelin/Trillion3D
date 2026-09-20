import {
  composeMatrix4,
  crossVector3,
  dotVector3,
  frustumClipBox,
  frustumPlanesFromMatrix,
  lengthSqVector3,
  multiplyMatrix4,
  normalizeVector3,
  perspectiveProjection,
  transformAffinePoint,
  transformHomogeneousPoint,
} from '../engine.js';
import { evaluateDetail } from './evaluateDetail.js';
import { evaluateAdvanced } from './evaluateAdvanced.js';
import { localizeResult } from './localizeResult.js';

const rad = (degrees) => (degrees * Math.PI) / 180;
const matrix = () => new Float64Array(16);
const vec = (x = 0, y = 0, z = 0) => new Float64Array([x, y, z]);
const qz = (degrees) => [0, 0, Math.sin(rad(degrees) / 2), Math.cos(rad(degrees) / 2)];
const round = (value) => Number(value.toFixed(3));
const vector = (angle) => [Math.cos(rad(angle)), Math.sin(rad(angle)), 0];

function transforms(id, state) {
  if (id === 'compose-transform') {
    const transform = matrix();
    composeMatrix4(transform, [state.tx, 0, 0], qz(state.angle), [state.scale, state.scale, 1]);
    const corners = [
      [-1, -0.7],
      [1, -0.7],
      [1, 0.7],
      [-1, 0.7],
    ].map(([x, y]) => Array.from(transformAffinePoint(vec(), transform, x, y, 0)));
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
  composeMatrix4(parent, [0, 0, 0], qz(state.parent), [1, 1, 1]);
  composeMatrix4(child, [state.child, 0, 0], qz(0), [1, 1, 1]);
  multiplyMatrix4(combined, parent, child);
  const point = Array.from(transformAffinePoint(vec(), combined, 0, 0, 0));
  return {
    kind: 'chain',
    input: `parent ${state.parent}° → child (${state.child}, 0)`,
    point,
    value: `world position = (${round(point[0])}, ${round(point[1])})`,
  };
}

function camera(id, state) {
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

function vectors(id, state) {
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

export function evaluate(id, state, locale = 'en') {
  let result;
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
