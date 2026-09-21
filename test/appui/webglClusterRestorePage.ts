import * as THREE from 'three';
import { IDENTITY_MATRIX4 } from '../../packages/sdk-core/index.ts';
import type { RenderBackend } from '../../packages/sdk-browser/backendTypes.ts';
import { WebglClusterOwner } from '../../packages/sdk-browser/webglClusterOwner.ts';
import { createSceneDrawer } from '../../packages/sdk-browser/explorerDrawScene.ts';
import { prepareExplorerWebglSurface } from '../../packages/sdk-browser/explorerWebglHost.ts';

const readPixel = (gl: WebGL2RenderingContext): number[] => {
  const value = new Uint8Array(4);
  gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
};

const waitFor = (read: () => boolean) =>
  new Promise<void>((resolve, reject) => {
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
  const map = new THREE.CanvasTexture(image);
  const material = new THREE.MeshBasicMaterial({ map });
  const paint = (color: string) => {
    const context = image.getContext('2d');
    if (!context) throw new Error('2d context unavailable');
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    map.needsUpdate = true;
  };
  return {
    map,
    paint,
    geometry,
    material,
    renderOrder: 0,
    matrix: { elements: new Float64Array(IDENTITY_MATRIX4) },
    _multiDrawCounts: new Int32Array([3]),
    _multiDrawStarts: new Int32Array([0]),
    _multiDrawCount: 1,
    _sideSplitMaterials: undefined,
    _sideSplitBack: undefined,
    _sideSplitFront: undefined,
    _sideSplitSource: undefined,
    _sideSplitPolygonMaterials: undefined,
  };
};

export async function heldRestore() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  document.body.append(canvas);
  const events: ('lost' | 'restored')[] = [],
    surface = prepareExplorerWebglSurface({
      canvas,
      size: { width: 8, height: 8 },
      onLifecycle: (state) => events.push(state),
    }),
    renderer = new THREE.WebGLRenderer({ canvas, context: surface.context }),
    gl = surface.context,
    camera = new THREE.PerspectiveCamera(),
    scene = new THREE.Scene(),
    mesh = texturedTriangle(),
    owner = new WebglClusterOwner(gl),
    backend: {
      scene: THREE.Scene;
      frameHeld?: boolean;
      drawHostGeometry?: RenderBackend['drawHostGeometry'];
    } = { scene, frameHeld: false };
  let draws = 0;
  backend.drawHostGeometry = (drawCamera) => {
    draws++;
    owner.draw([mesh], scene, drawCamera, false, true);
  };
  mesh.paint('red');
  const draw = createSceneDrawer(renderer, camera);
  draw(backend as RenderBackend, null);
  backend.frameHeld = true;
  mesh.paint('lime');
  const extension = gl.getExtension('WEBGL_lose_context');
  if (!extension) return { unavailable: 'WEBGL_lose_context unavailable' };
  extension.loseContext();
  await waitFor(() => events.includes('lost'));
  extension.restoreContext();
  await waitFor(() => events.includes('restored'));
  draw(backend as RenderBackend, null);
  const restoredPixel = readPixel(gl);
  draw.dispose();
  owner.dispose();
  renderer.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
  mesh.map.dispose();
  surface.dispose();
  return { draws, restoredPixel };
}
