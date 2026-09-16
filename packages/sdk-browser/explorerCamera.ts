import * as THREE from 'three';
import { exactPagesBounds } from './explorerScene.ts';
import type { BoxTransformLot } from './mathBatchRuntime.ts';
import { emptyWorldBox, hostWorldBounds } from './hostWorldBounds.ts';
import { framingFromBounds } from './framing.ts';
import { DEFAULT_FOV } from './backendCommon.ts';
import type { BackendContext, ExplorerOptions } from './backendTypes.ts';
import { sphereFromBounds, type ClusterManifest } from '../sdk-core/index.ts';

/** Centre et rayon de cadrage : le milieu des bornes et la demi-diagonale, relus d'une seule sphère. */
const framingSphere = new Float64Array(4);

export function createExplorerCamera(
  source: THREE.Object3D,
  autonomous: boolean,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  canvas: HTMLCanvasElement,
  options: ExplorerOptions,
  /** Le tampon des boîtes du cadrage, réservé au chargement ; `null` le laisse en JavaScript. */
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
  // La boîte et le centre repartent chez l'hôte — `explorer.bounds` et `explorer.center` sont son
  // API, et ses contrôles veulent une cible : ils sont construits ici, une fois, à la frontière.
  // Aucun calcul n'y est fait ; tout vient du socle, en nombres.
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
