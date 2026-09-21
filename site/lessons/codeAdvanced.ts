const source = (names) => `import { ${names.join(', ')} } from './js/engine.js';`;
const n = Number;
const q = (angle) => `const half = (${n(angle)} * Math.PI) / 360;
const quaternion = [0, 0, Math.sin(half), Math.cos(half)];`;

export function codeForAdvanced(id, state) {
  if (id === 'matrix-inverse')
    return `${source(['composeMatrix4', 'invertMatrix4', 'multiplyMatrix4'])}
const matrix = new Float64Array(16), inverse = new Float64Array(16), result = new Float64Array(16);
${q(state.angle)}
composeMatrix4(matrix, [1.4, 0.4, 0], quaternion, [${n(state.scale)}, 0.8, 1]);
invertMatrix4(inverse, matrix);
multiplyMatrix4(result, matrix, inverse);
export default Array.from(result);`;
  if (id === 'reflection-orientation')
    return `${source(['composeMatrix4', 'determinantMatrix4', 'linearPartDeterminant'])}
const matrix = new Float64Array(16), half = (25 * Math.PI) / 360;
composeMatrix4(matrix, [0, 0, 0], [0, 0, Math.sin(half), Math.cos(half)], [${n(state.scale)}, 1, 1]);
export default [determinantMatrix4(matrix), linearPartDeterminant(matrix)];`;
  if (id === 'quaternion-turn')
    return `${source(['composeMatrix4', 'transformDirectionVector3'])}
const matrix = new Float64Array(16), result = new Float64Array(3);
${q(state.angle)}
composeMatrix4(matrix, [0, 0, 0], quaternion, [1, 1, 1]);
transformDirectionVector3(result, matrix, 1, 0, 0);
export default Array.from(result);`;
  return `${source(['composeMatrix4', 'normalMatrix3', 'applyMatrix3Vector3', 'normalizeVector3'])}
const matrix = new Float64Array(16), normalMatrix = new Float64Array(9), result = new Float64Array(3);
const half = (28 * Math.PI) / 360;
composeMatrix4(matrix, [0, 0, 0], [0, 0, Math.sin(half), Math.cos(half)], [${n(state.scale)}, ${n(state.scaleY)}, 1]);
normalMatrix3(normalMatrix, matrix);
applyMatrix3Vector3(result, normalMatrix, 0.7, 0.7, 0);
normalizeVector3(result);
export default Array.from(result);`;
}
