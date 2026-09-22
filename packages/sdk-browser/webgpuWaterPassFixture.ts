import * as THREE from 'three';
import { surfaceOf } from './pageSurface.ts';
import { prepareWebgpuBlend } from './webgpuBlendPrepare.ts';
import { voidStaleBlendGroups } from './webgpuBlendIdentity.ts';
import { blendLightResources } from './webgpuBlendLighting.ts';
import { createWebgpuBlendState } from './webgpuBlendState.ts';
import { VOLUME_WORDS } from './webgpuTransmission.ts';
import { buildBlendStatics, refreshBlendPlan } from './webgpuBlendPlan.ts';
import { orderBlendPasses } from './webgpuBlendOrder.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** What the water-pass tests share: a scene of three transparent copies, one of which transmits,
 *  prepared and planned as `prepareBlendResources` does, and the frame targets of a replay. */
installGpuGlobals();
const buffer = () => ({ size: 0 }) as unknown as GPUBuffer;

/** A device that builds every pipeline, layout and group as a plain record, and counts the
 *  pipelines by fragment entry and the bind groups. */
export function mountDevice() {
  const pipelines: string[] = [],
    groups = { created: 0 };
  return {
    pipelines,
    groups,
    device: {
      createBuffer: () => buffer(),
      createBindGroupLayout: (descriptor: unknown) => descriptor,
      createPipelineLayout: () => ({}),
      createRenderPipeline: (descriptor: { fragment: { entryPoint: string } }) => {
        pipelines.push(descriptor.fragment.entryPoint);
        return {};
      },
      createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
      createBindGroup: () => {
        groups.created++;
        return {};
      },
      queue: { writeBuffer: () => {} },
    } as unknown as GPUDevice,
  };
}
export const device = mountDevice().device;

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
  return Object.assign(mesh, { surface: surfaceOf(material) });
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

export function prepared() {
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
  blendState.volumePacked = new Float32Array(blendState.transmissive * VOLUME_WORDS);
  blendState.argsBuffer = buffer();
  blendState.viewBuffer = buffer();
  return { blendState, gpu };
}

/** Frame targets of the replay: the HDR image, the opaque depth and surfaces, the backdrop. */
export function targets(gpu: WebgpuGpuState) {
  const placeholder = () => ({});
  Object.assign(gpu, {
    hdrView: {},
    colorView: {},
    depthView: {},
    targetSize: [8, 8],
    hdrTexture: {},
    depthTexture: {},
    feedbackView: {},
    surfaces: { views: () => [{}, {}, {}, {}] },
    backdrop: { color: {}, colorView: {}, waterDepth: {}, waterDepthView: {}, active: true },
    deferred: {
      uniform: {},
      placeholders: Object.fromEntries(
        ['slices', 'atlasView', 'sampler', 'bounceGrid', 'probes', 'tiles', 'proxy'].map((k) => [
          k,
          placeholder(),
        ]),
      ),
    },
  });
}

/**
 * A frame to replay the transparent passes into: a runtime whose bind groups are already built
 * on the placeholders — the tests observe draw order, not group construction —, and a recording
 * encoder that keeps each pass's label and the items it set, and counts the texture copies.
 */
export function replay(blendState: ReturnType<typeof prepared>['blendState'], gpu: WebgpuGpuState) {
  const passes: { label: string; drawn: number[] }[] = [];
  const items = blendState.blendGpu;
  const counters = { copies: 0 };
  const encoder = {
    beginRenderPass: ({ label }: { label: string }) => {
      const drawn: number[] = [];
      passes.push({ label, drawn });
      return {
        setViewport() {},
        setBindGroup(_slot: number, group: GPUBindGroup) {
          const rank = items.findIndex((item) => item.group === group);
          if (rank >= 0) drawn.push(rank);
        },
        setPipeline() {},
        draw() {},
        drawIndirect() {},
        end() {},
      };
    },
    copyTextureToTexture: () => counters.copies++,
  } as unknown as GPUCommandEncoder;
  const rt = {
    vis: { visEnabled: true, blendPipelines: [{}, {}, {}] },
    gpu,
    capture: { capturing: false },
    lights: { buffer: {}, shadows: undefined, store: { count: 0, unlit: false } },
    bounce: { probes: undefined },
    // `lit` view with no light: the contract lights, so the pass binds its resources by default.
    sunFar: { gpu: undefined },
    blendState,
    run: {
      diagnostic: 'beauty',
      gpuDrawCalls: 0,
      blendDrawCalls: 0,
      blendUnpagedTriangles: 0,
      blendPagedTriangles: 0,
      blendSubmittedTriangles: 0,
      feedbackWritten: true,
    },
  } as unknown as WebgpuPagesRuntime;
  // Groups are already built on these resources: their identity is primed on them, so the pass
  // need not rebuild them — this test observes draw order, not group construction. The lighting
  // is resolved once, as `encodeBlend` does before any pass.
  blendState.lighting = blendLightResources(rt);
  voidStaleBlendGroups(rt, blendState.lighting);
  for (const item of items) item.group = {} as GPUBindGroup;
  // No paged item here, and the shared group is posted ahead for the same reason.
  blendState.pagedGroup = {} as GPUBindGroup;
  return { rt, encoder, passes, counters };
}
