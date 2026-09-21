/** Boxes, spheres, frustums and cones: the selection tests, drawn from above as they decide. */
import {
  clipPlanesFromMatrix,
  composeMatrix4,
  createCameraFrame,
  frustumClipBox,
  frustumExcludesBox,
  multiplyMatrix4,
  perspectiveProjection,
  updateCameraFrame,
} from './engine.ts';
import { canvasView, formatNumber, slider, valueView, verdictView } from './kit.ts';
import type { DemoDef, DemoState } from './kit.ts';
import { drawScene } from './drawScene.ts';

/** The camera of these demos: one shape, so the picture and the planes cannot disagree. */
const ASPECT = 1.6;

/** Six flat box bounds, kept as a tuple so the engine's variadic box calls can spread it. */
type Box6 = [number, number, number, number, number, number];

/**
 * A little world of four boxes in front of the camera — the engine's camera looks down its
 * own −z, like the reference, so everything it can see has a negative z.
 */
const BOXES: Box6[] = [
  [-1, -0.5, -3, 0.4, 0.5, -2],
  [1.4, -0.5, -4.6, 2.6, 0.5, -3.5],
  [-3, -0.5, -6.2, -1.6, 0.5, -5],
  [0.2, -0.5, -8.6, 1.4, 0.5, -7.5],
];

/**
 * The camera the reader turns, and the frame the engine rewrites from it: the view is the
 * inverse of the camera's world matrix, and `updateCameraFrame` is what does that inversion
 * and extracts the six planes — the same call the renderer makes once per image.
 */
function frustumOf(state: DemoState) {
  const world = new Float64Array(16),
    projection = new Float64Array(16),
    clip = new Float64Array(16);
  const half = state.turn * 0.5;
  composeMatrix4(world, [0, 0, 0], [0, Math.sin(half), 0, Math.cos(half)], [1, 1, 1]);
  perspectiveProjection(projection, state.fov, ASPECT, 0.1, 1);
  const frame = createCameraFrame();
  updateCameraFrame(frame, projection, world, 100);
  multiplyMatrix4(clip, projection, frame.view);
  return { clip, planes: frame.planes };
}

export const BOUNDS_DEMOS: Record<string, DemoDef> = {
  frustumExcludesBox: {
    controls: [
      slider('turn', 'camera heading (rad)', -1.2, 1.2, 0.2, 0.01),
      slider('fov', 'field of view (°)', 20, 110, 60, 1),
    ],
    run(state) {
      const { planes } = frustumOf(state);
      const verdicts = BOXES.map((box) => ({
        box,
        out: frustumExcludesBox(planes, ...box),
        state: frustumClipBox(planes, ...box),
      }));
      const kept = verdicts.filter((verdict) => !verdict.out).length;
      return [
        canvasView(
          'the world from above, each box coloured by what the engine decided',
          (c, w, h) =>
            drawScene(c, w, h, {
              boxes: verdicts,
              turn: state.turn,
              fov: state.fov,
              aspect: ASPECT,
            }),
        ),
        valueView(
          'frustumClipBox — 0 outside, 1 straddling, 2 entirely inside',
          verdicts.map((verdict, index) => [`box ${index}`, String(verdict.state)]),
        ),
        verdictView(
          'this frame',
          kept > 0,
          `${kept} of ${BOXES.length} boxes survive the six planes`,
        ),
      ];
    },
  },
  frustumPlanesFromMatrix: {
    controls: [
      slider('turn', 'camera heading (rad)', -1.2, 1.2, 0.2, 0.01),
      slider('fov', 'field of view (°)', 20, 110, 60, 1),
    ],
    run(state) {
      const { clip, planes } = frustumOf(state);
      const raw = new Float64Array(24);
      clipPlanesFromMatrix(raw, clip);
      const names = ['right', 'left', 'bottom', 'top', 'near', 'far'];
      return [
        valueView(
          'the six normalised planes (a, b, c, d)',
          names.map((name, index) => [
            name,
            Array.from(planes.subarray(index * 4, index * 4 + 4), formatNumber).join(', '),
          ]),
        ),
        valueView('clipPlanesFromMatrix — the same planes, unnormalised', [
          ['right', Array.from(raw.subarray(0, 4), formatNumber).join(', ')],
          ['note', 'the sign alone decides, with no square root: the exact clip test'],
        ]),
      ];
    },
  },
};
