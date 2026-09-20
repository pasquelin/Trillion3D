import {
  adaptivePixelError,
  addTransformNode,
  boxEmpty,
  boxExpandByPoint,
  createPathGovernor,
  createTransformTree,
  linearToSrgb,
  lodQuality,
  nodeWorldPosition,
  setNodePosition,
  setNodeQuaternion,
  sphereFromBounds,
  srgbToLinear,
  updateNodeWorldMatrix,
} from '../engine.js';

const round = (value) => Number(value.toFixed(3));
const POINTS = [
  [-2, -1],
  [1, 1.4],
  [2.4, -0.4],
  [-0.5, 2],
  [3, 1.8],
  [-2.7, 1.1],
];

function bounds(id, state) {
  if (id === 'box-grow') {
    const box = new Float64Array(6);
    boxEmpty(box, 0);
    const points = POINTS.slice(0, state.points);
    points.forEach(([x, y]) => boxExpandByPoint(box, 0, x, y, 0));
    return {
      kind: 'bounds',
      input: `${state.points} points`,
      points,
      box: Array.from(box),
      value: `min (${box[0]}, ${box[1]}) → max (${box[3]}, ${box[4]})`,
    };
  }
  const box = [-state.width / 2, -state.height / 2, 0, state.width / 2, state.height / 2, 0];
  const sphere = new Float64Array(4);
  sphereFromBounds(sphere, 0, ...box);
  return {
    kind: 'sphere',
    input: `${state.width} × ${state.height} box`,
    box,
    sphere,
    value: `sphere radius = ${round(sphere[3])}`,
  };
}

function hierarchy(state) {
  const tree = createTransformTree(2),
    parent = addTransformNode(tree),
    child = addTransformNode(tree, parent);
  setNodePosition(tree, child, state.childX, 0, 0);
  const half = (state.parent * Math.PI) / 360;
  setNodeQuaternion(tree, parent, 0, 0, Math.sin(half), Math.cos(half));
  updateNodeWorldMatrix(tree, child, true, false);
  const point = nodeWorldPosition(new Float64Array(3), tree, child);
  return {
    kind: 'hierarchy',
    input: `parent ${state.parent}°, child local x=${state.childX}`,
    point,
    value: `child world = (${round(point[0])}, ${round(point[1])})`,
  };
}

function colour(state) {
  const a = state.left / 255,
    b = state.right / 255,
    screen = (a + b) / 2;
  const light = linearToSrgb((srgbToLinear(a) + srgbToLinear(b)) / 2);
  return {
    kind: 'colour',
    input: `sRGB ${state.left} + ${state.right}`,
    a,
    b,
    screen,
    light,
    value: `midpoints: screen ${Math.round(screen * 255)}, light ${Math.round(light * 255)}`,
  };
}

function budget(state) {
  const quality = lodQuality('adaptive');
  const error = adaptivePixelError(state.base, state.frame, state.budget);
  const governor = createPathGovernor(() => performance.now());
  governor.setWasm(true, true, null);
  const path = governor.choose('selection');
  return {
    kind: 'budget',
    input: `${state.frame} ms frame / ${state.budget} ms budget`,
    base: state.base,
    error,
    quality: quality.label,
    path,
    value: `allowed error ${round(state.base)} px → ${round(error)} px`,
  };
}

export function evaluateDetail(id, state) {
  if (id === 'box-grow' || id === 'sphere-from-box') return bounds(id, state);
  if (id === 'hierarchy') return hierarchy(state);
  if (id === 'color-space') return colour(state);
  return budget(state);
}
