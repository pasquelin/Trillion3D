import { pagesBounds } from '../scene/pagesBounds.ts';
import type { BoxTransformLot } from '../../math/batchRuntime.ts';
import { emptyWorldBox, hostWorldBounds } from '../../host/world/bounds.ts';
import { framingFromBounds } from '../../camera/framing.ts';
import { DEFAULT_FOV } from '../../backend/common.ts';
import type { BackendContext, MeasuredWorldOptions } from '../../backend/types.ts';
import { hostBox, hostFramingCamera, hostPoint } from '../../host/scene/graphObjects.ts';
import { sphereFromBounds, type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** Framing centre and radius: midpoint of the bounds and the half-diagonal, reread from a single sphere. */
const framingSphere = new Float64Array(4);

export function createExplorerCamera(
  source: Object3D,
  autonomous: boolean,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  canvas: HTMLCanvasElement,
  options: MeasuredWorldOptions,
  /** Framing-box buffer, reserved at load; `null` leaves it in JavaScript. */
  lot?: BoxTransformLot | null,
) {
  const flat = emptyWorldBox();
  // A mesh without a prepared primitive simply does not frame the camera.
  if (autonomous) pagesBounds(source, associations, metadata, () => {}, flat, lot);
  else hostWorldBounds(source, flat, lot);
  sphereFromBounds(framingSphere, 0, flat[0], flat[1], flat[2], flat[3], flat[4], flat[5]);
  const radius = framingSphere[3];
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Empty scene bounds');
  const framing = framingFromBounds(radius, canvas.width / canvas.height);
  // The box and the centre go back to the host — `explorer.bounds` and `explorer.center` are its
  // API, and its controls want a target. The host objects are built at the boundary
  // (`../../host/scene/graphObjects.ts`); no computation is done there, everything comes from the core as numbers.
  const camera = hostFramingCamera(
    options.fov ?? DEFAULT_FOV,
    canvas.width / canvas.height,
    framing.near,
    framing.far,
  );
  const bounds = hostBox(flat);
  const center = hostPoint(framingSphere[0], framingSphere[1], framingSphere[2]);
  const homeOffset = hostPoint(framing.offset[0], framing.offset[1], framing.offset[2]);
  camera.position.set(
    framingSphere[0] + framing.offset[0],
    framingSphere[1] + framing.offset[1],
    framingSphere[2] + framing.offset[2],
  );
  camera.lookAt(center);
  camera.updateMatrixWorld();
  return { bounds, center, radius, camera, homeOffset };
}
