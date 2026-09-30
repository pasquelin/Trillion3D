import { SUBSURFACE_BINDING } from '../../scene/subsurface.ts';
import { SHADING_OFFSET_BINDING } from '../../visibility/shader/shadingPoint.ts';
import { reflectionPipelines } from '../../reflections/pipelines.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { createDeferredLightingLayout } from './setup.ts';
import { SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts';
import { withSubgroupShadowRequests } from '../direct/shadowRequestWgsl.ts';
import { BOUNCE_SURFACE_BINDING } from '../../bounce/reflectWgsl.ts';
import type { ComposeInput } from './shaders.ts';
import { makeFullscreenPipeline } from './fullscreen.ts';
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts';
import { createCompositions, type CompositionSources } from './compositions.ts';
import type { FusedBlend } from '../../effects/webgpuEffects.ts';

/** Direct-lighting contract resources the pass rereads; when absent, they are replaced. */
export interface DirectLightResources {
  /** The declared lights, grown with the scene: the one buffer a contract program reads them from. */
  lights?: GPUBuffer;
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
  /** True when the narrow tile pass wrote the lists (`contractVariants.ts`, #849). */
  narrow?: boolean;
  unshadowed?: boolean; // no light holds a shadow slot: no shadow code (#1249)
}
export interface DeferredSources {
  lighting: string;
  compose: CompositionSources;
  label: string;
  direct: boolean;
  bounce?: boolean;
  /** Pages per side of a sun's clipmap the shadow shader was built with (`shadowRequestWgsl.ts`). */
  pages?: number;
}
/** What composition reads: a colour and its accumulated share, else the lit image's flags, and
 *  the chain's last blend when it left it to the composition (#963). */
export type ComposedImage = { color: GPUTextureView; share?: GPUTextureView; bloom?: FusedBlend };
/** What the temporal pass resolves: the colour, its pixels' as-is share, the filtering layers. */
export type AccumulatedImage = Required<Omit<ComposedImage, 'bloom'>> & {
  filter?: readonly [GPUTextureView, GPUTextureView];
};
export interface DeferredBindings {
  uniform: GPUBuffer;
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

/** A deferred-pass program: its modules, pipelines, and the bind groups it keeps while its
 *  resources do not change. The engine holds the unlit view, compiling the contract one lazily. */
export async function createDeferredProgram(
  device: GPUDevice,
  sources: DeferredSources,
  bindings: DeferredBindings,
) {
  // Granted `subgroups`, a contract program, its reflection passes too, asks for its shadow pages
  // per subgroup (#966).
  const perSubgroup = sources.direct && device.features.has('subgroups');
  const text = perSubgroup
    ? withSubgroupShadowRequests(sources.lighting, sources.pages)
    : sources.lighting;
  const lighting = await createCheckedShaderModule(
    device,
    text,
    `${sources.label}${perSubgroup ? '_SUBGROUP' : ''}_LIGHTING`,
  );
  const lightingLayout = createDeferredLightingLayout(device, sources.direct, sources.bounce);
  const light = await makeFullscreenPipeline(device, lighting, lightingLayout, 'lightSurface', [
    { format: 'rgba16float' },
  ]);
  const reflection = sources.direct
    ? await reflectionPipelines(device, text, lightingLayout)
    : undefined;
  const compositions = await createCompositions(device, sources.compose, sources.label);
  /** What the light group names: rebuilt when one of them is replaced (`bindIdentity.ts`). */
  let identity = createWebgpuBindIdentity(),
    boundSurface: SurfaceBuffer | undefined,
    boundHdr: GPUTextureView | undefined,
    /** The bound surface's flags: the share the lit image is composed with. */
    boundFlags: GPUTextureView | undefined,
    lightGroup: GPUBindGroup | undefined;
  // One per colour and share read, weakly keyed by every view it reads: nothing to reset.
  type Composition = { group: GPUBindGroup; input: ComposeInput };
  let composed = new WeakMap<GPUTextureView, WeakMap<GPUTextureView, Composition>>();
  return {
    light,
    reflection,
    get lightGroup() {
      return lightGroup;
    },
    compositions,
    /** The group reading the lit image and its surface flags, or `image` and its as-is share,
     *  and the input its pipelines compose (`compositions`); `undefined` before `bind`. A frame
     *  that reads no as-is share (`asIs` false, OMB-11) binds the colour alone. */
    composition(image?: ComposedImage, asIs = true) {
      const view = image?.color ?? boundHdr,
        // The flagless group is kept under its colour: no share view is ever a colour one.
        share = asIs ? (image?.share ?? boundFlags) : view;
      if (!view || !share || !boundSurface) return undefined;
      let byShare = composed.get(view);
      if (!byShare) composed.set(view, (byShare = new WeakMap()));
      const kept = byShare.get(share);
      if (kept) return kept;
      // A colour without its own share (the effect chain's, no TAA) reads the lit image's flags.
      const input = !asIs ? 'flagless' : image?.share ? 'accumulated' : 'still';
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: bindings.uniform } },
      ];
      if (asIs) entries.push({ binding: 2, resource: share });
      const group = device.createBindGroup({ layout: compositions.layouts[input], entries });
      const composition = { group, input } as const;
      byShare.set(share, composition);
      return composition;
    },
    bind(
      surface: SurfaceBuffer,
      depth: GPUTextureView,
      hdr: GPUTextureView,
      direct: DirectLightResources,
    ) {
      const { placeholders } = bindings;
      const lights = direct.lights,
        tiles = direct.tiles ?? placeholders.tiles,
        slices = direct.slices ?? placeholders.slices,
        atlas = direct.atlas ?? placeholders.atlasView,
        transmittance = direct.transmittance?.view ?? placeholders.transmittanceView,
        translucentDepth = direct.transmittance?.depthView ?? placeholders.atlasView,
        requests = direct.requests ?? placeholders.requests,
        probes = direct.probes,
        proxy = direct.proxy ?? placeholders.proxy;
      boundHdr = hdr;
      const { next } = identity;
      next[0] = surface;
      next[1] = lights;
      next[2] = tiles;
      next[3] = atlas;
      next[4] = transmittance;
      next[5] = requests;
      next[6] = probes;
      next[7] = proxy;
      if (!identity.moved()) return;
      boundSurface = surface;
      boundFlags = surface.views()[3];
      const entries: GPUBindGroupEntry[] = [
        ...surface.views().map((resource, binding) => ({ binding, resource })),
        { binding: 4, resource: depth },
        { binding: 5, resource: { buffer: bindings.uniform } },
      ];
      if (sources.direct) {
        if (!lights) throw new Error('the contract program binds no declared-light buffer');
        entries.push(
          { binding: SHADING_OFFSET_BINDING, resource: { buffer: surface.shadingOffset } },
          { binding: SUBSURFACE_BINDING, resource: surface.subsurfaceView },
          { binding: 6, resource: { buffer: lights } },
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
      }
      if (sources.bounce && direct.bounceGrid && direct.probes && direct.surfaceCache)
        entries.push(
          { binding: 11, resource: { buffer: direct.bounceGrid } },
          { binding: 12, resource: { buffer: direct.probes } },
          { binding: BOUNCE_SURFACE_BINDING, resource: { buffer: direct.surfaceCache } },
        );
      lightGroup = device.createBindGroup({ layout: lightingLayout, entries });
    },
    release() {
      identity = createWebgpuBindIdentity();
      boundSurface = boundHdr = boundFlags = lightGroup = undefined;
      composed = new WeakMap();
    },
  };
}
