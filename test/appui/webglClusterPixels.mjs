import * as THREE from 'three';
import { WebglClusterRenderer } from '../../packages/sdk-browser/webglClusterRenderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../packages/sdk-browser/cameraWorld.ts';

export function pixel(gl) {
  const value = new Uint8Array(4);
  gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
}

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
