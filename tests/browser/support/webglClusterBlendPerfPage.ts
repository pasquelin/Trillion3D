import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { threeCamera, threeMeshCopy } from '../../../bench/witnesses/three/fromGraphNodes.ts';
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts';
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts';
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/src/index.ts';
import { median } from '../../kit/median.ts';

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
  const result = new G.Geometry();
  result.setAttribute('position', new G.BufferAttribute(positions, 3));
  result.setIndex(new G.BufferAttribute(indices, 1));
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
  return { cpuP50: median(cpu), rafP50: median(raf), samples: cpu.length };
}

export async function measureBlend() {
  const sharedGeometry = geometry(4096),
    material = G.basicSurface({
      color: 0xff8040,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: G.DOUBLE_SIDE,
    }),
    camera = G.perspectiveCamera(60, 1, 0.1, 10),
    ownCanvas = canvas(),
    gl = ownCanvas.getContext('webgl2', { antialias: false });
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const sharedIndex = sharedGeometry.index;
  if (!sharedIndex) throw new Error('blend perf geometry requires an indexed geometry');
  const own = new WebglClusterRenderer(gl),
    ownScene = new G.GraphScene(),
    ownCamera = readHostDrawCamera(createHostDrawCamera(), camera),
    // The two-sided transparent record draws back faces then front faces, read at the draw.
    ownMesh = {
      geometry: { index: sharedIndex, attributes: sharedGeometry.attributes },
      material,
      renderOrder: 0,
      polygonOffsetUnits: undefined,
      matrix: { elements: new Float64Array(IDENTITY_MATRIX4) },
      _multiDrawStarts: new Int32Array([0]),
      _multiDrawCounts: new Int32Array([4096 * 3]),
      _multiDrawCount: 1,
    },
    three = new THREE.WebGLRenderer({ canvas: canvas(), antialias: false }),
    threeScene = new THREE.Scene(),
    threeMesh = threeMeshCopy({ geometry: sharedGeometry, material: material.clone() });
  three.setSize(256, 256, false);
  threeScene.add(threeMesh);
  const ownDraw = () => own.draw([ownMesh], ownScene, ownCamera, false, false),
    threeDraw = () => three.render(threeScene, threeCamera(camera)),
    ownA = await sample(ownDraw),
    reference = await sample(threeDraw),
    ownB = await sample(ownDraw);
  own.dispose();
  three.dispose();
  sharedGeometry.dispose();
  material.dispose();
  [threeMesh.material].flat().forEach((surface) => surface.dispose());
  return { triangles: 4096, resolution: 256, ownA, reference, ownB };
}
