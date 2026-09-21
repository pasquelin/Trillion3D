/** Camera demos: the reversed-Z projection and the frame the engine rewrites each image. */
import {
  DEPTH_CLEAR,
  DEPTH_NEAR,
  composeMatrix4,
  createCameraFrame,
  frustumExcludesBox,
  matrixAtRenderOrigin,
  perspectiveProjection,
  transformHomogeneousPoint,
  updateCameraFrame,
  viewToRenderOrigin,
  worldToRenderOrigin,
} from './engine.ts';
import { canvasView, formatNumber, matrixView, slider, valueView, verdictView } from './kit.ts';
import type { DemoDef } from './kit.ts';

const scratch = () => new Float64Array(16);

/** Six flat box bounds, kept as a tuple so the engine's variadic box calls can spread it. */
type Box6 = [number, number, number, number, number, number];

/** Depth of a point at `distance` from the eye, as the projection writes it. */
function depthAt(projection: Float64Array, distance: number) {
  const clip = new Float64Array(4);
  transformHomogeneousPoint(clip, projection, 0, 0, -distance);
  return clip[3] === 0 ? Number.NaN : clip[2] / clip[3];
}

export const CAMERA_DEMOS: Record<string, DemoDef> = {
  perspectiveProjection: {
    controls: [
      slider('fov', 'field of view (°)', 20, 110, 50, 1),
      slider('near', 'near plane', 0.01, 5, 0.1, 0.01),
      slider('aspect', 'aspect ratio', 0.5, 3, 1.78, 0.01),
    ],
    run(state) {
      const projection = scratch();
      perspectiveProjection(projection, state.fov, state.aspect, state.near, 1);
      const rows: [string, string][] = [1, 10, 100, 1000, 100000].map((distance) => [
        `depth at ${distance} m`,
        formatNumber(depthAt(projection, distance)),
      ]);
      return [
        matrixView('perspectiveProjection(out, fov, aspect, near, zoom)', projection),
        valueView('reversed depth, infinite far plane', [
          [
            `depth at the near plane (${formatNumber(state.near)} m)`,
            formatNumber(depthAt(projection, state.near)),
          ],
          ...rows,
          ['the constants the engine writes', `near ${DEPTH_NEAR}, clear ${DEPTH_CLEAR}`],
        ]),
        canvasView(
          'depth against distance: it falls from 1 at the near plane toward 0 at infinity',
          (context, width, height) => drawDepth(context, width, height, projection, state.near),
          200,
        ),
      ];
    },
  },
  updateCameraFrame: {
    controls: [
      slider('turn', 'camera heading (rad)', -1.5, 1.5, 0.3, 0.01),
      slider('far', 'declared far plane', 5, 500, 100, 1),
    ],
    run(state) {
      const projection = scratch(),
        world = scratch();
      perspectiveProjection(projection, 50, 1.6, 0.1, 1);
      const half = state.turn * 0.5;
      composeMatrix4(world, [0, 0, 0], [0, Math.sin(half), 0, Math.cos(half)], [1, 1, 1]);
      const frame = createCameraFrame();
      updateCameraFrame(frame, projection, world, state.far);
      const near: Box6 = [-0.5, -0.5, -3, 0.5, 0.5, -2];
      const beyond: Box6 = [-0.5, -0.5, -state.far - 20, 0.5, 0.5, -state.far - 10];
      return [
        matrixView('frame.view — the inverse of the camera world matrix', frame.view),
        valueView('the six planes it rewrote', [
          ['right', Array.from(frame.planes.subarray(0, 4), formatNumber).join(', ')],
          ['far', Array.from(frame.planes.subarray(20, 24), formatNumber).join(', ')],
        ]),
        verdictView(
          'a box beyond the declared far plane',
          !frustumExcludesBox(frame.planes, ...beyond),
          frustumExcludesBox(frame.planes, ...beyond)
            ? 'rejected — the projection has no far plane, the frustum keeps the one the host declared'
            : 'kept',
        ),
        verdictView(
          'a box three metres ahead',
          !frustumExcludesBox(frame.planes, ...near),
          frustumExcludesBox(frame.planes, ...near) ? 'rejected' : 'kept',
        ),
      ];
    },
  },
  worldToRenderOrigin: {
    controls: [
      slider('distance', 'distance of the scene from the origin (m)', 0, 2000000, 600000, 1000),
    ],
    run(state) {
      const world = scratch();
      composeMatrix4(world, [state.distance, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
      const origin = [state.distance, 0, 0];
      const relative = new Float32Array(16);
      worldToRenderOrigin(relative, world, origin);
      const direct = new Float32Array(16);
      for (let index = 0; index < 16; index++) direct[index] = world[index];
      const shifted = scratch();
      matrixAtRenderOrigin(shifted, world, origin);
      const view = new Float64Array(16);
      viewToRenderOrigin(view, world);
      return [
        valueView('the translation, written into a single-precision buffer', [
          ['world matrix, rounded as-is', formatNumber(direct[12])],
          ['worldToRenderOrigin, subtracted first', formatNumber(relative[12])],
          ['error carried into the image', formatNumber(Math.abs(direct[12] - state.distance))],
          ['note', 'the subtraction happens in double; only the write rounds'],
        ]),
        matrixView('matrixAtRenderOrigin — the same matrix, applied at the origin', shifted),
        matrixView('viewToRenderOrigin — the view without its translation', view),
      ];
    },
  },
};

function drawDepth(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  projection: Float64Array,
  near: number,
) {
  context.clearRect(0, 0, width, height);
  context.strokeStyle = 'rgba(128,128,128,0.4)';
  context.beginPath();
  context.moveTo(0, height - 1);
  context.lineTo(width, height - 1);
  context.moveTo(1, 0);
  context.lineTo(1, height);
  context.stroke();
  context.strokeStyle = '#3987e5';
  context.lineWidth = 2;
  context.beginPath();
  for (let pixel = 0; pixel <= width; pixel++) {
    // Logarithmic in distance, from the near plane to a hundred thousand times it.
    const distance = near * Math.pow(1e5, pixel / width);
    const depth = depthAt(projection, distance);
    const y = height - Math.min(1, Math.max(0, depth)) * (height - 8) - 4;
    if (pixel === 0) context.moveTo(pixel, y);
    else context.lineTo(pixel, y);
  }
  context.stroke();
  context.fillStyle = 'rgba(150,150,150,0.95)';
  context.font = '11px ui-monospace, monospace';
  context.fillText(`near ${formatNumber(near)} m`, 6, height - 8);
  context.fillText('×100 000', width - 70, height - 8);
}
