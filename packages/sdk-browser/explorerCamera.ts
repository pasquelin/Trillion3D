import * as THREE from 'three';
import { exactPagesBounds } from './exactPagesBounds.ts';
import type { BoxTransformLot } from './mathBatchRuntime.ts';
import { emptyWorldBox, hostWorldBounds } from './hostWorldBounds.ts';
import { framingFromBounds } from './framing.ts';
import { DEFAULT_FOV } from './backendCommon.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import { sphereFromBounds, type ClusterManifest } from '../sdk-core/index.ts';

/** Framing centre and radius: midpoint of the bounds and the half-diagonal, reread from a single sphere. */
const framingSphere = new Float64Array(4);

export function createExplorerCamera(
  source: THREE.Object3D,
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
  const camera = new THREE.PerspectiveCamera(
    options.fov ?? DEFAULT_FOV,
    canvas.width / canvas.height,
    framing.near,
    framing.far,
  );
  // The box and the centre go back to the host — `explorer.bounds` and `explorer.center` are its
  // API, and its controls want a target: they are built here, once, at the boundary.
  // No computation is done there; everything comes from the core, as numbers.
  const bounds = new THREE.Box3(
    new THREE.Vector3(flat[0], flat[1], flat[2]),
    new THREE.Vector3(flat[3], flat[4], flat[5]),
  );
  const center = new THREE.Vector3(framingSphere[0], framingSphere[1], framingSphere[2]);
  const homeOffset = new THREE.Vector3().fromArray(framing.offset);
  camera.position.set(
    framingSphere[0] + framing.offset[0],
    framingSphere[1] + framing.offset[1],
    framingSphere[2] + framing.offset[2],
  );
  camera.lookAt(center);
  camera.updateMatrixWorld();
  return { bounds, center, radius, camera, homeOffset };
}
