import { SUBSURFACE_BINDING } from '../../scene/subsurface.ts';
import { LIGHTING_RECEIVER_BINDING } from './surfaceWgsl.ts';
import { receiverEntries, type ReceiverResources } from '../../webgpu/visibility/receiver.ts';
import { reflectionPipelines } from '../../reflections/pipelines.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { createDeferredLightingLayout, type DeferredPlaceholders } from './setup.ts';
import { RESIDENT_PROXY_BINDING } from '../../bounce/nodeWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../direct/lightingWgsl.ts';
import { CONTRACT_VSM_BINDINGS } from '../direct/shadowWgsl.ts';
import { VSM_TRANSMISSION_RESOLVE_BINDING } from '../../vsm/transmissionWgsl.ts';
import { VSM_MASK_TABLE_BINDING, VSM_MASK_TILES_BINDING } from '../../vsm/projectionMaskTable.ts';
import { BOUNCE_SURFACE_BINDING } from '../../bounce/reflectWgsl.ts';
import type { ComposeInput } from './shaders.ts';
import { makeFullscreenPipeline } from './fullscreen.ts';
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts';
import { createCompositions, type CompositionSources } from './compositions.ts';
import { type FusedBlend } from '../../effects/webgpuKinds.ts';

/** Direct-lighting contract resources the pass rereads; when absent, they are replaced. */
export interface DirectLightResources {
  /** The declared lights, grown with the scene: the one buffer a contract program reads them from. */
  lights?: GPUBuffer;
  tiles?: GPUBuffer;
  /** The virtual shadow maps a non-mask read samples (`CONTRACT_VSM_BINDINGS`): this frame's
   *  page table, projection data and uniforms, and the pool's dynamic slice. */
  vsm?: { pageTable: GPUBuffer; projectionData: GPUBuffer; uniforms: GPUBuffer; pool: GPUBuffer };
  /** The virtual shadow maps' traced mask array (`vsmEncode.ts`), one 8-bit lane per shadowed
   *  light: bound on the transmittance's number. */
  vsmMask?: GPUTextureView;
  /** The mask's tile words (`vsmMaskFactor`): the layers its projection stored in each 8×8 tile. */
  vsmMaskTiles?: GPUTextureView;
  /** The translucent casters' transmission atlas (`../../vsm/transmissionPass.ts`), or none. */
  vsmTransmission?: GPUTextureView;
  /** Probe grid, coefficients, mirror surface cache — the two atlases of `atlas.ts`: one
   *  lifetime, the probes' identity. */
  bounceGrid?: GPUBuffer;
  probes?: GPUTextureView;
  surfaceCache?: GPUTextureView;
  /** Resident proxy; absent, a zero substitute. */
  proxy?: GPUBuffer;
  narrow?: boolean; // the narrow tile pass wrote the lists (`contractVariants.ts`, #849)
  unshadowed?: boolean; // no light declares a shadow, or no shadow raster: no shadow code (#1249)
  rectless?: boolean; // no light is a rectangle: no rectangle code (#1369)
  sunless?: boolean; // no shadowed light is a sun: no clipmap read (`ShadowKinds`)
  localless?: boolean; // no shadowed light is a point or a spot: no local read (`ShadowKinds`)
  receiver?: ReceiverResources; // what the receiver offset reads (#1410)
}
export interface DeferredSources {
  lighting: string;
  compose: CompositionSources;
  label: string;
  direct: boolean;
  bounce?: boolean;
  unboundedReflections?: boolean; // a reference session's rough trace (`reflectionTrace`, #33)
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
  placeholders: DeferredPlaceholders;
}

export type DeferredProgram = Awaited<ReturnType<typeof createDeferredProgram>>;

