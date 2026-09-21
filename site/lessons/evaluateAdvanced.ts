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

const matrix = () => new Float64Array(16);
const round = (value) => Number(value.toFixed(3));
const quaternion = (degrees) => {
  const half = (degrees * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

export function evaluateAdvanced(id, state) {
  const transform = matrix();
  if (id === 'matrix-inverse') {
    composeMatrix4(transform, [1.4, 0.4, 0], quaternion(state.angle), [state.scale, 0.8, 1]);
    const inverse = invertMatrix4(matrix(), transform),
      identity = multiplyMatrix4(matrix(), transform, inverse);
    const local = [0.8, 0.5, 0],
      world = transformAffinePoint(new Float64Array(3), transform, ...local);
    const recovered = transformAffinePoint(new Float64Array(3), inverse, ...world);
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
  const source = [0.7, 0.7, 0],
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
