import * as THREE from 'three';
import { WebglClusterRenderer } from '../../packages/sdk-browser/webglClusterRenderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../packages/sdk-browser/cameraWorld.ts';
import { triangleGeometry } from '../../packages/sdk-browser/triangleDiagnostic.ts';
import { drawCoplanarBlend } from './webglClusterCoplanarBlend.mjs';
import { clear, pixel } from './webglClusterPixels.mjs';

const geometry = (reverseFirst = false) => {
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2, -1, -1, -2, 1, -1, -2, 0, 1, -2]),
      3,
    ),
  );
  result.setAttribute(
    'color',
    new THREE.BufferAttribute(
      new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      3,
    ),
  );
  result.setIndex(
    new THREE.BufferAttribute(
      new Uint32Array(reverseFirst ? [0, 2, 1, 3, 4, 5] : [0, 1, 2, 3, 4, 5]),
      1,
    ),
  );
  return result;
};

const mesh = (geometry, material, starts = [0], counts = [6]) => ({
  geometry,
  material,
  matrix: new THREE.Matrix4(),
  _multiDrawStarts: new Int32Array(starts.map((start) => start * 4)),
  _multiDrawCounts: new Int32Array(counts),
  _multiDrawCount: starts.length,
});

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
    blend = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.5,
      vertexColors: true,
      depthWrite: false,
    }),
    ordered = mesh(geometry(), blend, [0, 3], [3, 3]);
  clear(gl);
  renderer.draw([ordered], scene, drawCamera, false, false);
  const sourceOrder = pixel(gl);
  ordered._multiDrawStarts = new Int32Array([12, 0]);
  clear(gl);
  renderer.draw([ordered], scene, drawCamera, false, false);
  const reversedOrder = pixel(gl);

  const double = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.5,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const back = double.clone(),
    front = double.clone();
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  const pair = [back, front],
    split = mesh(geometry(true), pair);
  split._sideSplitMaterials = pair;
  split._sideSplitBack = back;
  split._sideSplitFront = front;
  split._sideSplitSource = double;
  clear(gl);
  const splitSubmissions = renderer.draw([split], scene, drawCamera, false, false);
  const splitPixel = pixel(gl);
  double.side = THREE.DoubleSide;
  double.forceSinglePass = true;
  split.material = double;
  split._sideSplitMaterials = undefined;
  split._sideSplitSource = undefined;
  clear(gl);
  const singleSubmissions = renderer.draw([split], scene, drawCamera, false, false);

  const mask = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, alphaTest: 0.4 });
  const single = mesh(geometry(), mask, [0], [3]);
  clear(gl);
  renderer.draw([single], scene, drawCamera, false, false);
  const maskPixel = pixel(gl);
  mask.transparent = true;
  clear(gl);
  renderer.draw([single], scene, drawCamera, false, false);
  const blendPixel = pixel(gl);

  const lower = new THREE.MeshBasicMaterial({ color: 0xff0000, depthFunc: THREE.LessDepth }),
    raised = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      depthFunc: THREE.LessDepth,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -8,
    });
  clear(gl);
  renderer.draw(
    [mesh(geometry(), lower, [0], [3]), mesh(geometry(), raised, [0], [3])],
    scene,
    drawCamera,
    false,
    false,
  );
  const coplanarPixel = pixel(gl);

  clear(gl);
  const coplanarBlendSubmissions = drawCoplanarBlend(
    renderer,
    scene,
    drawCamera,
    geometry,
    mesh,
    lower,
  );
  const coplanarBlendPixel = pixel(gl);

  const diagnosticGeometry = triangleGeometry(geometry()),
    diagnosticMaterial = new THREE.MeshBasicMaterial({ vertexColors: true }),
    diagnostic = new THREE.Mesh(diagnosticGeometry, diagnosticMaterial);
  diagnostic.matrixAutoUpdate = false;
  clear(gl);
  const diagnosticSubmissions = renderer.draw([], scene, drawCamera, false, false, [diagnostic]);
  const diagnosticPixel = pixel(gl);

  double.forceSinglePass = false;
  split.material = pair;
  split._sideSplitMaterials = pair;
  split._sideSplitSource = double;
  double.visible = false;
  clear(gl);
  const hiddenSubmissions = renderer.draw([split], scene, drawCamera, false, false);
  const hiddenPixel = pixel(gl);
  double.visible = true;
  double.premultipliedAlpha = true;
  clear(gl);
  let sourceMutationRejected = false;
  try {
    renderer.draw([split], scene, drawCamera, false, false);
  } catch {
    sourceMutationRejected = true;
  }
  const sourceRejectionPixel = pixel(gl);
  double.premultipliedAlpha = false;
  pair[0] = double;
  clear(gl);
  let mutationRejected = false;
  try {
    renderer.draw([split], scene, drawCamera, false, false);
  } catch {
    mutationRejected = true;
  }
  const rejectionPixel = pixel(gl);
  renderer.dispose();
  return {
    sourceOrder,
    reversedOrder,
    splitPixel,
    splitSubmissions,
    singleSubmissions,
    maskPixel,
    blendPixel,
    coplanarPixel,
    coplanarBlendPixel,
    coplanarBlendSubmissions,
    diagnosticPixel,
    diagnosticSubmissions,
    mutationRejected,
    rejectionPixel,
    hiddenSubmissions,
    hiddenPixel,
    sourceMutationRejected,
    sourceRejectionPixel,
  };
}
