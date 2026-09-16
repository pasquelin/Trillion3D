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
  return {
    /** La profondeur des occulteurs, telle que la pyramide la réduit. Rien d'autre n'est écrit. */
    encodeHiz(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      const pass = encoder.beginRenderPass({
        label: 'WG raster occluder hiz',
        colorAttachments: [
          {
            view: input.hizView!,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 1, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setPipeline(hizOnly);
      pass.setBindGroup(0, bound(input.uniform));
      pass.draw(3);
      pass.end();
    },
    /** L'image close : identifiants, profondeur, et la pyramide remise à la coupe entière. */
    encodeFinal(
      encoder: GPUCommandEncoder,
      input: GpuRasterInput,
      width: number,
      height: number,
    ) {
      const view = input.hizView;
      const pass = encoder.beginRenderPass({
        label: 'WG raster resolve',
        colorAttachments: [
          {
            view: input.idsView,
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
          ...(view
            ? [
                {
                  view,
                  loadOp: 'clear' as const,
                  storeOp: 'store' as const,
                  clearValue: { r: 1, g: 0, b: 0, a: 1 },
                },
              ]
            : []),
        ],
        depthStencilAttachment: {
          view: input.depthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.setPipeline(view ? two : one);
      pass.setBindGroup(0, bound(input.uniform));
      pass.draw(3);
      pass.end();
    },
  };
}
