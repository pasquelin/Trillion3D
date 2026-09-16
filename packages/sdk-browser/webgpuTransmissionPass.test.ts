import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareWebgpuBlend } from './webgpuBlendPrepare.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { copyBackdrop, writeVolumeUniforms, VOLUME_STRIDE } from './webgpuTransmission.ts';
import { FLAG_TRANSMISSIVE } from './visibilityBuffer.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

installGpuGlobals();
const buffer = () => ({ size: 0 }) as unknown as GPUBuffer;
const device = {
  createBuffer: () => buffer(),
  queue: { writeBuffer: () => {} },
} as unknown as GPUDevice;

/** Un triangle par maillage : seule la classe de matériau distingue les trois copies. */
function copy(material: THREE.Material, order: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 0, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  return mesh;
}

function eau(transmission: number) {
  return Object.assign(
    new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.6, side: THREE.FrontSide }),
    {
      transmission,
      ior: 1.33,
      thickness: 2.5,
      attenuationDistance: 6,
      attenuationColor: new THREE.Color(0.35, 0.72, 0.68),
    },
  );
}

function prepared() {
  const blendState = createWebgpuBlendState();
  const gpu = {
    positionBuffers: new Map(),
    blendIndexBuffers: new Map(),
    blendUvBuffers: new Map(),
    blendNormalBuffers: new Map(),
    vertexBytes: 0,
    volumeBuffer: buffer(),
  } as unknown as WebgpuGpuState;
  const copies = [
    copy(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 }), 0),
    copy(eau(1), 1),
    copy(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 }), 2),
  ];
  blendState.transmissive = prepareWebgpuBlend(device, copies, gpu, blendState, new THREE.Scene());
  blendState.visibleBlend.push(...blendState.blendGpu);
  blendState.volumePacked = new Float32Array(blendState.blendGpu.length * (VOLUME_STRIDE / 4));
  return { blendState, gpu };
}

test('une surface transmissive est préparée comme les autres mélanges, et marquée', () => {
  const { blendState } = prepared();
  assert.equal(blendState.transmissive, 1, 'une seule des trois copies transmet');
  assert.equal(blendState.blendGpu.length, 3, 'aucune copie n’est laissée de côté');
  assert.deepEqual(
    blendState.blendGpu.map((item) => (item.flags & FLAG_TRANSMISSIVE) !== 0),
    [false, true, false],
  );
  assert.deepEqual(
    blendState.blendGpu.map((item) => !!item.transmissive),
    [false, true, false],
  );
});

test('le volume glTF du matériau arrive au nuanceur, entrée par entrée', () => {
  const { blendState, gpu } = prepared();
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime;
  writeVolumeUniforms(rt, device);
  const stride = VOLUME_STRIDE / 4,
    volume = blendState.volumePacked.subarray(stride, stride + 8);
  const arrondi = (value: number) => Math.round(value * 100) / 100;
  assert.deepEqual(Array.from(volume.subarray(0, 4)).map(arrondi), [1, 1.33, 2.5, 6]);
  assert.deepEqual(Array.from(volume.subarray(4, 7)).map(arrondi), [0.35, 0.72, 0.68]);
  // Un mélange sans transmission remplit quand même son entrée : le nuanceur ne la lit pas, et sa
  // valeur ne dépend jamais du voisin.
  assert.equal(blendState.volumePacked[0], 0);
});

/** Rejoue les deux passes et rend, pour chacune, les rangs des items qu'elle a dessinés. */
function passes(blendState: ReturnType<typeof prepared>['blendState'], gpu: WebgpuGpuState) {
  const drawn: number[][] = [];
  let current: number[] = [];
  const items = blendState.visibleBlend;
  for (const item of items) item.group = {} as GPUBindGroup;
  const pass = {
    setViewport() {},
    setBindGroup(_slot: number, group: GPUBindGroup) {
      current.push(items.findIndex((item) => item.group === group));
    },
    setPipeline() {},
    draw() {},
    drawIndirect() {},
    end() {},
  };
  const encoder = {
    beginRenderPass: () => {
      current = [];
      drawn.push(current);
      return pass;
    },
    copyTextureToTexture: () => {},
  } as unknown as GPUCommandEncoder;
  const rt = {
    vis: {
      visEnabled: true,
      pipelineBlendFront: {},
      pipelineBlendBack: {},
      pipelineBlendTextured: {},
    },
    gpu,
    lights: { buffer: {}, shadows: undefined, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // Vue `lit` sans lampe : le contrat éclaire, donc la passe lie ses ressources par défaut.
    sunFar: { gpu: undefined },
    blendState,
    run: {
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendUnpagedTriangles: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
    },
  } as unknown as WebgpuPagesRuntime;
  // Les groupes sont déjà bâtis sur ces ressources d'éclairage : la passe n'a donc pas à les
  // refaire, et ce test observe l'ordre de dessin, pas la construction des groupes.
  const { placeholders } = gpu.deferred!;
  blendState.lighting = {
    directLights: rt.lights.buffer!,
    shadowSlices: placeholders.slices,
    shadowAtlas: placeholders.atlasView,
    shadowSampler: placeholders.sampler,
    bounceGrid: placeholders.bounceGrid,
    probes: placeholders.probes,
  };
  drawBlendPass(rt, device, encoder, 0, true);
  assert.equal(copyBackdrop(rt, encoder), true, 'le fond est figé entre les deux passes');
  drawBlendPass(rt, device, encoder, 0, true, true);
  return drawn;
}

test('la transmission est une passe à part, après les mélanges, dans l’ordre source', () => {
  const { blendState, gpu } = prepared();
  Object.assign(gpu, {
    hdrView: {},
    colorView: {},
    depthView: {},
    targetSize: [8, 8],
    hdrTexture: {},
    depthTexture: {},
    backdrop: { color: {}, depth: {}, colorView: {}, depthView: {}, active: true },
    deferred: {
      placeholders: { slices: {}, atlasView: {}, sampler: {}, bounceGrid: {}, probes: {} },
    },
  });
  const drawn = passes(blendState, gpu);
  assert.deepEqual(drawn, [[0, 2], [1]], 'les mélanges d’abord, la transmission ensuite');
});

test('sans copie du fond, la passe de transmission n’est pas encodée', () => {
  const { blendState, gpu } = prepared();
  Object.assign(gpu, { targetSize: [8, 8], backdrop: undefined });
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime;
  assert.equal(copyBackdrop(rt, {} as GPUCommandEncoder), false);
});
