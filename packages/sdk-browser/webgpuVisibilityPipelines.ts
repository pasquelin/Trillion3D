import { SURFACE_FORMATS } from './surfaceBuffer.ts';
import { depthLayerBias } from '../sdk-core/index.ts';

/** Modes de face d'un jeu de couche, dans l'ordre : dos, aucune, face, dos inversé, face inversée. */
const LAYER_CULLS: Array<[GPUCullMode, GPUFrontFace]> = [
  ['back', 'ccw'],
  ['none', 'ccw'],
  ['front', 'ccw'],
  ['back', 'cw'],
  ['front', 'cw'],
];
const VIS_LAYER_CULLS = LAYER_CULLS.length;
/** Pipelines d'une couche : les cinq modes de face en occulteur, puis les mêmes en testé. */
const VIS_LAYER_PIPELINES = VIS_LAYER_CULLS * 2;
/** Rang d'un pipeline de couche dans `visLayerPipelines`. La couche 0 n'y figure pas. */
export const visLayerPipelineIndex = (layer: number, rest: boolean, cull: number) =>
  (layer - 1) * VIS_LAYER_PIPELINES + (rest ? VIS_LAYER_CULLS : 0) + cull;

async function scoped<T>(device: GPUDevice, run: () => T): Promise<T> {
  if (typeof device.pushErrorScope === 'function') device.pushErrorScope('validation');
  const value = run();
  const error = typeof device.popErrorScope === 'function' ? await device.popErrorScope() : null;
  if (error) throw error;
  return value;
}

/** Builds the visibility variants used by the selected Hi-Z or fallback path. */
export function createWebgpuVisibilityRasterPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
) {
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const depth: GPUDepthStencilState = {
    format: 'depth32float',
    depthWriteEnabled: true,
    depthCompare: 'less',
  };
  const targets: GPUColorTargetState[] = hiz
    ? [{ format: 'r32uint' }, { format: 'r32float' }]
    : [{ format: 'r32uint' }];
  const make = (
    vertex: string,
    fragment: string,
    cullMode: GPUCullMode,
    frontFace: GPUFrontFace = 'ccw',
  ) =>
    device.createRenderPipeline({
      layout,
      vertex: { module: visModule, entryPoint: vertex },
      fragment: { module: visModule, entryPoint: fragment, targets },
      primitive: { topology: 'triangle-list', cullMode, frontFace },
      depthStencil: depth,
    });
  return scoped(device, () => {
    const fragment = hiz ? 'vis_hiz_fs' : 'vis_fs';
    return {
      visPipelineBack: make('vis_vs', fragment, 'back'),
      visPipelineBackCw: make('vis_vs', fragment, 'back', 'cw'),
      visPipelineNone: make('vis_vs', fragment, 'none'),
      visPipelineFront: make('vis_vs', fragment, 'front'),
      visPipelineFrontCw: make('vis_vs', fragment, 'front', 'cw'),
      visHizRestBack: hiz ? make('vis_hiz_vs', fragment, 'back') : undefined,
      visHizRestNone: hiz ? make('vis_hiz_vs', fragment, 'none') : undefined,
      visHizRestFront: hiz ? make('vis_hiz_vs', fragment, 'front') : undefined,
      visHizRestBackCw: hiz ? make('vis_hiz_vs', fragment, 'back', 'cw') : undefined,
      visHizRestFrontCw: hiz ? make('vis_hiz_vs', fragment, 'front', 'cw') : undefined,
    };
  });
}

/**
 * Les pipelines des couches coplanaires au-dessus de 0. Une couche n'est qu'un décalage de
 * profondeur entier sur le même pipeline : même module, même état, même ordre de dessin. Les cibles
 * et les entrées suivent celles que la couche 0 a retenues, Hi-Z compris, pour que les deux passes
 * écrivent les mêmes attachements. `layerSlots` à 1 ne crée rien.
 */
export function createWebgpuCoplanarLayerPipelines(
  device: GPUDevice,
  visModule: GPUShaderModule,
  bindGroupLayout: GPUBindGroupLayout,
  hiz: boolean,
  layerSlots: number,
) {
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const targets: GPUColorTargetState[] = hiz
    ? [{ format: 'r32uint' }, { format: 'r32float' }]
    : [{ format: 'r32uint' }];
  const fragment = hiz ? 'vis_hiz_fs' : 'vis_fs';
  return scoped(device, () => {
    const pipelines: GPURenderPipeline[] = [];
    for (let layer = 1; layer < layerSlots; layer++)
      for (const rest of [false, true])
        for (const [cullMode, frontFace] of LAYER_CULLS)
          pipelines.push(
            device.createRenderPipeline({
              layout,
              vertex: { module: visModule, entryPoint: rest && hiz ? 'vis_hiz_vs' : 'vis_vs' },
              fragment: { module: visModule, entryPoint: fragment, targets },
              primitive: { topology: 'triangle-list', cullMode, frontFace },
              depthStencil: {
                format: 'depth32float',
                depthWriteEnabled: true,
                depthCompare: 'less',
                depthBias: depthLayerBias(layer),
              },
            }),
          );
    return pipelines;
  });
}

/** Builds the material resolve pipeline after shader compilation succeeds. */
export function createWebgpuShadePipeline(device: GPUDevice, shadeModule: GPUShaderModule) {
  const shadeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      {
        binding: 8,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: 256 },
      },
      {
        binding: 9,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      {
        binding: 10,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float', viewDimension: '2d-array' },
      },
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  return scoped(device, () => ({
    shadeBindGroupLayout,
    shadePipeline: device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [shadeBindGroupLayout] }),
      vertex: { module: shadeModule, entryPoint: 'shade_vs' },
      fragment: {
        module: shadeModule,
        entryPoint: 'shade_fs',
        targets: SURFACE_FORMATS.map((format) => ({ format })),
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  }));
}
