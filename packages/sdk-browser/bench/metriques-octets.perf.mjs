// Vertex bytes published by metrics().
import * as THREE from 'three';
import { createWebgpuGpuState } from '../webgpuPagesStateGpu.ts';
import { createWebgpuBlendState } from '../webgpuBlendState.ts';
import { ensureWebgpuPositionBuffer } from '../webgpuPositions.ts';
import { prepareWebgpuBlend } from '../webgpuBlendPrepare.ts';
import { vertexBytesOf } from '../webgpuPagesMetrics.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { referenceVertexBytes } from './oracles/metriques-octets.mjs';

Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64, INDIRECT: 256 },
});

const appareil = {
  limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 },
  createBuffer: ({ size }) => ({ size, destroy() {} }),
  queue: { writeBuffer() {} },
};

function geometrie(sommets, alea) {
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

function etat(pages, transparents, concats, depart) {
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
    const mesh = new THREE.Mesh(
      geometrie(6 + (i % 23), alea),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }),
    );
    mesh.updateMatrix();
    scene.add(mesh);
    copies.push(mesh);
  }
  prepareWebgpuBlend(appareil, copies, gpu, blendState, scene, false);
  const vis = concats
    ? { concatPos: { size: 0 }, concatUv: { size: 2 ** 31 }, concatNrm: { size: 4096 } }
    : { concatPos: undefined, concatUv: undefined, concatNrm: undefined };
  return { gpu, vis, blendState };
}

const grand = etat(400, 200, true, 0x41);
const petit = etat(2, 1, true, 0x43);

const resOctets = await mesure({
  name: 'vertex bytes of report',
  fichier: 'packages/sdk-browser/webgpuPagesMetrics.ts',
  cas: [
    { name: '400 pages, 200 transparents', input: grand, size: 600 },
    { name: '2 pages, 1 transparent', input: petit, size: 3 },
  ],
  calcul: ({ gpu, vis, blendState }) => vertexBytesOf(gpu, vis, blendState),
  attendu: ({ gpu, vis, blendState }) => referenceVertexBytes(gpu, vis, blendState),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'vertexBytesOf extremes',
  calcul: () => vertexBytesOf(createWebgpuGpuState([1, 1]), {}, createWebgpuBlendState()),
  extremes: [{ name: 'empty', input: null }],
});

rapport('metriques-octets', [resOctets], 'G4 publishes exact same vertex bytes');
