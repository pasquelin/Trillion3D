import * as THREE from 'three';
import { WebglClusterRenderer } from '../../../packages/sdk-browser/webglClusterRenderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/cameraWorld.ts';
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/index.ts';

const p50 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** A batch draw is always indexed (`submitClusterMesh` calls `drawElements`): the identity
 *  index keeps the same triangle order as the flat position layout below. */
function geometry(triangles: number) {
  const positions = new Float32Array(triangles * 9);
  const indices = new Uint32Array(triangles * 3);
  for (let triangle = 0; triangle < triangles; triangle++) {
    const offset = triangle * 9,
      x = ((triangle % 32) - 15.5) / 16,
      y = ((Math.floor(triangle / 32) % 32) - 15.5) / 16,
      z = -2 - (triangle % 7) * 0.0001;
    positions.set([x - 0.04, y - 0.04, z, x + 0.04, y - 0.04, z, x, y + 0.04, z], offset);
    indices.set([triangle * 3, triangle * 3 + 1, triangle * 3 + 2], triangle * 3);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  return result;
}

const canvas = () => {
  const value = document.createElement('canvas');
  value.width = value.height = 256;
  return value;
};

async function sample(draw: () => void, warmup = 20, count = 120) {
  const cpu: number[] = [],
    raf: number[] = [];
  let previous: number | undefined;
  for (let frame = 0; frame < warmup + count; frame++)
    await new Promise<void>((resolve) =>
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
    gl = ownCanvas.getContext('webgl2', { antialias: false });
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const sharedIndex = sharedGeometry.index;
  if (!sharedIndex) throw new Error('blend perf geometry requires an indexed geometry');
  const own = new WebglClusterRenderer(gl),
    ownScene = new THREE.Scene(),
    ownCamera = readHostDrawCamera(createHostDrawCamera(), camera),
    // The two-sided transparent record draws back faces then front faces, read at the draw.
    ownMesh = {
      geometry: { index: sharedIndex, attributes: sharedGeometry.attributes },
      material: material as THREE.Material | THREE.Material[],
      renderOrder: 0,
      polygonOffsetUnits: undefined,
      matrix: { elements: new Float64Array(IDENTITY_MATRIX4) },
      _multiDrawStarts: new Int32Array([0]),
      _multiDrawCounts: new Int32Array([4096 * 3]),
      _multiDrawCount: 1,
    },
    three = new THREE.WebGLRenderer({ canvas: canvas(), antialias: false }),
    threeScene = new THREE.Scene(),
    threeMesh = new THREE.Mesh(sharedGeometry, material.clone());
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
  threeMesh.material.dispose();
  return { triangles: 4096, resolution: 256, ownA, reference, ownB };
}
