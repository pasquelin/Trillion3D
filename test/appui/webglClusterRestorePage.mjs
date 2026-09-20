import * as THREE from 'three';
import { WebglClusterOwner } from '../../packages/sdk-browser/webglClusterOwner.ts';
import { createSceneDrawer } from '../../packages/sdk-browser/explorerDrawScene.ts';
import { prepareExplorerWebglSurface } from '../../packages/sdk-browser/explorerWebglHost.ts';

const readPixel = (gl) => {
  const value = new Uint8Array(4);
  gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
};

const waitFor = (read) =>
  new Promise((resolve, reject) => {
    const start = performance.now();
    const poll = () => {
      if (read()) resolve();
      else if (performance.now() - start > 2000) reject(new Error('Context event timeout'));
      else requestAnimationFrame(poll);
    };
    poll();
  });

const texturedTriangle = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const image = document.createElement('canvas');
  image.width = image.height = 1;
  const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(image) });
  return {
    image,
    geometry,
    material,
    matrix: new THREE.Matrix4(),
    _multiDrawCounts: new Int32Array([3]),
    _multiDrawStarts: new Int32Array([0]),
    _multiDrawCount: 1,
  };
};

export async function heldRestore() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  document.body.append(canvas);
  const events = [],
    surface = prepareExplorerWebglSurface({ canvas, onLifecycle: (state) => events.push(state) }),
    renderer = new THREE.WebGLRenderer({ canvas, context: surface.context }),
    gl = surface.context,
    camera = new THREE.PerspectiveCamera(),
    scene = new THREE.Scene(),
    mesh = texturedTriangle(),
    owner = new WebglClusterOwner(gl),
    backend = { scene, frameHeld: false };
  let draws = 0;
  backend.drawHostGeometry = (drawCamera) => {
    draws++;
    owner.draw([mesh], scene, drawCamera, false, true);
  };
  mesh.image.getContext('2d').fillStyle = 'red';
  mesh.image.getContext('2d').fillRect(0, 0, 1, 1);
  mesh.material.map.needsUpdate = true;
  const draw = createSceneDrawer(renderer, camera);
  draw(backend, null);
  backend.frameHeld = true;
  mesh.image.getContext('2d').fillStyle = 'lime';
  mesh.image.getContext('2d').fillRect(0, 0, 1, 1);
  mesh.material.map.needsUpdate = true;
  const extension = gl.getExtension('WEBGL_lose_context');
  if (!extension) return { unavailable: 'WEBGL_lose_context unavailable' };
  extension.loseContext();
  await waitFor(() => events.includes('lost'));
  extension.restoreContext();
  await waitFor(() => events.includes('restored'));
  draw(backend, null);
  const restoredPixel = readPixel(gl);
  draw.dispose();
  owner.dispose();
  renderer.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
  mesh.material.map.dispose();
  surface.dispose();
  return { draws, restoredPixel };
}
