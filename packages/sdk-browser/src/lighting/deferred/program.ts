import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { createDeferredLayouts } from './setup.ts';
import { SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts';
import { BOUNCE_SURFACE_BINDING } from '../../bounce/reflectWgsl.ts';
import type { ComposeInput } from './shaders.ts';
import { makeFullscreenPipeline } from './fullscreen.ts';

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
  /** One composition per input it reads the as-is share from (`AS_IS_READ`). */
  compose: Record<ComposeInput, string>;
  label: string;
  direct: boolean;
  bounce?: boolean;
}
/** What composition reads: a colour and its accumulated share, else the lit image's flags. */
export type ComposedImage = { color: GPUTextureView; share?: GPUTextureView };
/** What the temporal pass resolves: the colour, and each pixel's as-is share beside it. */
export type AccumulatedImage = Required<ComposedImage>;
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
  const lighting = await createCheckedShaderModule(
    device,
    sources.lighting,
    `${sources.label}_LIGHTING`,
  );
  const layouts = createDeferredLayouts(device, sources.direct, sources.bounce);
  const make = makeFullscreenPipeline,
    hdr = { format: 'rgba16float' as const },
    display = { format: 'rgba8unorm' as const };
  const light = await make(device, lighting, layouts.lighting, 'lightSurface', [hdr]);
  /** The composition of one input: into the capture target, or into it and the canvas at once. */
  const compile = async (input: ComposeInput) => {
    const label = `${sources.label}_COMPOSE_${input.toUpperCase()}`;
    const module = await createCheckedShaderModule(device, sources.compose[input], label);
    const layout = layouts.composition[input];
    return {
      layout,
      draw: await make(device, module, layout, 'compose', [display]),
      present: await make(device, module, layout, 'composePresent', [
        display,
        { format: 'bgra8unorm' },
      ]),
    };
  };
  const compositions = {
    still: await compile('still'),
    accumulated: await compile('accumulated'),
  };
  let boundSurface: SurfaceBuffer | undefined,
    boundTiles: GPUBuffer | undefined,
    boundAtlas: GPUTextureView | undefined,
    boundTransmittance: GPUTextureView | undefined,
    boundRequests: GPUBuffer | undefined,
    boundProbes: GPUBuffer | undefined,
    boundProxy: GPUBuffer | undefined,
    boundHdr: GPUTextureView | undefined,
    lightGroup: GPUBindGroup | undefined;
  // One per colour read (lit image, TAA history, effect target) and share beside it — an effect
  // target follows the alternating TAA histories —; weak: a dropped target frees its own.
  type Composition = (typeof compositions)['still'] & { group: GPUBindGroup };
  let composed = new WeakMap<GPUTextureView, WeakMap<GPUTextureView, Composition>>();
  return {
    light,
    get lightGroup() {
      return lightGroup;
    },
    /** The pipelines and group reading the lit image and its surface flags, or `image` and its
     *  as-is share; `undefined` before `bind`. */
    composition(image?: ComposedImage) {
      const view = image?.color ?? boundHdr;
      if (!view || !boundSurface) return undefined;
      const share = image?.share ?? boundSurface.views()[3];
      let byShare = composed.get(view);
      if (!byShare) composed.set(view, (byShare = new WeakMap()));
      let composition = byShare.get(share);
      if (!composition) {
        const kind = compositions[image?.share ? 'accumulated' : 'still'];
        const group = device.createBindGroup({
          layout: kind.layout,
          entries: [
            { binding: 0, resource: view },
            { binding: 1, resource: { buffer: bindings.uniform } },
            { binding: 2, resource: share },
          ],
        });
        byShare.set(share, (composition = { ...kind, group }));
      }
      return composition;
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
      if (boundHdr !== hdr || boundSurface !== surface) composed = new WeakMap();
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
      composed = new WeakMap();
    },
  };
}
