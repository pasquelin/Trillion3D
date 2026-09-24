import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import {
  threeCamera,
  threeGraph,
  threeMeshCopy,
} from '../../../bench/witnesses/three/fromGraphNodes.ts';
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts';
import { drawMatrix } from './webglClusterPixels.ts';

export const curvedPixels = (gl: WebGLRenderingContext | WebGL2RenderingContext, size: number) => {
  const output = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, output);
  return output;
};

export function planarWitness() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false }),
    geometry = new THREE.BufferGeometry(),
    material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10),
    scene = new THREE.Scene(),
    light = new THREE.DirectionalLight(0xffffff, 1);
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setIndex([0, 1, 2]);
  material.color.setRGB(0.18, 0, 0, THREE.LinearSRGBColorSpace);
  light.position.set(0, 0, 1);
  scene.add(new THREE.Mesh(geometry, material), light, light.target);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0, 1);
  renderer.render(scene, camera);
  const result = [
    ...curvedPixels(renderer.getContext(), 32).slice((16 * 32 + 16) * 4, (16 * 32 + 17) * 4),
  ];
  renderer.dispose();
  geometry.dispose();
  material.dispose();
  return result;
}

const sceneInputs = () => {
  const geometry = G.sphereGeometry(1, 32, 16);
  if (!geometry.index) throw new Error('sphere geometry missing index');
  geometry.setIndex(new G.GraphAttribute(Uint32Array.from(geometry.index.array), 1));
  const material = G.standardSurface({ roughness: 0.35, metalness: 0.8 });
  (material.color as G.Color).setRGB(0.18, 0.18, 0.18);
  const camera = G.perspectiveCamera(60, 1, 0.1, 10),
    light = G.directionalLight(0xffffff, 1);
  light.position.set(1, 1, 2);
  const scene = new G.GraphScene();
  scene.add(light, light.target!);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  return { geometry, material, camera, scene };
};

export function curvedComparison(size = 64, offset = 0, details = false) {
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = rawCanvas.height = size;
  const rawGl = rawCanvas.getContext('webgl2', { antialias: false }),
    input = sceneInputs();
  if (!rawGl) return { unavailable: 'WebGL2 unavailable' };
  rawGl.viewport(0, 0, size, size);
  rawGl.clearColor(0, 0, 0, 1);
  rawGl.clear(rawGl.COLOR_BUFFER_BIT | rawGl.DEPTH_BUFFER_BIT);
  const rawRenderer = new WebglClusterRenderer(rawGl),
    matrix = drawMatrix();
  matrix.makeTranslation(offset, 0, -3);
  if (!input.geometry.index) throw new Error('sphere geometry missing index');
  const count = input.geometry.index.count;
  rawRenderer.draw(
    [
      {
        geometry: { index: input.geometry.index, attributes: input.geometry.attributes },
        material: input.material,
        renderOrder: 0,
        polygonOffsetUnits: undefined,
        matrix,
        _multiDrawCounts: new Int32Array([count]),
        _multiDrawStarts: new Int32Array([0]),
        _multiDrawCount: 1,
      },
    ],
    input.scene,
    readHostDrawCamera(createHostDrawCamera(), input.camera),
    false,
    true,
  );
  const raw = curvedPixels(rawGl, size);

  const witnessCanvas = document.createElement('canvas');
  witnessCanvas.width = witnessCanvas.height = size;
  const witness = new THREE.WebGLRenderer({ canvas: witnessCanvas, antialias: false });
  witness.outputColorSpace = THREE.SRGBColorSpace;
  witness.toneMapping = THREE.NoToneMapping;
  witness.setClearColor(0, 1);
  const witnessInput = sceneInputs(),
    witnessScene = threeGraph(witnessInput.scene),
    mesh = threeMeshCopy(witnessInput);
  mesh.matrix.fromArray(matrix.elements);
  mesh.matrixAutoUpdate = false;
  witnessScene.add(mesh);
  witness.render(witnessScene, threeCamera(witnessInput.camera));
  const reference = curvedPixels(witness.getContext(), size);

  let changed = 0,
    max = 0,
    rawNonBlack = 0,
    referenceNonBlack = 0;
  for (let i = 0; i < raw.length; i += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(raw[i + channel] - reference[i + channel]);
      if (delta) pixelChanged = true;
      if (delta > max) max = delta;
    }
    if (pixelChanged) changed++;
    if (raw[i] || raw[i + 1] || raw[i + 2]) rawNonBlack++;
    if (reference[i] || reference[i + 1] || reference[i + 2]) referenceNonBlack++;
  }
  const middle = Math.floor(size / 2),
    center = (middle * size + middle) * 4;
  const result = {
    changed,
    max,
    rawNonBlack,
    referenceNonBlack,
    rawCenter: [...raw.slice(center, center + 4)],
    referenceCenter: [...reference.slice(center, center + 4)],
  };
  rawRenderer.dispose();
  witness.dispose();
  input.geometry.dispose();
  input.material.dispose();
  witnessInput.geometry.dispose();
  witnessInput.material.dispose();
  return details ? { ...result, raw, reference } : result;
}
