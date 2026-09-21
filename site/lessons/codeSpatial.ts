import type { ScenarioState } from './scenarios.ts';

const source = (names: string[]) => `import { ${names.join(', ')} } from './js/engine.js';`;
const number = (value: number) => Number(value);

export function codeForTransform(id: string, state: ScenarioState) {
  if (id === 'compose-transform')
    return `${source(['composeMatrix4', 'transformAffinePoint'])}
const matrix = new Float64Array(16);
const angle = (${number(state.angle)} * Math.PI) / 180;
const quaternion = [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
composeMatrix4(matrix, [${number(state.tx)}, 0, 0], quaternion, [${number(state.scale)}, ${number(state.scale)}, 1]);
const result = transformAffinePoint(new Float64Array(3), matrix, 1, 0.7, 0);
export default Array.from(result);`;
  if (id === 'matrix-chain')
    return `${source(['composeMatrix4', 'multiplyMatrix4', 'transformAffinePoint'])}
const parent = new Float64Array(16), child = new Float64Array(16), world = new Float64Array(16);
const angle = (${number(state.parent)} * Math.PI) / 180;
composeMatrix4(parent, [0, 0, 0], [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], [1, 1, 1]);
composeMatrix4(child, [${number(state.child)}, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
multiplyMatrix4(world, parent, child);
export default Array.from(transformAffinePoint(new Float64Array(3), world, 0, 0, 0));`;
  if (id === 'perspective')
    return `${source(['perspectiveProjection', 'transformHomogeneousPoint'])}
const projection = new Float64Array(16), clip = new Float64Array(4);
perspectiveProjection(projection, ${number(state.fov)}, 1.6, 0.1, 1);
transformHomogeneousPoint(clip, projection, 1, 1, -${number(state.depth)});
export default [clip[0] / clip[3], clip[1] / clip[3]];`;
  return `${source(['perspectiveProjection', 'frustumPlanesFromMatrix', 'frustumClipBox'])}
const projection = new Float64Array(16), planes = new Float64Array(24);
perspectiveProjection(projection, ${number(state.fov)}, 1.6, 0.1, 1);
frustumPlanesFromMatrix(planes, projection);
const x = ${number(state.x)}, z = -${number(state.depth)};
export default frustumClipBox(planes, x - 0.6, -0.6, z - 0.6, x + 0.6, 0.6, z + 0.6);`;
}

export function codeForVector(id: string, state: ScenarioState) {
  if (id === 'normalize')
    return `${source(['normalizeVector3'])}
const result = new Float64Array([${number(state.x)}, ${number(state.y)}, 0]);
normalizeVector3(result);
export default Array.from(result);`;
  const setup = `const radians = (degrees) => (degrees * Math.PI) / 180;
const a = [Math.cos(radians(${number(state.angleA)})), Math.sin(radians(${number(state.angleA)})), 0];
const b = [Math.cos(radians(${number(state.angleB)})), Math.sin(radians(${number(state.angleB)})), 0];`;
  if (id === 'dot-product')
    return `${source(['dotVector3'])}
${setup}
export default dotVector3(a, b);`;
  return `${source(['crossVector3'])}
${setup}
const result = new Float64Array(3);
crossVector3(result, a, b);
export default result[2];`;
}
