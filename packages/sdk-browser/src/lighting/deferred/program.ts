import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { createDeferredLayouts } from './setup.ts';
import { SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts';

/** Builds a render pipeline, asynchronously when the device offers it. */
export const buildRenderPipeline = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  device.createRenderPipelineAsync
    ? device.createRenderPipelineAsync(descriptor)
    : Promise.resolve(device.createRenderPipeline(descriptor));

/** A fullscreen-triangle pipeline on one bind group layout, at the colour targets given. */
export function makeFullscreenPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  bind: GPUBindGroupLayout,
  entryPoint: string,
  targets: GPUColorTargetState[],
) {
  return buildRenderPipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [bind] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint, targets },
    primitive: { topology: 'triangle-list' },
  });
}

/** Direct-lighting contract resources the pass rereads; when absent, they are replaced. */
export interface DirectLightResources {
  tiles?: GPUBuffer;
  /** Shadow records and page table, and the buffer the resolve records its shadow reads in. */
  slices?: GPUBuffer;
  requests?: GPUBuffer;
  atlas?: GPUTextureView;
  transmittance?: { view: GPUTextureView; depthView: GPUTextureView };
  /** Probe grid and their coefficients; when absent, bounce is not of this frame. */
  bounceGrid?: GPUBuffer;
  probes?: GPUBuffer;
  /** Resident proxy, distant-shadow settings and counters included; when absent, the
   *  zero substitute leaves the distant surface lit with no cast shadow. */
  proxy?: GPUBuffer;
}
export interface DeferredSources {
  lighting: string;
  compose: string;
  label: string;
  direct: boolean;
  bounce?: boolean;
}
export interface DeferredBindings {
  uniform: GPUBuffer;
  directLights: GPUBuffer;
  placeholders: {
    tiles: GPUBuffer;
    slices: GPUBuffer;
    requests: GPUBuffer;
    atlasView: GPUTextureView;
    transmittanceView: GPUTextureView;
    sampler: GPUSampler;
    proxy: GPUBuffer;
  };
}

export type DeferredProgram = Awaited<ReturnType<typeof createDeferredProgram>>;

/**
 * A deferred-pass program: its two modules, its three pipelines, and the bind groups it
 * keeps as long as its resources do not change. The engine holds two — the unlit view and
 * the contract one — and compiles the second only when a light asks for it.
 */
export async function createDeferredProgram(
  device: GPUDevice,
  sources: DeferredSources,
  bindings: DeferredBindings,
) {
  const modules = [
    await createCheckedShaderModule(device, sources.lighting, `${sources.label}_LIGHTING`),
    await createCheckedShaderModule(device, sources.compose, `${sources.label}_COMPOSE`),
  ];
  const layouts = createDeferredLayouts(device, sources.direct, sources.bounce);
  const make = makeFullscreenPipeline,
    hdr = { format: 'rgba16float' as const },
    display = { format: 'rgba8unorm' as const };
  const light = await make(device, modules[0], layouts.lighting, 'lightSurface', [hdr]);
  const compose = await make(device, modules[1], layouts.composition, 'compose', [display]);
  const composePresent = await make(device, modules[1], layouts.composition, 'composePresent', [
    display,
    { format: 'bgra8unorm' },
  ]);
  let boundSurface: SurfaceBuffer | undefined,
    boundTiles: GPUBuffer | undefined,
    boundAtlas: GPUTextureView | undefined,
    boundTransmittance: GPUTextureView | undefined,
    boundRequests: GPUBuffer | undefined,
    boundProbes: GPUBuffer | undefined,
    boundProxy: GPUBuffer | undefined,
    boundHdr: GPUTextureView | undefined,
    lightGroup: GPUBindGroup | undefined;
  /** One composition group per source read: the lit image, or one of the two temporal-
   *  antialiasing history targets. Three at most, held as long as the uniform lives. */
  const composeGroups = new Map<GPUTextureView, GPUBindGroup>();
  return {
    light,
    compose,
    composePresent,
    get lightGroup() {
      return lightGroup;
    },
    /** The group that reads `source`, the lit image bound by default. `undefined` before `bind`. */
    composeGroup(source?: GPUTextureView) {
      const view = source ?? boundHdr;
      if (!view) return undefined;
      let group = composeGroups.get(view);
      if (!group) {
        group = device.createBindGroup({
          layout: layouts.composition,
          entries: [
            { binding: 0, resource: view },
            { binding: 1, resource: { buffer: bindings.uniform } },
          ],
        });
        composeGroups.set(view, group);
      }
      return group;
    },
    bind(
      surface: SurfaceBuffer,
      depth: GPUTextureView,
      hdr: GPUTextureView,
      direct: DirectLightResources,
    ) {
      const { placeholders } = bindings;
      const tiles = direct.tiles ?? placeholders.tiles,
        slices = direct.slices ?? placeholders.slices,
        atlas = direct.atlas ?? placeholders.atlasView,
        transmittance = direct.transmittance?.view ?? placeholders.transmittanceView,
        translucentDepth = direct.transmittance?.depthView ?? placeholders.atlasView,
        requests = direct.requests ?? placeholders.requests,
        probes = direct.probes,
        proxy = direct.proxy ?? placeholders.proxy;
      if (boundHdr !== hdr) composeGroups.clear();
      boundHdr = hdr;
      if (
        boundSurface === surface &&
        boundTiles === tiles &&
        boundAtlas === atlas &&
        boundTransmittance === transmittance &&
        boundRequests === requests &&
        boundProbes === probes &&
        boundProxy === proxy
      )
        return;
      boundSurface = surface;
      boundTiles = tiles;
      boundAtlas = atlas;
      boundTransmittance = transmittance;
      boundRequests = requests;
      boundProbes = probes;
      boundProxy = proxy;
      const entries: GPUBindGroupEntry[] = [
        ...surface.views().map((resource, binding) => ({ binding, resource })),
        { binding: 4, resource: depth },
        { binding: 5, resource: { buffer: bindings.uniform } },
      ];
      if (sources.direct)
        entries.push(
          { binding: 6, resource: { buffer: bindings.directLights } },
          { binding: 7, resource: { buffer: tiles } },
          { binding: 8, resource: { buffer: slices } },
          { binding: 9, resource: atlas },
          { binding: 10, resource: placeholders.sampler },
          // The resident proxy, as-is: the sun's distant shadow traverses it without keeping
          // a second copy, and its header says whether there is something to traverse.
          { binding: SUN_FAR_PROXY_BINDING, resource: { buffer: proxy } },
          { binding: CONTRACT_SHADOW_BINDINGS.requests, resource: { buffer: requests } },
          { binding: CONTRACT_SHADOW_BINDINGS.transmittance, resource: transmittance },
          { binding: CONTRACT_SHADOW_BINDINGS.translucentDepth, resource: translucentDepth },
        );
      if (sources.bounce && direct.bounceGrid && direct.probes)
        entries.push(
          { binding: 11, resource: { buffer: direct.bounceGrid } },
          { binding: 12, resource: { buffer: direct.probes } },
        );
      lightGroup = device.createBindGroup({ layout: layouts.lighting, entries });
    },
    release() {
      boundSurface = undefined;
      boundTiles = undefined;
      boundAtlas = undefined;
      boundTransmittance = undefined;
      boundRequests = undefined;
      boundProbes = undefined;
      boundProxy = undefined;
      boundHdr = undefined;
      lightGroup = undefined;
      composeGroups.clear();
    },
  };
}
