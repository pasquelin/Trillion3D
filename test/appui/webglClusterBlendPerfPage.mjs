import * as THREE from 'three';
import { WebglClusterRenderer } from '../../packages/sdk-browser/webglClusterRenderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../packages/sdk-browser/cameraWorld.ts';

const p50 = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function geometry(triangles) {
  const positions = new Float32Array(triangles * 9);
  for (let triangle = 0; triangle < triangles; triangle++) {
    const offset = triangle * 9,
      x = ((triangle % 32) - 15.5) / 16,
      y = ((Math.floor(triangle / 32) % 32) - 15.5) / 16,
      z = -2 - (triangle % 7) * 0.0001;
    positions.set([x - 0.04, y - 0.04, z, x + 0.04, y - 0.04, z, x, y + 0.04, z], offset);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return result;
}

const canvas = () => {
  const value = document.createElement('canvas');
  value.width = value.height = 256;
  return value;
};

async function sample(draw, warmup = 20, count = 120) {
  const cpu = [],
    raf = [];
  let previous;
  for (let frame = 0; frame < warmup + count; frame++)
    await new Promise((resolve) =>
      requestAnimationFrame((now) => {
        const start = performance.now();
        draw();
        if (frame >= warmup) {
          cpu.push(performance.now() - start);
          if (previous !== undefined) raf.push(now - previous);
        }
        previous = now;
        resolve();
      }),
    );
  return { cpuP50: p50(cpu), rafP50: p50(raf), samples: cpu.length };
}

export async function measureBlend() {
  const sharedGeometry = geometry(4096),
    material = new THREE.MeshBasicMaterial({
      color: 0xff8040,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10),
    ownCanvas = canvas(),
    gl = ownCanvas.getContext('webgl2', { antialias: false }),
    own = new WebglClusterRenderer(gl),
    ownScene = new THREE.Scene(),
    ownCamera = readHostDrawCamera(createHostDrawCamera(), camera),
    back = material.clone(),
    front = material.clone(),
    pair = [back, front],
    ownMesh = {
      geometry: sharedGeometry,
      material: pair,
      matrix: new THREE.Matrix4(),
      _multiDrawStarts: new Int32Array([0]),
      _multiDrawCounts: new Int32Array([4096 * 3]),
      _multiDrawCount: 1,
      _sideSplitMaterials: pair,
      _sideSplitBack: back,
      _sideSplitFront: front,
      _sideSplitSource: material,
    },
    three = new THREE.WebGLRenderer({ canvas: canvas(), antialias: false }),
    threeScene = new THREE.Scene(),
    threeMesh = new THREE.Mesh(sharedGeometry, material.clone());
  back.side = THREE.BackSide;
  front.side = THREE.FrontSide;
  three.setSize(256, 256, false);
  threeScene.add(threeMesh);
  const ownDraw = () => own.draw([ownMesh], ownScene, ownCamera, false, false),
    threeDraw = () => three.render(threeScene, camera),
    ownA = await sample(ownDraw),
    reference = await sample(threeDraw),
    ownB = await sample(ownDraw);
  own.dispose();
  three.dispose();
  sharedGeometry.dispose();
  material.dispose();
  back.dispose();
  front.dispose();
  threeMesh.material.dispose();
  return { triangles: 4096, resolution: 256, ownA, reference, ownB };
}
