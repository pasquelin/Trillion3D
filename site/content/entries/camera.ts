import type { EntryNote } from '../model.ts';

/** Camera and projection (`sdk-core`), then the host-camera bridge and sides (`sdk-browser`). */

export const CAMERA: EntryNote[] = [
  {
    id: 'perspectiveProjection',
    replaces: 'PerspectiveCamera.updateProjectionMatrix()',
    proof:
      "bench Matrix4.makePerspective (×1.1 on the x/y terms; the depth terms are the engine's by design — a declared exception)",
    example: `const projection = new Float64Array(16);
perspectiveProjection(projection, 50, canvas.width / canvas.height, 0.1, 1);`,
  },
  {
    id: 'createCameraFrame',
    replaces: 'matrixWorldInverse + new Frustum()',
  },
  {
    id: 'updateCameraFrame',
    replaces: 'Frustum.setFromProjectionMatrix',
    proof: 'bench Frustum.setFromProjectionMatrix (×1.6 on the side planes)',
    example: `updateCameraFrame(frame, projection, world, 2000);
// frame.viewProjection feeds the GPU, frame.planes the culling`,
  },
  {
    id: 'worldToRenderOrigin',
  },
  {
    id: 'matrixAtRenderOrigin',
  },
  {
    id: 'viewToRenderOrigin',
  },
];

export const HOST_CAMERA: EntryNote[] = [
  {
    id: 'createEngineCamera',
    replaces: 'new PerspectiveCamera()',
    proof: 'engineCamera.test.ts',
  },
  {
    id: 'writeEngineCamera',
    replaces: 'updateProjectionMatrix() + updateMatrixWorld()',
    proof: 'engineCamera.test.ts: the same bits as a host camera read through readCameraWorld',
  },
  {
    id: 'defaultEngineCamera',
  },
  {
    id: 'readCameraWorld',
    proof:
      'packages/sdk-browser/src/camera/world.test.ts under a hostile rig; tests/integration/engine-without-three.test.ts',
  },
  {
    id: 'holdCameraWorld',
    replaces: 'PerspectiveCamera.copy',
  },
  {
    id: 'enginePose',
    replaces: 'getWorldPosition(), getWorldQuaternion()',
  },
];
