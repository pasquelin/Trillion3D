import * as THREE from 'three';
import type { VisPage } from '../../packages/sdk-browser/visibilityBuffer.ts';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';
import type { EngineCamera } from '../../packages/sdk-browser/cameraWorld.ts';
import {
  HIZ_BOUNDS_VALUES,
  projectBoxesFlat,
  type HizBounds,
  type HizPage,
} from '../../packages/sdk-browser/hiz.ts';

export function cameraAt(z = 5, near = 0.1) {
  const cam = new THREE.PerspectiveCamera(55, 1, near, 100);
  cam.position.z = z;
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

export function quad(
  material: THREE.Material,
  min: number[],
  max: number[],
  clusterId: string,
): { page: VisPage & HizPage; geometry: THREE.BufferGeometry } {
  const z = (min[2] + max[2]) * 0.5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [min[0], min[1], z, max[0], min[1], z, max[0], max[1], z, min[0], max[1], z],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const page: VisPage & HizPage = {
    array: new Uint32Array([0, 1, 2, 0, 2, 3]),
    attributes: geometry.attributes,
    matrix: new THREE.Matrix4(),
    material,
    clusterId,
    min,
    max,
    url: clusterId,
  };
  return { page, geometry };
}

const boxScratch = new Float64Array(HIZ_BOUNDS_VALUES);
/**
 * Single-box `HizBounds` adapter over the flat, batched `projectBoxesFlat`: `projectBoxToScreen`
 * was removed when the pipeline moved to the flat layout, but tests written for one box at a time
 * still want that shape. This calls the real (only) projection with a batch of one.
 */
export function projectBoxToScreen(
  min: number[],
  max: number[],
  matrix: THREE.Matrix4,
  camera: THREE.PerspectiveCamera | EngineCamera,
  viewport: [number, number],
): HizBounds {
  projectBoxesFlat([{ min, max, matrix }], 1, cameraMoteur(camera), viewport, boxScratch);
  return {
    minX: boxScratch[0],
    minY: boxScratch[1],
    maxX: boxScratch[2],
    maxY: boxScratch[3],
    nearestDepth: boxScratch[4],
    clipsNear: boxScratch[5] !== 0,
  };
}
