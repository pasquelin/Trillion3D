import type { PortalEntry } from '../model.ts';

/** Camera and projection (`sdk-core`), then the host-camera bridge and sides (`sdk-browser`). */
const CAM = {
  section: 'camera',
  kind: 'Function',
  module: 'packages/sdk-core/src/math/primitives/camera.ts',
};
const ORIGIN = {
  section: 'camera',
  kind: 'Function',
  module: 'packages/sdk-core/src/math/primitives/renderOrigin.ts',
};
const HOST = {
  section: 'host',
  kind: 'Function',
  module: 'packages/sdk-browser/src/camera/engineCamera.ts',
};

export const CAMERA: PortalEntry[] = [
  {
    ...CAM,
    id: 'perspectiveProjection',
    exports: ['perspectiveProjection'],
    title: 'perspectiveProjection()',
    signature: 'perspectiveProjection(out, fov, aspect, near, zoom)',
    description:
      'Perspective projection of a camera with vertical `fov` in degrees, ratio `aspect`, near plane `near`, zoom `zoom`. **Reversed depth, infinite far plane**: `near` projects to 1, infinity to 0. No far plane enters here, hence no division by it — which is what buys the depth precision.',
    replaces: 'PerspectiveCamera.updateProjectionMatrix()',
    proof:
      "bench Matrix4.makePerspective (×1.1 on the x/y terms; the depth terms are the engine's by design — a declared exception)",
    example: `const projection = new Float64Array(16);
perspectiveProjection(projection, 50, canvas.width / canvas.height, 0.1, 1);`,
  },
  {
    ...CAM,
    id: 'createCameraFrame',
    exports: ['createCameraFrame', 'CameraFrame'],
    title: 'createCameraFrame()',
    signature: 'createCameraFrame(): CameraFrame',
    description:
      'The matrices of a camera frame, allocated once and rewritten every frame: `view` (the inverse of the camera world matrix), `viewProjection`, and `planes`, the six normalised planes of that frustum.',
    replaces: 'matrixWorldInverse + new Frustum()',
  },
  {
    ...CAM,
    id: 'updateCameraFrame',
    exports: ['updateCameraFrame'],
    title: 'updateCameraFrame()',
    signature:
      'updateCameraFrame(frame: CameraFrame, projection: Float64Array, world: Float64Array, far?)',
    description:
      'Rewrites the frame: view = the inverse of `world` (zero for a singular world matrix, like the reference), view-projection = `projection · view`, and the six planes of that frustum. One depth convention crosses all three. `far` is the plane **declared by the host**: the projection has none — it is infinite, which is the whole point of reversed Z — but the frustum keeps it, otherwise a frame would suddenly gain every object the camera was not showing. Omitted or non-finite, the far plane stays unbounded.',
    replaces: 'Frustum.setFromProjectionMatrix',
    proof: 'bench Frustum.setFromProjectionMatrix (×1.6 on the side planes)',
    example: `updateCameraFrame(frame, projection, world, 2000);
// frame.viewProjection feeds the GPU, frame.planes the culling`,
  },
  {
    ...ORIGIN,
    id: 'worldToRenderOrigin',
    exports: ['worldToRenderOrigin'],
    title: 'worldToRenderOrigin()',
    signature: 'worldToRenderOrigin(out, world, origin, at = 0)',
    description:
      'Writes `world` with its translation brought back to `origin`. The subtraction happens in the precision of the inputs — the double of the engine world matrices — and writing a single-precision buffer rounds **after** it, never before: that is all that separates a sharp image from one that shivers. `at` is the rank of the first of the sixteen numbers written, so a buffer of many matrices fills without slicing a view per matrix per frame.',
  },
  {
    ...ORIGIN,
    id: 'matrixAtRenderOrigin',
    exports: ['matrixAtRenderOrigin'],
    title: 'matrixAtRenderOrigin()',
    signature: 'matrixAtRenderOrigin(out, m, origin, at = 0)',
    description:
      'Writes `m · T(origin)`: the same matrix, applied to a point referred to `origin`. Only the fourth column changes, and it equals `m · (origin, 1)`, computed in the precision of the inputs before the write rounding.',
  },
  {
    ...ORIGIN,
    id: 'viewToRenderOrigin',
    exports: ['viewToRenderOrigin'],
    title: 'viewToRenderOrigin()',
    signature: 'viewToRenderOrigin(out, view)',
    description:
      'Writes `view` without its translation: the view of a camera of the same orientation posed at the origin of the render frame — the exact counterpart of `worldToRenderOrigin`, the relative world already carrying the eye translation.',
  },
];

