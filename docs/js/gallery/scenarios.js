export const SCENARIOS = {
  'compose-transform': {
    controls: [
      ['tx', -3, 3, 1, 0.1],
      ['angle', -180, 180, 25, 1],
      ['scale', 0.4, 2, 1, 0.05],
    ],
    presets: [
      [1, 25, 1],
      [-1.5, 80, 1.4],
    ],
    animated: true,
  },
  'matrix-chain': {
    controls: [
      ['parent', -180, 180, 30, 1],
      ['child', -2, 2, 1.2, 0.1],
    ],
    presets: [
      [30, 1.2],
      [120, 1.8],
    ],
    animated: true,
  },
  perspective: {
    controls: [
      ['fov', 20, 110, 55, 1],
      ['depth', 1, 9, 4, 0.1],
    ],
    presets: [
      [55, 4],
      [95, 2],
    ],
    animated: false,
  },
  frustum: {
    controls: [
      ['x', -6, 6, 1, 0.1],
      ['depth', 1, 9, 4, 0.1],
      ['fov', 20, 110, 55, 1],
    ],
    presets: [
      [1, 4, 55],
      [4, 3, 40],
    ],
    animated: true,
  },
  'dot-product': {
    controls: [
      ['angleA', -180, 180, 0, 1],
      ['angleB', -180, 180, 55, 1],
    ],
    presets: [
      [0, 55],
      [0, 180],
    ],
    animated: true,
  },
  'cross-product': {
    controls: [
      ['angleA', -180, 180, 0, 1],
      ['angleB', -180, 180, 80, 1],
    ],
    presets: [
      [0, 80],
      [90, -45],
    ],
    animated: true,
  },
  normalize: {
    controls: [
      ['x', -4, 4, 3, 0.1],
      ['y', -4, 4, 2, 0.1],
    ],
    presets: [
      [3, 2],
      [0, 0],
    ],
    animated: false,
  },
  'box-grow': { controls: [['points', 1, 6, 4, 1]], presets: [[4], [6]], animated: true },
  'sphere-from-box': {
    controls: [
      ['width', 1, 6, 4, 0.1],
      ['height', 1, 5, 2, 0.1],
    ],
    presets: [
      [4, 2],
      [1.5, 4.5],
    ],
    animated: false,
  },
  hierarchy: {
    controls: [
      ['parent', -180, 180, 35, 1],
      ['childX', 0.5, 3, 1.8, 0.1],
    ],
    presets: [
      [35, 1.8],
      [150, 2.5],
    ],
    animated: true,
  },
  'color-space': {
    controls: [
      ['left', 0, 255, 30, 1],
      ['right', 0, 255, 230, 1],
    ],
    presets: [
      [30, 230],
      [0, 255],
    ],
    animated: false,
  },
  'lod-budget': {
    controls: [
      ['base', 0, 8, 2, 0.25],
      ['frame', 4, 32, 16, 1],
      ['budget', 2, 24, 8, 1],
    ],
    presets: [
      [2, 16, 8],
      [4, 28, 6],
    ],
    animated: true,
  },
};

export const initialState = (id) =>
  Object.fromEntries(SCENARIOS[id].controls.map(([name, , , value]) => [name, value]));
