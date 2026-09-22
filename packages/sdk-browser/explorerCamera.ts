import { exactPagesBounds } from './exactPagesBounds.ts';
import type { BoxTransformLot } from './mathBatchRuntime.ts';
import { emptyWorldBox, hostWorldBounds } from './hostWorldBounds.ts';
import { framingFromBounds } from './framing.ts';
import { DEFAULT_FOV } from './backendCommon.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import type { HostGraphNode } from './hostGraphNodes.ts';
import { hostBox, hostFramingCamera, hostPoint } from './hostGraphObjects.ts';
import { sphereFromBounds, type ClusterManifest } from '../sdk-core/index.ts';

/** Framing centre and radius: midpoint of the bounds and the half-diagonal, reread from a single sphere. */
const framingSphere = new Float64Array(4);

export function createExplorerCamera(
  source: HostGraphNode,
  autonomous: boolean,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  canvas: HTMLCanvasElement,
  options: ExplorerOptions,
  /** Framing-box buffer, reserved at load; `null` leaves it in JavaScript. */
  lot?: BoxTransformLot | null,
) {
  const flat = emptyWorldBox();
  // A mesh without a prepared primitive simply does not frame the camera.
  if (autonomous) exactPagesBounds(source, associations, metadata, () => {}, flat, lot);
  else hostWorldBounds(source, flat, lot);
  sphereFromBounds(framingSphere, 0, flat[0], flat[1], flat[2], flat[3], flat[4], flat[5]);
  const radius = framingSphere[3];
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Empty scene bounds');
  const framing = framingFromBounds(radius, canvas.width / canvas.height);
  // The box and the centre go back to the host — `explorer.bounds` and `explorer.center` are its
  // API, and its controls want a target. The host objects are built at the boundary
  // (`hostGraphObjects.ts`); no computation is done there, everything comes from the core as numbers.
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