const HDR: GPUColorTargetState[] = [{ format: 'rgba16float' }];
/** A deferred-pass program: its modules, its pipelines compiled together off the thread (#1362),
 *  and the bind groups it keeps while its resources do not change. */
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
  const lightingLayout = createDeferredLightingLayout(device, sources.direct, sources.bounce);
  const [light, reflection, compositions] = await Promise.all([
    makeFullscreenPipeline(device, lighting, lightingLayout, 'lightSurface', HDR),
    sources.direct
      ? reflectionPipelines(device, sources.lighting, lightingLayout, sources)
      : undefined,
    createCompositions(device, sources.compose, sources.label),
  ]);
  /** What the light group names: rebuilt when one of them is replaced (`bindIdentity.ts`). */
  let identity = createWebgpuBindIdentity(),
    boundSurface: SurfaceBuffer | undefined,
    boundHdr: GPUTextureView | undefined,
    /** The bound surface's flags: the share the lit image is composed with. */
    boundFlags: GPUTextureView | undefined,
    lightGroup: GPUBindGroup | undefined;
  // The virtual shadow maps' stand-ins as a frame's group (`DirectLightResources.vsm`), made once:
  // a frame without maps binds them and allocates nothing.
  const vsmPlaceholders = {
    pageTable: bindings.placeholders.vsmPageTable,
    projectionData: bindings.placeholders.vsmProjectionData,
    uniforms: bindings.placeholders.vsmUniforms,
    pool: bindings.placeholders.vsmPool,
  };
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
        vsm = direct.vsm ?? vsmPlaceholders,
        mask = direct.vsmMask ?? placeholders.vsmMask,
        maskTiles = direct.vsmMaskTiles ?? placeholders.vsmMaskTiles,
        vsmTransmission = direct.vsmTransmission ?? placeholders.transmittanceView,
        probes = direct.probes,
        proxy = direct.proxy ?? placeholders.proxy,
        receiver = direct.receiver ?? placeholders.receiver;
      boundHdr = hdr;
      const { next } = identity;
      next[0] = surface;
      next[1] = lights;
      next[2] = tiles;
      next[3] = vsm.pageTable;
      next[4] = mask;
      next[5] = probes;
      next[6] = proxy;
      for (let i = 0; i < receiver.length; i++) next[7 + i] = receiver[i];
      next[7 + receiver.length] = vsm.projectionData;
      next[8 + receiver.length] = vsm.uniforms;
      next[9 + receiver.length] = vsmTransmission;
      next[10 + receiver.length] = maskTiles;
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
          ...receiverEntries(LIGHTING_RECEIVER_BINDING, receiver),
          { binding: SUBSURFACE_BINDING, resource: surface.subsurfaceView },
          { binding: 6, resource: { buffer: lights } },
          { binding: 7, resource: { buffer: tiles } },
          { binding: CONTRACT_VSM_BINDINGS.pageTable, resource: { buffer: vsm.pageTable } },
          {
            binding: CONTRACT_VSM_BINDINGS.projectionData,
            resource: { buffer: vsm.projectionData },
          },
          { binding: CONTRACT_VSM_BINDINGS.uniforms, resource: { buffer: vsm.uniforms } },
          // The resident proxy as-is, no copy: its header says whether there is anything to trace.
          { binding: RESIDENT_PROXY_BINDING, resource: { buffer: proxy } },
          { binding: CONTRACT_SHADOW_BINDINGS.transmittance, resource: mask },
          { binding: VSM_MASK_TABLE_BINDING, resource: placeholders.vsmMaskTable.view },
          { binding: VSM_MASK_TILES_BINDING, resource: maskTiles },
          { binding: VSM_TRANSMISSION_RESOLVE_BINDING, resource: vsmTransmission },
        );
      }
      if (sources.bounce && direct.bounceGrid && direct.probes && direct.surfaceCache)
        entries.push(
          { binding: 11, resource: { buffer: direct.bounceGrid } },
          { binding: 12, resource: direct.probes },
          { binding: BOUNCE_SURFACE_BINDING, resource: direct.surfaceCache },
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
