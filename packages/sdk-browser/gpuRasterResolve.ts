import type { GpuRasterInput } from './gpuRasterTypes.ts';

/**
 * Les résolutions matérielles plein écran du tampon de visibilité.
 *
 * Elles sont le SEUL producteur des attachements que le reste de l'image lit : la texture
 * d'identifiants, le tampon de profondeur opaque et le niveau zéro de la pyramide. C'est pourquoi
 * elles les effacent : plus aucune passe de géométrie ne les ouvre avant elles.
 *
 * `encodeHiz` ne touche que la pyramide, et sans tampon de profondeur : elle tourne quand aucun
 * identifiant n'a encore été départagé, et la pyramide ne lit que la profondeur linéaire.
 */
export function createRasterResolves(
  device: GPUDevice,
  code: string,
  work: GPUBuffer,
  targetBytes: number,
) {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const module = device.createShaderModule({ code });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const vertex = { module, entryPoint: 'vs' };
  const primitive = { topology: 'triangle-list' as const };
  const makeFinal = (two: boolean) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex,
      fragment: {
        module,
        entryPoint: two ? 'two' : 'one',
        targets: two
          ? [{ format: 'r32uint' as const }, { format: 'r32float' as const }]
          : [{ format: 'r32uint' as const }],
      },
      primitive,
      depthStencil: {
        format: 'depth32float' as const,
        depthWriteEnabled: true,
        depthCompare: 'less' as const,
      },
    });
  const one = makeFinal(false),
    two = makeFinal(true);
  const hizOnly = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex,
    fragment: { module, entryPoint: 'hiz', targets: [{ format: 'r32float' as const }] },
    primitive,
  });
  let group: GPUBindGroup | undefined;
  const bound = (uniform: GPUBuffer) =>
    (group ??= device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: work, offset: 0, size: targetBytes } },
        { binding: 1, resource: { buffer: uniform, offset: 0, size: 96 } },
      ],
    }));
  /** Une pièce jointe de couleur effacée à la valeur que son attachement attend. */
  const cleared = (view: GPUTextureView, r: number) => ({
    view,
    loadOp: 'clear' as const,
    storeOp: 'store' as const,
    clearValue: { r, g: 0, b: 0, a: 1 },
  });
  /**
   * Les deux descripteurs de passe, gardés tels quels jusqu'au prochain jeu de vues. Ils ne
   * dépendent que des vues, et les vues ne changent qu'au redimensionnement de la cible — qui
   * libère ce raster tout entier. Les reconstruire par image allouait sept objets pour réécrire
   * les mêmes champs.
   */
  let idsFor: GPUTextureView | undefined,
    depthFor: GPUTextureView | undefined,
    hizFor: GPUTextureView | undefined,
    hizPass: GPURenderPassDescriptor | undefined,
    finalPass: GPURenderPassDescriptor | undefined;
  /** Refait les deux descripteurs quand, et seulement quand, une des trois vues a changé. */
  const refresh = (input: GpuRasterInput) => {
    if (idsFor === input.idsView && depthFor === input.depthView && hizFor === input.hizView)
      return;
    idsFor = input.idsView;
    depthFor = input.depthView;
    hizFor = input.hizView;
    hizPass = { label: 'WG raster occluder hiz', colorAttachments: [cleared(input.hizView!, 1)] };
    finalPass = {
      label: 'WG raster resolve',
      colorAttachments: input.hizView
        ? [cleared(input.idsView, 0), cleared(input.hizView, 1)]
        : [cleared(input.idsView, 0)],
      depthStencilAttachment: {
        view: input.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    };
  };
  return {
    /** La profondeur des occulteurs, telle que la pyramide la réduit. Rien d'autre n'est écrit. */
    encodeHiz(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      refresh(input);
      const pass = encoder.beginRenderPass(hizPass!);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setPipeline(hizOnly);
      pass.setBindGroup(0, bound(input.uniform));
      pass.draw(3);
      pass.end();
    },
    /** L'image close : identifiants, profondeur, et la pyramide remise à la coupe entière. */
    encodeFinal(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      refresh(input);
      const pass = encoder.beginRenderPass(finalPass!);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setPipeline(input.hizView ? two : one);
      pass.setBindGroup(0, bound(input.uniform));
      pass.draw(3);
      pass.end();
    },
  };
}
