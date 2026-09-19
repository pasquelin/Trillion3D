/**
 * API reference for Camera, Color, and Material functions.
 */
export const CAMERA_COLOR_CONTENT = {
  // Camera & Projection
  createEngineCamera: {
    title: 'createEngineCamera()',
    type: 'Function',
    category: 'Camera',
    signature: 'createEngineCamera(): EngineCamera',
    description:
      'Instantiates a persistent EngineCamera container holding matrices, optics, eye position, and view-frustum planes.',
    replaces: 'new PerspectiveCamera()',
    proof: 'engineCamera.test.ts',
    example: `const camera = createEngineCamera();`,
  },
  defaultEngineCamera: {
    title: 'defaultEngineCamera()',
    type: 'Function',
    category: 'Camera',
    signature: 'defaultEngineCamera(): EngineCamera',
    description:
      'Instantiates a fallback camera positioned at the origin (FOV 50°, aspect 1, near 0.1, far 2000).',
    replaces: 'new PerspectiveCamera() default rig',
    proof: 'engineCamera.test.ts',
    example: `const defaultCam = defaultEngineCamera();`,
  },
  writeEngineCamera: {
    title: 'writeEngineCamera(into, optics)',
    type: 'Function',
    category: 'Camera',
    signature: 'writeEngineCamera(into: EngineCamera, optics: CameraOptics): void',
    description:
      'Derives projection and view-projection planes from into.world and requested optics in place.',
    replaces: 'updateProjectionMatrix() + updateMatrixWorld()',
    proof: 'Bit-identical with host camera',
    example: `writeEngineCamera(cam, { fov: 60, aspect: 16/9, near: 0.1, far: 1000, zoom: 1 });`,
  },
  readCameraWorld: {
    title: 'readCameraWorld(into, hostCamera)',
    type: 'Function',
    category: 'Camera',
    signature: 'readCameraWorld(into: EngineCamera, hostCamera: HostCamera): void',
    description:
      'Resolves ancestors of a host camera, copies its world transform, and recalculates camera optics once per frame.',
    replaces: 'Host camera translation boundary',
    proof: 'cameraWorld.test.ts',
    example: `readCameraWorld(engineCam, threePerspectiveCamera);`,
  },
  holdCameraWorld: {
    title: 'holdCameraWorld(into, from)',
    type: 'Function',
    category: 'Camera',
    signature: 'holdCameraWorld(into: EngineCamera, from: EngineCamera): void',
    description:
      'Bit-for-bit in-place copy of an entire engine camera state without recomputing any terms.',
    replaces: 'PerspectiveCamera.copy()',
    proof: 'cameraWorld.test.ts',
    example: `holdCameraWorld(previousFrameCam, currentCam);`,
  },
  createCameraFrame: {
    title: 'createCameraFrame()',
    type: 'Function',
    category: 'Camera',
    signature: 'createCameraFrame(): CameraFrame',
    description:
      'Allocates pre-sized buffers for view matrix, view-projection, and 6 bounding frustum planes.',
    replaces: 'Per-frame frustum allocations',
    proof: 'Frustum bench',
    example: `const frame = createCameraFrame();`,
  },
  updateCameraFrame: {
    title: 'updateCameraFrame(frame, projection, world, far)',
    type: 'Function',
    category: 'Camera',
    signature:
      'updateCameraFrame(frame: CameraFrame, projection: Float64Array, world: Float64Array, far: number): void',
    description:
      'Inverts world to view matrix, multiplies view-projection, and extracts frustum planes in a single call.',
    replaces: 'matrixWorldInverse + Frustum.setFromProjectionMatrix',
    proof: 'Bench Frustum.setFromProjectionMatrix (1.6× faster)',
    example: `updateCameraFrame(frame, cam.projection, cam.world, 1000);`,
  },
  perspectiveProjection: {
    title: 'perspectiveProjection(out, fov, aspect, near, zoom)',
    type: 'Function',
    category: 'Camera',
    signature:
      'perspectiveProjection(out: Float64Array, fov: number, aspect: number, near: number, zoom?: number): Float64Array',
    description:
      'Builds reversed infinite-depth perspective matrix (near -> 1.0, infinity -> 0.0).',
    replaces: 'PerspectiveCamera.updateProjectionMatrix()',
    proof: 'Bench Matrix4.makePerspective (1.1× faster)',
    example: `perspectiveProjection(proj, 45, 1.77, 0.1, 1.0);`,
  },
  enginePose: {
    title: 'enginePose(cam)',
    type: 'Function',
    category: 'Camera',
    signature:
      'enginePose(cam: EngineCamera): { position: Float64Array; quaternion: Float64Array }',
    description:
      'Retrieves decomposed world position and orientation quaternion of the camera frame.',
    replaces: 'getWorldPosition() + getWorldQuaternion()',
    proof: 'cameraWorld.test.ts',
    example: `const { position, quaternion } = enginePose(cam);`,
  },
  // Colors
  srgbToLinear: {
    title: 'srgbToLinear(c)',
    type: 'Function',
    category: 'Colors',
    signature: 'srgbToLinear(c: number): number',
    description:
      'Evaluates the exact sRGB conversion curve: c / 12.92 if c <= 0.04045, else ((c + 0.055) / 1.055)^2.4.',
    replaces: 'Color.convertSRGBToLinear()',
    proof: 'Gap <= 1e-11 per channel vs Three rounded constants',
    example: `const linearRed = srgbToLinear(255 / 255);`,
  },
  linearToSrgb: {
    title: 'linearToSrgb(c)',
    type: 'Function',
    category: 'Colors',
    signature: 'linearToSrgb(c: number): number',
    description: 'Inverse sRGB tone curve converting linear energy to display sRGB gamma.',
    replaces: 'Color.convertLinearToSRGB()',
    proof: 'mathColor.test.ts',
    example: `const displayVal = linearToSrgb(linearVal);`,
  },
  hslToLinearRgb: {
    title: 'hslToLinearRgb(out, at, h, s, l)',
    type: 'Function',
    category: 'Colors',
    signature:
      'hslToLinearRgb(out: Float64Array, at: number, h: number, s: number, l: number): Float64Array',
    description:
      'Converts Hue-Saturation-Lightness values into linear RGB values written directly at index at.',
    replaces: 'Color.setHSL()',
    proof: 'Bench Color.setHSL (1.3× faster)',
    example: `hslToLinearRgb(colors, index * 3, 0.5, 0.8, 0.5);`,
  },
  // Materials & Raster
  sideOf: {
    title: 'sideOf(material)',
    type: 'Function',
    category: 'Materials',
    signature: "sideOf(material: unknown): 'front' | 'back' | 'double'",
    description:
      'Extracts the Side enum constant declared on an imported or host material descriptor.',
    replaces: 'material.side === THREE.DoubleSide queries',
    proof: 'materialSide.test.ts',
    example: `const side = sideOf(material);`,
  },
  materialSide: {
    title: 'materialSide(material)',
    type: 'Function',
    category: 'Materials',
    signature: 'materialSide(material: unknown): number',
    description:
      'Returns the raw numeric side constant for compatibility with diagnostic materials.',
    replaces: 'Direct material.side read',
    proof: 'materialSide.test.ts',
    example: `const raw = materialSide(mat);`,
  },
};
