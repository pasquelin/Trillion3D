import type { SurfaceBuffer } from './surfaceBuffer.ts';
import { createDeferredLayouts } from './deferredLightingSetup.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Construit un pipeline plein écran, en asynchrone quand l'appareil le propose. */
function makeFullscreenPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  bind: GPUBindGroupLayout,
  entryPoint: string,
  formats: GPUTextureFormat[],
) {
  const descriptor: GPURenderPipelineDescriptor = {
    layout: device.createPipelineLayout({ bindGroupLayouts: [bind] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint, targets: formats.map((format) => ({ format })) },
    primitive: { topology: 'triangle-list' },
  };
  return device.createRenderPipelineAsync
    ? device.createRenderPipelineAsync(descriptor)
    : Promise.resolve(device.createRenderPipeline(descriptor));
}

/** Les ressources du contrat d'éclairage direct que la passe relit ; absentes, elles sont remplacées. */
export interface DirectLightResources {
  tiles?: GPUBuffer;
  slices?: GPUBuffer;
  atlas?: GPUTextureView;
}
export interface DeferredSources {
  lighting: string;
  compose: string;
  label: string;
  direct: boolean;
}
export interface DeferredBindings {
  uniform: GPUBuffer;
  sceneLights: GPUBuffer;
  directLights: GPUBuffer;
  placeholders: {
    tiles: GPUBuffer;
    slices: GPUBuffer;
    atlasView: GPUTextureView;
    sampler: GPUSampler;
  };
}

export type DeferredProgram = Awaited<ReturnType<typeof createDeferredProgram>>;

/**
 * Un programme de la passe différée : ses deux modules, ses trois pipelines, et les groupes de
 * liaison qu'il garde tant que ses ressources ne changent pas. Le moteur en tient deux — celui de la
 * scène écrite et celui du contrat — et ne compile le second que lorsqu'une lampe le demande.
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
  const layouts = createDeferredLayouts(device, sources.direct);
  const make = makeFullscreenPipeline;
  const light = await make(device, modules[0], layouts.lighting, 'lightSurface', ['rgba16float']);
  const compose = await make(device, modules[1], layouts.composition, 'compose', ['rgba8unorm']);
  const composePresent = await make(device, modules[1], layouts.composition, 'composePresent', [
    'rgba8unorm',
    'bgra8unorm',
  ]);
  let boundSurface: SurfaceBuffer | undefined,
    boundTiles: GPUBuffer | undefined,
    boundAtlas: GPUTextureView | undefined,
    lightGroup: GPUBindGroup | undefined,
    composeGroup: GPUBindGroup | undefined;
  return {
    light,
    compose,
    composePresent,
    get lightGroup() {
      return lightGroup;
    },
    get composeGroup() {
      return composeGroup;
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
        atlas = direct.atlas ?? placeholders.atlasView;
      if (boundSurface === surface && boundTiles === tiles && boundAtlas === atlas) return;
      boundSurface = surface;
      boundTiles = tiles;
      boundAtlas = atlas;
      const entries: GPUBindGroupEntry[] = [
        ...surface.views().map((resource, binding) => ({ binding, resource })),
        { binding: 4, resource: depth },
        { binding: 5, resource: { buffer: bindings.uniform } },
        { binding: 6, resource: { buffer: bindings.sceneLights } },
      ];
      if (sources.direct)
        entries.push(
          { binding: 7, resource: { buffer: bindings.directLights } },
          { binding: 8, resource: { buffer: tiles } },
          { binding: 9, resource: { buffer: slices } },
          { binding: 10, resource: atlas },
          { binding: 11, resource: placeholders.sampler },
        );
      lightGroup = device.createBindGroup({ layout: layouts.lighting, entries });
      composeGroup = device.createBindGroup({
        layout: layouts.composition,
        entries: [
          { binding: 0, resource: hdr },
          { binding: 1, resource: { buffer: bindings.uniform } },
        ],
      });
    },
    release() {
      boundSurface = undefined;
      boundTiles = undefined;
      boundAtlas = undefined;
      lightGroup = undefined;
      composeGroup = undefined;
    },
  };
}