export const HOST_CAMERA: PortalEntry[] = [
  {
    ...HOST,
    id: 'createEngineCamera',
    exports: ['createEngineCamera', 'EngineCamera'],
    title: 'createEngineCamera()',
    signature: 'createEngineCamera(): EngineCamera',
    description:
      "An `EngineCamera`: a camera frame plus `world`, `projection`, `eye`, `near`, `far`, `fov`, `aspect`, every buffer allocated once. This is the engine's own camera — no host object crosses into the runtime.",
    replaces: 'new PerspectiveCamera()',
    proof: 'engineCamera.test.ts',
  },
  {
    ...HOST,
    id: 'writeEngineCamera',
    exports: ['writeEngineCamera', 'CameraOptics'],
    title: 'writeEngineCamera()',
    module: 'packages/sdk-browser/src/camera/engineCamera.ts',
    signature: 'writeEngineCamera(into: EngineCamera, optics: { fov, aspect, near, far, zoom })',
    description:
      'Everything a frame reads, derived from the `into.world` already set and the declared optics.',
    replaces: 'updateProjectionMatrix() + updateMatrixWorld()',
    proof: 'engineCamera.test.ts: the same bits as a host camera read through readCameraWorld',
  },
  {
    ...HOST,
    id: 'defaultEngineCamera',
    exports: ['defaultEngineCamera'],
    title: 'defaultEngineCamera()',
    signature: 'defaultEngineCamera(): EngineCamera',
    description:
      'The camera at the origin with fov 50, aspect 1, near 0.1, far 2000, zoom 1 — the fallback of oracles called before the first frame.',
  },
  {
    ...HOST,
    id: 'readCameraWorld',
    exports: ['readCameraWorld', 'HostCamera'],
    title: 'readCameraWorld()',
    module: 'packages/sdk-browser/src/camera/world.ts',
    signature:
      'readCameraWorld(into: EngineCamera, camera: HostCamera, aspect?: number): EngineCamera',
    description:
      "Resolves the host camera's ancestors, copies its world matrix, then applies `writeEngineCamera`. The only translation from a host camera, once per frame; `HostCamera` is a shape — pose, optics, world matrix, the host's own projection — not a type of the host's rendering library. `aspect` is the ratio the view is drawn at when it is not the one the camera declares: a surface capture renders the same camera aside, at the shape of the surface it writes into. The clip-depth convention is the engine's own, composed from the declared optics in reversed depth with an infinite far plane; nothing of the host's is read here.",
    proof:
      'packages/sdk-browser/src/camera/world.test.ts under a hostile rig; tests/integration/engine-without-three.test.ts',
  },
  {
    ...HOST,
    id: 'holdCameraWorld',
    exports: ['holdCameraWorld'],
    title: 'holdCameraWorld()',
    signature: 'holdCameraWorld(into: EngineCamera, from: EngineCamera): EngineCamera',
    description: 'A bit-for-bit copy of an engine camera, nothing recomputed.',
    replaces: 'PerspectiveCamera.copy',
  },
  {
    ...HOST,
    id: 'enginePose',
    exports: ['enginePose'],
    title: 'enginePose()',
    module: 'packages/sdk-browser/src/camera/world.ts',
    signature: 'enginePose(cam: EngineCamera): { position, quaternion }',
    description: 'The position and rotation of the drawn frame, read from the engine camera.',
    replaces: 'getWorldPosition(), getWorldQuaternion()',
  },
];
