import { BLEND_SHADER } from './webgpuBlendShader.ts';
import { FEEDBACK_FORMAT } from './surfaceBuffer.ts';
import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { BLEND_BINDINGS, atlasLayoutEntries, readOnly } from './webgpuBindLayout.ts';
import { VOLUME_SIZE } from './webgpuTransmission.ts';
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from './diagnosticGpuVariant.ts';
import { DEPTH_COMPARE } from './depthConvention.ts';

/** Builds the forward-material pipelines for transparent draws. */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: BlendGpuItem[],
  variant?: DiagnosticGpuVariant,
) {
  const b = BLEND_BINDINGS;
  // Sans variante, le module et les cibles sont exactement ceux d'avant : la production ne compile
  // aucun étage de diagnostic et n'a aucun masque d'écriture à elle.
  const { entryPoint, writeMask } = blendVariantPipeline(variant);
  const blendBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.positions, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.uvs, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      {
        binding: b.uniform,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: BLEND_VIEW_SIZE },
      },
      // La fiche de chaque item, lue au rang que l'indice de sommet porte : c'est elle qui remplace
      // le decalage dynamique d'uniforme, et donc le groupe de liaison par appel.
      { binding: b.items, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ...atlasLayoutEntries(b.data),
      { binding: b.normals, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.directLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.clusterDiagnostic, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.planInstances, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.clusterSpans, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.shadowSlices, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.shadowAtlas,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth' },
      },
      {
        binding: b.shadowSampler,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'comparison' },
      },
      { binding: b.bounceGrid, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: b.probes, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.tileLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      // Le proxy résident de l'ombre lointaine du soleil : en **lecture seule**, et c'est la
      // condition du rejet anticipé de profondeur de toute la passe. Une liaison accessible en
      // écriture depuis l'étage de fragments oblige le processeur graphique à ombrer chaque fragment
      // avant de le tester, effet de bord oblige — ici 4232 appels de fragments entièrement cachés
      // derrière l'opaque. Le rayon d'ombre est le même ; seuls les deux compteurs du relevé restent
      // à la résolution différée, qui, elle, peut écrire. C'est la huitième et dernière liaison de
      // stockage de cet étage de fragments, celle que la norme garantit encore.
      { binding: b.proxy, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.volume,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: VOLUME_SIZE },
      },
      {
        binding: b.backdrop,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d' },
      },
      {
        binding: b.backdropDepth,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'depth', viewDimension: '2d' },
      },
    ],
  });
  const blendModule = device.createShaderModule({
    code: variant ? BLEND_SHADER + DIAGNOSTIC_BLEND_WGSL : BLEND_SHADER,
  });
  const makeBlend = (cullMode: GPUCullMode) => {
    const descriptor: GPURenderPipelineDescriptor = {
      layout: device.createPipelineLayout({ bindGroupLayouts: [blendBindGroupLayout] }),
      vertex: { module: blendModule, entryPoint: 'vs' },
      fragment: {
        module: blendModule,
        entryPoint,
        targets: [
          {
            format: 'rgba16float' as GPUTextureFormat,
            writeMask,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
          // Le rang de tuile que le pixel demande aux textures virtuelles : une cible entière, sans
          // mélange, que la réduction relit après la passe.
          { format: FEEDBACK_FORMAT },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
      depthStencil: {
        format: 'depth32float',
        depthWriteEnabled: false,
        depthCompare: DEPTH_COMPARE,
      },
    };
    return device.createRenderPipelineAsync
      ? device.createRenderPipelineAsync(descriptor)
      : Promise.resolve(device.createRenderPipeline(descriptor));
  };
  for (const item of items) item.group = undefined;
  const pipelineBlendTextured = await makeBlend('none'),
    pipelineBlendFront = await makeBlend('front'),
    pipelineBlendBack = await makeBlend('back');
  return { blendBindGroupLayout, pipelineBlendTextured, pipelineBlendFront, pipelineBlendBack };
}
