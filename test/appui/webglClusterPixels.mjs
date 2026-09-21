import * as THREE from 'three';
import { WebglClusterRenderer } from '../../packages/sdk-browser/webglClusterRenderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../packages/sdk-browser/cameraWorld.ts';

export function pixel(gl, x = 16, y = 16) {
  const value = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
}

/** A quad facing the camera at depth `z`, with the normal a lit surface needs. */
export const quad = (z, half = 1) => {
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
export const clusterRecord = (geometry, material, starts = [0], counts = [6]) => ({
  geometry,
  material,
  renderOrder: 0,
  matrix: new THREE.Matrix4(),
  _multiDrawStarts: new Int32Array(starts.map((start) => start * 4)),
  _multiDrawCounts: new Int32Array(counts),
  _multiDrawCount: starts.length,
});

export function clear(gl) {
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
