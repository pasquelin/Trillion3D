import { Camera } from '../../../packages/sdk-core/src/world/camera/camera.ts';
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts';
import type { RippleFrame, Splat } from './ripples/types.ts';

/** Fixed input shared by both ripple backends; storage is allocated once. */
export function rippleInputs(count: 0 | 64): RippleFrame {
  const splats: Splat[] = [];
  for (let i = 0; i < count; i++)
    splats.push([(i % 8) * 4 - 14, Math.floor(i / 8) * 4 - 14, 1.5, (i % 2 ? -1 : 1) * 0.001]);
  return { camera: [0, 0], splats };
}

/** Square orthographic domain: box half-width sqrt(coverage) covers exactly that image fraction. */
export function smokeCamera() {
  const camera = new Camera('orthographic', {
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,
    near: 0.1,
    far: 10,
  });
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return {
    viewProjection: new Float32Array(vp.elements),
    inverseViewProjection: new Float32Array(vp.clone().invert().elements),
    eye: [0, 0, 2] as const,
  };
}
