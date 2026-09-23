import * as THREE from 'three';
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/src/index.ts';
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import type { ClusterDrawMesh } from '../../../packages/sdk-browser/src/cluster/batchMesh.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts';

export function pixel(gl: WebGL2RenderingContext, x = 16, y = 16): number[] {
  const value = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
}

/** A quad facing the camera at depth `z`, with the normal a lit surface needs. */
export const quad = (z: number, half = 1) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-half, -half, z, half, -half, z, half, half, z, -half, half, z],
      3,
    ),
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  // A 32-bit index, the one the owner's multi-draw ranges address.
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
};

/** A batch record as the owner receives it: index ranges given in indices, held in bytes. */
export const clusterRecord = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  starts: number[] = [0],
  counts: number[] = [6],
): ClusterDrawMesh => {
  const index = geometry.index;
  if (!index) throw new Error('clusterRecord requires an indexed geometry');
  return {
    geometry: { index, attributes: geometry.attributes },
    material,
    renderOrder: 0,
    polygonOffsetUnits: undefined,
    matrix: { elements: new Float64Array(IDENTITY_MATRIX4) },
    _multiDrawStarts: new Int32Array(starts.map((start) => start * 4)),
    _multiDrawCounts: new Int32Array(counts),
    _multiDrawCount: starts.length,
  };
};

/** A `ClusterDrawMesh` matrix field, `elements` a `Float64Array` as the renderer reads it, kept
 *  in sync with a private `THREE.Matrix4` so a proof can still pose it with the usual helpers. */
export interface DrawMatrix {
  elements: Float64Array<ArrayBuffer>;
  makeTranslation(x: number, y: number, z: number): void;
  makeScale(x: number, y: number, z: number): void;
  identity(): void;
  copy(source: DrawMatrix): void;
}

export function drawMatrix(): DrawMatrix {
  const scratch = new THREE.Matrix4(),
    elements = new Float64Array(16);
  const sync = () => elements.set(scratch.elements);
  return {
    elements,
    makeTranslation(x, y, z) {
      scratch.makeTranslation(x, y, z);
      sync();
    },
    makeScale(x, y, z) {
      scratch.makeScale(x, y, z);
      sync();
    },
    identity() {
      scratch.identity();
      sync();
    },
    copy(source) {
      elements.set(source.elements);
    },
  };
}

export function clear(gl: WebGL2RenderingContext) {
  gl.depthMask(true);
  gl.clearColor(0, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

/** A 32 × 32 WebGL2 canvas, the owned renderer on it and a camera at the origin; null without WebGL2. */
export function mountClusterRenderer() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  gl.viewport(0, 0, 32, 32);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  return {
    gl,
    renderer: new WebglClusterRenderer(gl),
    scene: new THREE.Scene(),
    camera,
    drawCamera: readHostDrawCamera(createHostDrawCamera(), camera),
  };
}
