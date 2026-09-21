import type { ScenarioState } from './scenarios.ts';

const source = (names: string[]) => `import { ${names.join(', ')} } from './js/engine.js';`;
const number = (value: number) => Number(value);

export function codeForBounds(id: string, state: ScenarioState) {
  if (id === 'box-grow')
    return `${source(['boxEmpty', 'boxExpandByPoint'])}
const points = [[-2, -1], [1, 1.4], [2.4, -0.4], [-0.5, 2], [3, 1.8], [-2.7, 1.1]].slice(0, ${number(state.points)});
const result = new Float64Array(6);
boxEmpty(result, 0);
points.forEach(([x, y]) => boxExpandByPoint(result, 0, x, y, 0));
export default Array.from(result);`;
  return `${source(['sphereFromBounds'])}
const width = ${number(state.width)}, height = ${number(state.height)};
const result = new Float64Array(4);
sphereFromBounds(result, 0, -width / 2, -height / 2, 0, width / 2, height / 2, 0);
export default Array.from(result);`;
}

export function codeForScene(id: string, state: ScenarioState) {
  if (id === 'hierarchy')
    return `${source(['createTransformTree', 'addTransformNode', 'setNodePosition', 'setNodeQuaternion', 'updateNodeWorldMatrix', 'nodeWorldPosition'])}
const tree = createTransformTree(2), parent = addTransformNode(tree), child = addTransformNode(tree, parent);
setNodePosition(tree, child, ${number(state.childX)}, 0, 0);
const half = (${number(state.parent)} * Math.PI) / 360;
setNodeQuaternion(tree, parent, 0, 0, Math.sin(half), Math.cos(half));
updateNodeWorldMatrix(tree, child, true, false);
export default Array.from(nodeWorldPosition(new Float64Array(3), tree, child));`;
  if (id === 'color-space')
    return `${source(['srgbToLinear', 'linearToSrgb'])}
const a = ${number(state.left)} / 255, b = ${number(state.right)} / 255;
const screen = (a + b) / 2;
const light = linearToSrgb((srgbToLinear(a) + srgbToLinear(b)) / 2);
export default [screen, light];`;
  return `${source(['adaptivePixelError', 'lodQuality', 'createPathGovernor'])}
lodQuality('adaptive');
const governor = createPathGovernor(() => performance.now());
governor.setWasm(true, true, null);
governor.choose('selection');
export default adaptivePixelError(${number(state.base)}, ${number(state.frame)}, ${number(state.budget)});`;
}
