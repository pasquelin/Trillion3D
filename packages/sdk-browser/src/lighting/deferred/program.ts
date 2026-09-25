import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { createDeferredLayouts } from './setup.ts';
import { SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts';
import { BOUNCE_SURFACE_BINDING } from '../../bounce/reflectWgsl.ts';

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
  /** Probe grid, coefficients, mirror surface cache: one lifetime, the probes' identity. */
  bounceGrid?: GPUBuffer;
  probes?: GPUBuffer;
  surfaceCache?: GPUBuffer;
  /** Resident proxy with the far-shadow settings and counters; absent, a zero substitute. */
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
 * A deferred-pass program: its two modules, its three pipelines, and the bind groups it keeps as
 * long as its resources do not change. The engine holds two, the unlit view and the contract
 * one, and compiles the second only when a light asks for it.
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
  // One composition group per source read: the lit image or a TAA history, three at most.
  const composeGroups = new Map<GPUTextureView, GPUBindGroup>();
  return {
    light,
    compose,
    composePresent,
    get lightGroup() {
      return lightGroup;
    },
    /** The group reading `source` (the lit image by default) and the surface flags, once bound. */
    composeGroup(source?: GPUTextureView) {
      const view = source ?? boundHdr;
      if (!view || !boundSurface) return undefined;
      let group = composeGroups.get(view);
      if (!group) {
        group = device.createBindGroup({
          layout: layouts.composition,
          entries: [
            { binding: 0, resource: view },
            { binding: 1, resource: { buffer: bindings.uniform } },
            { binding: 2, resource: boundSurface.views()[3] },
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
      if (boundHdr !== hdr || boundSurface !== surface) composeGroups.clear();
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
          // The resident proxy as-is, no copy: its header says whether there is anything to trace.
          { binding: SUN_FAR_PROXY_BINDING, resource: { buffer: proxy } },
          { binding: CONTRACT_SHADOW_BINDINGS.requests, resource: { buffer: requests } },
          { binding: CONTRACT_SHADOW_BINDINGS.transmittance, resource: transmittance },
          { binding: CONTRACT_SHADOW_BINDINGS.translucentDepth, resource: translucentDepth },
        );
      if (sources.bounce && direct.bounceGrid && direct.probes && direct.surfaceCache)
        entries.push(
          { binding: 11, resource: { buffer: direct.bounceGrid } },
          { binding: 12, resource: { buffer: direct.probes } },
          { binding: BOUNCE_SURFACE_BINDING, resource: { buffer: direct.surfaceCache } },
        );
      lightGroup = device.createBindGroup({ layout: layouts.lighting, entries });
    },
    release() {
      boundSurface = boundTiles = boundAtlas = boundTransmittance = undefined;
      boundRequests = boundProbes = boundProxy = boundHdr = lightGroup = undefined;
      composeGroups.clear();
    },
  };
}
