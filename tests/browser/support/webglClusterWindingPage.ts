import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { threeCamera, threeMeshCopy } from '../../../bench/witnesses/three/fromGraphNodes.ts';
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts';
import { drawMatrix } from './webglClusterPixels.ts';

const center = (gl: WebGLRenderingContext | WebGL2RenderingContext) => {
  const value = new Uint8Array(4);
  gl.readPixels(16, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
};

const inputs = () => {
  const geometry = new G.Geometry(),
    material = G.basicSurface(),
    matrix = drawMatrix();
  geometry.setAttribute(
    'position',
    new G.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  );
  geometry.setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  (material.color as G.Color).setRGB(0.18, 0, 0);
  const index = geometry.index;
  if (!index) throw new Error('winding proof requires an indexed geometry');
  return {
    geometry,
    ownMaterial: material,
    matrix,
    mesh: {
      geometry: { index, attributes: geometry.attributes },
      material,
      renderOrder: 0,
      polygonOffsetUnits: undefined,
      matrix,
      _multiDrawCounts: new Int32Array([3]),
      _multiDrawStarts: new Int32Array([0]),
      _multiDrawCount: 1,
    },
  };
};

export function windingComparisons() {
  const rawCanvas = document.createElement('canvas'),
    witnessCanvas = document.createElement('canvas');
  rawCanvas.width = rawCanvas.height = witnessCanvas.width = witnessCanvas.height = 32;
  const gl = rawCanvas.getContext('webgl2', { antialias: false });
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const raw = new WebglClusterRenderer(gl),
    witness = new THREE.WebGLRenderer({ canvas: witnessCanvas, antialias: false }),
    mesh = inputs(),
    scene = new G.GraphScene(),
    witnessScene = new THREE.Scene(),
    witnessMesh = threeMeshCopy({ geometry: mesh.geometry, material: mesh.ownMaterial }),
    camera = G.perspectiveCamera(60, 1, 0.1, 10),
    rig = new G.Object3D();
  witness.outputColorSpace = THREE.SRGBColorSpace;
  witness.toneMapping = THREE.NoToneMapping;
  witness.setClearColor(0, 1);
  witnessMesh.matrixAutoUpdate = false;
  witnessScene.add(witnessMesh);
  rig.add(camera);
  gl.viewport(0, 0, 32, 32);
  gl.clearColor(0, 0, 0, 1);
  const render = (modelMirror: boolean, cameraMirror: boolean) => {
    mesh.matrix.makeScale(modelMirror ? -1 : 1, 1, 1);
    witnessMesh.matrix.fromArray(mesh.matrix.elements);
    rig.scale.set(cameraMirror ? -1 : 1, 1, 1);
    rig.updateMatrixWorld(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    raw.draw([mesh.mesh], scene, readHostDrawCamera(createHostDrawCamera(), camera), false, true);
    const owned = center(gl);
    witness.render(witnessScene, threeCamera(camera));
    return { owned, witness: center(witness.getContext()) };
  };
  const result = { modelMirror: render(true, false), cameraMirror: render(false, true) };
  raw.dispose();
  witness.dispose();
  mesh.geometry.dispose();
  mesh.ownMaterial.dispose();
  return result;
}
