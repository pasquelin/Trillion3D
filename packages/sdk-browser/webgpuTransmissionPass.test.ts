import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareWebgpuBlend } from './webgpuBlendPrepare.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { copyBackdrop, writeVolumeRecords, VOLUME_STRIDE } from './webgpuTransmission.ts';
import { buildBlendStatics, refreshBlendPlan } from './webgpuBlendPlan.ts';
import { orderBlendPasses } from './webgpuBlendOrder.ts';
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

/** One triangle per mesh: only the material class distinguishes the three copies. */
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
  // The scene's transparent list IS the draw list: static tables and the encode plan are built with
  // it, as `prepareBlendResources` does.
  buildBlendStatics(blendState);
  refreshBlendPlan(blendState);
  // The image sort posts the keys, the frustum verdict and the slices the pass encodes.
  // The three copies are at the same place: their keys are equal, and source order splits them.
  orderBlendPasses(blendState, [0, 0, 0]);
  blendState.visibleBlend.push(...blendState.blendGpu);
  blendState.volumePacked = new Float32Array(blendState.blendGpu.length * (VOLUME_STRIDE / 4));
  return { blendState, gpu };
}

test('a transmissive surface is prepared like the other blends, and marked', () => {
  const { blendState } = prepared();
  assert.equal(blendState.transmissive, 1, 'only one of the three copies transmits');
  assert.equal(blendState.blendGpu.length, 3, 'no copy is left aside');
  assert.deepEqual(
    blendState.blendGpu.map((item) => (item.flags & FLAG_TRANSMISSIVE) !== 0),
    [false, true, false],
  );
  assert.deepEqual(
    blendState.blendGpu.map((item) => !!item.transmissive),
    [false, true, false],
  );
});

test("the material's glTF volume reaches the shader, entry by entry", () => {
  const { blendState, gpu } = prepared();
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime;
  writeVolumeRecords(rt, device);
  const stride = VOLUME_STRIDE / 4,
    volume = blendState.volumePacked.subarray(stride, stride + 8);
  const arrondi = (value: number) => Math.round(value * 100) / 100;
  assert.deepEqual(Array.from(volume.subarray(0, 4)).map(arrondi), [1, 1.33, 2.5, 6]);
  assert.deepEqual(Array.from(volume.subarray(4, 7)).map(arrondi), [0.35, 0.72, 0.68]);
  // A blend without transmission still fills its entry: the shader does not read it, and its value
  // never depends on the neighbour.
  assert.equal(blendState.volumePacked[0], 0);
});

/** Replays the two passes and returns, for each, the ranks of the items it drew. */
function passes(blendState: ReturnType<typeof prepared>['blendState'], gpu: WebgpuGpuState) {
  const drawn: number[][] = [];
  let current: number[] = [];
  const items = blendState.blendGpu;
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
  // Indirect arguments are written by the GPU: the pass only rereads them.
  blendState.argsBuffer = buffer();
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
    // `lit` view with no light: the contract lights, so the pass binds its resources by default.
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
  // Groups are already built on these lighting resources: the pass therefore need not rebuild them,
  // and this test observes draw order, not group construction.
  const { placeholders } = gpu.deferred!;
  blendState.lighting = {
    directLights: rt.lights.buffer!,
    shadowSlices: placeholders.slices,
    shadowAtlas: placeholders.atlasView,
    shadowSampler: placeholders.sampler,
    bounceGrid: placeholders.bounceGrid,
    probes: placeholders.probes,
  };
  // No paged item here, and the shared group is posted ahead for the same reason.
  blendState.pagedGroup = {} as GPUBindGroup;
  drawBlendPass(rt, device, encoder);
  assert.equal(copyBackdrop(rt, encoder), true, 'the backdrop is frozen between the two passes');
  drawBlendPass(rt, device, encoder, true);
  return drawn;
}

test('transmission is a separate pass, after blends, in source order', () => {
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
  assert.deepEqual(drawn, [[0, 2], [1]], 'blends first, transmission after');
});

test('with no backdrop copy, the transmission pass is not encoded', () => {
  const { blendState, gpu } = prepared();
  Object.assign(gpu, { targetSize: [8, 8], backdrop: undefined });
  const rt = { gpu, blendState } as unknown as WebgpuPagesRuntime;
  assert.equal(copyBackdrop(rt, {} as GPUCommandEncoder), false);
});
