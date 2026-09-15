// G4 : les octets de sommets publiés par `metrics()`. Le compteur est tenu par les deux chemins qui
// allouent — le tampon de positions d'une page, et l'index, les UV et les normales d'un maillage
// transparent — et l'égalité se prouve contre la somme que l'ancien relevé refaisait par image.
import * as THREE from 'three';
import { createWebgpuGpuState } from '../webgpuPagesStateGpu.ts';
import { createWebgpuBlendState } from '../webgpuBlendState.ts';
import { ensureWebgpuPositionBuffer } from '../webgpuPositions.ts';
import { prepareWebgpuBlend } from '../webgpuBlendPrepare.ts';
import { vertexBytesOf } from '../webgpuPagesMetrics.ts';
import { compare, graine } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeG } from '../../sdk-core/bench/bancG.mjs';
import { referenceVertexBytes } from './oracles/g-octets.mjs';

// Les drapeaux d'usage WebGPU n'existent pas hors navigateur ; seules leurs valeurs comptent ici.
Object.assign(globalThis, {
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64, INDIRECT: 256 },
});

/** Un appareil de banc : il ne retient d'un tampon que sa taille, la seule chose que le relevé lit. */
const appareil = {
  limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 },
  createBuffer: ({ size }) => ({ size, destroy() {} }),
  queue: { writeBuffer() {} },
};

/** Une géométrie indexée de `sommets` sommets, avec UV, normales et tangentes. */
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

/** Un état GPU peuplé par les chemins de la bibliothèque : positions puis maillages transparents. */
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

const lignes = [
  await compare({
    calcul: 'G4 octets de sommets du relevé',
    fichier: 'packages/sdk-browser/webgpuPagesMetrics.ts',
    cas: [
      { nom: '4 000 pages, 200 transparents', entree: etat(4000, 200, true, 0x41), taille: 4200 },
      {
        nom: '4 000 pages sans transparent ni concaténé',
        entree: etat(4000, 0, false, 0x42),
        taille: 4000,
      },
      { nom: 'une page, un transparent', entree: etat(1, 1, true, 0x43), taille: 2 },
      { nom: 'aucun tampon', entree: etat(0, 0, false, 0x44), taille: 0 },
      {
        nom: 'aucun tampon, concaténés aux tailles limites',
        entree: etat(0, 0, true, 0x45),
        taille: 0,
      },
    ],
    reference: ({ gpu, vis, blendState }) => referenceVertexBytes(gpu, vis, blendState),
    optimisee: ({ gpu, vis }) => vertexBytesOf(gpu, vis),
    options: { tours: 200, budgetMs: 4000, alterne: true },
  }),
];

verifieEtDeposeG('g-octets', 'G4 publie exactement les mêmes octets de sommets', lignes);
