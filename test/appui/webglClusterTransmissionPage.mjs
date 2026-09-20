// Standalone proof of the autonomous transmission pass: what a transmissive scene copy lets
// through is the engine's own cluster image, opaque and blended, depth-tested both ways.
import * as THREE from 'three';
import { WebglClusterRenderer } from '../../packages/sdk-browser/webglClusterRenderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../packages/sdk-browser/cameraWorld.ts';
import { clear, pixel } from './webglClusterPixels.mjs';

/** A quad facing the camera at depth `z`, with the normal the lit glass needs. */
const quad = (z, half = 1) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-half, -half, z, half, -half, z, half, half, z, -half, half, z]),
      3,
    ),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
};

const cluster = (geometry, material) => ({
  geometry,
  material,
  renderOrder: 0,
  matrix: new THREE.Matrix4(),
  _multiDrawStarts: new Int32Array([0]),
  _multiDrawCounts: new Int32Array([6]),
  _multiDrawCount: 1,
});

const glassMesh = (options = {}) => {
  const mesh = new THREE.Mesh(
    quad(-1),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, roughness: 1, ...options }),
  );
  mesh.matrixAutoUpdate = false;
  return mesh;
};

export function execute() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const gl = canvas.getContext('webgl2');
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  gl.viewport(0, 0, 32, 32);
  const renderer = new WebglClusterRenderer(gl),
    scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10),
    drawCamera = readHostDrawCamera(createHostDrawCamera(), camera),
    red = cluster(quad(-3), new THREE.MeshBasicMaterial({ color: 0xff0000 })),
    glass = glassMesh();
  scene.background = new THREE.Color(0x0000ff);
  const draw = (clusters, copies, srgb = false) =>
    renderer.draw(clusters, scene, drawCamera, false, srgb, [], copies);

  clear(gl);
  const withoutGlass = draw([red], []);
  const opaquePixel = pixel(gl);
  clear(gl);
  const submissions = draw([red], [glass]);
  const throughGlass = pixel(gl);
  const restored = {
    framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
    viewport: [...gl.getParameter(gl.VIEWPORT)],
    backdropBytes: renderer.backdropBytes,
  };
  clear(gl);
  draw([red], [glass], true);
  const encoded = pixel(gl);

  // The background shows through where no cluster stands behind the glass.
  clear(gl);
  draw([], [glass]);
  const backgroundThrough = pixel(gl);

  // A cluster in front of the glass hides it: shared depth, tested the usual way.
  const yellow = cluster(quad(-0.5), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
  clear(gl);
  draw([red, yellow], [glass]);
  const occluded = pixel(gl);

  // A blended cluster behind the glass is part of what it lets through.
  const blue = cluster(
    quad(-2),
    new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, opacity: 0.5 }),
  );
  clear(gl);
  draw([red, blue], [glass]);
  const blendedThrough = pixel(gl);

  // The volume attenuates: half the light over one unit of thickness.
  const tinted = glassMesh({
    thickness: 1,
    attenuationDistance: 1,
    attenuationColor: new THREE.Color(0.5, 0.5, 0.5),
  });
  clear(gl);
  draw([red], [tinted]);
  const attenuated = pixel(gl);

  // A declared light reflects on the glass; its diffuse lobe cancels, its specular stays.
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(0, 0, 1);
  scene.add(sun, sun.target);
  scene.updateMatrixWorld(true);
  const shiny = glassMesh({ roughness: 0.5 });
  clear(gl);
  draw([red], [shiny]);
  const lit = pixel(gl);
  scene.clear();

  // A sub-viewport: the backdrop follows it, texel for texel, and nothing outside it moves.
  clear(gl);
  gl.viewport(8, 8, 16, 16);
  draw([red], [glass]);
  gl.viewport(0, 0, 32, 32);
  const subViewport = { inside: pixel(gl), outside: readPixel(gl, 2, 2) };

  // Another physical extension is refused before anything is drawn.
  const coated = glassMesh({ clearcoat: 0.5 });
  clear(gl);
  let refused = false;
  try {
    draw([red], [coated]);
  } catch (error) {
    refused = /clearcoat/.test(String(error));
  }
  const refusedPixel = pixel(gl);
  const drawError = gl.getError();
  renderer.dispose();
  return {
    withoutGlass,
    submissions,
    opaquePixel,
    throughGlass,
    encoded,
    restored,
    backgroundThrough,
    occluded,
    blendedThrough,
    attenuated,
    lit,
    subViewport,
    refused,
    refusedPixel,
    drawError,
  };
}

function readPixel(gl, x, y) {
  const value = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
}
