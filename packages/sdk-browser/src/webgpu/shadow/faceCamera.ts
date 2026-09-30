import { invertMatrix4, updateCameraFrame } from '../../../../sdk-core/src/index.ts';
import { type EngineCamera } from '../../camera/world.ts';
import type { ShadowRun } from './runs.ts';

/**
 * The face as a camera the CPU cut reads: its world pose, the projection cropped to the region,
 * no far plane beyond the projection's own. The viewport makes the cut's pixel scale the face's
 * texel scale: its error is counted in the map's texels, as the GPU light cut counts it.
 */
export function faceEngineCamera(run: ShadowRun, into: EngineCamera, viewport: number[]) {
  const { face } = run;
  invertMatrix4(into.world, face.worldView);
  into.projection.set(face.clip);
  updateCameraFrame(into, into.projection, into.world, Infinity);
  // An orthography weighs no depth against its near plane (clip w is 1): the CPU cut only asks
  // for a positive one, and the smallest leaves every error as the GPU computes it.
  into.near = face.perspective ? face.near : Number.MIN_VALUE;
  into.far = Infinity;
  into.perspective = face.perspective;
  for (let a = 0; a < 3; a++) into.eye[a] = into.world[12 + a];
  viewport[0] = (2 * face.focal) / Math.abs(face.clip[0]);
  viewport[1] = (2 * face.focal) / Math.abs(face.clip[5]);
  return into;
}
