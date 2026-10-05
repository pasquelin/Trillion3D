import type { EngineCamera, HostCamera } from '../camera/world.ts';
import type { ViewHold } from './viewRevision.ts';

/** A replacement describing the identical view is continuous, even when a host hands over a
 * fresh camera wrapper each image. Explicit cuts do not depend on a pose-distance heuristic. */
export function trackViewCamera(
  view: ViewHold,
  camera: HostCamera,
  cam: EngineCamera,
  width: number,
  height: number,
) {
  const revision = camera.temporalRevision ?? 0;
  const cut =
    view.cameraRevision !== revision ||
    (view.camera !== camera && !view.fingerprint.same(cam, width, height));
  view.camera = camera;
  view.cameraRevision = revision;
  if (cut) view.temporalRevision++;
  return cut;
}
