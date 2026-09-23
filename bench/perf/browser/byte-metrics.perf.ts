// Vertex bytes published by metrics().
import * as THREE from 'three';
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts';
import { createWebgpuGpuState } from '../../../packages/sdk-browser/src/webgpu/pages/state/gpu.ts';
import { createWebgpuBlendState } from '../../../packages/sdk-browser/src/webgpu/blend/state.ts';
import { ensureWebgpuPositionBuffer } from '../../../packages/sdk-browser/src/webgpu/core/positions.ts';
import { prepareWebgpuBlend } from '../../../packages/sdk-browser/src/webgpu/blend/prepare.ts';
import { vertexBytesOf } from '../../../packages/sdk-browser/src/webgpu/pages/io/metrics.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { referenceVertexBytes } from '../../oracles/browser/byte-metrics.ts';

Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64, INDIRECT: 256 },
});

// A device fixture standing in for the real WebGPU one: only the three members the measured
// functions read are implemented, as the rest of this codebase's own GPUDevice fixtures do.
const appareil = {
  limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 },
  createBuffer: ({ size }: { size: number }) => ({ size, destroy() {} }),
  queue: { writeBuffer() {} },
} as unknown as GPUDevice;

function geometrie(sommets: number, alea: () => number) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(sommets * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = alea() * 2 - 1;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(sommets * 3), 3));
  geo.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(sommets * 4), 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(sommets * 2), 2));
  const index = new Uint32Array(sommets - (sommets % 3));
  for (let i = 0; i < index.length; i++) index[i] = i % sommets;
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}

function etat(pages: number, transparents: number, concats: boolean, depart: number) {
  const alea = graine(depart);
  const gpu = createWebgpuGpuState([1, 1]),
    blendState = createWebgpuBlendState(),
    scene = new THREE.Scene();
  for (let i = 0; i < pages; i++)
    ensureWebgpuPositionBuffer(
      appareil,
      geometrie(3 + (i % 17), alea).attributes,
      gpu.positionBuffers,
      gpu,
    );
  const copies = [];
  for (let i = 0; i < transparents; i++) {
    const paint = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 });
    const mesh = new THREE.Mesh(geometrie(6 + (i % 23), alea), paint);
    mesh.updateMatrix();
    scene.add(mesh);
    copies.push(Object.assign(mesh, { surface: surfaceOf(paint) }));
  }
  prepareWebgpuBlend(appareil, copies, gpu, blendState, scene);
  const tamponDe = (size: number) => appareil.createBuffer({ size, usage: 0 });
  const vis = concats
    ? { concatPos: tamponDe(0), concatUv: tamponDe(2 ** 31), concatNrm: tamponDe(4096) }
    : { concatPos: undefined, concatUv: undefined, concatNrm: undefined };
  return { gpu, vis, blendState };
}

const grand = etat(400, 200, true, 0x41);
const petit = etat(2, 1, true, 0x43);

const resOctets = await mesure({
  name: 'vertex bytes of report',
  fichier: 'packages/sdk-browser/src/webgpu/pages/io/metrics.ts',
  cas: [
    { name: '400 pages, 200 transparents', input: grand, size: 600 },
    { name: '2 pages, 1 transparent', input: petit, size: 3 },
  ],
  calcul: ({ gpu, vis }) => vertexBytesOf(gpu, vis),
  attendu: ({ gpu, vis, blendState }) => referenceVertexBytes(gpu, vis, blendState),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'vertexBytesOf extremes',
  calcul: () =>
    vertexBytesOf(createWebgpuGpuState([1, 1]), {
      concatPos: undefined,
      concatUv: undefined,
      concatNrm: undefined,
    }),
  extremes: [{ name: 'empty', input: null }],
});

rapport('metriques-octets', [resOctets], 'G4 publishes exact same vertex bytes');
